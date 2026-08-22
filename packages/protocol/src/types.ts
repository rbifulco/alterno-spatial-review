import type {
  ASSET_REVIEW_SCHEMA,
  LEGACY_SPATIAL_REVIEW_INDEX_SCHEMA,
  SCENE_ACTORS_SCHEMA,
  SPATIAL_REVIEW_BUNDLE_SCHEMA,
  SPATIAL_REVIEW_DISCOVERY_SCHEMA,
  SPATIAL_REVIEW_INDEX_SCHEMA,
  SPATIAL_REVIEW_RESOURCE_REQUEST,
  SPATIAL_REVIEW_RESOURCE_RESPONSE,
  SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY,
} from "./constants.js";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Transform3D = { position: Vec3; rotation: Vec3; scale: Vec3 };
export type SpatialReviewProfile = "scene" | "review";

export type AssetGeometry =
  | { kind: "primitive"; primitive: "box" | "sphere" | "cylinder"; dimensions: Vec3; segments?: number }
  | { kind: "mesh"; positions: number[]; indices?: number[]; normals?: number[]; uvs?: number[]; groups?: Array<{ start: number; count: number; materialIndex: number }> };

export type AssetGeometryDefinition = { id: string; name?: string; geometry: AssetGeometry };
export type AssetTextureMap = { slot: string; name?: string; sourceRef?: string; resourceId?: string; wrap?: "clamp" | "repeat"; repeat?: Vec2; offset?: Vec2; rotation?: number; flipY?: boolean };
export type AssetMaterial = { id: string; name: string; type: "standard" | "basic" | "phong" | "unknown"; color: string; emissive?: string; roughness?: number; metalness?: number; opacity: number; doubleSided: boolean; wireframe?: boolean; maps?: AssetTextureMap[] };
export type AssetNode = { id: string; name: string; type: "group" | "mesh" | "line" | "points"; parentId?: string; position: Vec3; rotation: Vec3; scale: Vec3; visible: boolean; geometry?: AssetGeometry; geometryId?: string; materialIds: string[]; instances?: number[][]; sourceRef?: string };
export type AssetSurfaceAnchor = { nodeId: string; instanceId?: number; localPosition: Vec3; localNormal?: Vec3; uv?: Vec2 };
export type AssetAnnotation = { id: string; body: string; category: string; priority: "low" | "medium" | "high" | "blocker"; target: { scope: "asset" | "component" | "geometry" | "material"; nodeId?: string; materialId?: string }; anchor?: AssetSurfaceAnchor; createdAt: string; author?: string; resolved: boolean };
export type AssetPartModification =
  | { id: string; action: "transform"; part: { id: string; name: string; sourceRef?: string }; before: Transform3D; after: Transform3D }
  | { id: string; action: "delete"; part: { id: string; name: string; sourceRef?: string }; removedNodes?: Array<{ node: AssetNode; index: number }> }
  | { id: string; action: "add"; node: AssetNode; material?: AssetMaterial };
export type AssetFeedback = { status: "unreviewed" | "needs-change" | "question" | "approved"; summary: string; annotations: AssetAnnotation[]; modifications: AssetPartModification[] };
export type ReviewAsset3D = { id: string; name: string; sourceRef?: string; category?: string; tags: string[]; nodes: AssetNode[]; geometries?: AssetGeometryDefinition[]; materials: AssetMaterial[]; sourceTransform?: Transform3D; animations?: string[]; feedback: AssetFeedback };
export type AssetReviewDocument3D = { schema: typeof ASSET_REVIEW_SCHEMA; id: string; name: string; units: "m"; source?: { label?: string; url?: string; importedAt?: string; generator?: string }; assets: ReviewAsset3D[] };

export type SceneReviewActor = { actorId: string; assetId: string; name: string; sourceRef: string; category: string; transform: Transform3D; bounds: { center: Vec3; size: Vec3 } };
export type SpatialReviewIndex = { schema: typeof SPATIAL_REVIEW_INDEX_SCHEMA | typeof LEGACY_SPATIAL_REVIEW_INDEX_SCHEMA; buildId: string; generatedAt: string; scene: { schema: typeof SCENE_ACTORS_SCHEMA; actors: SceneReviewActor[] }; assetCatalog: AssetReviewDocument3D };

export type SpatialReviewDiscovery = { schema: typeof SPATIAL_REVIEW_DISCOVERY_SCHEMA; version: 1; name: string; websiteUrl: string; scene?: string; assets?: string; liveCapture?: string };
export type SpatialReviewBundle = { schema: typeof SPATIAL_REVIEW_BUNDLE_SCHEMA; websiteUrl: string; discoveryUrl: string; discovery: SpatialReviewDiscovery; scene?: unknown; assets?: unknown };

export type SpatialReviewResourceTransferCapability = typeof SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY;
export type SpatialReviewResourceTransferOffer = {
  capability: SpatialReviewResourceTransferCapability;
  maxBytes: number;
};
export type SpatialReviewReadyMessage = {
  type: string;
  buildId: string;
  actors: number;
  capabilities?: string[];
  resourceTransfer?: SpatialReviewResourceTransferOffer;
};
export type SpatialReviewCatalogRequest = {
  type: string;
  profile?: SpatialReviewProfile;
  requestId?: string;
  resourceTransfer?: SpatialReviewResourceTransferOffer;
};
export type SpatialReviewCatalogMessage = {
  type: string;
  profile: SpatialReviewProfile;
  requestId?: string;
  payload: SpatialReviewIndex;
  resourceTransfer?: SpatialReviewResourceTransferOffer;
};
export type SpatialReviewResourceRequest = {
  type: typeof SPATIAL_REVIEW_RESOURCE_REQUEST;
  requestId: string;
  resourceId: string;
};
export type SpatialReviewResourceResponse = {
  type: typeof SPATIAL_REVIEW_RESOURCE_RESPONSE;
  requestId: string;
  resourceId: string;
  ok: true;
  contentType: string;
  bytes: ArrayBuffer;
} | {
  type: typeof SPATIAL_REVIEW_RESOURCE_RESPONSE;
  requestId: string;
  resourceId: string;
  ok: false;
  error: "not-found" | "unavailable" | "too-large";
  message: string;
};
