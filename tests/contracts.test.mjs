import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { SceneAssetRegistry, buildThreeAsset, disposeThreeAsset } from "../packages/sdk/dist/index.js";
import { SPATIAL_REVIEW_INDEX_SCHEMA, discoveryUrlForWebsite, normalizeSpatialReviewDiscovery } from "../packages/protocol/dist/index.js";
import { validateAssetDocument, validateReviewIndex } from "../packages/validator/dist/index.js";

test("normalizes discovery URLs", () => {
  const url = discoveryUrlForWebsite("example.com/project");
  assert.equal(url, "https://example.com/.well-known/spatial-review.json");
  const discovery = normalizeSpatialReviewDiscovery({ schema: "spatial-review-discovery/v1", version: 1, name: "Fixture", assets: "../assets.json" }, "https://example.com/.well-known/spatial-review.json");
  assert.equal(discovery.assets, "https://example.com/assets.json");
});

test("serializes registered Three.js roots without polygon decimation", () => {
  const root = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), new THREE.MeshStandardMaterial({ color: 0xcc8844 }));
  root.name = "Fixture cube";
  const registry = new SceneAssetRegistry("fixture-v1");
  registry.register({ actorId: "fixture", assetId: "fixture", name: "Fixture", category: "Test", sourceRef: "tests/fixture.ts", root });
  const index = registry.toReviewIndex("review");
  assert.equal(index.schema, SPATIAL_REVIEW_INDEX_SCHEMA);
  assert.equal(index.assetCatalog.assets.length, 1);
  assert.equal(index.assetCatalog.assets[0].geometries[0].geometry.positions.length, 72);
  assert.equal(validateReviewIndex(index).ok, true);
  assert.equal(validateAssetDocument(index.assetCatalog).ok, true);
});

test("emits a legacy index only when explicitly requested", () => {
  const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const registry = new SceneAssetRegistry("legacy-fixture");
  registry.register({ actorId: "fixture", assetId: "fixture", name: "Fixture", category: "Test", sourceRef: "fixture.ts", root });
  assert.equal(registry.toReviewIndex("scene", true).schema, "sole-review-index/v1");
});

test("builds a Three.js hierarchy from the engine-neutral asset contract", () => {
  const asset = {
    id: "pavilion",
    name: "Pavilion",
    tags: [],
    nodes: [
      { id: "root", name: "Root", type: "group", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, materialIds: [] },
      { id: "deck", name: "Deck", type: "mesh", parentId: "root", position: [0, 0.2, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true, geometry: { kind: "primitive", primitive: "box", dimensions: [4, 0.4, 3] }, materialIds: ["concrete"] },
    ],
    materials: [{ id: "concrete", name: "Concrete", type: "standard", color: "#888078", roughness: 0.8, metalness: 0, opacity: 1, doubleSided: false }],
    feedback: { status: "unreviewed", summary: "", annotations: [], modifications: [] },
  };
  const built = buildThreeAsset(asset);
  assert.equal(built.root.name, "Pavilion");
  assert.equal(built.nodes.get("deck")?.parent, built.nodes.get("root"));
  assert.ok(built.nodes.get("deck") instanceof THREE.Mesh);
  disposeThreeAsset(built.root);
});
