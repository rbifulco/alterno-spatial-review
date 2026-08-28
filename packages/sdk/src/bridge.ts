import { LEGACY_SPATIAL_REVIEW_CATALOG, LEGACY_SPATIAL_REVIEW_READY, LEGACY_SPATIAL_REVIEW_REQUEST, OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN, SPATIAL_REVIEW_CATALOG, SPATIAL_REVIEW_READY, SPATIAL_REVIEW_REQUEST, SPATIAL_REVIEW_RESOURCE_REQUEST, SPATIAL_REVIEW_RESOURCE_RESPONSE, SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY, type SpatialReviewCatalogRequest, type SpatialReviewProfile, type SpatialReviewResourceRequest, type SpatialReviewResourceResponse, type SpatialReviewResourceTransferOffer } from "@alterno-dev/spatial-review-protocol";
import { SPATIAL_REVIEW_PROGRESSIVE_CAPABILITY, SPATIAL_REVIEW_GEOMETRY_TRANSFER_CAPABILITY, SPATIAL_REVIEW_ASSET_REQUEST, SPATIAL_REVIEW_ASSET_RESPONSE, type SpatialReviewAssetRequest, type SpatialReviewAssetResponse } from "@alterno-dev/spatial-review-protocol";
import { prepareAssetTransfer } from "./geometry-transfer.js";
import type { SceneAssetRegistry } from "./registry.js";

const DEFAULT_MAX_RESOURCE_BYTES = 16 * 1024 * 1024;

