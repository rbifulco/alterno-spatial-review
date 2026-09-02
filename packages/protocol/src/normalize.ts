import { SPATIAL_REVIEW_BUNDLE_SCHEMA, SPATIAL_REVIEW_DISCOVERY_PATH, SPATIAL_REVIEW_DISCOVERY_SCHEMA } from "./constants.js";
import type { SpatialReviewBundle, SpatialReviewDiscovery, SpatialReviewEditorOriginPolicy } from "./types.js";

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}

function webUrl(value: string, base: string, label: string) {
  let url: URL;
  try { url = new URL(value, base); } catch { throw new Error(`${label} is not a valid URL.`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${label} must use HTTP or HTTPS.`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials.`);
  if (url.hostname.includes("*")) throw new Error(`${label} must not contain wildcards.`);
  url.hash = "";
  return url.href;
}

function optionalUrl(value: unknown, base: string, label: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a URL string.`);
  return webUrl(value, base, label);
}

function loopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function absoluteOrigin(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be an absolute URL origin.`);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an absolute URL origin.`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${label} must use HTTP or HTTPS.`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials.`);
  if (url.hostname.includes("*")) throw new Error(`${label} must not contain wildcards.`);
  if (value !== url.origin) throw new Error(`${label} must be the canonical origin without a path, query, or fragment.`);
  if (url.protocol !== "https:" && !loopbackHostname(url.hostname)) throw new Error(`${label} must use HTTPS unless it is a loopback development origin.`);
  return url.origin;
}

export function normalizeSpatialReviewProducerOrigin(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("producerUrl must be an absolute HTTP(S) URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("producerUrl must use HTTP or HTTPS.");
  if (url.username || url.password) throw new Error("producerUrl must not contain credentials.");
  if (url.hostname.includes("*")) throw new Error("producerUrl must not contain wildcards.");
  if (url.protocol !== "https:" && !loopbackHostname(url.hostname)) throw new Error("producerUrl must use HTTPS unless it is a loopback development URL.");
  return url.origin;
}

/** Validate and canonicalize public discovery metadata. This is advisory only;
 * producers must still authorize the observed runtime message origin. */
export function normalizeSpatialReviewEditorOriginPolicy(value: unknown): SpatialReviewEditorOriginPolicy {
  const policy = record(value, "editorOriginPolicy");
  if (policy.mode !== "allowlist" && policy.mode !== "same-origin" && policy.mode !== "any") throw new Error("editorOriginPolicy.mode must be allowlist, same-origin, or any.");
  if (policy.allowLoopbackPeers !== undefined && typeof policy.allowLoopbackPeers !== "boolean") throw new Error("editorOriginPolicy.allowLoopbackPeers must be boolean when present.");
  if (policy.mode === "allowlist") {
    if (!Array.isArray(policy.origins) || policy.origins.length === 0) throw new Error("editorOriginPolicy.origins must be a non-empty allowlist.");
    const origins = policy.origins.map((origin, index) => absoluteOrigin(origin, `editorOriginPolicy.origins[${index}]`));
    if (new Set(origins).size !== origins.length) throw new Error("editorOriginPolicy.origins must not contain duplicates.");
    return { mode: "allowlist", origins, ...(policy.allowLoopbackPeers === undefined ? {} : { allowLoopbackPeers: policy.allowLoopbackPeers }) };
  }
  if (policy.origins !== undefined) throw new Error(`editorOriginPolicy.origins is not allowed in ${policy.mode} mode.`);
  return { mode: policy.mode, ...(policy.allowLoopbackPeers === undefined ? {} : { allowLoopbackPeers: policy.allowLoopbackPeers }) };
}

/** Return the policy's preflight result for an editor and the live producer.
 * Runtime authorization remains mandatory even when this returns true. */
export function editorOriginPolicyAllows(policy: SpatialReviewEditorOriginPolicy, editorOrigin: string, producerUrl: string) {
  const normalized = normalizeSpatialReviewEditorOriginPolicy(policy);
  const editor = absoluteOrigin(editorOrigin, "editorOrigin");
  const producer = normalizeSpatialReviewProducerOrigin(producerUrl);
  if (normalized.allowLoopbackPeers && loopbackHostname(new URL(editor).hostname) && loopbackHostname(new URL(producer).hostname)) return true;
  if (normalized.mode === "any") return true;
  if (normalized.mode === "same-origin") return editor === producer;
  return normalized.origins.includes(editor);
}

export function normalizeWebsiteUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter the integrated website URL.");
  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return webUrl(withProtocol, withProtocol, "websiteUrl");
}

export function discoveryUrlForWebsite(websiteUrl: string) {
  return new URL(SPATIAL_REVIEW_DISCOVERY_PATH, normalizeWebsiteUrl(websiteUrl)).href;
}

function discoveryLocatorUrl(value: string, base: URL, label: string) {
  if (!value.trim()) throw new Error(`${label} is not a valid URL.`);
  let url: URL;
  try { url = new URL(value, base); } catch { throw new Error(`${label} is not a valid URL.`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${label} must use HTTP or HTTPS.`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials.`);
  if (url.origin !== base.origin) throw new Error(`${label} must use the website origin.`);
  url.hash = "";
  return url;
}

/** Return explicit, canonical-root and project-relative discovery candidates in
 * interoperable lookup order. The existing single-URL helper remains canonical. */
export function discoveryUrlsForWebsite(websiteUrl: string, explicitDiscoveryUrl?: string) {
  const website = new URL(normalizeWebsiteUrl(websiteUrl));
  if (website.username || website.password) throw new Error("websiteUrl must not contain credentials.");
  website.hash = "";
  website.search = "";
  const projectBase = new URL(website);
  projectBase.pathname = `${projectBase.pathname.replace(/\/+$/, "")}/`;
  const candidates = [
    ...(explicitDiscoveryUrl === undefined ? [] : [discoveryLocatorUrl(explicitDiscoveryUrl, projectBase, "discoveryUrl")]),
    discoveryLocatorUrl(SPATIAL_REVIEW_DISCOVERY_PATH, website, "discoveryUrl"),
    discoveryLocatorUrl(".well-known/spatial-review.json", projectBase, "discoveryUrl"),
  ];
  return [...new Set(candidates.map((candidate) => candidate.href))];
}

export function normalizeSpatialReviewDiscovery(payload: unknown, discoveryUrl: string): SpatialReviewDiscovery {
  const normalizedDiscoveryUrl = webUrl(discoveryUrl, discoveryUrl, "discoveryUrl");
  const value = record(payload, "Spatial Review discovery document");
  if (value.schema !== SPATIAL_REVIEW_DISCOVERY_SCHEMA) throw new Error(`Unsupported discovery schema. Expected ${SPATIAL_REVIEW_DISCOVERY_SCHEMA}.`);
  if (value.version !== 1) throw new Error("Unsupported Spatial Review discovery version.");
  let capabilities: SpatialReviewDiscovery["capabilities"];
  if (value.capabilities !== undefined) {
    const advertised = record(value.capabilities, "capabilities");
    if (advertised.liveCapture !== undefined) {
      const liveCapture = record(advertised.liveCapture, "capabilities.liveCapture");
      capabilities = {
        liveCapture: liveCapture.editorOriginPolicy === undefined
          ? {}
          : { editorOriginPolicy: normalizeSpatialReviewEditorOriginPolicy(liveCapture.editorOriginPolicy) },
      };
    } else capabilities = {};
  }
  const result: SpatialReviewDiscovery = {
    schema: SPATIAL_REVIEW_DISCOVERY_SCHEMA,
    version: 1,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : "Integrated website",
    websiteUrl: webUrl(typeof value.websiteUrl === "string" ? value.websiteUrl : new URL(normalizedDiscoveryUrl).origin, normalizedDiscoveryUrl, "websiteUrl"),
    scene: optionalUrl(value.scene, normalizedDiscoveryUrl, "scene"),
    assets: optionalUrl(value.assets, normalizedDiscoveryUrl, "assets"),
    liveCapture: optionalUrl(value.liveCapture, normalizedDiscoveryUrl, "liveCapture"),
    ...(capabilities === undefined ? {} : { capabilities }),
  };
  if (!result.scene && !result.assets && !result.liveCapture) throw new Error("The website advertises no scene, asset, or live-capture transport.");
  if (result.capabilities?.liveCapture?.editorOriginPolicy && !result.liveCapture) throw new Error("editorOriginPolicy requires an advertised liveCapture URL.");
  return result;
}

export function normalizeSpatialReviewBundle(payload: unknown): SpatialReviewBundle {
  const value = record(payload, "Spatial Review connection response");
  if (value.schema !== SPATIAL_REVIEW_BUNDLE_SCHEMA) throw new Error(typeof value.error === "string" ? value.error : "Unsupported connection response.");
  if (typeof value.discoveryUrl !== "string" || typeof value.websiteUrl !== "string") throw new Error("The connection response is missing its website URLs.");
  return {
    schema: SPATIAL_REVIEW_BUNDLE_SCHEMA,
    websiteUrl: webUrl(value.websiteUrl, value.discoveryUrl, "websiteUrl"),
    discoveryUrl: webUrl(value.discoveryUrl, value.discoveryUrl, "discoveryUrl"),
    discovery: normalizeSpatialReviewDiscovery(value.discovery, value.discoveryUrl),
    scene: value.scene,
    assets: value.assets,
  };
}
