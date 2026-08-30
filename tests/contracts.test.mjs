import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import { SceneAssetRegistry, assetFromObject3DRoots, attachSceneAssetRegistryBridge, attachSpatialReviewDiscoveryBridge, buildThreeAsset, buildThreeAssetAsync, disposeThreeAsset } from "../packages/sdk/dist/index.js";
import { OFFICIAL_SPATIAL_REVIEW_EDITOR_ORIGIN, SPATIAL_REVIEW_CATALOG, SPATIAL_REVIEW_DISCOVERY_REQUEST, SPATIAL_REVIEW_DISCOVERY_RESPONSE, SPATIAL_REVIEW_INDEX_SCHEMA, SPATIAL_REVIEW_REQUEST, SPATIAL_REVIEW_RESOURCE_REQUEST, SPATIAL_REVIEW_RESOURCE_RESPONSE, SPATIAL_REVIEW_RESOURCE_TRANSFER_CAPABILITY, discoveryUrlForWebsite, discoveryUrlsForWebsite, normalizeSpatialReviewDiscovery, spatialReviewEditorUrl } from "../packages/protocol/dist/index.js";
import { validateAssetDocument, validateReviewIndex } from "../packages/validator/dist/index.js";

test("normalizes discovery URLs", () => {
  const url = discoveryUrlForWebsite("example.com/project");
  assert.equal(url, "https://example.com/.well-known/spatial-review.json");
  const discovery = normalizeSpatialReviewDiscovery({ schema: "spatial-review-discovery/v1", version: 1, name: "Fixture", assets: "../assets.json" }, "https://example.com/.well-known/spatial-review.json");
  assert.equal(discovery.assets, "https://example.com/assets.json");
});

test("orders canonical, project-relative and explicit discovery locators", () => {
  assert.deepEqual(discoveryUrlsForWebsite("https://owner.github.io/"), [
    "https://owner.github.io/.well-known/spatial-review.json",
  ]);
  assert.deepEqual(discoveryUrlsForWebsite("https://owner.github.io/project?preview=1#section"), [
    "https://owner.github.io/.well-known/spatial-review.json",
    "https://owner.github.io/project/.well-known/spatial-review.json",
  ]);
  assert.deepEqual(discoveryUrlsForWebsite("https://owner.github.io/project/", ".well-known/custom.json?revision=2#ignored"), [
    "https://owner.github.io/project/.well-known/custom.json?revision=2",
    "https://owner.github.io/.well-known/spatial-review.json",
    "https://owner.github.io/project/.well-known/spatial-review.json",
  ]);
  assert.deepEqual(discoveryUrlsForWebsite("https://owner.github.io/project/", "/.well-known/spatial-review.json"), [
    "https://owner.github.io/.well-known/spatial-review.json",
    "https://owner.github.io/project/.well-known/spatial-review.json",
  ]);
  assert.equal(discoveryUrlForWebsite("https://owner.github.io/project/"), "https://owner.github.io/.well-known/spatial-review.json");
});

test("rejects unsafe discovery locators", () => {
  assert.throws(() => discoveryUrlsForWebsite("ftp://owner.github.io/project/"), /HTTP or HTTPS/);
  assert.throws(() => discoveryUrlsForWebsite("https://user:secret@owner.github.io/project/"), /credentials/);
  assert.throws(() => discoveryUrlsForWebsite("https://owner.github.io/project/", "https://cdn.example/manifest.json"), /website origin/);
  assert.throws(() => discoveryUrlsForWebsite("https://owner.github.io/project/", "data:application/json,{}"), /HTTP or HTTPS/);
  assert.throws(() => discoveryUrlsForWebsite("https://owner.github.io/project/", ""), /valid URL/);
});

test("rejects credentials in every discovery payload URL", () => {
  const base = { schema: "spatial-review-discovery/v1", version: 1, name: "Fixture" };
  for (const [field, value] of [
    ["websiteUrl", "https://user:secret@site.example/project/"],
    ["scene", "https://user:secret@site.example/scene.json"],
    ["assets", "https://user:secret@site.example/assets.json"],
    ["liveCapture", "https://user:secret@site.example/capture"],
  ]) {
    assert.throws(() => normalizeSpatialReviewDiscovery({ ...base, [field]: value, ...(field === "websiteUrl" ? { liveCapture: "/capture" } : {}) }, "https://site.example/.well-known/spatial-review.json"), /credentials/);
  }
  assert.throws(() => normalizeSpatialReviewDiscovery({ ...base, assets: "../assets.json" }, "https://user:secret@site.example/.well-known/spatial-review.json"), /credentials/);
  assert.throws(() => normalizeSpatialReviewDiscovery({ ...base, assets: "https://site.example/assets.json" }, "https://user:secret@site.example/.well-known/spatial-review.json"), /credentials/);
});

