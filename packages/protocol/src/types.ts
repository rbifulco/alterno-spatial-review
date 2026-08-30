import type {
  ASSET_REVIEW_SCHEMA,
  LEGACY_SPATIAL_REVIEW_INDEX_SCHEMA,
  SCENE_ACTORS_SCHEMA,
  SPATIAL_REVIEW_BUNDLE_SCHEMA,
  SPATIAL_REVIEW_DISCOVERY_SCHEMA,
  SPATIAL_REVIEW_DISCOVERY_REQUEST,
  SPATIAL_REVIEW_DISCOVERY_RESPONSE,
  SPATIAL_REVIEW_INDEX_SCHEMA,
  SPATIAL_REVIEW_RESOURCE_REQUEST,
  SPATIAL_REVIEW_RESOURCE_RESPONSE,
  SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY,
  SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY,
  SPATIAL_REVIEW_ASSET_CANCEL,
  SPATIAL_REVIEW_ASSET_PROGRESS,
  SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY,
  SPATIAL_REVIEW_SOURCE_STATUS,
} from "./constants.js";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Transform3D = { position: Vec3; rotation: Vec3; scale: Vec3 };
export type SpatialReviewProfile = "scene" | "review";
/** JSON documents use number arrays. Negotiated live transfers may use owned buffers. */
export type GeometryValues = number[] | Float32Array;
export type GeometryIndices = number[] | Uint16Array | Uint32Array;

export type AssetGeometry =
  | { kind: "primitive"; primitive: "box" | "sphere" | "cylinder"; dimensions: Vec3; segments?: number }
  | { kind: "mesh"; positions: GeometryValues; indices?: GeometryIndices; normals?: GeometryValues; uvs?: GeometryValues; groups?: Array<{ start: number; count: number; materialIndex: number }> };

export type AssetGeometryDefinition = { id: string; name?: string; geometry: AssetGeometry };
export type AssetTextureMap = { slot: string; name?: string; sourceRef?: string; resourceId?: string; wrap?: "clamp" | "repeat"; repeat?: Vec2; offset?: Vec2; rotation?: number; flipY?: boolean };
export type AssetMaterial = { id: string; name: string; type: "standard" | "basic" | "phong" | "unknown"; color: string; emissive?: string; roughness?: number; metalness?: number; opacity: number; doubleSided: boolean; wireframe?: boolean; maps?: AssetTextureMap[] };
export type AssetInstanceData = {
  encoding: "matrix-f32-v1";
  count: number;
  transforms: Float32Array;
  colors?: Float32Array | Uint8Array;
  stableIds?: Uint32Array;
  selection?: "aggregate" | "instance";
};
export type AssetRepresentationDescriptor = {
  id: string;
  purpose: "overview" | "detail";
  revision: string;
  estimatedBytes: number;
  triangles?: number;
  instances?: number;
  attributes: Array<"position" | "normal" | "uv" | "color">;
  /** Metres, when known. */
  geometricError?: number;
};
export type AssetStreamDescriptor = {
  capability: typeof SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY;
  revision: string;
  representations: AssetRepresentationDescriptor[];
};
export type AssetNode = { id: string; name: string; type: "group" | "mesh" | "line" | "points"; parentId?: string; position: Vec3; rotation: Vec3; scale: Vec3; visible: boolean; geometry?: AssetGeometry; geometryId?: string; materialIds: string[]; instances?: number[][]; instanceData?: AssetInstanceData; sourceRef?: string };
export type AssetSurfaceAnchor = { nodeId: string; instanceId?: number; localPosition: Vec3; localNormal?: Vec3; uv?: Vec2 };
export type AssetAnnotation = { id: string; body: string; category: string; priority: "low" | "medium" | "high" | "blocker"; target: { scope: "asset" | "component" | "geometry" | "material"; nodeId?: string; materialId?: string }; anchor?: AssetSurfaceAnchor; createdAt: string; author?: string; resolved: boolean };
export type AssetPartModification =
  | { id: string; action: "transform"; part: { id: string; name: string; sourceRef?: string }; before: Transform3D; after: Transform3D }
  | { id: string; action: "delete"; part: { id: string; name: string; sourceRef?: string }; removedNodes?: Array<{ node: AssetNode; index: number }> }
  | { id: string; action: "add"; node: AssetNode; material?: AssetMaterial };
export type AssetFeedback = { status: "unreviewed" | "needs-change" | "question" | "approved"; summary: string; annotations: AssetAnnotation[]; modifications: AssetPartModification[] };
export type ReviewAsset3D = { id: string; name: string; sourceRef?: string; category?: string; tags: string[]; nodes: AssetNode[]; geometries?: AssetGeometryDefinition[]; materials: AssetMaterial[]; sourceTransform?: Transform3D; animations?: string[]; stream?: AssetStreamDescriptor; feedback: AssetFeedback };
export type AssetReviewDocument3D = { schema: typeof ASSET_REVIEW_SCHEMA; id: string; name: string; units: "m"; source?: { label?: string; url?: string; importedAt?: string; generator?: string }; assets: ReviewAsset3D[] };

