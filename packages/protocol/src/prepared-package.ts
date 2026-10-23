import {
  SPATIAL_REVIEW_INDEX_SCHEMA,
  SPATIAL_REVIEW_PREPARED_CATALOG_SCHEMA,
  SPATIAL_REVIEW_PREPARED_PACKAGE_SCHEMA,
} from "./constants.js";
import type { AssetGeometry, SpatialReviewIndex } from "./types.js";

export const PREPARED_REVIEW_LIMITS = {
  manifestBytes: 4 * 1024 * 1024,
  catalogBytes: 24 * 1024 * 1024,
  resourceBytes: 64 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  resources: 16_384,
} as const;

export type PreparedReviewFidelity = {
  geometry: "source" | "approximate" | "proxy";
  materials: "source" | "approximate" | "proxy";
  /** The existing serializer does not reproduce arbitrary source shaders. */
  limitations: string[];
};
export type PreparedReviewSource = {
  websiteUrl: string;
  /** A source commit/build/content revision, independent of capture identity. */
  revision: string;
  generator: string;
  captureUrl?: string;
};
export type PreparedReviewDocumentDescriptor = { url: string; byteLength: number; sha256: string };
export type PreparedReviewResource = PreparedReviewDocumentDescriptor & {
  id: string;
  kind: "buffer" | "texture";
  contentType: string;
};
export type PreparedReviewManifest = {
  schema: typeof SPATIAL_REVIEW_PREPARED_PACKAGE_SCHEMA;
  version: 1;
  buildId: string;
  captureId: string;
  capturedAt: string;
  source: PreparedReviewSource;
  fidelity: PreparedReviewFidelity;
  /** One detailed capture serves Scene, Asset and Experience workspaces. */
  profile: "review";
  catalog: PreparedReviewDocumentDescriptor;
  resources: PreparedReviewResource[];
};
export type PreparedReviewBufferReference = {
  $spatialReviewBuffer: string;
  componentType: "f32" | "u32" | "u16" | "u8";
  length: number;
  /** Byte offset into an aligned, deduplicated numeric chunk. */
  byteOffset: number;
};
export type PreparedReviewCatalog = {
  schema: typeof SPATIAL_REVIEW_PREPARED_CATALOG_SCHEMA;
  buildId: string;
  captureId: string;
  /** Canonical SpatialReviewIndex with numeric buffers externalized. */
  index: unknown;
  /** Source texture resource ID to immutable resource ID. */
  textures: Record<string, string>;
};
export type PreparedReviewFile = { path: string; contentType: string; bytes: Uint8Array };
export type PreparedReviewPackage = { manifest: PreparedReviewManifest; files: PreparedReviewFile[] };
export type PreparedReviewTexture = { resourceId: string; bytes: ArrayBuffer | Uint8Array; contentType: string };
export type PrepareReviewPackageOptions = {
  source: PreparedReviewSource;
  fidelity: PreparedReviewFidelity;
  captureId?: string;
  capturedAt?: string;
  textures?: readonly PreparedReviewTexture[];
};

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const sizes = { f32: 4, u32: 4, u16: 2, u8: 1 } as const;

function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must be non-empty text of at most ${max} characters.`);
  return value;
}
function webUrl(value: unknown, base: string, label: string, sameOrigin = false) {
  const raw = text(value, label, 4_096);
  let url: URL;
  try { url = new URL(raw, base); } catch { throw new Error(`${label} must be a valid HTTP(S) URL.`); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hostname.includes("*")) throw new Error(`${label} must be a credential-free HTTP(S) URL.`);
  if (sameOrigin && url.origin !== new URL(base).origin) throw new Error(`${label} must use the package origin.`);
  url.hash = "";
  return url.href;
}
function descriptor(value: unknown, base: string, label: string, max: number): PreparedReviewDocumentDescriptor {
  if (!object(value)) throw new Error(`${label} must be an object.`);
  if (!Number.isSafeInteger(value.byteLength) || Number(value.byteLength) < 0 || Number(value.byteLength) > max) throw new Error(`${label}.byteLength exceeds the package budget.`);
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest.`);
  return { url: webUrl(value.url, base, `${label}.url`, true), byteLength: Number(value.byteLength), sha256: value.sha256 };
}

/** Resolve only the immutable package's own resources. The source URL is
 * provenance, never a fallback dependency for decoding or rendering. */
