import * as THREE from "three";
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
  result.setAttribute("position", new THREE.Float32BufferAttribute(geometry.positions, 3));
  if (geometry.indices?.length) result.setIndex(geometry.indices);
  if (geometry.normals?.length === geometry.positions.length) {
    result.setAttribute("normal", new THREE.Float32BufferAttribute(geometry.normals, 3));
  } else {
    result.computeVertexNormals();
  }
  if (geometry.uvs?.length) result.setAttribute("uv", new THREE.Float32BufferAttribute(geometry.uvs, 2));
  geometry.groups?.forEach((group) => result.addGroup(group.start, group.count, group.materialIndex));
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

export function geometryForNode(asset: ReviewAsset3D, node: AssetNode) {
  if (node.geometry) return node.geometry;
  return node.geometryId
    ? asset.geometries?.find((geometry) => geometry.id === node.geometryId)?.geometry
    : undefined;
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

function createNodeObject(node: AssetNode, asset: ReviewAsset3D, mode: AssetViewMode) {
  const sourceGeometry = geometryForNode(asset, node);
  if (!sourceGeometry) return new THREE.Group();
  const geometry = makeAssetGeometry(sourceGeometry);
  const materials = node.materialIds.map((id) => asset.materials.find((material) => material.id === id));
  const primary = materials[0];
  if (node.type === "line") return new THREE.LineSegments(geometry, materialForMode(primary, mode, true));
  if (node.type === "points") {
    return new THREE.Points(geometry, new THREE.PointsMaterial({ color: primary?.color ?? "#a6b6b0", size: 0.035 }));
  }
  const meshMaterials = (materials.length ? materials : [undefined]).map((material) => materialForMode(material, mode));
  if (node.instances?.length) {
    const mesh = new THREE.InstancedMesh(
      geometry,
      meshMaterials.length === 1 ? meshMaterials[0] : meshMaterials,
      node.instances.length,
    );
    node.instances.forEach((values, index) => mesh.setMatrixAt(index, new THREE.Matrix4().fromArray(values)));
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }
  return new THREE.Mesh(geometry, meshMaterials.length === 1 ? meshMaterials[0] : meshMaterials);
}

export function buildThreeAsset(
  asset: ReviewAsset3D,
  mode: AssetViewMode = "lit",
  hiddenNodeIds = new Set<string>(),
): BuiltAsset {
  const root = new THREE.Group();
  root.name = asset.name;
  const nodes = new Map<string, THREE.Object3D>();
  asset.nodes.forEach((node) => {
    const object = createNodeObject(node, asset, mode);
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
    const object = nodes.get(node.id);
    if (!object) return;
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    (parent ?? root).add(object);
  });
  root.updateMatrixWorld(true);
  return { root, nodes };
}

export function disposeThreeAsset(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const renderable = object as THREE.Mesh;
    renderable.geometry?.dispose();
    const candidates = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material ? [renderable.material] : [];
    candidates.forEach((material) => materials.add(material));
  });
  materials.forEach((material) => material.dispose());
}
