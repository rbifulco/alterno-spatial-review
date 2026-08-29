import * as THREE from "three";
import { ASSET_REVIEW_SCHEMA, LEGACY_SPATIAL_REVIEW_INDEX_SCHEMA, SCENE_ACTORS_SCHEMA, SPATIAL_REVIEW_INDEX_SCHEMA, type AssetReviewDocument3D, type NavigationSequence, type ReviewAsset3D, type SceneReviewActor, type SpatialReviewIndex, type SpatialReviewProfile, type Vec3 } from "@alterno-dev/spatial-review-protocol";
import { assetFromObject3DRoots } from "./serializer.js";
import { readTextureResource } from "./resource.js";
import { SceneGraphCache } from "./scene-cache.js";
import { assembleScene, transformMatrix, type SceneAssemblyRegistration } from "./assemblies.js";

export type SceneAssetRegistration = { actorId: string; assetId: string; name: string; sourceRef: string; category: string; roots: THREE.Object3D[]; tags?: string[]; order?: number; parentAssemblyId?: string; visible?: boolean };
export type NavigationSequenceRegistration = NavigationSequence & { order?: number };
type CachedAsset = { revision: string; asset: ReviewAsset3D };

function transform(object: THREE.Object3D) {
  const position = new THREE.Vector3(); const quaternion = new THREE.Quaternion(); const scale = new THREE.Vector3();
  object.matrixWorld.decompose(position, quaternion, scale); const rotation = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  return { position: position.toArray() as Vec3, rotation: [rotation.x, rotation.y, rotation.z].map(THREE.MathUtils.radToDeg) as Vec3, scale: scale.toArray() as Vec3 };
}

