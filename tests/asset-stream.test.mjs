import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  SceneAssetRegistry,
  attachSceneAssetRegistryBridge,
  buildThreeAsset,
  disposeThreeAsset,
  prepareAssetTransfer,
  SPATIAL_REVIEW_ASSET_CANCEL,
  SPATIAL_REVIEW_ASSET_PROGRESS,
  SPATIAL_REVIEW_ASSET_REQUEST,
  SPATIAL_REVIEW_ASSET_RESPONSE,
  SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY,
  SPATIAL_REVIEW_CATALOG,
  SPATIAL_REVIEW_REQUEST,
} from "../packages/sdk/dist/index.js";
import { validateAssetInstanceData, validateAssetStreamDescriptor, validateSpatialReviewAssetResponse, validateSpatialReviewAssetStreamOffer, validateSpatialReviewSourceStatus } from "../packages/validator/dist/index.js";
import { deferredRegistration, slowProducer, streamedAsset } from "./fixtures/streaming.mjs";

const wait = (milliseconds = 5) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("deferred registrations publish bounds and representations before creating geometry", async () => {
  let calls = 0;
  const registry = new SceneAssetRegistry("deferred-registry-r1");
  registry.registerDeferred(deferredRegistration(async (context) => { calls += 1; return slowProducer(context); }));
  const legacy = registry.toReviewIndex("scene", false, true, true, false);
  assert.equal(legacy.scene.actors.length, 0);
  assert.equal(legacy.assetCatalog.assets.length, 0);
  const streamed = registry.toReviewIndex("scene", false, true, true, true);
  assert.equal(calls, 0, "catalog generation must not invoke a geometry producer");
  assert.deepEqual(streamed.scene.actors[0].bounds.size, [200, 20, 200]);
  assert.equal(streamed.assetCatalog.assets[0].nodes.length, 0);
  assert.equal(streamed.assetCatalog.assets[0].stream.representations[1].revision, "city-detail-r3");
  const controller = new AbortController();
  const result = await registry.produceAssetRepresentation("deferred-city", "review", "overview", 256_000, "visible", controller.signal);
  assert.equal(calls, 1);
  assert.equal(result.asset.id, "deferred-city");
  assert.equal(result.representation.purpose, "overview");
  assert.throws(() => registry.setSourceStatus({ phase: "booting" }), /backwards/);
});

test("deferred completions cannot revive an unregistered asset or its texture resources", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const texture = new THREE.Texture();
  const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture }));
  const registry = new SceneAssetRegistry("deferred-unregister-r1");
  registry.registerDeferred(deferredRegistration(async () => { await gate; return root; }));

  const pending = registry.produceAssetRepresentation(
    "deferred-city", "review", "detail", 256_000, "visible", new AbortController().signal,
  );
  assert.equal(registry.unregister("deferred-city-placement"), true);
  release();
  await assert.rejects(pending, /superseded by a catalog change/);
  assert.equal(registry.hasTextureResource(`three-texture:${texture.uuid}`), false);

  root.geometry.dispose();
  root.material.dispose();
  texture.dispose();
});

test("concurrent requests share the first immutable representation snapshot", async () => {
  const releases = [];
  const gates = Array.from({ length: 2 }, () => new Promise((resolve) => { releases.push(resolve); }));
  const textures = [new THREE.Texture(), new THREE.Texture()];
  const roots = textures.map((texture) => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture })));
  let calls = 0;
  const registry = new SceneAssetRegistry("deferred-concurrent-r1");
  registry.registerDeferred(deferredRegistration(async () => {
    const call = calls;
    calls += 1;
    await gates[call];
    return roots[call];
  }));

  const firstPending = registry.produceAssetRepresentation(
    "deferred-city", "review", "detail", 256_000, "visible", new AbortController().signal,
  );
  const secondPending = registry.produceAssetRepresentation(
    "deferred-city", "review", "detail", 256_000, "visible", new AbortController().signal,
  );
  assert.equal(calls, 2);

  releases[0]();
  const first = await firstPending;
  const firstResourceId = first.asset.materials[0].maps[0].resourceId;
  assert.equal(registry.hasTextureResource(firstResourceId), true);

  releases[1]();
  const second = await secondPending;
  assert.equal(second.asset.materials[0].maps[0].resourceId, firstResourceId);
  assert.equal(registry.hasTextureResource(firstResourceId), true);
  assert.equal(registry.hasTextureResource(`three-texture:${textures[1].uuid}`), false);

  roots.forEach((root) => { root.geometry.dispose(); root.material.dispose(); });
  textures.forEach((texture) => texture.dispose());
});

