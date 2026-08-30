import { SPATIAL_REVIEW_BUNDLE_SCHEMA, SPATIAL_REVIEW_DISCOVERY_PATH, SPATIAL_REVIEW_DISCOVERY_SCHEMA } from "./constants.js";
import type { SpatialReviewBundle, SpatialReviewDiscovery } from "./types.js";

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}

function webUrl(value: string, base: string, label: string) {
  let url: URL;
  try { url = new URL(value, base); } catch { throw new Error(`${label} is not a valid URL.`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${label} must use HTTP or HTTPS.`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials.`);
  url.hash = "";
  return url.href;
}

function optionalUrl(value: unknown, base: string, label: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${label} must be a URL string.`);
  return webUrl(value, base, label);
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
  const result: SpatialReviewDiscovery = {
    schema: SPATIAL_REVIEW_DISCOVERY_SCHEMA,
    version: 1,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : "Integrated website",
    websiteUrl: webUrl(typeof value.websiteUrl === "string" ? value.websiteUrl : new URL(normalizedDiscoveryUrl).origin, normalizedDiscoveryUrl, "websiteUrl"),
    scene: optionalUrl(value.scene, normalizedDiscoveryUrl, "scene"),
    assets: optionalUrl(value.assets, normalizedDiscoveryUrl, "assets"),
    liveCapture: optionalUrl(value.liveCapture, normalizedDiscoveryUrl, "liveCapture"),
  };
  if (!result.scene && !result.assets && !result.liveCapture) throw new Error("The website advertises no scene, asset, or live-capture transport.");
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