test("normalizes a GitHub Pages project fixture against its successful document", async () => {
  const payload = JSON.parse(await readFile(new URL("./fixtures/github-pages-project/.well-known/spatial-review.json", import.meta.url), "utf8"));
  const discoveryUrl = "https://owner.github.io/project/.well-known/spatial-review.json";
  const discovery = normalizeSpatialReviewDiscovery(payload, discoveryUrl);
  assert.equal(discovery.websiteUrl, "https://owner.github.io/project/");
  assert.equal(discovery.liveCapture, "https://owner.github.io/project/?spatial-review-capture=1");
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
  assert.equal(
    spatialReviewEditorUrl("https://owner.github.io/project/", {
      workspace: "scene",
      discoveryUrl: "https://owner.github.io/project/.well-known/spatial-review.json#ignored",
    }),
    "https://spatial-review.alterno.dev/editor?site=https%3A%2F%2Fowner.github.io%2Fproject%2F&discovery=https%3A%2F%2Fowner.github.io%2Fproject%2F.well-known%2Fspatial-review.json",
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

    received.length = 0;
    const detachExplicit = attachSpatialReviewDiscoveryBridge({
      name: "Fixture",
      websiteUrl: "https://site.example/project/",
      discoveryUrl: "https://site.example/project/.well-known/spatial-review.json#ignored",
      liveCapture: "/capture",
    }, { allowOfficialEditor: false, allowedOrigins: ["https://editor.example"] });
    listener({ origin: "https://editor.example", source: editor, data: { type: SPATIAL_REVIEW_DISCOVERY_REQUEST, requestId: "discovery-3" } });
    assert.equal(received[0].message.discoveryUrl, "https://site.example/project/.well-known/spatial-review.json");
    assert.equal("discoveryUrl" in received[0].message.discovery, false);
    detachExplicit();

    received.length = 0;
    globalThis.window.location.href = "https://site.example/project/app/capture.html";
    const detachCustomBase = attachSpatialReviewDiscoveryBridge({
      name: "Fixture",
      websiteUrl: "https://site.example/project/",
      discoveryUrl: "manifests/v1/review.json",
      liveCapture: "../../capture",
    }, { allowOfficialEditor: false, allowedOrigins: ["https://editor.example"] });
    listener({ origin: "https://editor.example", source: editor, data: { type: SPATIAL_REVIEW_DISCOVERY_REQUEST, requestId: "discovery-4" } });
    assert.equal(received[0].message.discoveryUrl, "https://site.example/project/manifests/v1/review.json");
    assert.equal(received[0].message.discovery.liveCapture, "https://site.example/project/capture");
    detachCustomBase();
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

test("registers engine-neutral navigation sequences without requiring scene actors", () => {
  const registry = new SceneAssetRegistry("navigation-fixture");
  registry.registerNavigationSequence({
    id: "main-journey",
    name: "Main journey",
    sourceRef: "src/scene/rail.ts#mainJourney",
    stops: [
      { id: "start", name: "Start", camera: [0, 1.7, 4], target: [0, 1.5, 0], fov: 50, sourceRef: "src/world.ts#start" },
      { id: "finish", name: "Finish", camera: [4, 1.7, 0], target: [0, 1.5, 0], fov: 44, sourceRef: "src/world.ts#finish" },
    ],
    segments: [{
      id: "start--finish",
      fromStopId: "start",
      toStopId: "finish",
      weight: 1.5,
      lensStart: 0.25,
      sourceRef: "src/scene/rail.ts#start--finish",
      camera: {
        kind: "cubic-bezier",
        points: [
          { id: "start-camera", position: [0, 1.7, 4], role: "stop", stopId: "start" },
          { id: "out", position: [1, 1.7, 4], role: "control-out" },
          { id: "in", position: [4, 1.7, 1], role: "control-in" },
          { id: "finish-camera", position: [4, 1.7, 0], role: "stop", stopId: "finish" },
        ],
      },
      aim: { kind: "path-facing", lookDistance: 6, turnFraction: 0.18 },
    }],
  });

  const index = registry.toReviewIndex("scene");
  assert.equal(index.scene.actors.length, 0);
  assert.equal(index.assetCatalog.assets.length, 0);
  assert.equal(index.scene.navigationSequences.length, 1);
  assert.equal(index.scene.navigationSequences[0].segments[0].camera.kind, "cubic-bezier");
  assert.equal(registry.navigationSize, 1);
  assert.equal(validateReviewIndex(index).ok, true);
});

test("rejects navigation segments that do not reference declared stops", () => {
  const registry = new SceneAssetRegistry("invalid-navigation-fixture");
  registry.registerNavigationSequence({
    id: "broken",
    name: "Broken",
    stops: [{ id: "start", name: "Start", camera: [0, 0, 0], target: [0, 0, -1], fov: 50 }],
    segments: [{
      id: "missing-stop",
      fromStopId: "start",
      toStopId: "missing",
      weight: 1,
      camera: { kind: "line", points: [
        { id: "a", position: [0, 0, 0], role: "stop", stopId: "start" },
        { id: "b", position: [1, 0, 0], role: "stop", stopId: "missing" },
      ] },
      aim: { kind: "fixed-target", target: [0, 0, -1] },
    }],
  });
  const validation = validateReviewIndex(registry.toReviewIndex("scene"));
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /toStopId/);
});

test("reports malformed navigation JSON without throwing", () => {
  const index = new SceneAssetRegistry("malformed-navigation-fixture").toReviewIndex("scene");
  index.scene.navigationSequences = [{
    id: "bad-arrays",
    name: "Bad arrays",
    stops: "not-an-array",
    segments: null,
  }, {
    id: "bad-kinds",
    name: "Bad kinds",
    stops: [{ id: "start", name: "Start", camera: [0, 1, 2], target: [0, 1, 0], fov: 50 }],
    segments: [{
      id: "bad-segment",
      fromStopId: "start",
      toStopId: "start",
      weight: 1,
      camera: { kind: "spiral", points: [] },
      aim: { kind: "telepathic" },
    }],
  }];

  assert.doesNotThrow(() => validateReviewIndex(index));
  const validation = validateReviewIndex(index);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /stops must be a non-empty array/);
  assert.match(validation.errors.join("\n"), /supported curve type/);
  assert.match(validation.errors.join("\n"), /aim.kind is not supported/);
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

test("catalog revisions release superseded texture resource IDs without disposing website textures", () => {
  const registry = new SceneAssetRegistry("texture-revision-fixture");
  const firstTexture = new THREE.Texture();
  const secondTexture = new THREE.Texture();
  let disposedTextures = 0;
  firstTexture.addEventListener("dispose", () => { disposedTextures += 1; });
  secondTexture.addEventListener("dispose", () => { disposedTextures += 1; });
  const firstRoot = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: firstTexture }));
  const secondRoot = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: secondTexture }));
  registry.register({ actorId: "fixture", assetId: "fixture", name: "Fixture", category: "Test", sourceRef: "fixture.ts", root: firstRoot });
  const firstResourceId = registry.toReviewIndex("review").assetCatalog.assets[0].materials[0].maps[0].resourceId;
  assert.equal(registry.hasTextureResource(firstResourceId), true);

  registry.register({ actorId: "fixture", assetId: "fixture", name: "Fixture", category: "Test", sourceRef: "fixture.ts", root: secondRoot });
  assert.equal(registry.hasTextureResource(firstResourceId), false);
  const secondResourceId = registry.toReviewIndex("review").assetCatalog.assets[0].materials[0].maps[0].resourceId;
  assert.notEqual(secondResourceId, firstResourceId);
  assert.equal(registry.hasTextureResource(secondResourceId), true);
  assert.equal(disposedTextures, 0, "the registry forgets references but never disposes website-owned textures");
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