test("removing a noncanonical shared actor preserves its live deferred family", async () => {
  const texture = new THREE.Texture();
  const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture }));
  let calls = 0;
  const producer = async () => { calls += 1; return root; };
  const registry = new SceneAssetRegistry("shared-deferred-r1");
  const first = deferredRegistration(producer);
  registry.registerDeferred(first);
  registry.registerDeferred({ ...first, actorId: "deferred-city-secondary", sourceRef: "fixture#secondary" });

  const produced = await registry.produceAssetRepresentation(
    first.assetId, "review", "detail", 256_000, "visible", new AbortController().signal,
  );
  const resourceId = produced.asset.materials[0].maps[0].resourceId;
  assert.equal(registry.hasTextureResource(resourceId), true);
  assert.equal(registry.unregister("deferred-city-secondary"), true);
  assert.equal(registry.hasTextureResource(resourceId), true, "the canonical actor still owns this immutable representation");

  const cached = await registry.produceAssetRepresentation(
    first.assetId, "review", "detail", 256_000, "visible", new AbortController().signal,
  );
  assert.equal(cached.asset.materials[0].maps[0].resourceId, resourceId);
  assert.equal(calls, 1);

  root.geometry.dispose(); root.material.dispose(); texture.dispose();
});

test("typed instance transfers are exact, owned, renderable, and mutually exclusive", () => {
  const source = streamedAsset("instances", 32);
  const prepared = prepareAssetTransfer(source, 64 * 1024, { typedInstances: true });
  const instanceData = prepared.asset.nodes[0].instanceData;
  assert.equal(instanceData.count, 32);
  assert.equal(instanceData.transforms.length, 32 * 16);
  assert.equal(prepared.asset.nodes[0].instances, undefined);
  assert.ok(prepared.transfer.includes(instanceData.transforms.buffer));
  assert.equal(source.nodes[0].instances.length, 32, "producer-owned input remains reusable");
  assert.equal(validateAssetInstanceData(instanceData, 64 * 1024).ok, true);
  assert.equal(validateAssetInstanceData({ ...instanceData, transforms: new Float32Array(15) }).ok, false);
  assert.throws(() => prepareAssetTransfer({ ...source, nodes: [{ ...source.nodes[0], instanceData }] }, 64 * 1024, { typedInstances: true }), /both/);
  const built = buildThreeAsset(prepared.asset);
  assert.ok(built.nodes.get("instances-instances").isInstancedMesh);
  assert.equal(built.nodes.get("instances-instances").count, 32);
  disposeThreeAsset(built.root);
});