export function normalizePreparedReviewManifest(value: unknown, manifestUrl: string): PreparedReviewManifest {
  const base = webUrl(manifestUrl, manifestUrl, "manifestUrl");
  if (!object(value) || value.schema !== SPATIAL_REVIEW_PREPARED_PACKAGE_SCHEMA || value.version !== 1 || value.profile !== "review") throw new Error("Unsupported prepared review package.");
  if (!object(value.source) || !object(value.fidelity)) throw new Error("The prepared package requires source identity and fidelity metadata.");
  const source: PreparedReviewSource = {
    websiteUrl: webUrl(value.source.websiteUrl, base, "source.websiteUrl"),
    revision: text(value.source.revision, "source.revision"),
    generator: text(value.source.generator, "source.generator"),
    ...(value.source.captureUrl === undefined ? {} : { captureUrl: webUrl(value.source.captureUrl, base, "source.captureUrl") }),
  };
  const fidelity = value.fidelity;
  if (!["source", "approximate", "proxy"].includes(String(fidelity.geometry)) || !["source", "approximate", "proxy"].includes(String(fidelity.materials))
    || !Array.isArray(fidelity.limitations) || fidelity.limitations.length > 100 || fidelity.limitations.some((entry) => typeof entry !== "string" || entry.length > 2_000)) throw new Error("The prepared package has invalid fidelity metadata.");
  if (typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt))) throw new Error("capturedAt must be an ISO date.");
  if (!Array.isArray(value.resources) || value.resources.length > PREPARED_REVIEW_LIMITS.resources) throw new Error("The prepared package exceeds the resource-count budget.");
  const ids = new Set<string>();
  const urls = new Set<string>();
  let total = 0;
  const resources = value.resources.map((entry, index): PreparedReviewResource => {
    if (!object(entry) || (entry.kind !== "buffer" && entry.kind !== "texture")) throw new Error(`resources[${index}] has an invalid kind.`);
    const id = text(entry.id, `resources[${index}].id`);
    const data = descriptor(entry, base, `resources[${index}]`, PREPARED_REVIEW_LIMITS.resourceBytes);
    if (id !== `${entry.kind}:sha256:${data.sha256}` || ids.has(id) || urls.has(data.url)) throw new Error("Prepared resources must have unique content-addressed IDs and URLs.");
    const contentType = text(entry.contentType, `resources[${index}].contentType`, 100);
    if (entry.kind === "buffer" ? contentType !== "application/octet-stream" : !/^image\/(png|jpeg|webp|gif|avif)$/.test(contentType)) throw new Error("The prepared resource has an unsupported content type.");
    ids.add(id); urls.add(data.url); total += data.byteLength;
    return { ...data, id, kind: entry.kind, contentType };
  });
  const catalog = descriptor(value.catalog, base, "catalog", PREPARED_REVIEW_LIMITS.catalogBytes);
  if (total + catalog.byteLength > PREPARED_REVIEW_LIMITS.totalBytes) throw new Error("The prepared package exceeds the total byte budget.");
  return { schema: SPATIAL_REVIEW_PREPARED_PACKAGE_SCHEMA, version: 1, profile: "review", buildId: text(value.buildId, "buildId"), captureId: text(value.captureId, "captureId"),
    capturedAt: value.capturedAt, source, fidelity: { geometry: fidelity.geometry, materials: fidelity.materials, limitations: [...fidelity.limitations] } as PreparedReviewFidelity, catalog, resources };
}

export async function preparedReviewSha256(bytes: Uint8Array | ArrayBuffer) {
  const owned = new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", owned));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function typedGeometry(geometry: AssetGeometry): AssetGeometry {
  if (geometry.kind !== "mesh") return geometry;
  const floats = (value: number[] | Float32Array | undefined) => value === undefined || value instanceof Float32Array ? value : new Float32Array(value);
  const indices = geometry.indices;
  if (indices && !indices.every((index) => Number.isSafeInteger(index) && index >= 0 && index < geometry.positions.length / 3)) throw new Error("Prepared geometry contains an invalid index.");
  return { ...geometry, positions: floats(geometry.positions)!, normals: floats(geometry.normals), uvs: floats(geometry.uvs),
    indices: indices === undefined || !Array.isArray(indices) ? indices : geometry.positions.length / 3 <= 65_535 ? new Uint16Array(indices) : new Uint32Array(indices) };
}

/** Package an actual captured index. This does not infer or upgrade fidelity.
 * Callers must validate their canonical index before exporting it. */
