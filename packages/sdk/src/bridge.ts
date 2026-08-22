import { LEGACY_SPATIAL_REVIEW_CATALOG, LEGACY_SPATIAL_REVIEW_READY, LEGACY_SPATIAL_REVIEW_REQUEST, SPATIAL_REVIEW_CATALOG, SPATIAL_REVIEW_READY, SPATIAL_REVIEW_REQUEST, type SpatialReviewProfile } from "@alterno-dev/spatial-review-protocol";
import type { SceneAssetRegistry } from "./registry.js";

export type SceneAssetRegistryBridgeOptions = { allowedOrigins?: Iterable<string>; allowOrigin?: (origin: string) => boolean };
function loopback(origin: string) { try { const hostname = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, ""); return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"; } catch { return false; } }

export function attachSceneAssetRegistryBridge(registry: SceneAssetRegistry, options: SceneAssetRegistryBridgeOptions = {}) {
  const configured = new Set([...(options.allowedOrigins ?? [])].flatMap((origin) => { try { return [new URL(origin).origin]; } catch { return []; } })); configured.add(window.location.origin);
  const allowed = (origin: string) => configured.has(origin) || Boolean(options.allowOrigin?.(origin)) || (loopback(window.location.origin) && loopback(origin));
  const ready = { type: SPATIAL_REVIEW_READY, buildId: registry.buildId, actors: registry.size };
  const postReady = () => { if (window.parent !== window) { window.parent.postMessage(ready, "*"); window.parent.postMessage({ ...ready, type: LEGACY_SPATIAL_REVIEW_READY }, "*"); } window.opener?.postMessage(ready, "*"); window.opener?.postMessage({ ...ready, type: LEGACY_SPATIAL_REVIEW_READY }, "*"); };
  const onMessage = (event: MessageEvent) => {
    if (!allowed(event.origin) || (event.source !== window.parent && event.source !== window.opener)) return;
    const request = event.data as { type?: string; profile?: SpatialReviewProfile; requestId?: string } | null;
    const legacy = request?.type === LEGACY_SPATIAL_REVIEW_REQUEST; if (!legacy && request?.type !== SPATIAL_REVIEW_REQUEST) return;
    const profile: SpatialReviewProfile = request.profile === "scene" ? "scene" : "review";
    window.setTimeout(() => (event.source as Window | null)?.postMessage({ type: legacy ? LEGACY_SPATIAL_REVIEW_CATALOG : SPATIAL_REVIEW_CATALOG, profile, requestId: request.requestId, payload: registry.toReviewIndex(profile, legacy) }, event.origin), 0);
  };
  window.addEventListener("message", onMessage); postReady(); return () => window.removeEventListener("message", onMessage);
}