test("stream metadata and responses reject duplicate, malformed, and over-budget buffers", () => {
  const descriptor = deferredRegistration(() => streamedAsset()).stream;
  assert.equal(validateAssetStreamDescriptor(descriptor).ok, true);
  assert.equal(validateSpatialReviewAssetStreamOffer({ capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY, maxConcurrentRequests: 2, maxInFlightBytes: 64_000 }).ok, true);
  assert.equal(validateSpatialReviewAssetStreamOffer({ capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY, maxConcurrentRequests: 0, maxInFlightBytes: Number.MAX_SAFE_INTEGER }).ok, false);
  assert.equal(validateAssetStreamDescriptor({ ...descriptor, representations: [descriptor.representations[0], descriptor.representations[0]] }).ok, false);
  assert.equal(validateAssetStreamDescriptor({ ...descriptor, representations: [{ ...descriptor.representations[0], attributes: ["position", "position"] }] }).ok, false);
  const asset = prepareAssetTransfer(streamedAsset("deferred-city", 2), 16_384, { typedInstances: true }).asset;
  assert.equal(validateSpatialReviewAssetResponse({ type: SPATIAL_REVIEW_ASSET_RESPONSE, requestId: "r", buildId: "b", assetId: "deferred-city", profile: "review", ok: true, asset, representationId: "detail", revision: "r1" }, 16_384).ok, true);
  assert.equal(validateSpatialReviewAssetResponse({ type: SPATIAL_REVIEW_ASSET_RESPONSE, requestId: "r", buildId: "b", assetId: "deferred-city", profile: "review", ok: true, asset: { ...asset, nodes: [{ ...asset.nodes[0], instances: [] }] } }, 16_384).ok, false);
  const opaque = { ...asset, opaque: "x".repeat(20_000) };
  assert.throws(() => prepareAssetTransfer(opaque, 16_384, { typedInstances: true }), /transfer budget/);
  assert.equal(validateSpatialReviewAssetResponse({ type: SPATIAL_REVIEW_ASSET_RESPONSE, requestId: "opaque", buildId: "b", assetId: "deferred-city", profile: "review", ok: true, asset: opaque, representationId: "detail", revision: "r1" }, 16_384).ok, false);
  const opaqueArray = [];
  opaqueArray.extension = "x".repeat(20_000);
  assert.throws(() => prepareAssetTransfer({ ...asset, opaqueArray }, 16_384, { typedInstances: true }), /transfer budget/);
  assert.equal(validateSpatialReviewAssetResponse({ type: SPATIAL_REVIEW_ASSET_RESPONSE, requestId: "opaque-array", buildId: "b", assetId: "deferred-city", profile: "review", ok: true, asset: { ...asset, opaqueArray }, representationId: "detail", revision: "r1" }, 16_384).ok, false);
  const aliasedPositions = new Float32Array(30_000);
  const aliased = streamedAsset("aliased", 0);
  aliased.nodes = Array.from({ length: 3 }, (_, index) => ({
    ...aliased.nodes[0],
    id: `aliased-${index}`,
    geometry: { kind: "mesh", positions: aliasedPositions },
    instances: undefined,
  }));
  const aliasedTransfer = prepareAssetTransfer(aliased, 1024 * 1024);
  assert.ok(aliasedTransfer.bytes >= aliasedPositions.byteLength * 3, "each compacted alias is reserved in the transfer budget");
  assert.equal(validateSpatialReviewSourceStatus({ type: "alterno:spatial-review:source-status", buildId: "b", catalogRevision: "r", phase: "streaming", expectedActors: 1, readyActors: 2 }).ok, false);
});

test("deferred catalog replies cannot mix state from conflicting peer negotiations", async () => {
  const registry = new SceneAssetRegistry("catalog-negotiation-r1");
  registry.registerDeferred(deferredRegistration(async (context) => streamedAsset(context.assetId, 1)));
  const received = [];
  let listener;
  const editor = { postMessage(message) { received.push(message); } };
  const originalWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://site.example" }, parent: editor, opener: null, addEventListener(_type, callback) { listener = callback; }, removeEventListener() {}, setTimeout };
  let detach;
  try {
    detach = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"], maxGeometryBytes: 256_000 });
    const send = (data) => listener({ data, origin: "https://editor.example", source: editor });
    send({ type: SPATIAL_REVIEW_REQUEST, requestId: "stream-first", profile: "review", capabilities: [SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY], progressive: true, geometryTransfer: { capability: "geometry-transfer-v1", maxBytes: 128_000 } });
    send({ type: SPATIAL_REVIEW_REQUEST, requestId: "flat-second", profile: "scene" });
    await wait();
    const first = received.find((message) => message.requestId === "stream-first");
    const second = received.find((message) => message.requestId === "flat-second");
    assert.equal(first.assetStream, undefined, "an earlier response is downgraded when the peer disables streaming before serialization");
    assert.equal(first.progressive, undefined);
    assert.equal(second.assetStream, undefined);
    assert.equal(second.progressive, undefined);
  } finally {
    detach?.();
    globalThis.window = originalWindow;
  }
});