export type Bounds3D = { center: Vec3; size: Vec3 };
/** Ownership is independent of asset identity, classification, and render batches. */
export type SceneReviewAssembly = {
  assemblyId: string;
  name: string;
  sourceRef: string;
  parentAssemblyId?: string;
  /** Parent-local metres, XYZ Euler degrees, and positive uniform scale. */
  localTransform: Transform3D;
  /** Evaluated world pose and subtree bounds for non-hierarchical consumers. */
  transform: Transform3D;
  bounds: Bounds3D;
  /** Own visibility; effective visibility also includes all owners. */
  visible: boolean;
};
export type SceneOwnership = {
  capability: typeof SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY;
  mode: "hierarchical" | "flattened";
  /** Human-readable disclosure, especially when assembly editing is unavailable. */
  reason?: string;
};
export type SceneReviewActor = {
  actorId: string; assetId: string; name: string; sourceRef: string; category: string;
  /** Always world-space. Never reinterpret this existing field as parent-local. */
  transform: Transform3D;
  bounds: Bounds3D;
  parentAssemblyId?: string;
  /** Required for actors in an explicitly hierarchical scene, including world children. */
  localTransform?: Transform3D;
  /** Own visibility in hierarchical scenes; effective visibility when flattened. */
  visible?: boolean;
};

export type SceneOwnershipTarget = { kind: "assembly"; assemblyId: string; sourceRef: string }
  | { kind: "placement"; actorId: string; assetId: string; sourceRef: string };
/** Absolute intent against one baseline, not incremental operations to replay. */
export type SceneOwnershipOperation = {
  action: "transform";
  target: SceneOwnershipTarget;
  space: "parent-local";
  parentAssemblyId?: string;
  before: Transform3D;
  after: Transform3D;
} | {
  action: "reparent";
  target: SceneOwnershipTarget;
  before: { parentAssemblyId?: string; localTransform: Transform3D };
  after: { parentAssemblyId?: string; localTransform: Transform3D };
  preserveWorldPose: boolean;
};

/** Stable semantic role of an authored point. Unlike evaluated samples, these
 * points are suitable targets for review comments and spatial edit proposals. */
export type NavigationCurvePointRole = "stop" | "through" | "control" | "control-in" | "control-out";
export type NavigationCurvePoint = {
  id: string;
  position: Vec3;
  role: NavigationCurvePointRole;
  /** Connects an endpoint to the canonical navigation stop it represents. */
  stopId?: string;
  /** Durable code symbol or content path an agent can use to implement feedback. */
  sourceRef?: string;
  /** False when the point is explanatory output rather than authored input. */
  editable?: boolean;
};

/** Engine-neutral curve definitions. `sampled` is the read-only escape hatch
 * for custom runtime curves that cannot be represented by the authored forms. */
export type NavigationCurve3 =
  | { kind: "line"; points: [NavigationCurvePoint, NavigationCurvePoint] }
  | { kind: "quadratic-bezier"; points: [NavigationCurvePoint, NavigationCurvePoint, NavigationCurvePoint] }
  | { kind: "cubic-bezier"; points: [NavigationCurvePoint, NavigationCurvePoint, NavigationCurvePoint, NavigationCurvePoint] }
  | { kind: "catmull-rom"; points: NavigationCurvePoint[]; closed?: boolean; curveType?: "centripetal" | "chordal" | "catmullrom"; tension?: number }
  | { kind: "sampled"; samples: Vec3[] };

export type NavigationAim =
  | { kind: "curve"; curve: NavigationCurve3 }
  | { kind: "path-facing"; lookDistance: number; maximumPitchRatio?: number; turnFraction?: number }
  | { kind: "fixed-target"; target: Vec3 };

export type NavigationStop = {
  id: string;
  name: string;
  camera: Vec3;
  target: Vec3;
  fov: number;
  sourceRef?: string;
};

export type NavigationSegment = {
  id: string;
  fromStopId: string;
  toStopId: string;
  camera: NavigationCurve3;
  aim: NavigationAim;
  /** Relative input or timeline span; intentionally independent of distance. */
  weight: number;
  /** Normalized segment progress at which the stop-to-stop FOV blend begins. */
  lensStart?: number;
  sourceRef?: string;
};

export type NavigationSequence = {
  id: string;
  name: string;
  sourceRef?: string;
  category?: string;
  stops: NavigationStop[];
  segments: NavigationSegment[];
};

export type SpatialReviewScene = {
  schema: typeof SCENE_ACTORS_SCHEMA;
  actors: SceneReviewActor[];
  assemblies?: SceneReviewAssembly[];
  ownership?: SceneOwnership;
  navigationSequences?: NavigationSequence[];
};

