import { LEGACY_SPATIAL_REVIEW_CATALOG, LEGACY_SPATIAL_REVIEW_READY, LEGACY_SPATIAL_REVIEW_REQUEST, SPATIAL_REVIEW_CATALOG, SPATIAL_REVIEW_READY, SPATIAL_REVIEW_REQUEST, SPATIAL_REVIEW_RESOURCE_REQUEST, SPATIAL_REVIEW_RESOURCE_RESPONSE, SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY, type SpatialReviewCatalogRequest, type SpatialReviewProfile, type SpatialReviewResourceRequest, type SpatialReviewResourceResponse, type SpatialReviewResourceTransferOffer } from "@alterno-dev/spatial-review-protocol";
import type { SceneAssetRegistry } from "./registry.js";

const DEFAULT_MAX_RESOURCE_BYTES = 16 * 1024 * 1024;

export type SceneAssetRegistryBridgeOptions = { allowedOrigins?: Iterable<string>; allowOrigin?: (origin: string) => boolean; maxResourceBytes?: number };
function loopback(origin: string) { try { const hostname = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, ""); return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"; } catch { return false; } }
function offeredLimit(value: unknown) {
  const offer = value as Partial<SpatialReviewResourceTransferOffer> | null;
  return offer?.capability === SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY && Number.isFinite(offer.maxBytes) && Number(offer.maxBytes) > 0
    ? Math.floor(Number(offer.maxBytes))
    : undefined;
}

export function attachSceneAssetRegistryBridge(registry: SceneAssetRegistry, options: SceneAssetRegistryBridgeOptions = {}) {
  const configured = new Set([...(options.allowedOrigins ?? [])].flatMap((origin) => { try { return [new URL(origin).origin]; } catch { return []; } })); configured.add(window.location.origin);
  const allowed = (origin: string) => configured.has(origin) || Boolean(options.allowOrigin?.(origin)) || (loopback(window.location.origin) && loopback(origin));
  const maxResourceBytes = Math.floor(Number.isFinite(options.maxResourceBytes) && Number(options.maxResourceBytes) > 0 ? Number(options.maxResourceBytes) : DEFAULT_MAX_RESOURCE_BYTES);
  const resourceTransfer = { capability: SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY, maxBytes: maxResourceBytes } satisfies SpatialReviewResourceTransferOffer;
  const peerResourceLimits = new WeakMap<Window, number>();
  const ready = { type: SPATIAL_REVIEW_READY, buildId: registry.buildId, actors: registry.size, capabilities: [SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY], resourceTransfer };
  const postReady = () => { if (window.parent !== window) { window.parent.postMessage(ready, "*"); window.parent.postMessage({ ...ready, type: LEGACY_SPATIAL_REVIEW_READY }, "*"); } window.opener?.postMessage(ready, "*"); window.opener?.postMessage({ ...ready, type: LEGACY_SPATIAL_REVIEW_READY }, "*"); };
  const postResource = (target: Window, origin: string, response: SpatialReviewResourceResponse, transfer: Transferable[] = []) => {
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
  const onMessage = (event: MessageEvent) => {
    if (!allowed(event.origin) || (event.source !== window.parent && event.source !== window.opener)) return;
    const request = event.data as (SpatialReviewCatalogRequest & { resourceId?: string }) | null;
    if (request?.type === SPATIAL_REVIEW_RESOURCE_REQUEST) {
      void onResourceRequest(event, request as SpatialReviewResourceRequest);
      return;
    }
    const legacy = request?.type === LEGACY_SPATIAL_REVIEW_REQUEST; if (!legacy && request?.type !== SPATIAL_REVIEW_REQUEST) return;
    const profile: SpatialReviewProfile = request.profile === "scene" ? "scene" : "review";
    const target = event.source as Window;
    const requestedLimit = offeredLimit(request.resourceTransfer);
    const agreedLimit = requestedLimit ? Math.min(maxResourceBytes, requestedLimit) : maxResourceBytes;
    peerResourceLimits.set(target, agreedLimit);
    window.setTimeout(() => target.postMessage({ type: legacy ? LEGACY_SPATIAL_REVIEW_CATALOG : SPATIAL_REVIEW_CATALOG, profile, requestId: request.requestId, payload: registry.toReviewIndex(profile, legacy), resourceTransfer: { ...resourceTransfer, maxBytes: agreedLimit } }, event.origin), 0);
  };
  window.addEventListener("message", onMessage); postReady(); return () => window.removeEventListener("message", onMessage);
}
