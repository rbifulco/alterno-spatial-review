import * as THREE from "three";
import { SceneAssetRegistry } from "../../packages/sdk/dist/index.js";

export function ownershipFixture() {
  const registry = new SceneAssetRegistry("ownership-baseline-v1");
  const world = new THREE.Group();
  const buildings = new Map();
  for (const [id, x] of [["BE1", 10], ["BE2", -10]]) {
    const building = new THREE.Group(); building.name = id; building.position.x = x; world.add(building); buildings.set(id, building);
    registry.registerAssembly({ assemblyId: id, name: `Building ${id}`, sourceRef: `fixture#${id}`, root: building });
    registry.registerAssembly({ assemblyId: `${id}-room`, name: "Ground-floor room", sourceRef: `fixture#${id}-room`, parentAssemblyId: id, localTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
  }
  registry.registerAssembly({ assemblyId: "BE1-roof", name: "Roof", sourceRef: "fixture#BE1-roof", parentAssemblyId: "BE1", localTransform: { position: [0, 3, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
  registry.registerAssembly({ assemblyId: "street", name: "Street", sourceRef: "fixture#street", localTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
  const geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshStandardMaterial({ color: "#97afa4" });
  const roots = new Map();
  const add = (id, assetId, owner, buildingId, position, scale = [1, 1, 1]) => {
    const root = new THREE.Mesh(geometry, material); root.name = assetId; root.position.fromArray(position); root.scale.fromArray(scale);
    (buildings.get(buildingId) ?? world).add(root); roots.set(id, root);
    registry.register({ actorId: id, assetId, name: id, category: assetId === "chair" ? "Furniture" : "Structure and contents", sourceRef: `fixture#${id}`, parentAssemblyId: owner, root });
  };
  add("BE1-structure", "structure", "BE1", "BE1", [0, 1, 0], [5, 2, 5]);
  add("dish-01", "dish", "BE1-roof", "BE1", [1, 3.5, 1]);
  add("tank-01", "tank", "BE1-roof", "BE1", [-1, 3.5, 1]);
  add("crate-01", "crate", "BE1-roof", "BE1", [1, 3.5, -1]);
  add("table-01", "table", "BE1-room", "BE1", [0, 0.5, 1]);
  add("chair-01", "chair", "BE1-room", "BE1", [1, 0.5, 0]);
  add("chair-02", "chair", "BE2-room", "BE2", [1, 0.5, 0]);
  add("palm-west-entry", "palm", "street", undefined, [0, 2, 6]);
  return { registry, world, buildings, roots, geometry, material };
}

/** Source pivot x=11, geometry centre x=21 before rotation/scale. */
export function offsetOwnershipFixture({ thin = false, rotation = [0, 0, 0], scale = [1, 1, 1], offsetInGeometry = false } = {}) {
  const registry = new SceneAssetRegistry("offset-ownership-baseline");
  const world = new THREE.Group(), building = new THREE.Group();
  building.position.x = 10; world.add(building);
  registry.registerAssembly({ assemblyId: "BE1", name: "Building", sourceRef: "fixture#BE1", root: building });
  const geometry = new THREE.BoxGeometry(2, thin ? .002 : 2, 4);
  const material = new THREE.MeshStandardMaterial({ color: "#97afa4" });
  const mesh = new THREE.Mesh(geometry, material);
  const root = offsetInGeometry ? mesh : new THREE.Group();
  if (offsetInGeometry) geometry.translate(10, 0, 0);
  else { mesh.position.x = 10; root.add(mesh); }
  root.position.x = 1;
  root.rotation.set(...rotation.map(THREE.MathUtils.degToRad));
  root.scale.fromArray(scale); building.add(root);
  registry.register({ actorId: "offset-box", assetId: "offset-box", name: "Offset box", sourceRef: "fixture#offset-box", category: "Test", parentAssemblyId: "BE1", root });
  world.updateMatrixWorld(true);
  return { registry, world, building, root, mesh, geometry, material };
}
