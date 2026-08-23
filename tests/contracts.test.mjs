import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { SceneAssetRegistry, attachSceneAssetRegistryBridge, attachSpatialReviewDiscoveryBridge, buildThreeAsset, disposeThreeAsset } from "../packages/sdk/dist/index.js";
import { OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN, SPATIAL_REVIEW_CATALOG, SPATIAL_REVIEW_DISCOVERY_REQUEST, SPATIAL_REVIEW_DISCOVERY_RESPONSE, SPATIAL_REVIEW_INDEX_SCHEMA, SPATIAL_REVIEW_REQUEST, SPATIAL_REVIEW_RESOURCE_REQUEST, SPATIAL_REVIEW_RESOURCE_RESPONSE, SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY, discoveryUrlForWebsite, normalizeSpatialReviewDiscovery, spatialReviewEditorUrl } from "../packages/protocol/dist/index.js";
import { validateAssetDocument, validateReviewIndex } from "../packages/validator/dist/index.js";

test("normalizes discovery URLs", () => {
  const url = discoveryUrlForWebsite("example.com/project");
  assert.equal(url, "https://example.com/.well-known/spatial-review.json");
  const discovery = normalizeSpatialReviewDiscovery({ schema: "spatial-review-discovery/v1", version: 1, name: "Fixture", assets: "../assets.json" }, "https://example.com/.well-known/spatial-review.json");
  assert.equal(discovery.assets, "https://example.com/assets.json");
});

test("builds official editor deep links", () => {
  assert.equal(
    spatialReviewEditorUrl("project.example/path"),
    "https://spatial-review.alterno.dev/review?site=https%3A%2F%2Fproject.example%2Fpath",
  );
  assert.equal(
    spatialReviewEditorUrl("https://project.example/path", "assets"),
    "https://spatial-review.alterno.dev/asset-editor?site=https%3A%2F%2Fproject.example%2Fpath",
  );
});

test("trusts the official editor for discovery by default and supports explicit opt-out", () => {
  const received = [];
  let listener;
  const editor = { postMessage(message, origin) { received.push({ message, origin }); } };
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: { origin: "https://site.example", href: "https://site.example/project" },
    parent: editor,
    opener: null,
    addEventListener(type, value) { if (type === "message") listener = value; },
    removeEventListener() {},
  };
  try {
    const registration = { name: "Fixture", liveCapture: "/capture" };
    const request = { type: SPATIAL_REVIEW_DISCOVERY_REQUEST, requestId: "official-default" };
    const detachDefault = attachSpatialReviewDiscoveryBridge(registration);
    listener({ origin: OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN, source: editor, data: request });
    assert.equal(received.at(-1)?.origin, OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN);
    detachDefault();

    received.length = 0;
    const detachOptOut = attachSpatialReviewDiscoveryBridge(registration, { allowOfficialEditor: false });
    listener({ origin: OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN, source: editor, data: request });
    assert.equal(received.length, 0);
    detachOptOut();
  } finally {
    globalThis.window = originalWindow;
  }
});