test("disabling streaming completes queued and active asset requests as cancelled", async () => {
  const registry = new SceneAssetRegistry("stream-downgrade-r1");
  registry.registerDeferred(deferredRegistration(async ({ signal }) => await new Promise((_resolve, reject) => {
    const cancelled = () => reject(new DOMException("cancelled", "AbortError"));
    if (signal.aborted) cancelled();
    else signal.addEventListener("abort", cancelled, { once: true });
  })));
  const received = [];
  let listener;
  const editor = { postMessage(message) { received.push(message); } };
  const originalWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://site.example" }, parent: editor, opener: null, addEventListener(_type, callback) { listener = callback; }, removeEventListener() {}, setTimeout };
  let detach;
  try {
    detach = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"], maxConcurrentAssetRequests: 1, maxInFlightBytes: 256_000 });
    const send = (data) => listener({ data, origin: "https://editor.example", source: editor });
    send({ type: SPATIAL_REVIEW_REQUEST, requestId: "stream-catalog", profile: "review", capabilities: [SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY], progressive: true, geometryTransfer: { capability: "geometry-transfer-v1", maxBytes: 256_000 } });
    await wait();
    const stream = { capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY, representationId: "detail", maxBytes: 256_000, priority: "visible" };
    send({ type: SPATIAL_REVIEW_ASSET_REQUEST, requestId: "active", buildId: registry.buildId, assetId: "deferred-city", profile: "review", stream });
    send({ type: SPATIAL_REVIEW_ASSET_REQUEST, requestId: "queued", buildId: registry.buildId, assetId: "deferred-city", profile: "review", stream });
    await wait();

    send({ type: SPATIAL_REVIEW_REQUEST, requestId: "flat-catalog", profile: "review" });
    await wait(20);
    for (const requestId of ["active", "queued"]) {
      const responses = received.filter((message) => message.type === SPATIAL_REVIEW_ASSET_RESPONSE && message.requestId === requestId);
      assert.equal(responses.length, 1, `${requestId} receives exactly one terminal response`);
      assert.equal(responses[0].error, "cancelled");
    }
    assert.equal(registry.getSourceStatus().activeRequests, 0);
  } finally {
    detach?.();
    globalThis.window = originalWindow;
  }
});

test("lowering the negotiated stream budget cancels work accepted under the prior ceiling", async () => {
  const registry = new SceneAssetRegistry("stream-budget-renegotiation-r1");
  registry.registerDeferred(deferredRegistration(async ({ signal }) => await new Promise((_resolve, reject) => {
    const cancelled = () => reject(new DOMException("cancelled", "AbortError"));
    if (signal.aborted) cancelled();
    else signal.addEventListener("abort", cancelled, { once: true });
  })));
  const received = [];
  let listener;
  const editor = { postMessage(message) { received.push(message); } };
  const originalWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://site.example" }, parent: editor, opener: null, addEventListener(_type, callback) { listener = callback; }, removeEventListener() {}, setTimeout };
  let detach;
  try {
    detach = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"], maxConcurrentAssetRequests: 1, maxInFlightBytes: 256_000, maxGeometryBytes: 256_000 });
    const send = (data) => listener({ data, origin: "https://editor.example", source: editor });
    const catalog = (requestId, maxBytes) => ({ type: SPATIAL_REVIEW_REQUEST, requestId, profile: "review", capabilities: [SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY], progressive: true, geometryTransfer: { capability: "geometry-transfer-v1", maxBytes } });
    send(catalog("large-catalog", 256_000));
    await wait();
    const stream = { capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY, representationId: "detail", maxBytes: 256_000, priority: "visible" };
    send({ type: SPATIAL_REVIEW_ASSET_REQUEST, requestId: "active-large", buildId: registry.buildId, assetId: "deferred-city", profile: "review", stream });
    send({ type: SPATIAL_REVIEW_ASSET_REQUEST, requestId: "queued-large", buildId: registry.buildId, assetId: "deferred-city", profile: "review", stream });
    await wait();

    send(catalog("small-catalog", 64_000));
    await wait(20);
    const negotiated = received.find((message) => message.requestId === "small-catalog");
    assert.equal(negotiated.geometryTransfer.maxBytes, 64_000);
    assert.equal(negotiated.assetStream.capability, SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY);
    for (const requestId of ["active-large", "queued-large"]) {
      const responses = received.filter((message) => message.type === SPATIAL_REVIEW_ASSET_RESPONSE && message.requestId === requestId);
      assert.equal(responses.length, 1, `${requestId} receives exactly one terminal response`);
      assert.equal(responses[0].error, "cancelled");
    }
    assert.equal(registry.getSourceStatus().activeRequests, 0);
  } finally {
    detach?.();
    globalThis.window = originalWindow;
  }
});