export async function encodePreparedReviewPackage(index: SpatialReviewIndex, options: PrepareReviewPackageOptions): Promise<PreparedReviewPackage> {
  if (index.schema !== SPATIAL_REVIEW_INDEX_SCHEMA) throw new Error("Prepared packages require a canonical SpatialReviewIndex.");
  if (index.assetCatalog.assets.some((asset) => !asset.nodes.length)) throw new Error("Prepared packages require complete detailed assets, not pending geometry metadata.");
  const captureId = options.captureId ?? crypto.randomUUID();
  const resources = new Map<string, PreparedReviewResource>();
  const files: PreparedReviewFile[] = [];
  let total = 0;
  const addResource = async (bytes: Uint8Array, kind: PreparedReviewResource["kind"], contentType: string) => {
    if (bytes.byteLength > PREPARED_REVIEW_LIMITS.resourceBytes) throw new Error("A prepared resource exceeds the byte budget.");
    const sha256 = await preparedReviewSha256(bytes);
    const id = `${kind}:sha256:${sha256}`;
    if (!resources.has(id)) {
      total += bytes.byteLength;
      if (total > PREPARED_REVIEW_LIMITS.totalBytes || resources.size >= PREPARED_REVIEW_LIMITS.resources) throw new Error("The prepared package exceeds its resource budget.");
      const extension = kind === "buffer" ? "bin" : contentType.split("/")[1];
      const url = `resources/${sha256}.${extension}`;
      resources.set(id, { id, kind, contentType, url, sha256, byteLength: bytes.byteLength });
      files.push({ path: url, contentType, bytes: new Uint8Array(bytes) });
    }
    return id;
  };
  const numericBuffers = new Map<string, { bytes: Uint8Array; references: PreparedReviewBufferReference[] }>();
  const active = new WeakSet<object>();
  const typedCache = new WeakMap<object, Promise<PreparedReviewBufferReference>>();
  const encode = async (value: unknown, depth = 0): Promise<unknown> => {
    if (depth > 256) throw new Error("The prepared catalog exceeds the nesting budget.");
    if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("The prepared catalog contains a non-finite value."); return value; }
    if (typeof value !== "object") throw new Error("The prepared catalog contains unsupported values.");
    if (ArrayBuffer.isView(value)) {
      if (!(value instanceof Float32Array || value instanceof Uint32Array || value instanceof Uint16Array || value instanceof Uint8Array)) throw new Error("Unsupported prepared buffer component type.");
      if (value instanceof Float32Array && !value.every(Number.isFinite)) throw new Error("Prepared buffers must contain finite values.");
      let encoded = typedCache.get(value);
      if (!encoded) {
        const componentType = value instanceof Float32Array ? "f32" : value instanceof Uint32Array ? "u32" : value instanceof Uint16Array ? "u16" : "u8";
        const bytes = new Uint8Array(value.byteLength);
        if (littleEndian || componentType === "u8") bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        else {
          const view = new DataView(bytes.buffer);
          value.forEach((entry, offset) => {
            if (componentType === "f32") view.setFloat32(offset * 4, entry, true);
            else if (componentType === "u32") view.setUint32(offset * 4, entry, true);
            else view.setUint16(offset * 2, entry, true);
          });
        }
        encoded = preparedReviewSha256(bytes).then((digest) => {
          let packed = numericBuffers.get(digest);
          if (!packed) { packed = { bytes, references: [] }; numericBuffers.set(digest, packed); }
          const reference: PreparedReviewBufferReference = { $spatialReviewBuffer: "", componentType, length: value.length, byteOffset: 0 };
          packed.references.push(reference);
          return reference;
        });
        typedCache.set(value, encoded);
      }
      return encoded;
    }
    if (active.has(value)) throw new Error("The prepared catalog must not contain cycles.");
    active.add(value);
    let encoded: unknown;
    if (Array.isArray(value)) {
      const entries = []; for (const entry of value) entries.push(await encode(entry, depth + 1)); encoded = entries;
    } else {
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("The prepared catalog must contain only plain data.");
      const entries: Array<[string, unknown]> = [];
      for (const key of Object.keys(value)) {
        const property = Object.getOwnPropertyDescriptor(value, key);
        if (!property || !("value" in property)) throw new Error("The prepared catalog must contain only data properties.");
        if (property.value !== undefined) entries.push([key, await encode(property.value, depth + 1)]);
      }
      encoded = Object.fromEntries(entries);
    }
    active.delete(value);
    return encoded;
  };
  const typedIndex = { ...index, generatedAt: options.capturedAt ?? index.generatedAt, assetCatalog: { ...index.assetCatalog, assets: index.assetCatalog.assets.map((asset) => ({ ...asset,
    geometries: asset.geometries?.map((definition) => ({ ...definition, geometry: typedGeometry(definition.geometry) })),
    nodes: asset.nodes.map((node) => {
      if (node.instances && node.instanceData) throw new Error("Prepared components cannot use both instance encodings.");
      const { instances, ...rest } = node;
      const geometry = node.geometry ? { geometry: typedGeometry(node.geometry) } : {};
      if (!instances) return { ...rest, ...geometry };
      if (instances.length > 100_000 || instances.some((matrix) => matrix.length !== 16 || !matrix.every(Number.isFinite))) throw new Error("Prepared components contain invalid instance matrices.");
      const transforms = new Float32Array(instances.length * 16);
      instances.forEach((matrix, index) => transforms.set(matrix, index * 16));
      return { ...rest, ...geometry, instanceData: { encoding: "matrix-f32-v1", count: instances.length, transforms } };
    }),
  })) } };
  const textureEntries: Array<[string, string]> = [];
  for (const texture of options.textures ?? []) {
    if (textureEntries.some(([id]) => id === texture.resourceId)) throw new Error("Duplicate source texture resource ID.");
    const bytes = texture.bytes instanceof Uint8Array ? texture.bytes : new Uint8Array(texture.bytes);
    textureEntries.push([texture.resourceId, await addResource(bytes, "texture", texture.contentType.toLowerCase().split(";")[0].trim())]);
  }
  const textures = Object.fromEntries(textureEntries);
  for (const asset of index.assetCatalog.assets) for (const material of asset.materials) for (const map of material.maps ?? []) {
    if (!map.resourceId || !textures[map.resourceId]) throw new Error(`Prepared texture ${material.id}/${map.slot} has no captured resource bytes.`);
  }
  const encodedIndex = await encode(typedIndex);
  // Package many tiny geometry arrays into a few requests without losing
  // deduplication. Four-byte alignment supports every v1 component type.
  const chunkTarget = 16 * 1024 * 1024;
  let chunkEntries: Array<{ value: { bytes: Uint8Array; references: PreparedReviewBufferReference[] }; offset: number }> = [];
  let chunkLength = 0;
  const flushChunk = async () => {
    if (!chunkEntries.length) return;
    const bytes = new Uint8Array(chunkLength);
    for (const { value, offset } of chunkEntries) bytes.set(value.bytes, offset);
    const id = await addResource(bytes, "buffer", "application/octet-stream");
    for (const { value, offset } of chunkEntries) for (const reference of value.references) {
      reference.$spatialReviewBuffer = id; reference.byteOffset = offset;
    }
    chunkEntries = []; chunkLength = 0;
  };
  for (const value of numericBuffers.values()) {
    if (value.bytes.byteLength > PREPARED_REVIEW_LIMITS.resourceBytes) throw new Error("A prepared numeric buffer exceeds the byte budget.");
    let offset = Math.ceil(chunkLength / 4) * 4;
    if (chunkEntries.length && offset + value.bytes.byteLength > chunkTarget) { await flushChunk(); offset = 0; }
    chunkEntries.push({ value, offset }); chunkLength = offset + value.bytes.byteLength;
    if (chunkLength >= chunkTarget) await flushChunk();
  }
  await flushChunk();
  const catalog: PreparedReviewCatalog = { schema: SPATIAL_REVIEW_PREPARED_CATALOG_SCHEMA, buildId: index.buildId, captureId, index: encodedIndex, textures };
  const catalogBytes = new TextEncoder().encode(JSON.stringify(catalog));
  if (catalogBytes.byteLength > PREPARED_REVIEW_LIMITS.catalogBytes) throw new Error("The prepared catalog exceeds the metadata budget.");
  const catalogSha = await preparedReviewSha256(catalogBytes);
  const catalogPath = `catalog.${catalogSha}.json`;
  const manifest: PreparedReviewManifest = { schema: SPATIAL_REVIEW_PREPARED_PACKAGE_SCHEMA, version: 1, buildId: index.buildId, captureId,
    capturedAt: options.capturedAt ?? index.generatedAt, source: options.source, fidelity: options.fidelity, profile: "review",
    catalog: { url: catalogPath, byteLength: catalogBytes.byteLength, sha256: catalogSha }, resources: [...resources.values()] };
  normalizePreparedReviewManifest(manifest, "https://package.invalid/manifest.json");
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (manifestBytes.byteLength > PREPARED_REVIEW_LIMITS.manifestBytes || total + catalogBytes.byteLength > PREPARED_REVIEW_LIMITS.totalBytes) throw new Error("The prepared package exceeds the metadata/total byte budget.");
  files.push({ path: catalogPath, contentType: "application/json", bytes: catalogBytes });
  files.push({ path: "manifest.json", contentType: "application/json", bytes: manifestBytes });
  return { manifest, files };
}

