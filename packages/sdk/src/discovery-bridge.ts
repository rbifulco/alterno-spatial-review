import {
  SPATIAL_REVIEW_DISCOVERY_REQUEST,
  SPATIAL_REVIEW_DISCOVERY_RESPONSE,
  SPATIAL_REVIEW_DISCOVERY_SCHEMA,
  OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN,
  discoveryUrlsForWebsite,
  normalizeSpatialReviewDiscovery,
  type SpatialReviewDiscovery,
  type SpatialReviewDiscoveryRequestMessage,
  type SpatialReviewDiscoveryResponseMessage,
} from "@alterno-dev/spatial-review-protocol";

export type SpatialReviewDiscoveryRegistration = {
  name: string;
  websiteUrl?: string;
  /** Locator metadata returned by the bridge; never copied into discovery JSON. */
  discoveryUrl?: string;
  scene?: string;
  assets?: string;
  liveCapture?: string;
};

export type SpatialReviewDiscoveryBridgeOptions = {
  /** Trust the official Alterno editor origin. Defaults to true. */
  allowOfficialEditor?: boolean;
  allowedOrigins?: Iterable<string>;
  allowOrigin?: (origin: string) => boolean;
};

function loopback(origin: string) {
  try {
    const hostname = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch { return false; }
}

export function attachSpatialReviewDiscoveryBridge(
  registration: SpatialReviewDiscoveryRegistration,
  options: SpatialReviewDiscoveryBridgeOptions = {},
) {
  const configured = new Set([...(options.allowedOrigins ?? [])].flatMap((origin) => {
    try { return [new URL(origin).origin]; } catch { return []; }
  }));
  if (options.allowOfficialEditor !== false) configured.add(OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN);
  configured.add(window.location.origin);
  const allowed = (origin: string) => configured.has(origin)
    || Boolean(options.allowOrigin?.(origin))
    || (loopback(window.location.origin) && loopback(origin));
  const { discoveryUrl: registeredDiscoveryUrl, ...documentRegistration } = registration;
  const discovery = normalizeSpatialReviewDiscovery({
    schema: SPATIAL_REVIEW_DISCOVERY_SCHEMA,
    version: 1,
    ...documentRegistration,
    websiteUrl: registration.websiteUrl ?? window.location.origin,
  }, window.location.href);
  const discoveryUrl = discoveryUrlsForWebsite(discovery.websiteUrl, registeredDiscoveryUrl)[0];

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
