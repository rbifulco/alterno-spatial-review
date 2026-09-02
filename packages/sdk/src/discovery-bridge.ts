import {
  SPATIAL_REVIEW_DISCOVERY_REQUEST,
  SPATIAL_REVIEW_DISCOVERY_RESPONSE,
  SPATIAL_REVIEW_DISCOVERY_SCHEMA,
  discoveryUrlsForWebsite,
  normalizeSpatialReviewDiscovery,
  normalizeSpatialReviewEditorOriginPolicy,
  type SpatialReviewDiscovery,
  type SpatialReviewDiscoveryCapabilities,
  type SpatialReviewDiscoveryRequestMessage,
  type SpatialReviewDiscoveryResponseMessage,
} from "@alterno-dev/spatial-review-protocol";
import {
  resolveSpatialReviewEditorAuthorization,
  spatialReviewEditorOriginAllowed,
  spatialReviewEditorOriginPolicy,
  type SpatialReviewEditorAuthorizationSource,
} from "./origin-authorization.js";

export type SpatialReviewDiscoveryRegistration = {
  name: string;
  websiteUrl?: string;
  /** Locator metadata returned by the bridge; never copied into discovery JSON. */
  discoveryUrl?: string;
  scene?: string;
  assets?: string;
  liveCapture?: string;
  capabilities?: SpatialReviewDiscoveryCapabilities;
};

export type SpatialReviewDiscoveryBridgeOptions = SpatialReviewEditorAuthorizationSource;

function policiesMatch(left: unknown, right: unknown) {
  const first = normalizeSpatialReviewEditorOriginPolicy(left);
  const second = normalizeSpatialReviewEditorOriginPolicy(right);
  if (first.mode !== second.mode || first.allowLoopbackPeers !== second.allowLoopbackPeers) return false;
  if (first.mode !== "allowlist" || second.mode !== "allowlist") return true;
  return first.origins.length === second.origins.length && first.origins.every((entry) => second.origins.includes(entry));
}

export function attachSpatialReviewDiscoveryBridge(
  registration: SpatialReviewDiscoveryRegistration,
  options: SpatialReviewDiscoveryBridgeOptions = {},
) {
  const authorization = resolveSpatialReviewEditorAuthorization(options);
  const allowed = (origin: string) => spatialReviewEditorOriginAllowed(authorization, window.location.origin, origin);
  const { discoveryUrl: registeredDiscoveryUrl, ...documentRegistration } = registration;
  const websiteUrl = new URL(registration.websiteUrl ?? window.location.origin, window.location.href).href;
  const discoveryUrl = discoveryUrlsForWebsite(websiteUrl, registeredDiscoveryUrl)[0];
  const discovery = normalizeSpatialReviewDiscovery({
    schema: SPATIAL_REVIEW_DISCOVERY_SCHEMA,
    version: 1,
    ...documentRegistration,
    websiteUrl,
  }, discoveryUrl);
  const declaredPolicy = discovery.capabilities?.liveCapture?.editorOriginPolicy;
  const derivedPolicy = discovery.liveCapture ? spatialReviewEditorOriginPolicy(authorization, discovery.liveCapture) : undefined;
  if (declaredPolicy && !derivedPolicy) throw new Error("An advertised editorOriginPolicy requires an explicitly disclosed shared authorization from createSpatialReviewEditorAuthorization().");
  if (declaredPolicy && !policiesMatch(declaredPolicy, derivedPolicy)) {
    throw new Error("The advertised editorOriginPolicy does not match the runtime editor authorization options.");
  }
  if (derivedPolicy) {
    discovery.capabilities = { ...discovery.capabilities, liveCapture: { ...discovery.capabilities?.liveCapture, editorOriginPolicy: derivedPolicy } };
  }

  const onMessage = (event: MessageEvent) => {
    if (!allowed(event.origin) || (event.source !== window.parent && event.source !== window.opener)) return;
    const request = event.data as Partial<SpatialReviewDiscoveryRequestMessage> | null;
    if (request?.type !== SPATIAL_REVIEW_DISCOVERY_REQUEST || typeof request.requestId !== "string" || !request.requestId || request.requestId.length > 200) return;
    const response: SpatialReviewDiscoveryResponseMessage = {
      type: SPATIAL_REVIEW_DISCOVERY_RESPONSE,
      requestId: request.requestId,
      discoveryUrl,
      discovery,
    };
    (event.source as Window).postMessage(response, event.origin);
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
