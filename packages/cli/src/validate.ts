import {
  discoveryUrlsForWebsite,
  spatialReviewEditorUrl,
  type SpatialReviewDiscovery,
} from "@alterno-dev/spatial-review-protocol";
import { validateAssetDocument, validateDiscovery } from "@alterno-dev/spatial-review-validator";

const DISCOVERY_LIMIT_BYTES = 64 * 1024;
const DOCUMENT_LIMIT_BYTES = 24 * 1024 * 1024;

export type DiscoveryAttempt = {
  url: string;
  outcome: "unavailable" | "invalid" | "compatible";
  message: string;
};

export type ResolvedWebsiteDiscovery = {
  discoveryUrl: string;
  discovery: SpatialReviewDiscovery;
  attempts: DiscoveryAttempt[];
};

export type ValidateWebsiteOptions = {
  discoveryUrl?: string;
  fetch?: typeof fetch;
};

async function readLimitedJson(response: Response, limit: number, label: string) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error(`${label} exceeds the ${Math.floor(limit / 1024)} KiB limit.`);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new Error(`${label} exceeds the ${Math.floor(limit / 1024)} KiB limit.`);
    try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
    catch { throw new Error(`${label} is not valid JSON.`); }
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new Error(`${label} exceeds the ${Math.floor(limit / 1024)} KiB limit.`);
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength; });
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { throw new Error(`${label} is not valid JSON.`); }
}

function actualResponseUrl(response: Response, requestedUrl: string) {
  const actual = new URL(response.url || requestedUrl);
  const requested = new URL(requestedUrl);
  if (actual.protocol !== "http:" && actual.protocol !== "https:") throw new Error("redirected to a non-HTTP URL");
  if (actual.username || actual.password) throw new Error("redirected to a URL containing credentials");
  if (actual.origin !== requested.origin) throw new Error(`redirected outside ${requested.origin}`);
  actual.hash = "";
  return actual.href;
}

export async function resolveWebsiteDiscovery(
  websiteUrl: string,
  options: ValidateWebsiteOptions = {},
): Promise<ResolvedWebsiteDiscovery> {
  const fetcher = options.fetch ?? fetch;
  const candidates = discoveryUrlsForWebsite(websiteUrl, options.discoveryUrl);
  const attempts: DiscoveryAttempt[] = [];
  for (const candidate of candidates) {
    let response: Response;
    try {
      response = await fetcher(candidate, { headers: { accept: "application/json" }, redirect: "follow" });
    } catch (error) {
      attempts.push({ url: candidate, outcome: "unavailable", message: error instanceof Error ? error.message : "network request failed" });
      continue;
    }
    if (!response.ok) {
      attempts.push({ url: candidate, outcome: "unavailable", message: `HTTP ${response.status}` });
      continue;
    }
    let actualUrl: string;
    let payload: unknown;
    try {
      actualUrl = actualResponseUrl(response, candidate);
      payload = await readLimitedJson(response, DISCOVERY_LIMIT_BYTES, "Spatial Review discovery document");
    } catch (error) {
      attempts.push({ url: candidate, outcome: "invalid", message: error instanceof Error ? error.message : "invalid response" });
      continue;
    }
    const result = validateDiscovery(payload, actualUrl);
    if (!result.ok) {
      attempts.push({ url: candidate, outcome: "invalid", message: result.errors.join("; ") });
      continue;
    }
    attempts.push({ url: candidate, outcome: "compatible", message: actualUrl === candidate ? "valid discovery document" : `valid at ${actualUrl}` });
    return { discoveryUrl: actualUrl, discovery: result.value, attempts };
  }
  throw new Error([
    "No compatible Spatial Review discovery document was found.",
    ...attempts.map((attempt) => `- ${attempt.url}: ${attempt.outcome} (${attempt.message})`),
  ].join("\n"));
}

async function fetchDocument(url: string, label: string, fetcher: typeof fetch) {
  const response = await fetcher(url, { headers: { accept: "application/json" }, redirect: "follow" });
  if (!response.ok) throw new Error(`${label} ${url} returned ${response.status}.`);
  return readLimitedJson(response, DOCUMENT_LIMIT_BYTES, label);
}

export async function validateWebsite(websiteUrl: string, options: ValidateWebsiteOptions = {}) {
  const fetcher = options.fetch ?? fetch;
  const resolved = await resolveWebsiteDiscovery(websiteUrl, { ...options, fetch: fetcher });
  const { discovery } = resolved;
  if (discovery.scene) await fetchDocument(discovery.scene, "Scene document", fetcher);
  if (discovery.assets) {
    const assets = validateAssetDocument(await fetchDocument(discovery.assets, "Asset document", fetcher));
    if (!assets.ok) throw new Error(assets.errors.join("\n"));
  }
  return [
    `Compatible: ${discovery.name}`,
    `Discovery: ${resolved.discoveryUrl}`,
    "Attempted discovery URLs:",
    ...resolved.attempts.map((attempt) => `- ${attempt.url}: ${attempt.outcome} (${attempt.message})`),
    `Scene: ${discovery.scene ? "yes" : "no"}`,
    `Assets: ${discovery.assets ? "yes" : "no"}`,
    `Live: ${discovery.liveCapture ? "yes" : "no"}`,
    `Open review: ${spatialReviewEditorUrl(discovery.websiteUrl, { discoveryUrl: resolved.discoveryUrl })}`,
    "",
  ].join("\n");
}
