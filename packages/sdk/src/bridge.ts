import {
  LEGACY_SPATIAL_REVIEW_CATALOG,
  LEGACY_SPATIAL_REVIEW_READY,
  LEGACY_SPATIAL_REVIEW_REQUEST,
  OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN,
  SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY,
  SPATIAL_REVIEW_ASSET_CANCEL,
  SPATIAL_REVIEW_ASSET_PROGRESS,
  SPATIAL_REVIEW_ASSET_REQUEST,
  SPATIAL_REVIEW_ASSET_RESPONSE,
  SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY,
  SPATIAL_REVIEW_CATALOG,
  SPATIAL_REVIEW_GEOMETRY_TRANSFER_CAPABILITY,
  SPATIAL_REVIEW_PROGRESSIVE_CAPABILITY,
  SPATIAL_REVIEW_READY,
  SPATIAL_REVIEW_REQUEST,
  SPATIAL_REVIEW_RESOURCE_REQUEST,
  SPATIAL_REVIEW_RESOURCE_RESPONSE,
  SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY,
  type AssetRepresentationDescriptor,
  type SpatialReviewAssetCancelMessage,
  type SpatialReviewAssetProgressMessage,
  type SpatialReviewAssetRequest,
  type SpatialReviewAssetResponse,
  type SpatialReviewCatalogRequest,
  type SpatialReviewProfile,
  type SpatialReviewResourceRequest,
  type SpatialReviewResourceResponse,
  type SpatialReviewResourceTransferOffer,
  type SpatialReviewSourceStatusMessage,
} from "@alterno-dev/spatial-review-protocol";
import { prepareAssetTransfer } from "./geometry-transfer.js";
import type { SceneAssetRegistry, SceneAssetRepresentationProgress } from "./registry.js";

const DEFAULT_MAX_RESOURCE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_GEOMETRY_BYTES = 64 * 1024 * 1024;

export type SceneAssetRegistryBridgeOptions = {
  /** Trust the official Alterno editor origin. Defaults to true. */
  allowOfficialEditor?: boolean;
  allowedOrigins?: Iterable<string>;
  allowOrigin?: (origin: string) => boolean;
  maxResourceBytes?: number;
  /** Outer ceiling for a single legacy or streamed representation. */
  maxGeometryBytes?: number;
  maxConcurrentAssetRequests?: number;
  maxInFlightBytes?: number;
  maxQueuedAssetRequests?: number;
  progressIntervalMs?: number;
};

type StreamJob = {
  target: Window;
  origin: string;
  request: SpatialReviewAssetRequest;
  profile: SpatialReviewProfile;
  representation: AssetRepresentationDescriptor;
  maxBytes: number;
  reservation: number;
  sequence: number;
  controller: AbortController;
  terminal: boolean;
  lastProgressAt: number;
  lastProgressPhase?: SpatialReviewAssetProgressMessage["phase"];
};

type PeerState = {
  origin: string;
  resourceLimit: number;
  geometryLimit: number;
  progressive: boolean;
  stream: boolean;
  readyForStatus: boolean;
  queue: StreamJob[];
  active: Map<string, StreamJob>;
  inFlightBytes: number;
  lastStatusAt: number;
  lastStatusPhase?: SpatialReviewSourceStatusMessage["phase"];
  lastStatusActiveRequests?: number;
};

