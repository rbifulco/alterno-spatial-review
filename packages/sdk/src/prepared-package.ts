import {
  encodePreparedReviewPackage,
  PREPARED_REVIEW_LIMITS,
  type AssetRepresentationDescriptor,
  type PreparedReviewFidelity,
  type PreparedReviewPackage,
  type PreparedReviewTexture,
  type ReviewAsset3D,
  type SpatialReviewIndex,
} from "@alterno-dev/spatial-review-protocol";
import type { SceneAssetRegistry } from "./registry.js";

/** Structural on purpose: an existing capture page's registry can be exported
 * by a newer SDK without constructing a second Three.js scene or registry. */
export type PreparedReviewRegistry = Pick<SceneAssetRegistry,
  "toReviewIndex" | "getAssetStreamDescriptor" | "produceAssetRepresentation" | "readTextureResource">;
export type ExportPreparedReviewOptions = {
  websiteUrl: string;
  sourceRevision: string;
  sourceGenerator?: string;
  captureUrl?: string;
  captureId?: string;
  capturedAt?: string;
  fidelity: PreparedReviewFidelity;
  signal?: AbortSignal;
  maxAssetBytes?: number;
  onProgress?: (progress: { phase: "assets" | "textures" | "encoding"; completed: number; total: number; assetId?: string }) => void;
};
export type ExportPreparedReviewResult = PreparedReviewPackage & {
  stats: { elapsedMs: number; assets: number; resources: number; bytes: number };
};

const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Prepared review export was cancelled.", "AbortError");
};
const representationIdentity = (value: AssetRepresentationDescriptor) => JSON.stringify(value);

/** Execute the existing canonical serializers once before sharing the editor
 * URL. It never falls back to discovery's optional static/proxy manifests.
 * Pause source animation/mutation until this promise settles. */
export async function exportPreparedReviewPackage(registry: PreparedReviewRegistry, options: ExportPreparedReviewOptions): Promise<ExportPreparedReviewResult> {
  const started = performance.now();
  const signal = options.signal ?? new AbortController().signal;
  abort(signal);
  const metadata = registry.toReviewIndex("review", false, true, true, true);
  const initialScene = JSON.stringify(metadata.scene);
  const textures: PreparedReviewTexture[] = [];
  const textureIds = new Set<string>();
  const assets: ReviewAsset3D[] = [];
  const selected = new Map<string, AssetRepresentationDescriptor>();
  const maxBytes = options.maxAssetBytes ?? PREPARED_REVIEW_LIMITS.resourceBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > PREPARED_REVIEW_LIMITS.totalBytes) throw new Error("maxAssetBytes exceeds the package budget.");
  for (const family of metadata.assetCatalog.assets) {
    abort(signal);
    const descriptor = registry.getAssetStreamDescriptor(family.id, "review");
    const detail = descriptor?.representations.find((representation) => representation.purpose === "detail");
    if (!detail) throw new Error(`Asset ${family.id} has no detailed representation; a prepared package cannot silently substitute overview geometry.`);
    options.onProgress?.({ phase: "assets", completed: assets.length, total: metadata.assetCatalog.assets.length, assetId: family.id });
    const produced = await registry.produceAssetRepresentation(family.id, "review", detail.id, maxBytes, "background", signal);
    abort(signal);
    if (!produced || produced.asset.id !== family.id || representationIdentity(produced.representation) !== representationIdentity(detail)) throw new Error(`Asset ${family.id} changed or became unavailable during prepared export.`);
    selected.set(family.id, detail);
    assets.push(produced.asset);
    // Read session-owned resources immediately, before later deferred families
    // can evict them from the live registry's bounded retention cache.
    for (const material of produced.asset.materials) for (const map of material.maps ?? []) {
      if (!map.resourceId) throw new Error(`Texture ${material.id}/${map.slot} has no canonical registry resource ID.`);
      if (textureIds.has(map.resourceId)) continue;
      options.onProgress?.({ phase: "textures", completed: textureIds.size, total: textureIds.size + 1, assetId: family.id });
      const resource = await registry.readTextureResource(map.resourceId, PREPARED_REVIEW_LIMITS.resourceBytes);
      abort(signal);
      if (!resource) throw new Error(`Texture ${map.resourceId} is unavailable during prepared export.`);
      textureIds.add(map.resourceId);
      textures.push({ resourceId: map.resourceId, ...resource });
    }
  }
  const final = registry.toReviewIndex("review", false, true, true, true);
  if (final.buildId !== metadata.buildId || JSON.stringify(final.scene) !== initialScene || JSON.stringify(final.assetCatalog.assets.map((asset) => asset.id)) !== JSON.stringify(metadata.assetCatalog.assets.map((asset) => asset.id))) throw new Error("The source scene changed during prepared export. Pause its runtime and capture again.");
  for (const [assetId, representation] of selected) {
    const current = registry.getAssetStreamDescriptor(assetId, "review")?.representations.find((entry) => entry.id === representation.id);
    if (!current || representationIdentity(current) !== representationIdentity(representation)) throw new Error(`Asset ${assetId} changed during prepared export. Pause its runtime and capture again.`);
  }
  const index: SpatialReviewIndex = { ...metadata, generatedAt: options.capturedAt ?? metadata.generatedAt, assetCatalog: { ...metadata.assetCatalog, assets } };
  options.onProgress?.({ phase: "encoding", completed: assets.length, total: assets.length });
  const result = await encodePreparedReviewPackage(index, {
    source: { websiteUrl: options.websiteUrl, revision: options.sourceRevision, generator: options.sourceGenerator ?? "@alterno-dev/spatial-review registry", ...(options.captureUrl ? { captureUrl: options.captureUrl } : {}) },
    fidelity: options.fidelity,
    captureId: options.captureId,
    capturedAt: options.capturedAt,
    textures,
  });
  abort(signal);
  return { ...result, stats: { elapsedMs: performance.now() - started, assets: assets.length, resources: result.manifest.resources.length, bytes: result.files.reduce((sum, file) => sum + file.bytes.byteLength, 0) } };
}