test("bridge negotiates streaming, reuses revisions, transfers typed instances, and cancels active producers", async () => {
  const registry = new SceneAssetRegistry("stream-bridge-r1");
  let calls = 0;
  registry.registerDeferred(deferredRegistration(async (context) => { calls += 1; return slowProducer(context); }));
  const received = [];
  let listener;
  const editor = { postMessage(message, origin, transfer = []) { received.push({ message, origin, transfer }); } };
  const originalWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://site.example" }, parent: editor, opener: null, addEventListener(_type, callback) { listener = callback; }, removeEventListener() {}, setTimeout };
  let detach;
  try {
    detach = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"], maxConcurrentAssetRequests: 1, maxInFlightBytes: 512_000, progressIntervalMs: 10_000 });
    const send = (data, origin = "https://editor.example", source = editor) => listener({ data, origin, source });
    send({ type: SPATIAL_REVIEW_REQUEST, requestId: "catalog", profile: "review", capabilities: [SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY], progressive: true, geometryTransfer: { capability: "geometry-transfer-v1", maxBytes: 256_000 } });
    await wait();
    const catalog = received.find(({ message }) => message.type === SPATIAL_REVIEW_CATALOG)?.message;
    assert.equal(catalog.assetStream.capability, SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY);
    assert.equal(catalog.payload.assetCatalog.assets[0].nodes.length, 0);
    assert.equal(calls, 0);

    const request = { type: SPATIAL_REVIEW_ASSET_REQUEST, requestId: "cached", buildId: registry.buildId, assetId: "deferred-city", profile: "review", stream: { capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY, representationId: "detail", maxBytes: 256_000, priority: "interactive", knownRevision: "city-detail-r3" } };
    send(request);
    assert.equal(received.find(({ message }) => message.requestId === "cached")?.message.notModified, true);
    assert.equal(calls, 0);

    send({ ...request, requestId: "detail", stream: { ...request.stream, knownRevision: undefined } });
    await wait(30);
    const response = received.find(({ message }) => message.requestId === "detail" && message.type === SPATIAL_REVIEW_ASSET_RESPONSE);
    assert.equal(response.message.ok, true);
    assert.equal(response.message.asset.nodes[0].instanceData.count, 2_048);
    assert.equal(response.message.asset.nodes[0].instances, undefined);
    assert.ok(response.transfer.length > 0);
    assert.deepEqual(received.filter(({ message }) => message.requestId === "detail" && message.type === SPATIAL_REVIEW_ASSET_PROGRESS)
      .map(({ message }) => message.phase), ["queued", "generating", "serializing"], "same-phase producer progress is rate-limited");

    send({ ...request, requestId: "cancelled", stream: { ...request.stream, representationId: "overview", knownRevision: undefined } });
    await wait(2);
    send({ type: SPATIAL_REVIEW_ASSET_CANCEL, requestId: "cancelled", buildId: registry.buildId });
    await wait();
    const cancelled = received.filter(({ message }) => message.requestId === "cancelled" && message.type === SPATIAL_REVIEW_ASSET_RESPONSE);
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].message.error, "cancelled");
    assert.equal(cancelled.some(({ message }) => message.asset), false);

    const count = received.length;
    send({ ...request, requestId: "evil" }, "https://evil.example");
    await wait();
    assert.equal(received.length, count);
  } finally {
    detach?.();
    globalThis.window = originalWindow;
  }
});

