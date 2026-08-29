import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { ownershipFixture } from "./fixtures/ownership.mjs";
import { validateReviewIndex } from "../packages/validator/dist/index.js";
import { validateSceneOwnership, sceneTransformMatrix, SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY } from "../packages/protocol/dist/index.js";
import { SceneAssetRegistry, attachSceneAssetRegistryBridge, SPATIAL_REVIEW_REQUEST, SPATIAL_REVIEW_CATALOG, LEGACY_SPATIAL_REVIEW_REQUEST, OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN } from "../packages/sdk/dist/index.js";

test("ownership records preserve world compatibility, shared designs, and original game geometry", () => {
  const { registry, world, roots, geometry } = ownershipFixture();
  const before = world.children.slice(), buffer = [...geometry.attributes.position.array];
  const index = registry.toReviewIndex();
  assert.equal(validateReviewIndex(index).ok, true);
  assert.equal(index.scene.assemblies.length, 6);
  assert.equal(index.scene.actors.length, 8);
  const chairs = index.scene.actors.filter((actor) => actor.assetId === "chair");
  assert.deepEqual(chairs.map((actor) => actor.parentAssemblyId), ["BE1-room", "BE2-room"]);
  assert.deepEqual(chairs.map((actor) => actor.localTransform.position), [[1, .5, 0], [1, .5, 0]]);
  assert.deepEqual(chairs.map((actor) => actor.transform.position), [[11, .5, 0], [-9, .5, 0]]);
  assert.equal(index.assetCatalog.assets.filter((asset) => asset.id === "chair").length, 1);
  assert.deepEqual(world.children, before);
  assert.deepEqual([...geometry.attributes.position.array], buffer);
  assert.equal(roots.get("chair-01").geometry, roots.get("chair-02").geometry);
});

test("assembly transforms and bounds follow source changes without changing child-local poses", () => {
  const { registry, buildings } = ownershipFixture();
  const before = registry.toScene();
  buildings.get("BE1").position.x += 5;
  buildings.get("BE1").rotation.y = Math.PI / 2;
  buildings.get("BE1").scale.setScalar(2);
  const after = registry.toScene();
  assert.deepEqual(validateSceneOwnership(after), []);
  for (const actor of after.actors) {
    const original = before.actors.find((item) => item.actorId === actor.actorId);
    actor.localTransform.position.forEach((value, i) => assert.ok(Math.abs(value - original.localTransform.position[i]) < 1e-6));
    if (["chair-02", "palm-west-entry"].includes(actor.actorId)) assert.deepEqual(actor.transform, original.transform);
  }
  assert.notDeepEqual(after.assemblies.find((entry) => entry.assemblyId === "BE1").bounds, before.assemblies.find((entry) => entry.assemblyId === "BE1").bounds);
});

test("visibility is per placement, inherited on flattening, and never poisons a shared design", () => {
  const { registry, buildings, roots } = ownershipFixture();
  roots.get("chair-01").visible = false;
  buildings.get("BE1").visible = false;
  const hierarchical = registry.toReviewIndex();
  assert.equal(hierarchical.scene.actors.find((actor) => actor.actorId === "dish-01").visible, true);
  assert.equal(hierarchical.assetCatalog.assets.find((asset) => asset.id === "chair").nodes.every((node) => node.visible), true);
  const flat = registry.toScene(false);
  assert.equal(flat.assemblies, undefined);
  assert.equal(flat.ownership.mode, "flattened");
  assert.match(flat.ownership.reason, /unavailable/);
  assert.equal(flat.actors.some((actor) => actor.actorId === "dish-01"), false);
  assert.equal(flat.actors.find((actor) => actor.actorId === "chair-02").visible, true);
  assert.equal(flat.actors.some((actor) => actor.parentAssemblyId || actor.localTransform), false);
  buildings.get("BE1").visible = true;
  assert.equal(registry.toScene(false).actors.some((actor) => actor.actorId === "chair-01"), false);
  assert.deepEqual(validateSceneOwnership(flat), []);
  assert.deepEqual(registry.toActors(), registry.toScene(false).actors, "actor-only callers must not receive dangling ownership references");
  assert.equal(registry.toReviewIndex("scene", true, false, true).scene.ownership.mode, "flattened");
});

