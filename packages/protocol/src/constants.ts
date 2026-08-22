export const SPATIAL_REVIEW_DISCOVERY_SCHEMA = "spatial-review-discovery/v1" as const;
export const SPATIAL_REVIEW_BUNDLE_SCHEMA = "spatial-review-bundle/v1" as const;
export const SPATIAL_REVIEW_INDEX_SCHEMA = "spatial-review-index/v1" as const;
export const LEGACY_SPATIAL_REVIEW_INDEX_SCHEMA = "sole-review-index/v1" as const;
export const ASSET_REVIEW_SCHEMA = "asset-review-3d/v1" as const;
export const SCENE_ACTORS_SCHEMA = "scene-actors/v1" as const;
export const SPATIAL_REVIEW_DISCOVERY_PATH = "/.well-known/spatial-review.json" as const;

export const SPATIAL_REVIEW_READY = "alterno:spatial-review:ready" as const;
export const SPATIAL_REVIEW_REQUEST = "alterno:spatial-review:request" as const;
export const SPATIAL_REVIEW_CATALOG = "alterno:spatial-review:catalog" as const;
export const SPATIAL_REVIEW_RESOURCE_REQUEST = "alterno:spatial-review:resource-request" as const;
export const SPATIAL_REVIEW_RESOURCE_RESPONSE = "alterno:spatial-review:resource-response" as const;
export const SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY = "resource-transfer-v1" as const;

/** Temporary wire aliases used only while deployed Sole/editor builds migrate. */
export const LEGACY_SPATIAL_REVIEW_READY = "sole:scene-asset-registry:ready" as const;
export const LEGACY_SPATIAL_REVIEW_REQUEST = "sole:scene-asset-registry:request" as const;
export const LEGACY_SPATIAL_REVIEW_CATALOG = "sole:scene-asset-registry:catalog" as const;
