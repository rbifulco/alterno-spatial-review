import * as THREE from "three";
import {
  ASSET_REVIEW_SCHEMA,
  LEGACY_SPATIAL_REVIEW_INDEX_SCHEMA,
  SCENE_ACTORS_SCHEMA,
  SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY,
  SPATIAL_REVIEW_INDEX_SCHEMA,
  SPATIAL_REVIEW_MAX_BUILD_ID_LENGTH,
  SPATIAL_REVIEW_SOURCE_STATUS,
  type AssetRepresentationDescriptor,
  type AssetReviewDocument3D,
  type AssetStreamDescriptor,
  type Bounds3D,
  type NavigationSequence,
  type ReviewAsset3D,
  type SceneReviewActor,
  type SpatialReviewIndex,
  type SpatialReviewProfile,
  type SpatialReviewSourceStatusMessage,
  type Transform3D,
  type Vec3,
} from "@alterno-dev/spatial-review-protocol";
import { assetFromObject3DRoots } from "./serializer.js";
import { readTextureResource } from "./resource.js";
import { SceneGraphCache } from "./scene-cache.js";
import { assembleScene, matrixTransform, transformMatrix, type SceneAssemblyRegistration } from "./assemblies.js";
import { assetTransferBuffers, prepareAssetTransfer } from "./geometry-transfer.js";

export type SceneAssetRegistration = { actorId: string; assetId: string; name: string; sourceRef: string; category: string; roots: THREE.Object3D[]; tags?: string[]; order?: number; parentAssemblyId?: string; visible?: boolean };
export type SceneAssetRepresentationProgress = {
  phase: "generating" | "serializing";
  completed?: number;
  total?: number;
};
export type SceneAssetRepresentationContext = {
  assetId: string;
  profile: SpatialReviewProfile;
  representation: AssetRepresentationDescriptor;
  maxBytes: number;
  priority: "interactive" | "visible" | "background";
  signal: AbortSignal;
  reportProgress: (progress: SceneAssetRepresentationProgress) => void;
};
export type DeferredSceneAssetRegistration = {
  actorId: string;
  assetId: string;
  name: string;
  sourceRef: string;
  category: string;
  transform: Transform3D;
  bounds: Bounds3D;
  stream: AssetStreamDescriptor;
  produceRepresentation: (context: SceneAssetRepresentationContext) => ReviewAsset3D | THREE.Object3D | THREE.Object3D[] | Promise<ReviewAsset3D | THREE.Object3D | THREE.Object3D[]>;
  tags?: string[];
  order?: number;
  parentAssemblyId?: string;
  visible?: boolean;
};
export type NavigationSequenceRegistration = NavigationSequence & { order?: number };
type CachedAsset = { revision: string; asset: ReviewAsset3D };
type AnySceneAssetRegistration = SceneAssetRegistration | DeferredSceneAssetRegistration;
type TextureResourceEntry = { texture: THREE.Texture; owners: Set<string> };
type DeferredRepresentationCacheEntry = {
  registration: DeferredSceneAssetRegistration;
  assetId: string;
  asset: ReviewAsset3D;
  bytes: number;
};

const MAX_DEFERRED_REPRESENTATION_CACHE_ENTRIES = 32;
const MAX_DEFERRED_REPRESENTATION_CACHE_BYTES = 64 * 1024 * 1024;

const statusPhaseOrder = new Map<SpatialReviewSourceStatusMessage["phase"], number>([
  ["booting", 0],
  ["catalog-ready", 1],
  ["streaming", 2],
  ["complete", 3],
  ["error", 3],
]);

function isDeferred(entry: AnySceneAssetRegistration): entry is DeferredSceneAssetRegistration {
  return "produceRepresentation" in entry;
}

function finiteTransform(value: Transform3D) {
  return [value.position, value.rotation, value.scale].every((vector) => vector.length === 3 && vector.every(Number.isFinite));
}

function finiteBounds(value: Bounds3D) {
  return value.center.length === 3 && value.size.length === 3
    && value.center.every(Number.isFinite) && value.size.every((component) => Number.isFinite(component) && component >= 0);
}