test("trusts the official editor for registered scene catalogs by default", async () => {
  const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const registry = new SceneAssetRegistry("official-editor-fixture");
  registry.register({ actorId: "fixture", assetId: "fixture", name: "Fixture", category: "Test", sourceRef: "fixture.ts", root });
  const received = [];
  let listener;
  const editor = { postMessage(message, origin) { received.push({ message, origin }); } };
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: { origin: "https://site.example" },
    parent: editor,
    opener: null,
    addEventListener(type, value) { if (type === "message") listener = value; },
    removeEventListener() {},
    setTimeout,
  };
  try {
    const detach = attachSceneAssetRegistryBridge(registry);
    listener({
      origin: OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN,
      source: editor,
      data: { type: SPATIAL_REVIEW_REQUEST, profile: "review", requestId: "official-catalog" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const catalog = received.find((entry) => entry.message.type === SPATIAL_REVIEW_CATALOG);
    assert.equal(catalog?.origin, OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN);
    assert.equal(catalog?.message.payload.assetCatalog.assets.length, 1);
    detach();

    received.length = 0;
    const detachOptOut = attachSceneAssetRegistryBridge(registry, { allowOfficialEditor: false });
    received.length = 0; // Ignore the bridge-ready announcement.
    listener({
      origin: OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN,
      source: editor,
      data: { type: SPATIAL_REVIEW_REQUEST, profile: "review", requestId: "official-opt-out" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(received.length, 0);
    detachOptOut();
  } finally {
    globalThis.window = originalWindow;
  }
});

test("discovers a live capture through the origin-checked browser bridge", () => {
  const received = [];
  let listener;
  const editor = { postMessage(message, origin) { received.push({ message, origin }); } };
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: { origin: "https://site.example", href: "https://site.example/project" },
    parent: editor,
    opener: null,
    addEventListener(type, value) { if (type === "message") listener = value; },
    removeEventListener() {},
  };
  try {
    const detach = attachSpatialReviewDiscoveryBridge({ name: "Fixture", liveCapture: "/capture" }, { allowOfficialEditor: false, allowedOrigins: ["https://editor.example"] });
    listener({ origin: "https://editor.example", source: editor, data: { type: SPATIAL_REVIEW_DISCOVERY_REQUEST, requestId: "discovery-1" } });
    assert.deepEqual(received, [{
      origin: "https://editor.example",
      message: {
        type: SPATIAL_REVIEW_DISCOVERY_RESPONSE,
        requestId: "discovery-1",
        discoveryUrl: "https://site.example/.well-known/spatial-review.json",
        discovery: {
          schema: "spatial-review-discovery/v1",
          version: 1,
          name: "Fixture",
          websiteUrl: "https://site.example/",
          scene: undefined,
          assets: undefined,
          liveCapture: "https://site.example/capture",
        },
      },
    }]);
    listener({ origin: "https://untrusted.example", source: editor, data: { type: SPATIAL_REVIEW_DISCOVERY_REQUEST, requestId: "discovery-2" } });
    assert.equal(received.length, 1);
    detach();
  } finally {
    globalThis.window = originalWindow;
  }
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

test("advertises and reads registered texture resources", async () => {
  const texture = new THREE.Texture();
  texture.userData.sourceRef = "data:image/png;base64,iVBORw0KGgo=";
  const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture }));
  const registry = new SceneAssetRegistry("texture-fixture");
  registry.register({ actorId: "fixture", assetId: "fixture", name: "Fixture", category: "Test", sourceRef: "fixture.ts", root });
  const index = registry.toReviewIndex("review");
  const map = index.assetCatalog.assets[0].materials[0].maps[0];
  assert.match(map.resourceId, /^three-texture:/);
  const resource = await registry.readTextureResource(map.resourceId, 1024);
  assert.equal(resource.contentType, "image/png");
  assert.ok(resource.bytes.byteLength > 0);
});

test("transfers requested texture bytes through the origin-checked browser bridge", async () => {
  const texture = new THREE.Texture();
  texture.userData.sourceRef = "data:image/png;base64,iVBORw0KGgo=";
  const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture }));
  const registry = new SceneAssetRegistry("bridge-texture-fixture");
  registry.register({ actorId: "fixture", assetId: "fixture", name: "Fixture", category: "Test", sourceRef: "fixture.ts", root });
  const received = [];
  let listener;
  const editor = { postMessage(message, origin, transfer) { received.push({ message, origin, transfer }); } };
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: { origin: "https://site.example" },
    parent: editor,
    opener: null,
    addEventListener(type, value) { if (type === "message") listener = value; },
    removeEventListener() {},
    setTimeout,
  };
  try {
    const detach = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"], maxResourceBytes: 512 });
    listener({ origin: "https://editor.example", source: editor, data: { type: SPATIAL_REVIEW_REQUEST, profile: "review", requestId: "catalog-1", resourceTransfer: { capability: SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY, maxBytes: 1024 } } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const catalogMessage = received.find((entry) => entry.message.type === SPATIAL_REVIEW_CATALOG)?.message;
    assert.deepEqual(catalogMessage.resourceTransfer, { capability: SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY, maxBytes: 512 });
    const resourceId = catalogMessage.payload.assetCatalog.assets[0].materials[0].maps[0].resourceId;
    listener({ origin: "https://editor.example", source: editor, data: { type: SPATIAL_REVIEW_RESOURCE_REQUEST, requestId: "resource-1", resourceId } });
    for (let attempt = 0; attempt < 20 && !received.some((entry) => entry.message.type === SPATIAL_REVIEW_RESOURCE_RESPONSE); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const resource = received.find((entry) => entry.message.type === SPATIAL_REVIEW_RESOURCE_RESPONSE);
    assert.equal(resource.origin, "https://editor.example");
    assert.equal(resource.message.ok, true);
    assert.equal(resource.message.contentType, "image/png");
    assert.ok(resource.message.bytes.byteLength > 0);
    assert.deepEqual(resource.transfer, [resource.message.bytes]);

    listener({ origin: "https://editor.example", source: editor, data: { type: SPATIAL_REVIEW_REQUEST, profile: "review", requestId: "catalog-2", resourceTransfer: { capability: SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY, maxBytes: 4 } } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const constrainedCatalog = received.find((entry) => entry.message.type === SPATIAL_REVIEW_CATALOG && entry.message.requestId === "catalog-2")?.message;
    assert.equal(constrainedCatalog.resourceTransfer.maxBytes, 4);
    listener({ origin: "https://editor.example", source: editor, data: { type: SPATIAL_REVIEW_RESOURCE_REQUEST, requestId: "resource-2", resourceId } });
    for (let attempt = 0; attempt < 20 && !received.some((entry) => entry.message.requestId === "resource-2"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const rejected = received.find((entry) => entry.message.requestId === "resource-2");
    assert.equal(rejected.message.ok, false);
    assert.equal(rejected.message.error, "too-large");
    detach();
  } finally {
    globalThis.window = originalWindow;
  }
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