test("cancelling an uncooperative producer immediately releases queue capacity", async () => {
  const registry = new SceneAssetRegistry("stream-cancel-release-r1");
  let calls = 0;
  registry.registerDeferred(deferredRegistration(async (context) => {
    calls += 1;
    if (calls === 1) return await new Promise(() => {});
    return streamedAsset(context.assetId, 1);
  }));
  const received = [];
  let listener;
  const editor = { postMessage(message) { received.push(message); } };
  const originalWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://site.example" }, parent: editor, opener: null, addEventListener(_type, callback) { listener = callback; }, removeEventListener() {}, setTimeout };
  let detach;
  try {
    detach = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"], maxConcurrentAssetRequests: 1, maxInFlightBytes: 256_000 });
    const send = (data) => listener({ data, origin: "https://editor.example", source: editor });
    send({ type: SPATIAL_REVIEW_REQUEST, requestId: "catalog", profile: "review", capabilities: [SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY], progressive: true, geometryTransfer: { capability: "geometry-transfer-v1", maxBytes: 256_000 } });
    await wait();
    const request = (requestId) => ({ type: SPATIAL_REVIEW_ASSET_REQUEST, requestId, buildId: registry.buildId, assetId: "deferred-city", profile: "review", stream: { capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY, representationId: "detail", maxBytes: 256_000, priority: "interactive" } });
    send(request("stuck"));
    await wait();
    send({ type: SPATIAL_REVIEW_ASSET_CANCEL, requestId: "stuck", buildId: registry.buildId });
    send(request("next"));
    await wait(20);
    assert.equal(received.filter((message) => message.requestId === "stuck" && message.type === SPATIAL_REVIEW_ASSET_RESPONSE).length, 1);
    assert.equal(received.find((message) => message.requestId === "stuck" && message.type === SPATIAL_REVIEW_ASSET_RESPONSE).error, "cancelled");
    assert.equal(received.find((message) => message.requestId === "next" && message.type === SPATIAL_REVIEW_ASSET_RESPONSE).ok, true);
    assert.equal(registry.getSourceStatus().activeRequests, 0);
  } finally {
    detach?.();
    globalThis.window = originalWindow;
  }
});

test("source status counts active requests across every negotiated peer", async () => {
  const registry = new SceneAssetRegistry("stream-global-status-r1");
  const releases = [];
  registry.registerDeferred(deferredRegistration(async (context) => {
    await new Promise((resolve) => releases.push(resolve));
    return streamedAsset(context.assetId, 1);
  }));
  const receivedA = [];
  const receivedB = [];
  let listener;
  const editorA = { postMessage(message) { receivedA.push(message); } };
  const editorB = { postMessage(message) { receivedB.push(message); } };
  const originalWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://site.example" }, parent: editorA, opener: editorB, addEventListener(_type, callback) { listener = callback; }, removeEventListener() {}, setTimeout };
  let detach;
  try {
    detach = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"], maxConcurrentAssetRequests: 1, maxInFlightBytes: 256_000 });
    const send = (source, data) => listener({ data, origin: "https://editor.example", source });
    const catalog = { type: SPATIAL_REVIEW_REQUEST, profile: "review", capabilities: [SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY], progressive: true, geometryTransfer: { capability: "geometry-transfer-v1", maxBytes: 256_000 } };
    send(editorA, { ...catalog, requestId: "catalog-a" });
    send(editorB, { ...catalog, requestId: "catalog-b" });
    await wait();
    const request = (requestId) => ({ type: SPATIAL_REVIEW_ASSET_REQUEST, requestId, buildId: registry.buildId, assetId: "deferred-city", profile: "review", stream: { capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY, representationId: "detail", maxBytes: 256_000, priority: "visible" } });
    send(editorA, request("asset-a"));
    send(editorB, request("asset-b"));
    await wait();
    assert.equal(registry.getSourceStatus().activeRequests, 2);
    assert.equal(receivedA.filter((message) => message.type === "alterno:spatial-review:source-status").at(-1).activeRequests, 2);
    assert.equal(receivedB.filter((message) => message.type === "alterno:spatial-review:source-status").at(-1).activeRequests, 2);
    releases.splice(0).forEach((release) => release());
    await wait(20);
    assert.equal(registry.getSourceStatus().activeRequests, 0);
  } finally {
    releases.splice(0).forEach((release) => release());
    detach?.();
    globalThis.window = originalWindow;
  }
});

