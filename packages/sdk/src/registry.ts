import * as THREE from "three";
import { ASSET_REVIEW_SCHEMA, LEGACY_SPATIAL_REVIEW_INDEX_SCHEMA, SCENE_ACTORS_SCHEMA, SPATIAL_REVIEW_INDEX_SCHEMA, type AssetReviewDocument3D, type SceneReviewActor, type SpatialReviewIndex, type SpatialReviewProfile, type Vec3 } from "@alterno-dev/spatial-review-protocol";
import { assetFromObject3DRoots } from "./serializer.js";
import { readTextureResource } from "./resource.js";

export type SceneAssetRegistration = { actorId: string; assetId: string; name: string; sourceRef: string; category: string; roots: THREE.Object3D[]; tags?: string[]; order?: number };

function transform(object: THREE.Object3D) {
  object.updateWorldMatrix(true, false); const position = new THREE.Vector3(); const quaternion = new THREE.Quaternion(); const scale = new THREE.Vector3(); object.matrixWorld.decompose(position, quaternion, scale); const rotation = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  return { position: position.toArray() as Vec3, rotation: [rotation.x, rotation.y, rotation.z].map(THREE.MathUtils.radToDeg) as Vec3, scale: scale.toArray() as Vec3 };
}

export class SceneAssetRegistry {
  readonly buildId: string;
  private registrations = new Map<string, SceneAssetRegistration>();
  private cache = new Map<SpatialReviewProfile, AssetReviewDocument3D>();
  private textureResources = new Map<string, THREE.Texture>();
  constructor(buildId = `alterno-${new Date().toISOString()}`) { this.buildId = buildId; }
  register(registration: Omit<SceneAssetRegistration, "roots"> & { root?: THREE.Object3D; roots?: THREE.Object3D[] }) {
    const roots = registration.roots ?? (registration.root ? [registration.root] : []); if (!roots.length) throw new Error(`Scene actor "${registration.actorId}" has no asset root.`);
    this.registrations.set(registration.actorId, { ...registration, roots }); this.cache.clear(); this.textureResources.clear();
    roots.forEach((root, rootIndex) => { root.userData.spatialReviewAsset = { actorId: registration.actorId, assetId: registration.assetId, name: registration.name, sourceRef: registration.sourceRef, rootIndex }; if (!root.name) root.name = roots.length > 1 ? `${registration.name} / part ${rootIndex + 1}` : registration.name; });
    return roots[0];
  }
  get size() { return this.registrations.size; }
  private ordered() { return [...this.registrations.values()].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)); }
  toAssetDocument(profile: SpatialReviewProfile = "review") {
    const cached = this.cache.get(profile); if (cached) return cached; const assets = new Map<string, SceneAssetRegistration>(); this.ordered().forEach((entry) => { if (!assets.has(entry.assetId)) assets.set(entry.assetId, entry); });
    const document: AssetReviewDocument3D = { schema: ASSET_REVIEW_SCHEMA, id: "alterno-live-scene-assets", name: profile === "scene" ? "Recognizable scene meshes" : "Detailed scene assets", units: "m", source: { label: "Registered live Three.js roots", generator: "@alterno-dev/spatial-review", importedAt: new Date().toISOString() }, assets: [...assets.values()].map((entry) => assetFromObject3DRoots(entry.roots, entry.name, entry.sourceRef, { assetId: entry.assetId, category: entry.category, tags: [...(entry.tags ?? []), "registered", profile], profile, onTexture: (resourceId, texture) => this.textureResources.set(resourceId, texture) })) };
    this.cache.set(profile, document); return document;
  }
  toActors(): SceneReviewActor[] { return this.ordered().map((entry) => { entry.roots.forEach((root) => root.updateWorldMatrix(true, true)); const bounds = entry.roots.reduce((box, root) => box.union(new THREE.Box3().setFromObject(root)), new THREE.Box3()); return { actorId: entry.actorId, assetId: entry.assetId, name: entry.name, sourceRef: entry.sourceRef, category: entry.category, transform: transform(entry.roots[0]), bounds: { center: (bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3())).toArray() as Vec3, size: (bounds.isEmpty() ? new THREE.Vector3() : bounds.getSize(new THREE.Vector3())).toArray() as Vec3 } }; }); }
  toReviewIndex(profile: SpatialReviewProfile = "review", legacy = false): SpatialReviewIndex { return { schema: legacy ? LEGACY_SPATIAL_REVIEW_INDEX_SCHEMA : SPATIAL_REVIEW_INDEX_SCHEMA, buildId: this.buildId, generatedAt: new Date().toISOString(), scene: { schema: SCENE_ACTORS_SCHEMA, actors: this.toActors() }, assetCatalog: this.toAssetDocument(profile) }; }
  hasTextureResource(resourceId: string) { return this.textureResources.has(resourceId); }
  async readTextureResource(resourceId: string, maxBytes: number) {
    const texture = this.textureResources.get(resourceId);
    return texture ? readTextureResource(texture, maxBytes) : undefined;
  }
}
