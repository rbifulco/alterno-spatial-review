export const SPATIAL_REVIEW_DISCOVERY_SCHEMA = "spatial-review-discovery/v1" as const;
export const SPATIAL_REVIEW_BUNDLE_SCHEMA = "spatial-review-bundle/v1" as const;
export const SPATIAL_REVIEW_INDEX_SCHEMA = "spatial-review-index/v1" as const;
export const LEGACY_SPATIAL_REVIEW_INDEX_SCHEMA = "sole-review-index/v1" as const;
export const ASSET_REVIEW_SCHEMA = "asset-review-3d/v1" as const;
export const SCENE_ACTORS_SCHEMA = "scene-actors/v1" as const;
export const SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY = "scene-assemblies-v1" as const;
export const SPATIAL_REVIEW_DISCOVERY_PATH = "/.well-known/spatial-review.json" as const;

export const SPATIAL_REVIEW_READY = "alterno:spatial-review:ready" as const;
export const SPATIAL_REVIEW_REQUEST = "alterno:spatial-review:request" as const;
export const SPATIAL_REVIEW_CATALOG = "alterno:spatial-review:catalog" as const;
export const SPATIAL_REVIEW_DISCOVERY_REQUEST = "alterno:spatial-review:discovery-request" as const;
export const SPATIAL_REVIEW_DISCOVERY_RESPONSE = "alterno:spatial-review:discovery-response" as const;
export const SPATIAL_REVIEW_RESOURCE_REQUEST = "alterno:spatial-review:resource-request" as const;
export const SPATIAL_REVIEW_RESOURCE_RESPONSE = "alterno:spatial-review:resource-response" as const;
export const SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY = "resource-transfer-v1" as const;
export const SPATIAL_REVIEW_PROGRESSIVE_CAPABILITY = "progressive-assets-v1" as const;
export const SPATIAL_REVIEW_GEOMETRY_TRANSFER_CAPABILITY = "geometry-transfer-v1" as const;
export const SPATIAL_REVIEW_ASSET_REQUEST = "alterno:spatial-review:asset-request" as const;
export const SPATIAL_REVIEW_ASSET_RESPONSE = "alterno:spatial-review:asset-response" as const;
export const SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY = "asset-stream-v1" as const;
export const SPATIAL_REVIEW_SOURCE_STATUS = "alterno:spatial-review:source-status" as const;
export const SPATIAL_REVIEW_ASSET_PROGRESS = "alterno:spatial-review:asset-progress" as const;
export const SPATIAL_REVIEW_ASSET_CANCEL = "alterno:spatial-review:asset-cancel" as const;

/** Shared producer/consumer safety limits for live catalog identity and render
 * fan-out. Keeping these in the protocol package prevents SDKs and validators
 * from advertising payloads that conforming editors must reject. */
export const SPATIAL_REVIEW_MAX_BUILD_ID_LENGTH = 200;
export const SPATIAL_REVIEW_MAX_NODE_MATERIAL_IDS = 256;
export const SPATIAL_REVIEW_MAX_ASSET_MATERIAL_REFERENCES = 100_000;
export const SPATIAL_REVIEW_MAX_GEOMETRY_GROUPS = 20_000;
export const SPATIAL_REVIEW_MAX_ASSET_GEOMETRY_GROUPS = 100_000;

/** Temporary wire aliases used only while deployed Sole/editor builds migrate. */
export const LEGACY_SPATIAL_REVIEW_READY = "sole:scene-asset-registry:ready" as const;
export const LEGACY_SPATIAL_REVIEW_REQUEST = "sole:scene-asset-registry:request" as const;
export const LEGACY_SPATIAL_REVIEW_CATALOG = "sole:scene-asset-registry:catalog" as const;