function validateStreamDescriptor(stream: AssetStreamDescriptor) {
  if (stream.capability !== SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY || !stream.revision.trim() || stream.revision.length > 200) throw new Error("Deferred asset stream metadata is invalid.");
  if (!stream.representations.length || stream.representations.length > 32) throw new Error("Deferred assets require 1-32 stream representations.");
  const ids = new Set<string>();
  stream.representations.forEach((representation) => {
    if (!representation.id.trim() || representation.id.length > 200 || ids.has(representation.id)) throw new Error(`Deferred asset representation id "${representation.id}" is empty or duplicated.`);
    ids.add(representation.id);
    if ((representation.purpose !== "overview" && representation.purpose !== "detail") || !representation.revision.trim() || representation.revision.length > 200
      || !Number.isSafeInteger(representation.estimatedBytes) || representation.estimatedBytes < 0 || representation.estimatedBytes > 1024 * 1024 * 1024) throw new Error(`Deferred asset representation "${representation.id}" has invalid purpose, revision, or byte metadata.`);
    if (!Array.isArray(representation.attributes) || representation.attributes.length > 4 || new Set(representation.attributes).size !== representation.attributes.length
      || representation.attributes.some((attribute) => !["position", "normal", "uv", "color"].includes(attribute))) throw new Error(`Deferred asset representation "${representation.id}" has unsupported attributes.`);
    for (const count of [representation.triangles, representation.instances]) if (count !== undefined && (!Number.isSafeInteger(count) || count < 0 || count > 100_000_000)) throw new Error(`Deferred asset representation "${representation.id}" has an invalid count estimate.`);
    if (representation.geometricError !== undefined && (!Number.isFinite(representation.geometricError) || representation.geometricError < 0)) throw new Error(`Deferred asset representation "${representation.id}" has an invalid geometric error.`);
  });
}

function opaqueRevision(value: string) {
  let hash = 14695981039346656037n;
  for (let index = 0; index < value.length; index += 1) hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(index))) * 1099511628211n);
  return `three-${hash.toString(16)}`;
}

function transform(object: THREE.Object3D) {
  return matrixTransform(object.matrixWorld);
}