function loopback(origin: string) {
  try {
    const hostname = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function positiveLimit(value: unknown, fallback: number, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isFinite(value) && Number(value) > 0 ? Math.min(maximum, Math.floor(Number(value))) : fallback;
}

function offeredLimit(value: unknown) {
  const offer = value as Partial<SpatialReviewResourceTransferOffer> | null;
  return offer?.capability === SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY && Number.isFinite(offer.maxBytes) && Number(offer.maxBytes) > 0
    ? Math.floor(Number(offer.maxBytes))
    : undefined;
}

function priorityValue(priority: "interactive" | "visible" | "background") {
  return priority === "interactive" ? 0 : priority === "visible" ? 1 : 2;
}

export function attachSceneAssetRegistryBridge(registry: SceneAssetRegistry, options: SceneAssetRegistryBridgeOptions = {}) {
  const configured = new Set([...(options.allowedOrigins ?? [])].flatMap((origin) => {
    try { return [new URL(origin).origin]; } catch { return []; }
  }));
  if (options.allowOfficialEditor !== false) configured.add(OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN);
  configured.add(window.location.origin);
  const allowed = (origin: string) => configured.has(origin) || Boolean(options.allowOrigin?.(origin)) || (loopback(window.location.origin) && loopback(origin));
  const maxResourceBytes = positiveLimit(options.maxResourceBytes, DEFAULT_MAX_RESOURCE_BYTES, 1024 * 1024 * 1024);
  const maxGeometryBytes = positiveLimit(options.maxGeometryBytes, DEFAULT_MAX_GEOMETRY_BYTES, 1024 * 1024 * 1024);
  const maxConcurrentRequests = positiveLimit(options.maxConcurrentAssetRequests, 2, 16);
  const maxInFlightBytes = positiveLimit(options.maxInFlightBytes, maxGeometryBytes * maxConcurrentRequests, 1024 * 1024 * 1024);
  const maxQueuedRequests = positiveLimit(options.maxQueuedAssetRequests, 32, 256);
  const progressIntervalMs = positiveLimit(options.progressIntervalMs, 100, 10_000);
  const resourceTransfer = { capability: SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY, maxBytes: maxResourceBytes } satisfies SpatialReviewResourceTransferOffer;
  const geometryTransfer = { capability: SPATIAL_REVIEW_GEOMETRY_TRANSFER_CAPABILITY, maxBytes: maxGeometryBytes } as const;
  const assetStream = { capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY, maxConcurrentRequests, maxInFlightBytes } as const;
  const peerStates = new Map<Window, PeerState>();
  const legacyPending = new WeakMap<Window, number>();
  const seenRequests = new WeakMap<Window, Set<string>>();
  const timers = new Set<number>();
  let sequence = 0;
  let disposed = false;

  const schedule = (callback: () => void) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, 0);
    timers.add(timer);
  };
  const stateFor = (target: Window, origin: string) => {
    let state = peerStates.get(target);
    if (!state) {
      state = { origin, resourceLimit: maxResourceBytes, geometryLimit: maxGeometryBytes, progressive: false, stream: false, readyForStatus: false, queue: [], active: new Map(), inFlightBytes: 0, lastStatusAt: 0 };
      peerStates.set(target, state);
    }
    state.origin = origin;
    return state;
  };
  const post = (target: Window, origin: string, message: unknown, transfer: Transferable[] = []) => {
    if (disposed) return;
    try { target.postMessage(message, origin, transfer); } catch { /* The requesting frame or popup may have closed. */ }
  };
  const responseBase = (request: SpatialReviewAssetRequest, profile: SpatialReviewProfile) => ({
    type: SPATIAL_REVIEW_ASSET_RESPONSE,
    requestId: request.requestId,
    assetId: request.assetId,
    buildId: registry.buildId,
    profile,
  } as const);
  const ready = {
    type: SPATIAL_REVIEW_READY,
    buildId: registry.buildId,
    actors: registry.size,
    assemblies: registry.assemblySize,
    navigationSequences: registry.navigationSize,
    capabilities: [SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY, SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY, SPATIAL_REVIEW_PROGRESSIVE_CAPABILITY, SPATIAL_REVIEW_GEOMETRY_TRANSFER_CAPABILITY, SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY],
    resourceTransfer,
    geometryTransfer,
  };
  const postReady = () => {
    if (window.parent !== window) {
      window.parent.postMessage(ready, "*");
      window.parent.postMessage({ ...ready, type: LEGACY_SPATIAL_REVIEW_READY }, "*");
    }
    window.opener?.postMessage(ready, "*");
    window.opener?.postMessage({ ...ready, type: LEGACY_SPATIAL_REVIEW_READY }, "*");
  };

  const activeRequestCount = () => [...peerStates.values()].reduce((total, state) => total + state.active.size, 0);
  const postStatus = (target: Window, state: PeerState, status: SpatialReviewSourceStatusMessage, force = false) => {
    if (!state.stream || !state.readyForStatus) return;
    const now = Date.now();
    if (!force && state.lastStatusPhase === status.phase && state.lastStatusActiveRequests === status.activeRequests && now - state.lastStatusAt < progressIntervalMs) return;
    state.lastStatusAt = now;
    state.lastStatusPhase = status.phase;
    state.lastStatusActiveRequests = status.activeRequests;
    post(target, state.origin, status);
  };
  const broadcastStatus = (status = registry.getSourceStatus(), force = false) => {
    const globalStatus = { ...status, activeRequests: activeRequestCount() };
    peerStates.forEach((state, target) => postStatus(target, state, globalStatus, force));
  };
  const stopStatusListener = registry.onSourceStatus((status) => broadcastStatus(status));

  const onResourceRequest = async (event: MessageEvent, request: SpatialReviewResourceRequest) => {
    const target = event.source as Window;
    if (!request.requestId || request.requestId.length > 200 || !request.resourceId || request.resourceId.length > 500) return;
    if (!registry.hasTextureResource(request.resourceId)) {
      post(target, event.origin, { type: SPATIAL_REVIEW_RESOURCE_RESPONSE, requestId: request.requestId, resourceId: request.resourceId, ok: false, error: "not-found", message: "The requested live texture is not registered." } satisfies SpatialReviewResourceResponse);
      return;
    }
    try {
      const resource = await registry.readTextureResource(request.resourceId, stateFor(target, event.origin).resourceLimit);
      if (!resource) return;
      post(target, event.origin, { type: SPATIAL_REVIEW_RESOURCE_RESPONSE, requestId: request.requestId, resourceId: request.resourceId, ok: true, contentType: resource.contentType, bytes: resource.bytes } satisfies SpatialReviewResourceResponse, [resource.bytes]);
    } catch (error) {
      const tooLarge = error instanceof RangeError;
      post(target, event.origin, { type: SPATIAL_REVIEW_RESOURCE_RESPONSE, requestId: request.requestId, resourceId: request.resourceId, ok: false, error: tooLarge ? "too-large" : "unavailable", message: error instanceof Error ? error.message : "The live texture could not be transferred." } satisfies SpatialReviewResourceResponse);
    }
  };

  const postProgress = (job: StreamJob, progress: SceneAssetRepresentationProgress | { phase: "queued" }, force = false) => {
    if (job.terminal || job.controller.signal.aborted) return;
    const now = Date.now();
    if (!force && job.lastProgressPhase === progress.phase && now - job.lastProgressAt < progressIntervalMs) return;
    job.lastProgressAt = now;
    job.lastProgressPhase = progress.phase;
    const completed = "completed" in progress && typeof progress.completed === "number" && Number.isFinite(progress.completed) && progress.completed >= 0 ? progress.completed : undefined;
    const total = "total" in progress && typeof progress.total === "number" && Number.isFinite(progress.total) && progress.total > 0 ? progress.total : undefined;
    post(job.target, job.origin, {
      type: SPATIAL_REVIEW_ASSET_PROGRESS,
      requestId: job.request.requestId,
      buildId: registry.buildId,
      assetId: job.request.assetId,
      representationId: job.representation.id,
      phase: progress.phase,
      ...(completed !== undefined ? { completed } : {}),
      ...(total !== undefined && (completed === undefined || completed <= total) ? { total } : {}),
    } satisfies SpatialReviewAssetProgressMessage);
  };

  const finishJob = (_state: PeerState, job: StreamJob, response: SpatialReviewAssetResponse, transfer: Transferable[] = []) => {
    if (job.terminal) return;
    job.terminal = true;
    post(job.target, job.origin, response, transfer);
  };
  const releaseJob = (state: PeerState, job: StreamJob) => {
    if (state.active.get(job.request.requestId) !== job) return false;
    state.active.delete(job.request.requestId);
    state.inFlightBytes = Math.max(0, state.inFlightBytes - job.reservation);
    return true;
  };
  const syncActiveRequestStatus = () => {
    const current = registry.getSourceStatus();
    registry.setSourceStatus({
      phase: current.phase === "catalog-ready" && activeRequestCount() > 0 ? "streaming" : current.phase,
      expectedActors: current.expectedActors,
      readyActors: current.readyActors,
      activeRequests: activeRequestCount(),
      message: current.message,
    });
  };

  const pump = (target: Window, state: PeerState) => {
    if (disposed || !state.stream) return;
    while (state.active.size < maxConcurrentRequests) {
      const index = state.queue.findIndex((job) => state.inFlightBytes + job.reservation <= maxInFlightBytes);
      if (index < 0) break;
      const [job] = state.queue.splice(index, 1);
      state.active.set(job.request.requestId, job);
      state.inFlightBytes += job.reservation;
      syncActiveRequestStatus();
      postProgress(job, { phase: "generating" }, true);
      void (async () => {
        const base = responseBase(job.request, job.profile);
        try {
          const result = await registry.produceAssetRepresentation(job.request.assetId, job.profile, job.representation.id, job.maxBytes,
            job.request.stream!.priority, job.controller.signal, (progress) => postProgress(job, progress));
          if (job.controller.signal.aborted) throw new DOMException("Asset representation request was cancelled.", "AbortError");
          if (!result) {
            finishJob(state, job, { ...base, ok: false, error: "not-found", representationId: job.representation.id, revision: job.representation.revision });
          } else {
            if (job.controller.signal.aborted) throw new DOMException("Asset representation request was cancelled.", "AbortError");
            finishJob(state, job, { ...base, ok: true, asset: result.asset, representationId: result.representation.id, revision: result.representation.revision, notModified: false }, result.transfer);
          }
        } catch (error) {
          const cancelled = job.controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
          finishJob(state, job, { ...base, ok: false, error: cancelled ? "cancelled" : error instanceof RangeError ? "too-large" : "unavailable", representationId: job.representation.id, revision: job.representation.revision });
        } finally {
          if (releaseJob(state, job)) syncActiveRequestStatus();
          pump(target, state);
        }
      })();
    }
  };

  const onStreamRequest = (event: MessageEvent, request: SpatialReviewAssetRequest, state: PeerState) => {
    const target = event.source as Window;
    const profile: SpatialReviewProfile = request.profile === "scene" ? "scene" : "review";
    const base = responseBase(request, profile);
    const stream = request.stream;
    if (!state.stream || !stream || stream.capability !== SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY) {
      post(target, event.origin, { ...base, ok: false, error: "unavailable" });
      return;
    }
    if ((request.profile !== "scene" && request.profile !== "review") || !stream.representationId || stream.representationId.length > 200 || !Number.isSafeInteger(stream.maxBytes) || stream.maxBytes <= 0 || stream.maxBytes > 1024 * 1024 * 1024
      || !["interactive", "visible", "background"].includes(stream.priority) || (stream.knownRevision !== undefined && (!stream.knownRevision || stream.knownRevision.length > 200))) {
      post(target, event.origin, { ...base, ok: false, error: "unavailable" });
      return;
    }
    if (state.active.has(request.requestId) || state.queue.some((job) => job.request.requestId === request.requestId)) return;
    const descriptor = registry.getAssetStreamDescriptor(request.assetId, profile);
    const representation = descriptor?.representations.find((candidate) => candidate.id === stream.representationId);
    if (!representation) {
      post(target, event.origin, { ...base, ok: false, error: "not-found" });
      return;
    }
    if (stream.knownRevision === representation.revision
      && registry.canReuseAssetRepresentation(request.assetId, profile, representation.id, representation.revision)) {
      post(target, event.origin, { ...base, ok: true, notModified: true, representationId: representation.id, revision: representation.revision });
      return;
    }
    const maxBytes = Math.min(state.geometryLimit, maxInFlightBytes, stream.maxBytes);
    if (representation.estimatedBytes > maxBytes) {
      post(target, event.origin, { ...base, ok: false, error: "too-large", representationId: representation.id, revision: representation.revision });
      return;
    }
    if (state.queue.length + state.active.size >= maxQueuedRequests + maxConcurrentRequests) {
      post(target, event.origin, { ...base, ok: false, error: "busy", representationId: representation.id, revision: representation.revision, retryAfterMs: 100 });
      return;
    }
    const job: StreamJob = { target, origin: event.origin, request, profile, representation, maxBytes, reservation: maxBytes, sequence: sequence++, controller: new AbortController(), terminal: false, lastProgressAt: 0 };
    state.queue.push(job);
    state.queue.sort((left, right) => priorityValue(left.request.stream!.priority) - priorityValue(right.request.stream!.priority) || left.sequence - right.sequence);
    postProgress(job, { phase: "queued" }, true);
    pump(target, state);
  };

  const onLegacyAssetRequest = (event: MessageEvent, request: SpatialReviewAssetRequest, state: PeerState) => {
    const target = event.source as Window;
    const limit = state.geometryLimit;
    const profile: SpatialReviewProfile = request.profile === "scene" ? "scene" : "review";
    const response = responseBase(request, profile);
    if ((legacyPending.get(target) ?? 0) >= 4) {
      post(target, event.origin, { ...response, ok: false, error: "busy" } satisfies SpatialReviewAssetResponse);
      return;
    }
    legacyPending.set(target, (legacyPending.get(target) ?? 0) + 1);
    schedule(() => {
      try {
        const source = registry.toAsset(request.assetId, profile, true, limit);
        if (!source) post(target, event.origin, { ...response, ok: false, error: "not-found" } satisfies SpatialReviewAssetResponse);
        else {
          const prepared = prepareAssetTransfer(source, limit);
          post(target, event.origin, { ...response, ok: true, asset: prepared.asset } satisfies SpatialReviewAssetResponse, prepared.transfer);
        }
      } catch (error) {
        post(target, event.origin, { ...response, ok: false, error: error instanceof RangeError ? "too-large" : "unavailable" } satisfies SpatialReviewAssetResponse);
      } finally {
        legacyPending.set(target, Math.max(0, (legacyPending.get(target) ?? 1) - 1));
      }
    });
  };

  const onAssetRequest = (event: MessageEvent, request: SpatialReviewAssetRequest) => {
    const target = event.source as Window;
    const state = stateFor(target, event.origin);
    if (request.buildId !== registry.buildId || typeof request.assetId !== "string" || !request.assetId || request.assetId.length > 500
      || typeof request.requestId !== "string" || !request.requestId || request.requestId.length > 200) return;
    if (request.stream) onStreamRequest(event, request, state);
    else onLegacyAssetRequest(event, request, state);
  };

  const onCancel = (event: MessageEvent, request: SpatialReviewAssetCancelMessage) => {
    const target = event.source as Window;
    const state = peerStates.get(target);
    if (!state?.stream || state.origin !== event.origin || request.buildId !== registry.buildId || typeof request.requestId !== "string" || !request.requestId || request.requestId.length > 200) return;
    const queuedIndex = state.queue.findIndex((job) => job.request.requestId === request.requestId);
    if (queuedIndex >= 0) {
      const [job] = state.queue.splice(queuedIndex, 1);
      finishJob(state, job, { ...responseBase(job.request, job.profile), ok: false, error: "cancelled", representationId: job.representation.id, revision: job.representation.revision });
      pump(target, state);
      return;
    }
    const active = state.active.get(request.requestId);
    if (active) {
      active.controller.abort();
      finishJob(state, active, { ...responseBase(active.request, active.profile), ok: false, error: "cancelled", representationId: active.representation.id, revision: active.representation.revision });
      if (releaseJob(state, active)) syncActiveRequestStatus();
      pump(target, state);
    }
  };

  const onCatalogRequest = (event: MessageEvent, request: SpatialReviewCatalogRequest) => {
    const legacy = request.type === LEGACY_SPATIAL_REVIEW_REQUEST;
    const profile: SpatialReviewProfile = request.profile === "scene" ? "scene" : "review";
    const target = event.source as Window;
    if (request.requestId) {
      if (typeof request.requestId !== "string" || request.requestId.length > 200) return;
      const seen = seenRequests.get(target) ?? new Set<string>();
      if (seen.has(request.requestId)) return;
      seen.add(request.requestId);
      if (seen.size > 128) seen.delete(seen.values().next().value!);
      seenRequests.set(target, seen);
    }
    const state = stateFor(target, event.origin);
    const previousStream = state.stream;
    const previousGeometryLimit = state.geometryLimit;
    const requestedLimit = offeredLimit(request.resourceTransfer);
    state.resourceLimit = requestedLimit ? Math.min(maxResourceBytes, requestedLimit) : maxResourceBytes;
    const offeredGeometry = request.geometryTransfer;
    const progressive = request.progressive === true && offeredGeometry?.capability === SPATIAL_REVIEW_GEOMETRY_TRANSFER_CAPABILITY
      && Number.isFinite(offeredGeometry.maxBytes) && offeredGeometry.maxBytes > 0;
    state.progressive = progressive;
    state.geometryLimit = progressive ? Math.min(maxGeometryBytes, Math.floor(offeredGeometry!.maxBytes)) : maxGeometryBytes;
    const stream = !legacy && progressive && Array.isArray(request.capabilities) && request.capabilities.includes(SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY);
    state.stream = stream;
    state.readyForStatus = false;
    const streamBudgetLowered = previousStream && stream && state.geometryLimit < previousGeometryLimit;
    if (!stream || streamBudgetLowered) {
      state.queue.splice(0).forEach((job) => {
        finishJob(state, job, { ...responseBase(job.request, job.profile), ok: false, error: "cancelled", representationId: job.representation.id, revision: job.representation.revision });
        job.controller.abort();
      });
      state.active.forEach((job) => {
        finishJob(state, job, { ...responseBase(job.request, job.profile), ok: false, error: "cancelled", representationId: job.representation.id, revision: job.representation.revision });
        job.controller.abort();
        releaseJob(state, job);
      });
      syncActiveRequestStatus();
    }
    schedule(() => {
      try {
        // Another request from this peer may have changed the connection-wide
        // negotiation before this deferred serialization runs. Intersect this
        // request with the current state so the response never advertises a
        // transport that subsequent messages cannot use.
        const responseProgressive = progressive && state.progressive;
        const responseStream = stream && state.stream && responseProgressive;
        const responseResourceLimit = Math.min(state.resourceLimit, requestedLimit ? Math.min(maxResourceBytes, requestedLimit) : maxResourceBytes);
        const responseGeometryLimit = Math.min(state.geometryLimit, progressive ? Math.min(maxGeometryBytes, Math.floor(offeredGeometry!.maxBytes)) : maxGeometryBytes);
        const payload = registry.toReviewIndex(profile, legacy, responseProgressive, !legacy && Array.isArray(request.capabilities) && request.capabilities.includes(SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY), responseStream);
        post(target, event.origin, {
          type: legacy ? LEGACY_SPATIAL_REVIEW_CATALOG : SPATIAL_REVIEW_CATALOG,
          profile,
          requestId: request.requestId,
          payload,
          resourceTransfer: { ...resourceTransfer, maxBytes: responseResourceLimit },
          ...(responseProgressive ? { progressive: true, geometryTransfer: { ...geometryTransfer, maxBytes: responseGeometryLimit } } : {}),
          ...(responseStream ? { assetStream } : {}),
        });
        state.readyForStatus = state.stream && (state.readyForStatus || responseStream);
        if (responseStream) postStatus(target, state, registry.getSourceStatus(), true);
      } catch { /* Peer closed or the scene changed during capture. */ }
    });
  };

  const onMessage = (event: MessageEvent) => {
    if (disposed || !allowed(event.origin) || (event.source !== window.parent && event.source !== window.opener)) return;
    const request = event.data as (SpatialReviewCatalogRequest & { resourceId?: string; assetId?: string }) | null;
    if (request?.type === SPATIAL_REVIEW_RESOURCE_REQUEST) { void onResourceRequest(event, request as SpatialReviewResourceRequest); return; }
    if (request?.type === SPATIAL_REVIEW_ASSET_CANCEL) { onCancel(event, event.data as SpatialReviewAssetCancelMessage); return; }
    if (request?.type === SPATIAL_REVIEW_ASSET_REQUEST) {
      const state = peerStates.get(event.source as Window);
      if (state?.progressive && state.origin === event.origin) onAssetRequest(event, event.data as SpatialReviewAssetRequest);
      return;
    }
    if (request?.type !== SPATIAL_REVIEW_REQUEST && request?.type !== LEGACY_SPATIAL_REVIEW_REQUEST) return;
    onCatalogRequest(event, request);
  };

  const releaseLiveReviewSession = registry.retainLiveReviewSession();
  try {
    window.addEventListener("message", onMessage);
    postReady();
  } catch (error) {
    window.removeEventListener("message", onMessage);
    releaseLiveReviewSession();
    throw error;
  }
  return () => {
    if (disposed) return;
    disposed = true;
    stopStatusListener();
    peerStates.forEach((state) => {
      state.queue.splice(0).forEach((job) => { job.terminal = true; });
      state.active.forEach((job) => {
        job.terminal = true;
        job.controller.abort();
      });
      state.active.clear();
      state.inFlightBytes = 0;
    });
    syncActiveRequestStatus();
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    window.removeEventListener("message", onMessage);
    releaseLiveReviewSession();
  };
}
