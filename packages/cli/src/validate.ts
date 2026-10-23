import {
  discoveryUrlsForWebsite,
  normalizeWebsiteUrl,
  spatialReviewEditorUrl,
  decodePreparedReviewCatalog,
  normalizePreparedReviewManifest,
  preparedReviewSha256,
  PREPARED_REVIEW_LIMITS,
  type SpatialReviewDiscovery,
} from "@alterno-dev/spatial-review-protocol";
import { validateAssetDocument, validateDiscovery, validateSceneDocument, validateReviewIndex } from "@alterno-dev/spatial-review-validator";

const DISCOVERY_LIMIT_BYTES = 64 * 1024;
const DOCUMENT_LIMIT_BYTES = 24 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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
  /** Extra static-document origins trusted by this CLI invocation. */
  allowedDocumentOrigins?: readonly string[];
  fetch?: typeof fetch;
};

class UrlPolicyError extends Error {}

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

function normalizedOrigin(value: string, label: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UrlPolicyError(`${label} must use HTTP(S).`);
  if (url.username || url.password) throw new UrlPolicyError(`${label} must not contain credentials.`);
  if (url.pathname !== "/" || url.search || url.hash) throw new UrlPolicyError(`${label} must be an origin without a path, query, or fragment.`);
  return url.origin;
}

function assertTrustedUrl(value: string, trustedOrigins: ReadonlySet<string>, label: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UrlPolicyError(`${label} must use HTTP(S).`);
  if (url.username || url.password) throw new UrlPolicyError(`${label} must not contain credentials.`);
  if (!trustedOrigins.has(url.origin)) throw new UrlPolicyError(`${label} origin ${url.origin} is not trusted; pass --allow-origin ${url.origin} to opt in.`);
  url.hash = "";
  return url.href;
}

async function fetchWithRedirectPolicy(url: string, fetcher: typeof fetch, trustedOrigins: ReadonlySet<string>, label: string) {
  let current = assertTrustedUrl(url, trustedOrigins, label);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetcher(current, { headers: { accept: "application/json" }, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) {
      const actualUrl = actualResponseUrl(response, current);
      assertTrustedUrl(actualUrl, trustedOrigins, label);
      return { response, actualUrl };
    }
    if (redirects === MAX_REDIRECTS) throw new UrlPolicyError(`${label} exceeded the ${MAX_REDIRECTS}-redirect limit.`);
    const location = response.headers.get("location");
    if (!location) throw new UrlPolicyError(`${label} returned a redirect without a Location header.`);
    current = assertTrustedUrl(new URL(location, current).href, trustedOrigins, `${label} redirect`);
  }
  throw new UrlPolicyError(`${label} exceeded the redirect limit.`);
}

