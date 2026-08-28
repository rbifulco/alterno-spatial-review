import * as THREE from "three";
import { ResourceCache, type ResourceLease } from "./resource-cache.js";
import type {
  AssetGeometry,
  AssetMaterial,
  AssetNode,
  ReviewAsset3D,
  Vec3,
} from "@alterno-dev/spatial-review-protocol";

export type AssetViewMode = "lit" | "unlit" | "wireframe" | "normals" | "xray";

export type BuiltAsset = {
  root: THREE.Group;
  nodes: Map<string, THREE.Object3D>;
};

export class ThreeAssetResourceCache {
  readonly geometries = new ResourceCache<THREE.BufferGeometry>();
  readonly materials = new ResourceCache<THREE.Material>();
}
const sharedResources = new ThreeAssetResourceCache();
const defaultMaterialSource = {};
const objectResources = new WeakMap<THREE.Object3D, {
  geometry: ResourceLease<THREE.BufferGeometry>;
  materials: ResourceLease<THREE.Material>[];
}>();

export function ownThreeAssetResources<T extends THREE.Object3D>(object: T, geometry: ResourceLease<THREE.BufferGeometry>, materials: ResourceLease<THREE.Material>[]) {
  objectResources.set(object, { geometry, materials });
  return object;
}

/** Clone a live hierarchy while retaining its shared GPU resources. */
export function cloneThreeAssetObject(source: THREE.Object3D) {
  const clone = source.clone(true);
  const originals: THREE.Object3D[] = []; source.traverse(object => originals.push(object));
  let index = 0;
  clone.traverse(object => {
    const resources = objectResources.get(originals[index++]);
    if (resources) objectResources.set(object, { geometry: resources.geometry.retain(), materials: resources.materials.map(lease => lease.retain()) });
  });
  return clone;
}

/** Replace appearance without mutating resources still used by other actors. */
export function replaceThreeAssetMaterials(object: THREE.Mesh | THREE.Line | THREE.Points, materials: ResourceLease<THREE.Material>[]) {
  const resources = objectResources.get(object);
  if (!resources) throw new Error("Cannot replace materials on an unowned asset object.");
  resources.materials.forEach((lease) => lease.release());
  resources.materials = materials;
  object.material = materials.length === 1 ? materials[0].value : materials.map((lease) => lease.value);
}