export class SceneAssetRegistry {
  readonly buildId: string;
  private registrations = new Map<string, SceneAssetRegistration>();
  private navigationRegistrations = new Map<string, NavigationSequenceRegistration>();
  private assemblyRegistrations = new Map<string, SceneAssemblyRegistration>();
  private assets = new Map<string, SceneAssetRegistration>();
  private orderedEntries: SceneAssetRegistration[] | undefined;
  private assetCache = new Map<string, CachedAsset>();
  private actorCache = new Map<string, { revision: string; actor: SceneReviewActor }>();
  private graph = new SceneGraphCache();
  private textureResources = new Map<string, THREE.Texture>();
  constructor(buildId = `alterno-${new Date().toISOString()}`) { this.buildId = buildId; }
  register(registration: Omit<SceneAssetRegistration, "roots"> & { root?: THREE.Object3D; roots?: THREE.Object3D[] }) {
    const roots = registration.roots ?? (registration.root ? [registration.root] : []);
    if (!roots.length) throw new Error(`Scene actor "${registration.actorId}" has no asset root.`);
    const previous = this.registrations.get(registration.actorId);
    this.registrations.set(registration.actorId, { ...registration, roots });
    this.actorCache.delete(registration.actorId); this.resetCatalog([registration.assetId, ...(previous ? [previous.assetId] : [])]);
    roots.forEach((root, rootIndex) => {
      root.userData.spatialReviewAsset = { actorId: registration.actorId, assetId: registration.assetId, name: registration.name, sourceRef: registration.sourceRef, rootIndex };
      if (!root.name) root.name = roots.length > 1 ? `${registration.name} / part ${rootIndex + 1}` : registration.name;
    });
    return roots[0];
  }
  unregister(actorId: string) {
    const previous = this.registrations.get(actorId);
    const removed = this.registrations.delete(actorId);
    if (removed) { this.actorCache.delete(actorId); this.resetCatalog([previous!.assetId]); }
    return removed;
  }
  /** Register a transform-only owner. A root supplies a pose, never geometry. */
  registerAssembly(registration: SceneAssemblyRegistration) {
    if (!registration.assemblyId.trim()) throw new Error("Scene assembly ID cannot be empty.");
    this.assemblyRegistrations.set(registration.assemblyId, registration.root ? { ...registration } : { ...registration, localTransform: structuredClone(registration.localTransform) });
    this.assetCache.clear();
    return registration;
  }
  unregisterAssembly(assemblyId: string) {
    if ([...this.registrations.values(), ...this.assemblyRegistrations.values()].some((entry) => entry.parentAssemblyId === assemblyId)) throw new Error("Reparent or unregister owned children before removing their assembly.");
    this.assetCache.clear();
    return this.assemblyRegistrations.delete(assemblyId);
  }
  get assemblySize() { return this.assemblyRegistrations.size; }
  /** Transform/hierarchy edits and attribute.needsUpdate are detected automatically.
   * Explicitly invalidate after changing raw geometry buffers without a version bump. */
  invalidate(actorId?: string) {
    const entries = actorId ? [this.registrations.get(actorId)].filter((value): value is SceneAssetRegistration => Boolean(value)) : this.ordered();
    entries.forEach((entry) => { this.graph.invalidate(entry.roots); this.actorCache.delete(entry.actorId); });
  }
  private resetCatalog(assetIds: string[]) {
    this.orderedEntries = undefined;
    const affected = new Set(assetIds);
    this.assetCache.forEach((entry, key) => { if (affected.has(entry.asset.id)) this.assetCache.delete(key); });
    if (!this.registrations.size) this.textureResources.clear();
  }
  registerNavigationSequence(registration: NavigationSequenceRegistration) {
    if (!registration.id.trim()) throw new Error("Navigation sequence id cannot be empty.");
    if (!registration.stops.length) throw new Error(`Navigation sequence "${registration.id}" has no stops.`);
    this.navigationRegistrations.set(registration.id, structuredClone(registration));
    return registration;
  }
  get size() { return this.registrations.size; }
  get navigationSize() { return this.navigationRegistrations.size; }
  get cacheMetrics() { return { ...this.graph.metrics, assets: this.assetCache.size }; }
  private ordered() {
    if (!this.orderedEntries) {
      this.orderedEntries = [...this.registrations.values()].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
      this.assets.clear(); this.orderedEntries.forEach((entry) => { if (!this.assets.has(entry.assetId)) this.assets.set(entry.assetId, entry); });
    }
    return this.orderedEntries;
  }
  private revision(entry: SceneAssetRegistration) { return entry.roots.map((root) => this.graph.inspect(root).revision).join(":"); }
  private asset(entry: SceneAssetRegistration, profile: SpatialReviewProfile, compact: boolean) {
    const key = `${profile}:${compact}:${entry.assetId}`; const revision = this.revision(entry);
    const cached = this.assetCache.get(key);
    if (cached?.revision === revision) return cached.asset;
    const asset = assetFromObject3DRoots(entry.roots, entry.name, entry.sourceRef, {
      assetId: entry.assetId, category: entry.category, tags: [...(entry.tags ?? []), "registered", profile], profile,
      geometryEncoding: compact ? "typed" : "json", onTexture: (resourceId, texture) => this.textureResources.set(resourceId, texture),
      // A single root is the placement's visibility switch. Multiple roots
      // are asset parts: one actor flag cannot encode their individual states.
      ignoreRootVisibility: this.assemblyRegistrations.size > 0 && entry.roots.length === 1,
    });
    this.assetCache.set(key, { revision, asset }); return asset;
  }
  private document(profile: SpatialReviewProfile, metadata = false): AssetReviewDocument3D {
    this.ordered();
    return { schema: ASSET_REVIEW_SCHEMA, id: "alterno-live-scene-assets", name: profile === "scene" ? "Recognizable scene meshes" : "Detailed scene assets", units: "m",
      source: { label: "Registered live Three.js roots", generator: "@alterno-dev/spatial-review", importedAt: new Date().toISOString() },
      assets: [...this.assets.values()].map((entry) => metadata ? {
        id: entry.assetId, name: entry.name, sourceRef: entry.sourceRef, category: entry.category, tags: entry.tags ?? [], nodes: [], materials: [],
        feedback: { status: "unreviewed", summary: "", annotations: [], modifications: [] },
      } : this.asset(entry, profile, false)) };
  }
  toAssetDocument(profile: SpatialReviewProfile = "review") { this.graph.begin(); return this.document(profile); }
  /** Serializes only the requested family. The byte budget is checked before allocating arrays. */
  toAsset(assetId: string, profile: SpatialReviewProfile = "review", compact = false, maxBytes = Infinity) {
    this.ordered(); const entry = this.assets.get(assetId); if (!entry) return undefined;
    const seen = new Set<THREE.BufferGeometry>(); let bytes = 0;
    entry.roots.forEach((root) => root.traverse((object) => {
      const geometry = (object as THREE.Mesh).geometry;
      if (geometry && !seen.has(geometry)) {
        seen.add(geometry);
        for (const name of profile === "scene" ? ["position"] : ["position", "normal", "uv"]) {
          const attribute = geometry.getAttribute(name); if (attribute) bytes += attribute.count * attribute.itemSize * 4;
        }
        if (geometry.index) bytes += geometry.index.count * (geometry.getAttribute("position")?.count <= 65535 ? 2 : 4);
      }
      if (object instanceof THREE.InstancedMesh) bytes += object.count * 16 * 8;
    }));
    if (bytes > maxBytes) throw new RangeError("The requested asset exceeds the negotiated geometry byte budget.");
    this.graph.begin(); return this.asset(entry, profile, compact);
  }
  private actors(): SceneReviewActor[] {
    return this.ordered().map((entry) => {
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
  toScene(hierarchical = true) {
    this.graph.begin();
    const actors = this.actors();
    if (!this.assemblyRegistrations.size && !actors.some((actor) => actor.parentAssemblyId)) return { schema: SCENE_ACTORS_SCHEMA, actors, navigationSequences: this.toNavigationSequences() };
    // Object identity, not geometry resource identity, determines registration ownership.
    const owners = new Map<THREE.Object3D, string>();
    this.ordered().forEach((entry) => entry.roots.forEach((root) => {
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
  toReviewIndex(profile: SpatialReviewProfile = "review", legacy = false, metadata = false, hierarchical = !legacy): SpatialReviewIndex {
    this.graph.begin(); return { schema: legacy ? LEGACY_SPATIAL_REVIEW_INDEX_SCHEMA : SPATIAL_REVIEW_INDEX_SCHEMA, buildId: this.buildId, generatedAt: new Date().toISOString(),
      scene: this.toScene(!legacy && hierarchical), assetCatalog: this.document(profile, metadata) };
  }
  hasTextureResource(resourceId: string) { return this.textureResources.has(resourceId); }
  async readTextureResource(resourceId: string, maxBytes: number) { const texture = this.textureResources.get(resourceId); return texture ? readTextureResource(texture, maxBytes) : undefined; }
}