function mappedAsset(maps) {
  return {
    id: "textured-plane",
    name: "Textured plane",
    tags: [],
    nodes: [{
      id: "plane",
      name: "Plane",
      type: "mesh",
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
      geometry: { kind: "primitive", primitive: "box", dimensions: [2, 2, 0.05] },
      materialIds: ["photo"],
    }],
    materials: [{
      id: "photo",
      name: "Photo",
      type: "standard",
      color: "#ffffff",
      emissive: "#222222",
      roughness: 1,
      metalness: 0,
      opacity: 1,
      doubleSided: true,
      maps,
    }],
    feedback: { status: "unreviewed", summary: "", annotations: [], modifications: [] },
  };
}

test("explicitly hydrates every supported material map and retains it through live serialization", async () => {
  const slots = ["map", "normalMap", "bumpMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap"];
  const sourceRef = "data:image/png;base64,iVBORw0KGgo=";
  const maps = slots.map((slot, index) => ({
    slot,
    name: `${slot} fixture`,
    sourceRef,
    wrap: index % 2 ? "repeat" : "clamp",
    repeat: [index + 1, index + 2],
    offset: [index / 10, index / 20],
    rotation: index / 8,
    flipY: index % 2 === 0,
  }));
  const asset = mappedAsset(maps);
  const synchronous = buildThreeAsset(asset);
  assert.equal(synchronous.nodes.get("plane").material.map, null, "the compatible synchronous path does not resolve URLs");
  disposeThreeAsset(synchronous.root);
  const baseTexture = new THREE.Texture();
  let resolverCalls = 0;
  let baseDisposals = 0;
  baseTexture.addEventListener("dispose", () => { baseDisposals += 1; });
  const built = await buildThreeAssetAsync(asset, {
    resolveTexture(definition, context) {
      resolverCalls += 1;
      assert.equal(definition.sourceRef, sourceRef);
      assert.equal(context.asset, asset);
      assert.equal(context.material, asset.materials[0]);
      return baseTexture;
    },
  });
  assert.equal(resolverCalls, 1, "one decoded source is shared by every sampler binding");
  const material = built.nodes.get("plane").material;
  const hydrated = slots.map((slot) => material[slot]);
  hydrated.forEach((texture, index) => {
    const definition = maps[index];
    assert.ok(texture?.isTexture, definition.slot);
    assert.notEqual(texture, baseTexture);
    assert.deepEqual(texture.repeat.toArray(), definition.repeat);
    assert.deepEqual(texture.offset.toArray(), definition.offset);
    assert.equal(texture.rotation, definition.rotation);
    assert.equal(texture.flipY, definition.flipY);
    assert.equal(texture.wrapS, definition.wrap === "repeat" ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping);
    assert.equal(texture.userData.sourceRef, sourceRef);
    assert.equal(texture.colorSpace, definition.slot === "map" || definition.slot === "emissiveMap" ? THREE.SRGBColorSpace : THREE.NoColorSpace);
  });
  assert.equal(new Set(hydrated).size, slots.length, "sampler transforms do not share Texture objects");
  assert.equal(new Set(hydrated.map((texture) => texture.source)).size, 1, "samplers share the decoded image source");
  assert.equal(material.transparent, true, "alpha maps enable blending");

  const roundTrip = assetFromObject3DRoots([built.root], asset.name, "fixture:textured-plane");
  const roundTripMaps = roundTrip.materials.flatMap((candidate) => candidate.maps ?? []);
  assert.deepEqual(roundTripMaps.map((map) => map.slot), slots);
  roundTripMaps.forEach((map, index) => {
    assert.equal(map.sourceRef, sourceRef);
    assert.equal(map.wrap, maps[index].wrap);
    assert.deepEqual(map.repeat, maps[index].repeat);
    assert.deepEqual(map.offset, maps[index].offset);
    assert.equal(map.rotation, maps[index].rotation);
    assert.equal(map.flipY, maps[index].flipY);
  });

  const registry = new SceneAssetRegistry("hydrated-texture-fixture");
  registry.register({ actorId: asset.id, assetId: asset.id, name: asset.name, category: "Test", sourceRef: "fixture.ts", root: built.root });
  const liveMaps = registry.toReviewIndex("review").assetCatalog.assets[0].materials.flatMap((candidate) => candidate.maps ?? []);
  assert.equal(liveMaps.length, slots.length);
  for (const map of liveMaps) {
    assert.ok(registry.hasTextureResource(map.resourceId));
    const resource = await registry.readTextureResource(map.resourceId, 1024);
    assert.equal(resource.contentType, "image/png");
  }

  let cloneDisposals = 0;
  material.map.addEventListener("dispose", () => { cloneDisposals += 1; });
  disposeThreeAsset(built.root);
  assert.equal(cloneDisposals, 1);
  assert.equal(baseDisposals, 0, "the caller retains ownership of resolver cache entries");
  baseTexture.dispose();
});

test("texture source policy failures come only from the explicit resolver", async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = () => {
    fetched = true;
    throw new Error("Unexpected implicit fetch");
  };
  try {
    for (const [label, map] of [
      ["missing", { slot: "map" }],
      ["rejected", { slot: "map", sourceRef: "https://assets.example/rejected.png" }],
      ["oversized", { slot: "map", sourceRef: "https://assets.example/large.png" }],
      ["cross-origin", { slot: "map", sourceRef: "https://other.example/texture.png" }],
    ]) {
      await assert.rejects(
        buildThreeAssetAsync(mappedAsset([map]), {
          resolveTexture() { throw new Error(`${label} texture rejected by policy`); },
        }),
        new RegExp(`${label} texture rejected by policy`),
      );
    }
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