export function makeAssetGeometry(geometry: AssetGeometry) {
  if (geometry.kind === "primitive") {
    const [width, height, depth] = geometry.dimensions;
    if (geometry.primitive === "sphere") {
      return new THREE.SphereGeometry(
        Math.max(width, height, depth) * 0.5,
        geometry.segments ?? 32,
        Math.max(12, Math.round((geometry.segments ?? 32) * 0.62)),
      );
    }
    if (geometry.primitive === "cylinder") {
      return new THREE.CylinderGeometry(width * 0.5, depth * 0.5, height, geometry.segments ?? 32);
    }
    return new THREE.BoxGeometry(width, height, depth);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.BufferAttribute(geometry.positions instanceof Float32Array ? geometry.positions : new Float32Array(geometry.positions), 3));
  if (geometry.indices?.length) result.setIndex(Array.isArray(geometry.indices) ? geometry.indices : new THREE.BufferAttribute(geometry.indices, 1));
  if (geometry.normals?.length === geometry.positions.length) {
    result.setAttribute("normal", new THREE.BufferAttribute(geometry.normals instanceof Float32Array ? geometry.normals : new Float32Array(geometry.normals), 3));
  } else {
    result.computeVertexNormals();
  }
  if (geometry.uvs?.length) result.setAttribute("uv", new THREE.BufferAttribute(geometry.uvs instanceof Float32Array ? geometry.uvs : new Float32Array(geometry.uvs), 2));
  geometry.groups?.forEach((group) => result.addGroup(group.start, group.count, group.materialIndex));
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

const geometryLookups = new WeakMap<object, Map<string, AssetGeometry>>();
const materialLookups = new WeakMap<object, Map<string, AssetMaterial>>();

export function geometryForNode(asset: ReviewAsset3D, node: AssetNode) {
  if (node.geometry) return node.geometry;
  if (!node.geometryId || !asset.geometries) return undefined;
  let lookup = geometryLookups.get(asset.geometries);
  if (!lookup) { lookup = new Map(asset.geometries.map(definition => [definition.id, definition.geometry])); geometryLookups.set(asset.geometries, lookup); }
  return lookup.get(node.geometryId);
}

function materialsForNodes(asset: ReviewAsset3D) {
  let lookup = materialLookups.get(asset.materials);
  if (!lookup) { lookup = new Map(asset.materials.map(material => [material.id, material])); materialLookups.set(asset.materials, lookup); }
  return lookup;
}

function materialForMode(material: AssetMaterial | undefined, mode: AssetViewMode, line = false) {
  const color = material?.color ?? "#8d8d88";
  const opacity = material?.opacity ?? 1;
  if (line) return new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  if (mode === "normals") return new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  if (mode === "wireframe") {
    return new THREE.MeshBasicMaterial({ color: "#9ed7c2", wireframe: true, transparent: true, opacity: 0.9 });
  }
  if (mode === "unlit") {
    return new THREE.MeshBasicMaterial({
      color,
      side: material?.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      transparent: opacity < 1,
      opacity,
      toneMapped: false,
    });
  }
  return new THREE.MeshStandardMaterial({
    color,
    emissive: material?.emissive ?? "#000000",
    roughness: material?.roughness ?? 0.82,
    metalness: material?.metalness ?? 0,
    transparent: mode === "xray" || opacity < 1,
    opacity: mode === "xray" ? 0.26 : opacity,
    depthWrite: mode !== "xray",
    side: material?.doubleSided || mode === "xray" ? THREE.DoubleSide : THREE.FrontSide,
    wireframe: material?.wireframe === true,
  });
}

function createNodeObject(node: AssetNode, asset: ReviewAsset3D, mode: AssetViewMode, resources: ThreeAssetResourceCache) {
  const sourceGeometry = geometryForNode(asset, node);
  if (!sourceGeometry) return new THREE.Group();
  const geometryLease = resources.geometries.acquire(sourceGeometry, "geometry", () => makeAssetGeometry(sourceGeometry));
  const geometry = geometryLease.value;
  const materials = node.materialIds.map((id) => materialsForNodes(asset).get(id));
  const materialLeases = (node.type === "line" || node.type === "points" ? [materials[0]] : materials.length ? materials : [undefined])
    .map((material) => resources.materials.acquire(material ?? defaultMaterialSource, `${mode}:${node.type}`, () =>
      node.type === "points"
        ? new THREE.PointsMaterial({ color: material?.color ?? "#a6b6b0", size: 0.035 })
        : materialForMode(material, mode, node.type === "line")));
  const meshMaterials = materialLeases.map((lease) => lease.value);
  const owned = <T extends THREE.Object3D>(object: T) => {
    objectResources.set(object, { geometry: geometryLease, materials: materialLeases });
    return object;
  };
  if (node.type === "line") return owned(new THREE.LineSegments(geometry, meshMaterials[0]));
  if (node.type === "points") return owned(new THREE.Points(geometry, meshMaterials[0] as THREE.PointsMaterial));
  if (node.instances?.length) {
    const mesh = new THREE.InstancedMesh(geometry, meshMaterials.length === 1 ? meshMaterials[0] : meshMaterials, node.instances.length);
    node.instances.forEach((values, index) => mesh.setMatrixAt(index, new THREE.Matrix4().fromArray(values)));
    mesh.instanceMatrix.needsUpdate = true;
    return owned(mesh);
  }
  return owned(new THREE.Mesh(geometry, meshMaterials.length === 1 ? meshMaterials[0] : meshMaterials));
}

export function buildThreeAsset(asset: ReviewAsset3D, mode: AssetViewMode = "lit", hiddenNodeIds = new Set<string>(), resources = sharedResources): BuiltAsset {
  const root = new THREE.Group();
  root.name = asset.name;
  const nodes = new Map<string, THREE.Object3D>();
  asset.nodes.forEach((node) => {
    const object = createNodeObject(node, asset, mode, resources);
    object.name = node.name;
    object.position.fromArray(node.position);
    object.rotation.set(...node.rotation.map(THREE.MathUtils.degToRad) as Vec3);
    object.scale.fromArray(node.scale);
    object.visible = node.visible && !hiddenNodeIds.has(node.id);
    object.userData.assetNodeId = node.id;
    object.userData.sourceRef = node.sourceRef;
    nodes.set(node.id, object);
  });
  asset.nodes.forEach((node) => {
    const object = nodes.get(node.id)!;
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ?? root).add(object);
  });
  root.updateMatrixWorld(true);
  return { root, nodes };
}

const disposedObjects = new WeakSet<THREE.Object3D>();
export function disposeThreeAsset(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (disposedObjects.has(object)) return;
    disposedObjects.add(object);
    const renderable = object as THREE.Mesh;
    const resources = objectResources.get(object);
    if (resources) {
      resources.geometry.release();
      resources.materials.forEach((lease) => lease.release());
      objectResources.delete(object);
    } else renderable.geometry?.dispose();
    if ((renderable as THREE.InstancedMesh).isInstancedMesh) (renderable as THREE.InstancedMesh).dispose();
    const candidates = Array.isArray(renderable.material) ? renderable.material : renderable.material ? [renderable.material] : [];
    candidates.forEach((material) => {
      if (!resources?.materials.some((lease) => lease.value === material)) materials.add(material);
    });
  });
  materials.forEach((material) => material.dispose());
}