export async function resolveWebsiteDiscovery(
  websiteUrl: string,
  options: ValidateWebsiteOptions = {},
): Promise<ResolvedWebsiteDiscovery> {
  const fetcher = options.fetch ?? fetch;
  const candidates = discoveryUrlsForWebsite(websiteUrl, options.discoveryUrl);
  const websiteOrigin = new URL(normalizeWebsiteUrl(websiteUrl)).origin;
  const attempts: DiscoveryAttempt[] = [];
  for (const candidate of candidates) {
    let response: Response;
    let actualUrl: string;
    try {
      ({ response, actualUrl } = await fetchWithRedirectPolicy(candidate, fetcher, new Set([new URL(candidate).origin]), "Spatial Review discovery document"));
    } catch (error) {
      attempts.push({ url: candidate, outcome: error instanceof UrlPolicyError ? "invalid" : "unavailable", message: error instanceof Error ? error.message : "network request failed" });
      continue;
    }
    if (!response.ok) {
      attempts.push({ url: candidate, outcome: "unavailable", message: `HTTP ${response.status}` });
      continue;
    }
    let payload: unknown;
    try {
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
    if (new URL(result.value.websiteUrl).origin !== websiteOrigin) {
      attempts.push({ url: candidate, outcome: "invalid", message: `websiteUrl must remain on ${websiteOrigin}` });
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

async function fetchDocument(url: string, label: string, fetcher: typeof fetch, trustedOrigins: ReadonlySet<string>) {
  const { response } = await fetchWithRedirectPolicy(url, fetcher, trustedOrigins, label);
  if (!response.ok) throw new Error(`${label} ${url} returned ${response.status}.`);
  return readLimitedJson(response, DOCUMENT_LIMIT_BYTES, label);
}

async function fetchPreparedBytes(descriptor: { url: string; byteLength: number; sha256?: string }, fetcher: typeof fetch, trustedOrigins: ReadonlySet<string>) {
  const { response } = await fetchWithRedirectPolicy(descriptor.url, fetcher, trustedOrigins, "Prepared review package");
  if (!response.ok) throw new Error(`Prepared review package returned ${response.status}.`);
  const declared = Number(response.headers.get("content-length"));
  const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
  if ((!encoding || encoding === "identity") && Number.isFinite(declared) && declared > descriptor.byteLength) throw new Error("Prepared review file exceeds its declared byte budget.");
  const chunks: Uint8Array[] = []; let length = 0;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > descriptor.byteLength) { await reader.cancel(); throw new Error("Prepared review file exceeds its declared byte budget."); }
      chunks.push(result.value);
    }
  } else { const bytes = new Uint8Array(await response.arrayBuffer()); chunks.push(bytes); length = bytes.byteLength; }
  if (length > descriptor.byteLength || (descriptor.sha256 && length !== descriptor.byteLength)) throw new Error("Prepared review file length does not match its manifest.");
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (descriptor.sha256 && await preparedReviewSha256(bytes) !== descriptor.sha256) throw new Error("Prepared review file SHA-256 does not match its manifest.");
  return bytes.buffer;
}

async function validatePreparedTransport(manifestUrl: string, websiteUrl: string, fetcher: typeof fetch, trustedOrigins: ReadonlySet<string>) {
  const bytes = await fetchPreparedBytes({ url: manifestUrl, byteLength: PREPARED_REVIEW_LIMITS.manifestBytes }, fetcher, trustedOrigins);
  const manifest = normalizePreparedReviewManifest(JSON.parse(new TextDecoder().decode(bytes)), manifestUrl);
  if (manifest.source.websiteUrl !== websiteUrl) throw new Error("The prepared package belongs to a different source website.");
  const catalogBytes = await fetchPreparedBytes(manifest.catalog, fetcher, trustedOrigins);
  const buffers = new Map<string, ArrayBuffer>();
  for (const resource of manifest.resources) {
    const resourceBytes = await fetchPreparedBytes(resource, fetcher, trustedOrigins);
    if (resource.kind === "buffer") buffers.set(resource.id, resourceBytes);
  }
  const decoded = decodePreparedReviewCatalog(JSON.parse(new TextDecoder().decode(catalogBytes)), manifest, buffers);
  const result = validateReviewIndex(decoded.index);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  if (result.value.assetCatalog.assets.some((asset) => !asset.nodes.length)) throw new Error("The prepared package contains pending detailed geometry.");
  for (const asset of result.value.assetCatalog.assets) for (const material of asset.materials) for (const map of material.maps ?? []) {
    if (!map.resourceId || !decoded.textures[map.resourceId]) throw new Error("A prepared texture is missing its captured resource.");
  }
  return manifest;
}

export async function validateWebsite(websiteUrl: string, options: ValidateWebsiteOptions = {}) {
  const fetcher = options.fetch ?? fetch;
  const resolved = await resolveWebsiteDiscovery(websiteUrl, { ...options, fetch: fetcher });
  const { discovery } = resolved;
  const trustedOrigins = new Set([new URL(resolved.discoveryUrl).origin]);
  for (const origin of options.allowedDocumentOrigins ?? []) trustedOrigins.add(normalizedOrigin(origin, "Allowed document origin"));
  const prepared = discovery.capabilities?.preparedPackage
    ? await validatePreparedTransport(discovery.capabilities.preparedPackage.manifest, discovery.websiteUrl, fetcher, trustedOrigins)
    : undefined;
  let sceneAssetIds: string[] | undefined;
  if (!prepared && discovery.scene) {
    const scene = validateSceneDocument(await fetchDocument(discovery.scene, "Scene document", fetcher, trustedOrigins));
    if (!scene.ok) throw new Error(scene.errors.join("\n"));
    sceneAssetIds = scene.value.actors.map((actor) => actor.assetId);
  }
  if (!prepared && discovery.assets) {
    const assets = validateAssetDocument(await fetchDocument(discovery.assets, "Asset document", fetcher, trustedOrigins));
    if (!assets.ok) throw new Error(assets.errors.join("\n"));
    if (sceneAssetIds) {
      const assetIds = new Set(assets.value.assets.map((asset) => asset.id));
      const missing = [...new Set(sceneAssetIds.filter((assetId) => !assetIds.has(assetId)))];
      if (missing.length) throw new Error(`Scene actors reference assets missing from the advertised catalog: ${missing.join(", ")}.`);
    }
  }
  return [
    `Compatible: ${discovery.name}`,
    `Discovery: ${resolved.discoveryUrl}`,
    "Attempted discovery URLs:",
    ...resolved.attempts.map((attempt) => `- ${attempt.url}: ${attempt.outcome} (${attempt.message})`),
    `Scene: ${discovery.scene ? "yes" : "no"}`,
    `Assets: ${discovery.assets ? "yes" : "no"}`,
    `Live: ${discovery.liveCapture ? "yes" : "no"}`,
    `Prepared: ${prepared ? `${prepared.captureId} (build ${prepared.buildId}, source revision ${prepared.source.revision})` : "no"}`,
    `Live editor policy: ${discovery.capabilities?.liveCapture?.editorOriginPolicy?.mode ?? "unspecified"}`,
    `Open review: ${spatialReviewEditorUrl(discovery.websiteUrl, { discoveryUrl: resolved.discoveryUrl })}`,
    "",
  ].join("\n");
}