/** Restore shared typed views only after the consumer has verified each file's
 * length and digest. Repeated references return the same view object. */
export function decodePreparedReviewCatalog(value: unknown, manifest: PreparedReviewManifest, buffers: ReadonlyMap<string, ArrayBuffer>): { index: SpatialReviewIndex; textures: Record<string, string> } {
  if (!object(value) || value.schema !== SPATIAL_REVIEW_PREPARED_CATALOG_SCHEMA || value.buildId !== manifest.buildId || value.captureId !== manifest.captureId || !object(value.textures)) throw new Error("The prepared catalog does not match its capture identity.");
  const resources = new Map(manifest.resources.map((resource) => [resource.id, resource]));
  const views = new Map<string, Float32Array | Uint32Array | Uint16Array | Uint8Array>();
  let visited = 0;
  const decode = (candidate: unknown, depth = 0): unknown => {
    if (++visited > 2_000_000 || depth > 256) throw new Error("The prepared catalog exceeds its structural budget.");
    if (!candidate || typeof candidate !== "object") return candidate;
    if (object(candidate) && Object.hasOwn(candidate, "$spatialReviewBuffer")) {
      const { $spatialReviewBuffer: id, componentType, length, byteOffset } = candidate;
      if (Object.keys(candidate).length !== 4 || typeof id !== "string" || !Object.hasOwn(sizes, String(componentType)) || !Number.isSafeInteger(length) || Number(length) < 0 || !Number.isSafeInteger(byteOffset) || Number(byteOffset) < 0) throw new Error("Invalid prepared buffer reference.");
      const type = componentType as PreparedReviewBufferReference["componentType"];
      const resource = resources.get(id);
      const buffer = buffers.get(id);
      if (resource?.kind !== "buffer" || !buffer || buffer.byteLength !== resource.byteLength || Number(byteOffset) % sizes[type] !== 0 || Number(byteOffset) + Number(length) * sizes[type] > buffer.byteLength) throw new Error("Prepared buffer length or resource kind does not match its reference.");
      const key = `${id}:${byteOffset}:${type}:${length}`;
      let view = views.get(key);
      if (!view) {
        view = type === "f32" ? new Float32Array(buffer, Number(byteOffset), Number(length)) : type === "u32" ? new Uint32Array(buffer, Number(byteOffset), Number(length)) : type === "u16" ? new Uint16Array(buffer, Number(byteOffset), Number(length)) : new Uint8Array(buffer, Number(byteOffset), Number(length));
        if (!littleEndian && type !== "u8") {
          view = view.slice(); const data = new DataView(buffer, Number(byteOffset), Number(length) * sizes[type]);
          for (let index = 0; index < view.length; index++) view[index] = type === "f32" ? data.getFloat32(index * 4, true) : type === "u32" ? data.getUint32(index * 4, true) : data.getUint16(index * 2, true);
        }
        views.set(key, view);
      }
      return view;
    }
    if (Array.isArray(candidate)) return candidate.map((entry) => decode(entry, depth + 1));
    return Object.fromEntries(Object.entries(candidate).map(([key, entry]) => [key, decode(entry, depth + 1)]));
  };
  const index = decode(value.index) as SpatialReviewIndex;
  if (!object(index) || index.schema !== SPATIAL_REVIEW_INDEX_SCHEMA || index.buildId !== manifest.buildId || index.generatedAt !== manifest.capturedAt || !object(index.scene) || !object(index.assetCatalog)) throw new Error("The prepared index does not match its source build or capture time.");
  const textures = Object.fromEntries(Object.entries(value.textures).map(([sourceId, id]) => {
    if (!sourceId || typeof id !== "string" || resources.get(id)?.kind !== "texture") throw new Error("Invalid prepared texture resource mapping.");
    return [sourceId, id];
  }));
  return { index, textures };
}