export type SceneAssetRegistryBridgeOptions = {
  /** Trust the official Alterno editor origin. Defaults to true. */
  allowOfficialEditor?: boolean;
  allowedOrigins?: Iterable<string>;
  allowOrigin?: (origin: string) => boolean;
  maxResourceBytes?: number;
  maxGeometryBytes?: number;
};
function loopback(origin: string) { try { const hostname = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, ""); return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"; } catch { return false; } }
function offeredLimit(value: unknown) {
  const offer = value as Partial<SpatialReviewResourceTransferOffer> | null;
  return offer?.capability === SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY && Number.isFinite(offer.maxBytes) && Number(offer.maxBytes) > 0
    ? Math.floor(Number(offer.maxBytes))
    : undefined;
}

export function attachSceneAssetRegistryBridge(registry: SceneAssetRegistry, options: SceneAssetRegistryBridgeOptions = {}) {
  const configured = new Set([...(options.allowedOrigins ?? [])].flatMap((origin) => { try { return [new URL(origin).origin]; } catch { return []; } }));
  if (options.allowOfficialEditor !== false) configured.add(OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN);
  configured.add(window.location.origin);
  const allowed = (origin: string) => configured.has(origin) || Boolean(options.allowOrigin?.(origin)) || (loopback(window.location.origin) && loopback(origin));
  const maxResourceBytes = Math.floor(Number.isFinite(options.maxResourceBytes) && Number(options.maxResourceBytes) > 0 ? Number(options.maxResourceBytes) : DEFAULT_MAX_RESOURCE_BYTES);
  const resourceTransfer = { capability: SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY, maxBytes: maxResourceBytes } satisfies SpatialReviewResourceTransferOffer;
  const maxGeometryBytes = Math.floor(Number.isFinite(options.maxGeometryBytes) && Number(options.maxGeometryBytes) > 0 ? Number(options.maxGeometryBytes) : 64 * 1024 * 1024);
  const geometryTransfer = { capability: SPATIAL_REVIEW_GEOMETRY_TRANSFER_CAPABILITY, maxBytes: maxGeometryBytes };
  const peerGeometryLimits = new WeakMap<Window, number>();
  const pending = new WeakMap<Window, number>();
  const seenRequests = new WeakMap<Window, Set<string>>();
  const timers = new Set<number>();
  let disposed = false;
  const schedule = (callback: () => void) => {
    const timer = window.setTimeout(() => { timers.delete(timer); if (!disposed) callback(); }, 0);
    timers.add(timer);
  };
  const peerResourceLimits = new WeakMap<Window, number>();
  const ready = { type: SPATIAL_REVIEW_READY, buildId: registry.buildId, actors: registry.size, navigationSequences: registry.navigationSize, capabilities: [SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY, SPATIAL_REVIEW_PROGRESSIVE_CAPABILITY, SPATIAL_REVIEW_GEOMETRY_TRANSFER_CAPABILITY], resourceTransfer, geometryTransfer };
  const postReady = () => { if (window.parent !== window) { window.parent.postMessage(ready, "*"); window.parent.postMessage({ ...ready, type: LEGACY_SPATIAL_REVIEW_READY }, "*"); } window.opener?.postMessage(ready, "*"); window.opener?.postMessage({ ...ready, type: LEGACY_SPATIAL_REVIEW_READY }, "*"); };
  const postResource = (target: Window, origin: string, response: SpatialReviewResourceResponse, transfer: Transferable[] = []) => {
    if (disposed) return;
    try { target.postMessage(response, origin, transfer); } catch { /* The requesting frame or popup may have closed. */ }
  };
  const onResourceRequest = async (event: MessageEvent, request: SpatialReviewResourceRequest) => {
    const target = event.source as Window;
    if (!request.requestId || request.requestId.length > 200 || !request.resourceId || request.resourceId.length > 500) return;
    if (!registry.hasTextureResource(request.resourceId)) {
      postResource(target, event.origin, { type: SPATIAL_REVIEW_RESOURCE_RESPONSE, requestId: request.requestId, resourceId: request.resourceId, ok: false, error: "not-found", message: "The requested live texture is not registered." });
      return;
    }
    try {
      const resource = await registry.readTextureResource(request.resourceId, peerResourceLimits.get(target) ?? maxResourceBytes);
      if (!resource) return;
      postResource(target, event.origin, { type: SPATIAL_REVIEW_RESOURCE_RESPONSE, requestId: request.requestId, resourceId: request.resourceId, ok: true, contentType: resource.contentType, bytes: resource.bytes }, [resource.bytes]);
    } catch (error) {
      const tooLarge = error instanceof RangeError;
      postResource(target, event.origin, { type: SPATIAL_REVIEW_RESOURCE_RESPONSE, requestId: request.requestId, resourceId: request.resourceId, ok: false, error: tooLarge ? "too-large" : "unavailable", message: error instanceof Error ? error.message : "The live texture could not be transferred." });
    }
  };
  const postAsset = (target: Window, origin: string, response: SpatialReviewAssetResponse, transfer: Transferable[] = []) => {
    if (disposed) return;
    try { target.postMessage(response, origin, transfer); } catch { /* Peer closed. */ }
  };
  const onAssetRequest = (event: MessageEvent, request: SpatialReviewAssetRequest) => {
    const target = event.source as Window;
    const limit = peerGeometryLimits.get(target);
    if (!limit || request.buildId !== registry.buildId || typeof request.assetId !== "string" || request.assetId.length > 500
      || typeof request.requestId !== "string" || !request.requestId || request.requestId.length > 200) return;
    const profile: SpatialReviewProfile = request.profile === "scene" ? "scene" : "review";
    const response = { type: SPATIAL_REVIEW_ASSET_RESPONSE, requestId: request.requestId, assetId: request.assetId, buildId: registry.buildId, profile };
    if ((pending.get(target) ?? 0) >= 4) { postAsset(target, event.origin, { ...response, ok: false, error: "busy" }); return; }
    pending.set(target, (pending.get(target) ?? 0) + 1);
    schedule(() => {
      try {
        const source = registry.toAsset(request.assetId, profile, true, limit);
        if (!source) postAsset(target, event.origin, { ...response, ok: false, error: "not-found" });
        else {
          const { asset, transfer } = prepareAssetTransfer(source, limit);
          postAsset(target, event.origin, { ...response, ok: true, asset }, transfer);
        }
      } catch (error) {
        postAsset(target, event.origin, { ...response, ok: false, error: error instanceof RangeError ? "too-large" : "unavailable" });
      } finally { pending.set(target, Math.max(0, (pending.get(target) ?? 1) - 1)); }
    });
  };
  const onMessage = (event: MessageEvent) => {
    if (disposed || !allowed(event.origin) || (event.source !== window.parent && event.source !== window.opener)) return;
    const request = event.data as (SpatialReviewCatalogRequest & { resourceId?: string }) | null;
    if (request?.type === SPATIAL_REVIEW_RESOURCE_REQUEST) { void onResourceRequest(event, request as SpatialReviewResourceRequest); return; }
    if (request?.type === SPATIAL_REVIEW_ASSET_REQUEST) { onAssetRequest(event, event.data); return; }
    const legacy = request?.type === LEGACY_SPATIAL_REVIEW_REQUEST; if (!legacy && request?.type !== SPATIAL_REVIEW_REQUEST) return;
    const profile: SpatialReviewProfile = request.profile === "scene" ? "scene" : "review";
    const target = event.source as Window;
    if (request.requestId) {
      if (typeof request.requestId !== "string" || request.requestId.length > 200) return;
      const seen = seenRequests.get(target) ?? new Set<string>();
      if (seen.has(request.requestId)) return;
      seen.add(request.requestId); if (seen.size > 128) seen.delete(seen.values().next().value!);
      seenRequests.set(target, seen);
    }
    const requestedLimit = offeredLimit(request.resourceTransfer);
    const agreedLimit = requestedLimit ? Math.min(maxResourceBytes, requestedLimit) : maxResourceBytes;
    peerResourceLimits.set(target, agreedLimit);
    const offeredGeometry = request.geometryTransfer;
    const progressive = request.progressive === true && offeredGeometry?.capability === SPATIAL_REVIEW_GEOMETRY_TRANSFER_CAPABILITY
      && Number.isFinite(offeredGeometry.maxBytes) && offeredGeometry.maxBytes > 0;
    const agreedGeometry = progressive ? Math.min(maxGeometryBytes, Math.floor(offeredGeometry!.maxBytes)) : maxGeometryBytes;
    if (progressive) peerGeometryLimits.set(target, agreedGeometry);
    schedule(() => {
      try {
        target.postMessage({ type: legacy ? LEGACY_SPATIAL_REVIEW_CATALOG : SPATIAL_REVIEW_CATALOG, profile, requestId: request.requestId,
          payload: registry.toReviewIndex(profile, legacy, progressive), resourceTransfer: { ...resourceTransfer, maxBytes: agreedLimit },
          ...(progressive ? { progressive: true, geometryTransfer: { ...geometryTransfer, maxBytes: agreedGeometry } } : {}) }, event.origin);
      } catch { /* Peer closed during capture. */ }
    });
  };
  window.addEventListener("message", onMessage); postReady();
  return () => { disposed = true; timers.forEach((timer) => clearTimeout(timer)); timers.clear(); window.removeEventListener("message", onMessage); };
}