export type SpatialReviewIndex = { schema: typeof SPATIAL_REVIEW_INDEX_SCHEMA | typeof LEGACY_SPATIAL_REVIEW_INDEX_SCHEMA; buildId: string; generatedAt: string; scene: SpatialReviewScene; assetCatalog: AssetReviewDocument3D };

export type SpatialReviewDiscovery = { schema: typeof SPATIAL_REVIEW_DISCOVERY_SCHEMA; version: 1; name: string; websiteUrl: string; scene?: string; assets?: string; liveCapture?: string };
export type SpatialReviewBundle = { schema: typeof SPATIAL_REVIEW_BUNDLE_SCHEMA; websiteUrl: string; discoveryUrl: string; discovery: SpatialReviewDiscovery; scene?: unknown; assets?: unknown };

export type SpatialReviewDiscoveryRequestMessage = {
  type: typeof SPATIAL_REVIEW_DISCOVERY_REQUEST;
  requestId: string;
};
export type SpatialReviewDiscoveryResponseMessage = {
  type: typeof SPATIAL_REVIEW_DISCOVERY_RESPONSE;
  requestId: string;
  discoveryUrl: string;
  discovery: SpatialReviewDiscovery;
};

export type SpatialReviewResourceTransferCapability = typeof SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY;
export type SpatialReviewResourceTransferOffer = {
  capability: SpatialReviewResourceTransferCapability;
  maxBytes: number;
};
export type SpatialReviewReadyMessage = {
  type: string;
  buildId: string;
  actors: number;
  assemblies?: number;
  navigationSequences?: number;
  capabilities?: string[];
  resourceTransfer?: SpatialReviewResourceTransferOffer;
};
export type SpatialReviewCatalogRequest = {
  type: string;
  profile?: SpatialReviewProfile;
  requestId?: string;
  /** Explicit consumer opt-in; absent means a flattened world-space catalog. */
  capabilities?: string[];
  resourceTransfer?: SpatialReviewResourceTransferOffer;
  /** Opt in to bounds/metadata first, then request individual asset families. */
  progressive?: boolean;
  geometryTransfer?: { capability: "geometry-transfer-v1"; maxBytes: number };
};
export type SpatialReviewCatalogMessage = {
  type: string;
  profile: SpatialReviewProfile;
  requestId?: string;
  payload: SpatialReviewIndex;
  resourceTransfer?: SpatialReviewResourceTransferOffer;
  progressive?: boolean;
  geometryTransfer?: { capability: "geometry-transfer-v1"; maxBytes: number };
  assetStream?: SpatialReviewAssetStreamOffer;
};

export type SpatialReviewAssetStreamCapability = typeof SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY;
export type SpatialReviewAssetStreamOffer = {
  capability: SpatialReviewAssetStreamCapability;
  maxConcurrentRequests: number;
  maxInFlightBytes: number;
};

export type SpatialReviewAssetStreamRequest = {
  capability: SpatialReviewAssetStreamCapability;
  representationId: string;
  maxBytes: number;
  priority: "interactive" | "visible" | "background";
  knownRevision?: string;
};

export type SpatialReviewAssetRequest = {
  type: "alterno:spatial-review:asset-request";
  requestId: string;
  buildId: string;
  assetId: string;
  profile: SpatialReviewProfile;
  stream?: SpatialReviewAssetStreamRequest;
};
export type SpatialReviewAssetResponse = {
  type: "alterno:spatial-review:asset-response";
  requestId: string;
  buildId: string;
  assetId: string;
  profile: SpatialReviewProfile;
} & (
  | { ok: true; asset: ReviewAsset3D; representationId?: string; revision?: string; notModified?: false }
  | { ok: true; notModified: true; representationId: string; revision: string }
  | { ok: false; error: "not-found" | "too-large" | "unavailable" | "busy" | "cancelled"; representationId?: string; revision?: string; retryAfterMs?: number }
);
export type SpatialReviewSourceStatusMessage = {
  type: typeof SPATIAL_REVIEW_SOURCE_STATUS;
  buildId: string;
  catalogRevision: string;
  phase: "booting" | "catalog-ready" | "streaming" | "complete" | "error";
  expectedActors?: number;
  readyActors?: number;
  activeRequests?: number;
  message?: string;
};
export type SpatialReviewAssetProgressMessage = {
  type: typeof SPATIAL_REVIEW_ASSET_PROGRESS;
  requestId: string;
  buildId: string;
  assetId: string;
  representationId: string;
  phase: "queued" | "generating" | "serializing";
  completed?: number;
  total?: number;
};
export type SpatialReviewAssetCancelMessage = {
  type: typeof SPATIAL_REVIEW_ASSET_CANCEL;
  requestId: string;
  buildId: string;
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