export class SceneAssetRegistry {
  readonly buildId: string;
  private registrations = new Map<string, SceneAssetRegistration>();
  private deferredRegistrations = new Map<string, DeferredSceneAssetRegistration>();
  private navigationRegistrations = new Map<string, NavigationSequenceRegistration>();
  private assemblyRegistrations = new Map<string, SceneAssemblyRegistration>();
  private assets = new Map<string, AnySceneAssetRegistration>();
  private orderedEntries: AnySceneAssetRegistration[] | undefined;
  private assetCache = new Map<string, CachedAsset>();
  private actorCache = new Map<string, { revision: string; actor: SceneReviewActor }>();
  private graph = new SceneGraphCache();
  private textureResources = new Map<string, TextureResourceEntry>();
  private textureResourceOwners = new Map<string, Set<string>>();
  private textureResourceOwnerAssets = new Map<string, string>();
  private deferredRepresentationCache = new Map<string, DeferredRepresentationCacheEntry>();
  private deferredRepresentationCacheBytes = 0;
  private catalogVersion = 0;
  private sourceStatus: SpatialReviewSourceStatusMessage;
  private sourceStatusListeners = new Set<(status: SpatialReviewSourceStatusMessage) => void>();
  constructor(buildId = `alterno-${new Date().toISOString()}`) {
    if (typeof buildId !== "string" || !buildId.trim() || buildId.length > SPATIAL_REVIEW_MAX_BUILD_ID_LENGTH) {
      throw new Error(`Spatial Review buildId must contain 1-${SPATIAL_REVIEW_MAX_BUILD_ID_LENGTH} characters.`);
    }
    this.buildId = buildId;
    this.sourceStatus = { type: SPATIAL_REVIEW_SOURCE_STATUS, buildId, catalogRevision: this.catalogRevision, phase: "booting" };
  }
  get catalogRevision() { return `catalog-${this.catalogVersion}`; }
  getSourceStatus() { return structuredClone(this.sourceStatus); }
  onSourceStatus(listener: (status: SpatialReviewSourceStatusMessage) => void) {
    this.sourceStatusListeners.add(listener);
    return () => this.sourceStatusListeners.delete(listener);
  }
  setSourceStatus(status: Omit<SpatialReviewSourceStatusMessage, "type" | "buildId" | "catalogRevision">) {
    const previous = this.sourceStatus;
    for (const count of [status.expectedActors, status.readyActors, status.activeRequests]) if (count !== undefined && (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000)) throw new Error("Source status counts must be bounded non-negative integers.");
    if (status.expectedActors !== undefined && status.readyActors !== undefined && status.readyActors > status.expectedActors) throw new Error("Source readyActors cannot exceed expectedActors.");
    if (status.message !== undefined && status.message.length > 500) throw new Error("Source status messages are limited to 500 characters.");
    if ((statusPhaseOrder.get(status.phase) ?? -1) < (statusPhaseOrder.get(previous.phase) ?? -1)) throw new Error(`Source status cannot move backwards from ${previous.phase} to ${status.phase} within ${this.catalogRevision}.`);
    if ((previous.phase === "complete" || previous.phase === "error") && status.phase !== previous.phase) throw new Error(`Source status cannot leave terminal phase ${previous.phase} within ${this.catalogRevision}.`);
    const next = { type: SPATIAL_REVIEW_SOURCE_STATUS, buildId: this.buildId, catalogRevision: this.catalogRevision, ...status } satisfies SpatialReviewSourceStatusMessage;
    this.sourceStatus = next;
    this.sourceStatusListeners.forEach((listener) => listener(structuredClone(next)));
    return structuredClone(next);
  }
  register(registration: Omit<SceneAssetRegistration, "roots"> & { root?: THREE.Object3D; roots?: THREE.Object3D[] }) {
    const roots = registration.roots ?? (registration.root ? [registration.root] : []);
    if (!roots.length) throw new Error(`Scene actor "${registration.actorId}" has no asset root.`);
    const previous = this.registrations.get(registration.actorId) ?? this.deferredRegistrations.get(registration.actorId);
    const affectedAssetIds = [registration.assetId, ...(previous ? [previous.assetId] : [])];
    const previousCanonical = this.canonicalEntries(affectedAssetIds);
    this.deferredRegistrations.delete(registration.actorId);
    this.registrations.set(registration.actorId, { ...registration, roots });
    this.actorCache.delete(registration.actorId); this.resetCatalog(affectedAssetIds, previousCanonical);
    roots.forEach((root, rootIndex) => {
      root.userData.spatialReviewAsset = { actorId: registration.actorId, assetId: registration.assetId, name: registration.name, sourceRef: registration.sourceRef, rootIndex };
      if (!root.name) root.name = roots.length > 1 ? `${registration.name} / part ${rootIndex + 1}` : registration.name;
    });
    return roots[0];
  }
  /** Register catalog metadata immediately and defer geometry creation until a
   * negotiated representation request supplies an AbortSignal and byte budget. */
  registerDeferred(registration: DeferredSceneAssetRegistration) {
    if (!registration.actorId.trim() || !registration.assetId.trim()) throw new Error("Deferred scene actor and asset IDs cannot be empty.");
    if (!finiteTransform(registration.transform) || !finiteBounds(registration.bounds)) throw new Error(`Deferred scene actor "${registration.actorId}" has invalid transform or bounds metadata.`);
    validateStreamDescriptor(registration.stream);
    const previous = this.registrations.get(registration.actorId) ?? this.deferredRegistrations.get(registration.actorId);
    const affectedAssetIds = [registration.assetId, ...(previous ? [previous.assetId] : [])];
    const previousCanonical = this.canonicalEntries(affectedAssetIds);
    this.registrations.delete(registration.actorId);
    this.deferredRegistrations.set(registration.actorId, {
      ...registration,
      transform: structuredClone(registration.transform),
      bounds: structuredClone(registration.bounds),
      stream: structuredClone(registration.stream),
    });
    this.actorCache.delete(registration.actorId);
    this.resetCatalog(affectedAssetIds, previousCanonical);
    return registration;
  }
  unregister(actorId: string) {
    const previous = this.registrations.get(actorId) ?? this.deferredRegistrations.get(actorId);
    const previousCanonical = previous ? this.canonicalEntries([previous.assetId]) : undefined;
    const removed = this.registrations.delete(actorId) || this.deferredRegistrations.delete(actorId);
    if (removed) { this.actorCache.delete(actorId); this.resetCatalog([previous!.assetId], previousCanonical); }
    return removed;
  }
  /** Register a transform-only owner. A root supplies a pose, never geometry. */
  registerAssembly(registration: SceneAssemblyRegistration) {
    if (!registration.assemblyId.trim()) throw new Error("Scene assembly ID cannot be empty.");
    this.assemblyRegistrations.set(registration.assemblyId, registration.root ? { ...registration } : { ...registration, localTransform: structuredClone(registration.localTransform) });
    this.assetCache.clear();
    this.resetCatalog([]);
    return registration;
  }
  unregisterAssembly(assemblyId: string) {
    if ([...this.registrations.values(), ...this.deferredRegistrations.values(), ...this.assemblyRegistrations.values()].some((entry) => entry.parentAssemblyId === assemblyId)) throw new Error("Reparent or unregister owned children before removing their assembly.");
    this.assetCache.clear();
    const removed = this.assemblyRegistrations.delete(assemblyId);
    if (removed) this.resetCatalog([]);
    return removed;
  }
  get assemblySize() { return this.assemblyRegistrations.size; }
  /** Transform/hierarchy edits and attribute.needsUpdate are detected automatically.
   * Explicitly invalidate after changing raw geometry buffers without a version bump. */
  invalidate(actorId?: string) {
    const entries = actorId ? [this.registrations.get(actorId)].filter((value): value is SceneAssetRegistration => Boolean(value)) : this.ordered().filter((entry): entry is SceneAssetRegistration => !isDeferred(entry));
    entries.forEach((entry) => { this.graph.invalidate(entry.roots); this.actorCache.delete(entry.actorId); });
  }
  private resetCatalog(assetIds: string[], previousCanonical?: ReadonlyMap<string, AnySceneAssetRegistration | undefined>) {
    this.orderedEntries = undefined;
    this.catalogVersion += 1;
    this.sourceStatus = { type: SPATIAL_REVIEW_SOURCE_STATUS, buildId: this.buildId, catalogRevision: this.catalogRevision, phase: "booting" };
    this.sourceStatusListeners.forEach((listener) => listener(structuredClone(this.sourceStatus)));
    const affected = new Set(assetIds);
    let invalidated = affected;
    if (previousCanonical) {
      this.ordered();
      invalidated = new Set([...affected].filter((assetId) => previousCanonical.get(assetId) !== this.assets.get(assetId)));
    }
    this.assetCache.forEach((entry, key) => { if (invalidated.has(entry.asset.id)) this.assetCache.delete(key); });
    this.deferredRepresentationCache.forEach((entry, key) => { if (invalidated.has(entry.assetId)) this.deleteDeferredRepresentation(key); });
    this.textureResourceOwnerAssets.forEach((assetId, owner) => { if (invalidated.has(assetId)) this.releaseTextureResourceOwner(owner); });
    if (!this.registrations.size && !this.deferredRegistrations.size) {
      this.deferredRepresentationCache.clear();
      this.deferredRepresentationCacheBytes = 0;
      this.clearTextureResources();
    }
  }
  registerNavigationSequence(registration: NavigationSequenceRegistration) {
    if (!registration.id.trim()) throw new Error("Navigation sequence id cannot be empty.");
    if (!registration.stops.length) throw new Error(`Navigation sequence "${registration.id}" has no stops.`);
    this.navigationRegistrations.set(registration.id, structuredClone(registration));
    this.resetCatalog([]);
    return registration;
  }
  get size() { return this.registrations.size + this.deferredRegistrations.size; }
  get navigationSize() { return this.navigationRegistrations.size; }
  get cacheMetrics() { return { ...this.graph.metrics, assets: this.assetCache.size }; }
  get deferredCacheMetrics() {
    return {
      entries: this.deferredRepresentationCache.size,
      bytes: this.deferredRepresentationCacheBytes,
      maxEntries: MAX_DEFERRED_REPRESENTATION_CACHE_ENTRIES,
      maxBytes: MAX_DEFERRED_REPRESENTATION_CACHE_BYTES,
    };
  }
  private deleteDeferredRepresentation(key: string) {
    const cached = this.deferredRepresentationCache.get(key);
    if (!cached) return false;
    this.deferredRepresentationCache.delete(key);
    this.deferredRepresentationCacheBytes = Math.max(0, this.deferredRepresentationCacheBytes - cached.bytes);
    return true;
  }
  private rememberDeferredRepresentation(key: string, entry: DeferredRepresentationCacheEntry) {
    this.deleteDeferredRepresentation(key);
    if (entry.bytes > MAX_DEFERRED_REPRESENTATION_CACHE_BYTES) return false;
    this.deferredRepresentationCache.set(key, entry);
    this.deferredRepresentationCacheBytes += entry.bytes;
    while (this.deferredRepresentationCache.size > MAX_DEFERRED_REPRESENTATION_CACHE_ENTRIES
      || this.deferredRepresentationCacheBytes > MAX_DEFERRED_REPRESENTATION_CACHE_BYTES) {
      const oldest = this.deferredRepresentationCache.keys().next().value;
      if (oldest === undefined) break;
      this.deleteDeferredRepresentation(oldest);
    }
    return true;
  }
  private useDeferredRepresentation(key: string, cached: DeferredRepresentationCacheEntry, representation: AssetRepresentationDescriptor, maxBytes: number) {
    if (cached.bytes > maxBytes) throw new RangeError("The requested representation exceeds the negotiated geometry byte budget.");
    this.deferredRepresentationCache.delete(key);
    this.deferredRepresentationCache.set(key, cached);
    const asset = structuredClone(cached.asset);
    return { asset, representation, transfer: assetTransferBuffers(asset), bytes: cached.bytes };
  }
  private ordered() {
    if (!this.orderedEntries) {
      this.orderedEntries = [...this.registrations.values(), ...this.deferredRegistrations.values()].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
      this.assets.clear(); this.orderedEntries.forEach((entry) => { if (!this.assets.has(entry.assetId)) this.assets.set(entry.assetId, entry); });
    }
    return this.orderedEntries;
  }
  private canonicalEntries(assetIds: readonly string[]) {
    this.ordered();
    return new Map([...new Set(assetIds)].map((assetId) => [assetId, this.assets.get(assetId)]));
  }
  private revision(entry: SceneAssetRegistration) { return entry.roots.map((root) => this.graph.inspect(root).revision).join(":"); }
  private releaseTextureResourceOwner(owner: string) {
    const resourceIds = this.textureResourceOwners.get(owner);
    resourceIds?.forEach((resourceId) => {
      const resource = this.textureResources.get(resourceId);
      if (!resource) return;
      resource.owners.delete(owner);
      if (!resource.owners.size) this.textureResources.delete(resourceId);
    });
    this.textureResourceOwners.delete(owner);
    this.textureResourceOwnerAssets.delete(owner);
  }
  private replaceTextureResources(owner: string, assetId: string, resources: Map<string, THREE.Texture>) {
    this.releaseTextureResourceOwner(owner);
    const resourceIds = new Set<string>();
    resources.forEach((texture, resourceId) => {
      const resource = this.textureResources.get(resourceId) ?? { texture, owners: new Set<string>() };
      resource.texture = texture;
      resource.owners.add(owner);
      this.textureResources.set(resourceId, resource);
      resourceIds.add(resourceId);
    });
    if (resourceIds.size) {
      this.textureResourceOwners.set(owner, resourceIds);
      this.textureResourceOwnerAssets.set(owner, assetId);
    }
  }
  private clearTextureResources() {
    this.textureResources.clear();
    this.textureResourceOwners.clear();
    this.textureResourceOwnerAssets.clear();
  }
  private estimateBytes(entry: SceneAssetRegistration, profile: SpatialReviewProfile, instanceComponentBytes = 8) {
    const seen = new Set<THREE.BufferGeometry>(); let bytes = 0; let triangles = 0; let instances = 0;
    entry.roots.forEach((root) => root.traverse((object) => {
      const geometry = (object as THREE.Mesh).geometry;
      if (geometry && !seen.has(geometry)) {
        seen.add(geometry);
        for (const name of profile === "scene" ? ["position"] : ["position", "normal", "uv"]) {
          const attribute = geometry.getAttribute(name); if (attribute) bytes += attribute.count * attribute.itemSize * 4;
        }
        if (geometry.index) {
          bytes += geometry.index.count * (geometry.getAttribute("position")?.count <= 65535 ? 2 : 4);
          triangles += Math.floor(geometry.index.count / 3);
        } else triangles += Math.floor((geometry.getAttribute("position")?.count ?? 0) / 3);
      }
      if (object instanceof THREE.InstancedMesh) {
        instances += object.count;
        bytes += object.count * 16 * instanceComponentBytes;
      }
    }));
    return { bytes, triangles, instances };
  }
  private streamDescriptor(entry: AnySceneAssetRegistration, profile: SpatialReviewProfile): AssetStreamDescriptor {
    if (isDeferred(entry)) return structuredClone(entry.stream);
    const revision = opaqueRevision(this.revision(entry));
    const estimate = this.estimateBytes(entry, profile, 4);
    return {
      capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY,
      revision,
      representations: [{
        id: profile === "scene" ? "overview" : "detail",
        purpose: profile === "scene" ? "overview" : "detail",
        revision,
        estimatedBytes: Math.min(1024 * 1024 * 1024, estimate.bytes),
        triangles: estimate.triangles,
        instances: estimate.instances,
        attributes: profile === "scene" ? ["position"] : ["position", "normal", "uv"],
      }],
    };
  }
  private asset(entry: SceneAssetRegistration, profile: SpatialReviewProfile, compact: boolean) {
    const key = `${profile}:${compact}:${entry.assetId}`; const revision = this.revision(entry);
    const cached = this.assetCache.get(key);
    if (cached?.revision === revision) return cached.asset;
    const resources = new Map<string, THREE.Texture>();
    const asset = assetFromObject3DRoots(entry.roots, entry.name, entry.sourceRef, {
      assetId: entry.assetId, category: entry.category, tags: [...(entry.tags ?? []), "registered", profile], profile,
      geometryEncoding: compact ? "typed" : "json", onTexture: (resourceId, texture) => resources.set(resourceId, texture),
      // A single root is the placement's visibility switch. Multiple roots
      // are asset parts: one actor flag cannot encode their individual states.
      ignoreRootVisibility: this.assemblyRegistrations.size > 0 && entry.roots.length === 1,
    });
    this.replaceTextureResources(`eager:${key}`, entry.assetId, resources);
    this.assetCache.set(key, { revision, asset }); return asset;
  }
  private document(profile: SpatialReviewProfile, metadata = false, stream = false): AssetReviewDocument3D {
    this.ordered();
    const entries = [...this.assets.values()].filter((entry) => stream || !isDeferred(entry));
    return { schema: ASSET_REVIEW_SCHEMA, id: "alterno-live-scene-assets", name: profile === "scene" ? "Recognizable scene meshes" : "Detailed scene assets", units: "m",
      source: { label: "Registered live scene assets", generator: "@alterno-dev/spatial-review", importedAt: new Date().toISOString() },
      assets: entries.map((entry) => metadata ? {
        id: entry.assetId, name: entry.name, sourceRef: entry.sourceRef, category: entry.category, tags: entry.tags ?? [], nodes: [], materials: [],
        ...(stream ? { stream: this.streamDescriptor(entry, profile) } : {}),
        feedback: { status: "unreviewed", summary: "", annotations: [], modifications: [] },
      } : this.asset(entry as SceneAssetRegistration, profile, false)) };
  }
  toAssetDocument(profile: SpatialReviewProfile = "review") { this.graph.begin(); return this.document(profile); }
  /** Serializes only the requested family. The byte budget is checked before allocating arrays. */
  toAsset(assetId: string, profile: SpatialReviewProfile = "review", compact = false, maxBytes = Infinity) {
    this.ordered(); const entry = this.assets.get(assetId); if (!entry || isDeferred(entry)) return undefined;
    if (this.estimateBytes(entry, profile).bytes > maxBytes) throw new RangeError("The requested asset exceeds the negotiated geometry byte budget.");
    this.graph.begin(); return this.asset(entry, profile, compact);
  }
  getAssetStreamDescriptor(assetId: string, profile: SpatialReviewProfile = "review") {
    this.graph.begin(); this.ordered();
    const entry = this.assets.get(assetId);
    return entry ? this.streamDescriptor(entry, profile) : undefined;
  }
  async produceAssetRepresentation(assetId: string, profile: SpatialReviewProfile, representationId: string, maxBytes: number,
    priority: SceneAssetRepresentationContext["priority"], signal: AbortSignal, reportProgress: SceneAssetRepresentationContext["reportProgress"] = () => {}) {
    this.graph.begin(); this.ordered();
    const entry = this.assets.get(assetId);
    if (!entry) return undefined;
    const stream = this.streamDescriptor(entry, profile);
    const representation = stream.representations.find((candidate) => candidate.id === representationId);
    if (!representation) return undefined;
    if (representation.estimatedBytes > maxBytes) throw new RangeError("The requested representation exceeds the negotiated geometry byte budget.");
    if (signal.aborted) throw new DOMException("Asset representation request was cancelled.", "AbortError");
    let asset: ReviewAsset3D;
    if (isDeferred(entry)) {
      // A representation revision is immutable. Reusing its first completed
      // snapshot keeps response resource IDs stable across concurrent peers.
      const cacheKey = JSON.stringify([profile, entry.assetId, representation.id, representation.revision]);
      const cached = this.deferredRepresentationCache.get(cacheKey);
      if (cached?.registration === entry) {
        reportProgress({ phase: "serializing" });
        return this.useDeferredRepresentation(cacheKey, cached, representation, maxBytes);
      }
      const produced = await entry.produceRepresentation({ assetId, profile, representation: structuredClone(representation), maxBytes, priority, signal, reportProgress });
      if (signal.aborted) throw new DOMException("Asset representation request was cancelled.", "AbortError");

      // Rebuild the catalog map before accepting an async completion. An
      // unregister or replacement must make the old producer result stale.
      this.ordered();
      if (this.assets.get(assetId) !== entry) throw new Error("Asset representation request was superseded by a catalog change.");
      const completed = this.deferredRepresentationCache.get(cacheKey);
      if (completed?.registration === entry) {
        reportProgress({ phase: "serializing" });
        return this.useDeferredRepresentation(cacheKey, completed, representation, maxBytes);
      }

      let ownsTextureResources = false;
      if (produced instanceof THREE.Object3D || Array.isArray(produced)) {
        const roots = produced instanceof THREE.Object3D ? [produced] : produced;
        if (!roots.length || roots.some((root) => !(root instanceof THREE.Object3D))) throw new Error("The deferred asset producer returned invalid Three.js roots.");
        const resources = new Map<string, THREE.Texture>();
        asset = assetFromObject3DRoots(roots, entry.name, entry.sourceRef, { assetId: entry.assetId, category: entry.category, tags: [...(entry.tags ?? []), "registered", profile], profile, geometryEncoding: "typed", onTexture: (resourceId, texture) => resources.set(resourceId, texture) });
        this.replaceTextureResources(`deferred:${cacheKey}`, entry.assetId, resources);
        ownsTextureResources = resources.size > 0;
      } else asset = produced;
      let prepared: ReturnType<typeof prepareAssetTransfer>;
      try {
        if (asset.id !== entry.assetId) throw new Error(`Deferred asset producer returned "${asset.id}" for requested asset "${entry.assetId}".`);
        reportProgress({ phase: "serializing" });
        prepared = prepareAssetTransfer({ ...asset, stream }, maxBytes, { typedInstances: true });
      } catch (error) {
        if (ownsTextureResources) this.releaseTextureResourceOwner(`deferred:${cacheKey}`);
        throw error;
      }
      const cacheEntry = { registration: entry, assetId: entry.assetId, asset: prepared.asset, bytes: prepared.bytes };
      if (this.rememberDeferredRepresentation(cacheKey, cacheEntry)) {
        return this.useDeferredRepresentation(cacheKey, cacheEntry, representation, maxBytes);
      }
      return { ...prepared, representation };
    } else {
      if (this.estimateBytes(entry, profile, 4).bytes > maxBytes) throw new RangeError("The requested representation exceeds the negotiated geometry byte budget.");
      asset = this.asset(entry, profile, true);
    }
    reportProgress({ phase: "serializing" });
    return { ...prepareAssetTransfer({ ...asset, stream }, maxBytes, { typedInstances: true }), representation };
  }
  private actors(includeDeferred = false): SceneReviewActor[] {
    return this.ordered().filter((entry) => includeDeferred || !isDeferred(entry)).map((entry) => {
      if (isDeferred(entry)) return { actorId: entry.actorId, assetId: entry.assetId, name: entry.name, sourceRef: entry.sourceRef, category: entry.category,
        parentAssemblyId: entry.parentAssemblyId, visible: entry.visible ?? true, transform: structuredClone(entry.transform), bounds: structuredClone(entry.bounds) };
      const revision = this.revision(entry); let cached = this.actorCache.get(entry.actorId);
      if (cached?.revision !== revision) {
        const bounds = new THREE.Box3(); entry.roots.forEach((root) => bounds.union(this.graph.inspect(root).bounds));
        const actor: SceneReviewActor = { actorId: entry.actorId, assetId: entry.assetId, name: entry.name, sourceRef: entry.sourceRef, category: entry.category,
          parentAssemblyId: entry.parentAssemblyId, visible: entry.visible ?? entry.roots.some((root) => root.visible),
          transform: transform(entry.roots[0]), bounds: { center: (bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3())).toArray() as Vec3,
            size: (bounds.isEmpty() ? new THREE.Vector3() : bounds.getSize(new THREE.Vector3())).toArray() as Vec3 } };
        cached = { revision, actor }; this.actorCache.set(entry.actorId, cached);
      }
      // Do not expose mutable cache entries to handoff consumers.
      return structuredClone(cached.actor);
    });
  }
  /** Legacy actor-only callers have no assembly context, so return world-space fallback records. */
  toActors() { return this.toScene(false).actors; }
  toScene(hierarchical = true, includeDeferred = false) {
    this.graph.begin();
    const actors = this.actors(includeDeferred);
    if (!this.assemblyRegistrations.size && !actors.some((actor) => actor.parentAssemblyId)) return { schema: SCENE_ACTORS_SCHEMA, actors, navigationSequences: this.toNavigationSequences() };
    // Object identity, not geometry resource identity, determines registration ownership.
    const owners = new Map<THREE.Object3D, string>();
    this.ordered().filter((entry): entry is SceneAssetRegistration => !isDeferred(entry)).forEach((entry) => entry.roots.forEach((root) => {
      const recomposed = transformMatrix(transform(root));
      if (!root.matrixWorld.elements.every((value, index) => Number.isFinite(value) && Math.abs(value - recomposed.elements[index]) <= 1e-5 * Math.max(1, Math.abs(value)))) throw new Error(`Actor "${entry.actorId}" has an unsupported sheared source-root transform.`);
      root.traverse((object) => {
        if (!(object as THREE.Mesh).geometry) return;
        if (owners.has(object)) throw new Error(`Rendered object "${object.name || object.uuid}" has overlapping registration owners "${owners.get(object)}" and "${entry.actorId}".`);
        owners.set(object, entry.actorId);
      });
    }));
    return { ...assembleScene([...this.assemblyRegistrations.values()], actors, hierarchical), navigationSequences: this.toNavigationSequences() };
  }
  toNavigationSequences(): NavigationSequence[] { return [...this.navigationRegistrations.values()].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)).map(({ order: _order, ...sequence }) => structuredClone(sequence)); }
  toReviewIndex(profile: SpatialReviewProfile = "review", legacy = false, metadata = false, hierarchical = !legacy, stream = false): SpatialReviewIndex {
    this.graph.begin();
    if (this.sourceStatus.phase === "booting") this.setSourceStatus({ phase: "catalog-ready", expectedActors: this.size, readyActors: this.registrations.size });
    return { schema: legacy ? LEGACY_SPATIAL_REVIEW_INDEX_SCHEMA : SPATIAL_REVIEW_INDEX_SCHEMA, buildId: this.buildId, generatedAt: new Date().toISOString(),
      scene: this.toScene(!legacy && hierarchical, stream), assetCatalog: this.document(profile, metadata, stream) };
  }
  hasTextureResource(resourceId: string) { return this.textureResources.has(resourceId); }
  async readTextureResource(resourceId: string, maxBytes: number) { const resource = this.textureResources.get(resourceId); return resource ? readTextureResource(resource.texture, maxBytes) : undefined; }
}