test("unnegotiated peers keep the progressive geometry fallback", async () => {
  const registry = new SceneAssetRegistry("mixed-stream-r1");
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  registry.register({ actorId: "eager", assetId: "eager", name: "Eager", sourceRef: "fixture#eager", category: "Fixture", root: mesh });
  registry.registerDeferred(deferredRegistration(slowProducer));
  const received = [];
  let listener;
  const editor = { postMessage(message) { received.push(message); } };
  const originalWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://site.example" }, parent: editor, opener: null, addEventListener(_type, callback) { listener = callback; }, removeEventListener() {}, setTimeout };
  let detach;
  try {
    detach = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"] });
    listener({ origin: "https://editor.example", source: editor, data: { type: SPATIAL_REVIEW_REQUEST, requestId: "old", profile: "scene", progressive: true, geometryTransfer: { capability: "geometry-transfer-v1", maxBytes: 64 * 1024 } } });
    await wait();
    const catalog = received.find((message) => message.type === SPATIAL_REVIEW_CATALOG);
    assert.equal(catalog.assetStream, undefined);
    assert.deepEqual(catalog.payload.assetCatalog.assets.map((asset) => asset.id), ["eager"]);
  } finally {
    detach?.();
    globalThis.window = originalWindow;
    mesh.geometry.dispose(); mesh.material.dispose();
  }
});

test("bridge bounds its queue and starts interactive work before background work", async () => {
  const registry = new SceneAssetRegistry("stream-priority-r1");
  const starts = []; const releases = [];
  for (const suffix of ["first", "background", "interactive", "overflow"]) {
    registry.registerDeferred({
      ...deferredRegistration(async (context) => {
        starts.push(context.priority);
        await new Promise((resolve) => releases.push(resolve));
        return streamedAsset(context.assetId, 1);
      }, 4_096),
      actorId: `${suffix}-placement`,
      assetId: `${suffix}-asset`,
    });
  }
  const received = []; let listener;
  const editor = { postMessage(message) { received.push(message); } };
  const originalWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://site.example" }, parent: editor, opener: null, addEventListener(_type, callback) { listener = callback; }, removeEventListener() {}, setTimeout };
  let detach;
  try {
    detach = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"], maxConcurrentAssetRequests: 1, maxQueuedAssetRequests: 2, maxInFlightBytes: 64_000 });
    const send = (data) => listener({ origin: "https://editor.example", source: editor, data });
    send({ type: SPATIAL_REVIEW_REQUEST, requestId: "catalog-priority", profile: "review", capabilities: [SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY], progressive: true, geometryTransfer: { capability: "geometry-transfer-v1", maxBytes: 16_000 } });
    await wait();
    const request = (requestId, priority) => ({ type: SPATIAL_REVIEW_ASSET_REQUEST, requestId, buildId: registry.buildId, assetId: `${requestId}-asset`, profile: "review",
      stream: { capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY, representationId: "detail", maxBytes: 8_000, priority } });
    send(request("first", "visible"));
    send(request("background", "background"));
    send(request("interactive", "interactive"));
    send(request("overflow", "visible"));
    await wait();
    assert.deepEqual(starts, ["visible"]);
    assert.equal(received.find((message) => message.requestId === "overflow")?.error, "busy");
    assert.equal(received.find((message) => message.requestId === "overflow")?.retryAfterMs, 100);
    releases.shift()(); await wait();
    assert.deepEqual(starts, ["visible", "interactive"]);
    releases.shift()(); await wait();
    assert.deepEqual(starts, ["visible", "interactive", "background"]);
    releases.shift()(); await wait();
  } finally {
    releases.splice(0).forEach((release) => release());
    detach?.(); globalThis.window = originalWindow;
  }
});
