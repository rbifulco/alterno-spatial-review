import { ASSET_REVIEW_SCHEMA, SPATIAL_REVIEW_INDEX_SCHEMA, normalizeSpatialReviewDiscovery, type AssetReviewDocument3D, type SpatialReviewDiscovery, type SpatialReviewIndex } from "@alterno-dev/spatial-review-protocol";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function validateDiscovery(value: unknown, url: string): ValidationResult<SpatialReviewDiscovery> {
  try { return { ok: true, value: normalizeSpatialReviewDiscovery(value, url) }; } catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : "Invalid discovery document"] }; }
}

export function validateAssetDocument(value: unknown): ValidationResult<AssetReviewDocument3D> {
  const errors: string[] = [];
  if (!object(value)) errors.push("Asset document must be an object.");
  else {
    if (value.schema !== ASSET_REVIEW_SCHEMA) errors.push(`schema must be ${ASSET_REVIEW_SCHEMA}.`);
    if (!Array.isArray(value.assets)) errors.push("assets must be an array.");
    else if (value.assets.length > 2_000) errors.push("assets exceeds the 2,000 item safety limit.");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as AssetReviewDocument3D };
}

export function validateReviewIndex(value: unknown): ValidationResult<SpatialReviewIndex> {
  const errors: string[] = [];
  if (!object(value)) errors.push("Review index must be an object.");
  else {
    if (value.schema !== SPATIAL_REVIEW_INDEX_SCHEMA) errors.push(`schema must be ${SPATIAL_REVIEW_INDEX_SCHEMA}.`);
    if (!object(value.scene) || !Array.isArray(value.scene.actors)) errors.push("scene.actors must be an array.");
    const assets = object(value.assetCatalog) ? value.assetCatalog.assets : undefined;
    if (!Array.isArray(assets)) errors.push("assetCatalog.assets must be an array.");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as SpatialReviewIndex };
}