test("unrelated assemblies preserve each multi-root component's visibility in every asset export", () => {
  for (const states of [[true, false], [false, true]]) {
    const registry = new SceneAssetRegistry("mixed-root-visibility");
    const roots = states.map((visible, index) => {
      const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      root.name = `part-${index}`; root.visible = visible; root.position.x = index * 2;
      return root;
    });
    registry.register({ actorId: "parts", assetId: "parts", name: "Parts", sourceRef: "fixture#parts", category: "Test", roots });
    const visibility = (asset) => roots.map((root) => asset.nodes.find((node) => node.name === root.name).visible);
    assert.deepEqual(visibility(registry.toAsset("parts")), states);
    registry.registerAssembly({ assemblyId: "unrelated", name: "Unrelated", sourceRef: "fixture#unrelated", localTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
    for (const profile of ["scene", "review"]) {
      for (const [legacy, hierarchical] of [[false, true], [false, false], [true, false]]) {
        const index = registry.toReviewIndex(profile, legacy, false, hierarchical);
        assert.equal(index.scene.actors[0].visible, true);
        assert.deepEqual(visibility(index.assetCatalog.assets[0]), states, `${profile}, legacy=${legacy}, hierarchical=${hierarchical}`);
      }
      for (const compact of [false, true]) assert.deepEqual(visibility(registry.toAsset("parts", profile, compact)), states);
      assert.deepEqual(visibility(registry.toAssetDocument(profile).assets[0]), states);
    }
    assert.deepEqual(roots.map((root) => root.visible), states, "capture must not mutate the game's visibility");
    registry.unregisterAssembly("unrelated");
    assert.deepEqual(visibility(registry.toAsset("parts")), states, "cached assets retain component states when ownership is removed");
    roots.forEach((root) => { root.geometry.dispose(); root.material.dispose(); });
  }
});

test("explicit multi-root placement visibility never overrides component visibility", () => {
  const registry = new SceneAssetRegistry("placement-and-component-visibility");
  const visible = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); visible.name = "visible-part";
  const hidden = visible.clone(); hidden.name = "hidden-part"; hidden.visible = false;
  const registration = { actorId: "parts", assetId: "parts", name: "Parts", sourceRef: "fixture#parts", category: "Test", parentAssemblyId: "room", roots: [visible, hidden] };
  registry.registerAssembly({ assemblyId: "room", name: "Room", sourceRef: "fixture#room", localTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
  for (const placementVisible of [false, true, false]) {
    registry.register({ ...registration, visible: placementVisible });
    const index = registry.toReviewIndex();
    assert.equal(index.scene.actors[0].visible, placementVisible);
    assert.equal(registry.toScene(false).actors.length, placementVisible ? 1 : 0);
    assert.deepEqual(index.assetCatalog.assets[0].nodes.filter((node) => node.geometryId).map((node) => node.visible), [true, false]);
  }
  visible.geometry.dispose(); visible.material.dispose();
});

test("explicit registration ownership rejects duplicate geometry roots, not shared resources", () => {
  const { registry, buildings } = ownershipFixture();
  registry.register({ actorId: "duplicate", assetId: "bad", name: "Bad duplicate", sourceRef: "fixture#bad", category: "Test", parentAssemblyId: "BE1", root: buildings.get("BE1") });
  assert.throws(() => registry.toScene(), /overlapping registration owners/);
});

test("ownership capture rejects sheared actor roots instead of exporting lossy TRS", () => {
  const registry = new SceneAssetRegistry("shear-fixture"), parent = new THREE.Group();
  parent.scale.set(2, 1, 1);
  const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  root.rotation.y = Math.PI / 4;
  parent.add(root);
  registry.registerAssembly({ assemblyId: "room", name: "Room", sourceRef: "fixture#room", localTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
  registry.register({ actorId: "chair", assetId: "chair", name: "Chair", sourceRef: "fixture#chair", category: "Furniture", parentAssemblyId: "room", root });
  assert.throws(() => registry.toScene(), /sheared source-root/);
});

test("valid XYZ rotations just beyond the Euler singularity retain an exact source pose", () => {
  const registry = new SceneAssetRegistry("past-gimbal");
  registry.registerAssembly({ assemblyId: "world", name: "World", sourceRef: "fixture#world", localTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
  const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  root.rotation.y = -Math.PI / 2 - 0.00042;
  root.scale.setScalar(0.84);
  root.updateMatrixWorld(true);
  const before = root.matrixWorld.clone();
  registry.register({ actorId: "past-gimbal", assetId: "fixture", name: "Past gimbal", sourceRef: "fixture#past-gimbal", category: "Fixture", parentAssemblyId: "world", root });
  const actor = registry.toScene().actors[0];
  const after = sceneTransformMatrix(actor.transform);
  before.elements.forEach((value, index) => assert.ok(Math.abs(value - after[index]) < 1e-9));
  root.geometry.dispose();
  root.material.dispose();
});

test("ownership validator rejects ambiguous, cyclic, malformed, and lossy payloads", () => {
  const scene = ownershipFixture().registry.toScene();
  const mutations = [
    (s) => { delete s.ownership; },
    (s) => { s.actors[0].parentAssemblyId = "missing"; },
    (s) => { s.assemblies[0].parentAssemblyId = "BE1-room"; },
    (s) => { s.assemblies[0].localTransform.scale = [1, 2, 1]; },
    (s) => { s.assemblies[0].localTransform.scale = [-1, -1, -1]; },
    (s) => { s.actors[0].localTransform.position[0] = NaN; },
    (s) => { s.actors[0].transform.position[0] += 10; },
    (s) => { s.actors[0].localTransform.scale = [0, 1, 1]; },
    (s) => { s.actors[0].actorId = s.assemblies[0].assemblyId; },
    (s) => { s.actors[0].bounds.size[0] = -1; },
    (s) => { s.assemblies[0].sourceRef = ""; },
    (s) => { s.assemblies[0].parentAssemblyId = ["BE1", "BE2"]; },
    (s) => { s.assemblies[0].visible = "yes"; },
  ];
  mutations.forEach((mutate) => { const candidate = structuredClone(scene); mutate(candidate); assert.ok(validateSceneOwnership(candidate).length > 0, mutate.toString()); });
  assert.deepEqual(validateSceneOwnership({ actors: [{}] }), [], "pre-existing flat validation stays unchanged");
});

test("engine-neutral transform math agrees with Three.js XYZ degrees", () => {
  for (let index = 0; index < 20; index++) {
    const transform = { position: [index, -index, .3], rotation: [index * 14, index * 27, index * 33], scale: [1, 2, 3] };
    const expected = new THREE.Matrix4().compose(new THREE.Vector3(...transform.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation.map(THREE.MathUtils.degToRad))), new THREE.Vector3(...transform.scale));
    sceneTransformMatrix(transform).forEach((value, axis) => assert.ok(Math.abs(value - expected.elements[axis]) < 1e-9));
  }
});

test("bridge negotiates hierarchy independently of progressive and legacy transport", async () => {
  const { registry } = ownershipFixture();
  const received = []; let listener;
  const peer = { postMessage(message) { received.push(message); } }, original = globalThis.window;
  globalThis.window = { location: { origin: "https://site.example" }, parent: peer, opener: null, setTimeout, addEventListener(_type, fn) { listener = fn; }, removeEventListener() {} };
  let detach;
  try {
    detach = attachSceneAssetRegistryBridge(registry);
    assert.ok(received[0].capabilities.includes(SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY));
    for (const [id, type, capabilities] of [["old", SPATIAL_REVIEW_REQUEST, undefined], ["new", SPATIAL_REVIEW_REQUEST, [SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY]], ["legacy", LEGACY_SPATIAL_REVIEW_REQUEST, [SPATIAL_REVIEW_ASSEMBLIES_CAPABILITY]]]) {
      listener({ origin: OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN, source: peer, data: { type, requestId: id, capabilities, profile: "scene" } });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    const messages = received.filter((message) => message.payload);
    assert.equal(messages.find((message) => message.requestId === "old").payload.scene.ownership.mode, "flattened");
    assert.equal(messages.find((message) => message.requestId === "new").payload.scene.ownership.mode, "hierarchical");
    assert.equal(messages.find((message) => message.requestId === "new").type, SPATIAL_REVIEW_CATALOG);
    assert.equal(messages.find((message) => message.requestId === "legacy").payload.scene.ownership.mode, "flattened");
  } finally { detach?.(); globalThis.window = original; }
});
