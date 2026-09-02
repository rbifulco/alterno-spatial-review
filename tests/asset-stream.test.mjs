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
  structuredClone(result.asset, { transfer: result.transfer });
  const reused = await registry.produceAssetRepresentation("deferred-city", "review", "overview", 256_000, "visible", controller.signal);
  assert.ok(reused.asset.nodes[0].instanceData.transforms.byteLength > 0, "transferring one response cannot detach the retained snapshot");
  assert.equal(calls, 1);
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

test("deferred representation snapshots are validated before caching and retained in a bounded LRU", async () => {
  let oversized = true;
  let invalidCalls = 0;
  const invalidRegistry = new SceneAssetRegistry("deferred-invalid-cache-r1");
  invalidRegistry.registerDeferred(deferredRegistration((context) => {
    invalidCalls += 1;
    return {
      ...streamedAsset(context.assetId, 0),
      ...(oversized ? { extension: "x".repeat(300_000) } : {}),
    };
  }, 1_024));
  await assert.rejects(
    invalidRegistry.produceAssetRepresentation("deferred-city", "review", "detail", 256_000, "visible", new AbortController().signal),
    /transfer budget/,
  );
  assert.equal(invalidRegistry.deferredCacheMetrics.entries, 0);
  oversized = false;
  await invalidRegistry.produceAssetRepresentation("deferred-city", "review", "detail", 256_000, "visible", new AbortController().signal);
  assert.equal(invalidCalls, 2, "an invalid producer result never becomes the immutable cached snapshot");

  let calls = 0;
  const registry = new SceneAssetRegistry("deferred-bounded-cache-r1");
  const registrations = Array.from({ length: 33 }, (_, index) => {
    const base = deferredRegistration((context) => { calls += 1; return streamedAsset(context.assetId, 0); }, 1_024);
    return { ...base, actorId: `actor-${index}`, assetId: `asset-${index}` };
  });
  registrations.forEach((registration) => registry.registerDeferred(registration));
  for (const registration of registrations) {
    await registry.produceAssetRepresentation(registration.assetId, "review", "detail", 256_000, "visible", new AbortController().signal);
  }
  const metrics = registry.deferredCacheMetrics;
  assert.equal(metrics.entries, metrics.maxEntries);
  assert.ok(metrics.bytes <= metrics.maxBytes);
  await registry.produceAssetRepresentation("asset-0", "review", "detail", 256_000, "visible", new AbortController().signal);
  assert.equal(calls, 34, "the oldest representation is reproduced after bounded eviction");
});

test("deferred texture resources keep a delivery grace and then obey independent bounds", async () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  const roots = [];
  const textures = [];
  try {
    const registry = new SceneAssetRegistry("deferred-texture-cache-r1");
    const registrations = Array.from({ length: 66 }, (_, index) => {
      const texture = new THREE.Texture();
      const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture }));
      roots.push(root); textures.push(texture);
      const base = deferredRegistration(() => root, 1_024);
      return { ...base, actorId: `textured-actor-${index}`, assetId: `textured-asset-${index}` };
    });
    registrations.forEach((registration) => registry.registerDeferred(registration));
    const resourceIds = [];
    for (const registration of registrations.slice(0, 65)) {
      const result = await registry.produceAssetRepresentation(registration.assetId, "review", "detail", 256_000, "visible", new AbortController().signal);
      resourceIds.push(result.asset.materials[0].maps[0].resourceId);
    }

    let metrics = registry.deferredCacheMetrics;
    assert.equal(metrics.entries, metrics.maxEntries, "geometry snapshots remain independently bounded");
    assert.equal(metrics.textureOwners, 65, "a just-delivered resource is not removed before the editor can request it");
    assert.equal(registry.hasTextureResource(resourceIds[0]), true);

    now += metrics.textureGraceMs + 1;
    const final = await registry.produceAssetRepresentation(registrations[65].assetId, "review", "detail", 256_000, "visible", new AbortController().signal);
    resourceIds.push(final.asset.materials[0].maps[0].resourceId);
    metrics = registry.deferredCacheMetrics;
    assert.ok(metrics.textureOwners <= metrics.maxTextureOwners);
    assert.ok(metrics.textureBytes <= metrics.maxTextureBytes);
    assert.equal(registry.hasTextureResource(resourceIds[0]), false, "the oldest expired resource owner is released");
    assert.equal(registry.hasTextureResource(resourceIds.at(-1)), true, "the current delivery remains available");
  } finally {
    Date.now = originalNow;
    roots.forEach((root) => { root.geometry.dispose(); root.material.dispose(); });
    textures.forEach((texture) => texture.dispose());
  }
});

test("texture-owner eviction invalidates stale geometry and revision reuse", async () => {
  const originalNow = Date.now;
  let now = 2_000;
  Date.now = () => now;
  const roots = [];
  const textures = [];
  try {
    const registry = new SceneAssetRegistry("deferred-texture-invalidation-r1");
    const calls = Array(5).fill(0);
    const registrations = Array.from({ length: 5 }, (_, index) => {
      const texture = new THREE.Texture({ width: 4_100, height: 4_100 });
      const geometry = index === 0 ? new THREE.SphereGeometry(1, 32, 16) : new THREE.BoxGeometry();
      const root = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture }));
      roots.push(root); textures.push(texture);
      const base = deferredRegistration(() => { calls[index] += 1; return root; }, 1_024);
      return { ...base, actorId: `large-texture-actor-${index}`, assetId: `large-texture-asset-${index}` };
    });
    registrations.forEach((registration) => registry.registerDeferred(registration));
    const resourceIds = [];
    for (const registration of registrations.slice(0, 4)) {
      const result = await registry.produceAssetRepresentation(registration.assetId, "review", "detail", 256_000, "visible", new AbortController().signal);
      resourceIds.push(result.asset.materials[0].maps[0].resourceId);
    }
    let metrics = registry.deferredCacheMetrics;
    assert.ok(metrics.textureBytes > metrics.maxTextureBytes, "young deliveries may temporarily exceed the resource budget");

    now += metrics.textureGraceMs + 1;
    await registry.produceAssetRepresentation(registrations[4].assetId, "review", "detail", 256_000, "visible", new AbortController().signal);
    assert.equal(registry.hasTextureResource(resourceIds[0]), false);
    assert.equal(registry.canReuseAssetRepresentation(registrations[0].assetId, "review", "detail", "city-detail-r3"), false);

    await assert.rejects(
      registry.produceAssetRepresentation(registrations[0].assetId, "review", "detail", 1_024, "visible", new AbortController().signal),
      /transfer budget/,
    );
    assert.equal(registry.canReuseAssetRepresentation(registrations[0].assetId, "review", "detail", "city-detail-r3"), false,
      "a failed regeneration cannot revive revision reuse");

    const reproduced = await registry.produceAssetRepresentation(registrations[0].assetId, "review", "detail", 256_000, "visible", new AbortController().signal);
    assert.equal(calls[0], 3, "missing resources force representation regeneration instead of a stale geometry hit");
    assert.equal(registry.hasTextureResource(reproduced.asset.materials[0].maps[0].resourceId), true);
    assert.equal(registry.canReuseAssetRepresentation(registrations[0].assetId, "review", "detail", "city-detail-r3"), true);
  } finally {
    Date.now = originalNow;
    roots.forEach((root) => { root.geometry.dispose(); root.material.dispose(); });
    textures.forEach((texture) => texture.dispose());
  }
});

test("the last live bridge releases deferred session resources", async () => {
  const texture = new THREE.Texture();
  const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture }));
  const registry = new SceneAssetRegistry("deferred-session-release-r1");
  registry.registerDeferred(deferredRegistration(() => root));
  const editor = { postMessage() {} };
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: { origin: "https://site.example" },
    parent: editor,
    opener: null,
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
  };
  let detach;
  let detachSecond;
  try {
    detach = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"] });
    detachSecond = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"] });
    const result = await registry.produceAssetRepresentation(
      "deferred-city", "review", "detail", 256_000, "visible", new AbortController().signal,
    );
    const resourceId = result.asset.materials[0].maps[0].resourceId;
    assert.equal(registry.hasTextureResource(resourceId), true);
    detach();
    assert.equal(registry.hasTextureResource(resourceId), true, "another live bridge still owns the session");
    detachSecond();
    assert.equal(registry.hasTextureResource(resourceId), false);
    assert.equal(registry.deferredCacheMetrics.entries, 0);
    assert.equal(registry.deferredCacheMetrics.textureOwners, 0);
    assert.equal(registry.canReuseAssetRepresentation("deferred-city", "review", "detail", "city-detail-r3"), false);
    detach();
    detach = undefined;
    detachSecond = undefined;
  } finally {
    detach?.();
    detachSecond?.();
    globalThis.window = originalWindow;
    root.geometry.dispose(); root.material.dispose(); texture.dispose();
  }
});

test("known revisions regenerate after their session resources expire", async () => {
  const texture = new THREE.Texture();
  const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture }));
  let calls = 0;
  const registry = new SceneAssetRegistry("deferred-known-revision-r1");
  registry.registerDeferred(deferredRegistration(() => { calls += 1; return root; }));
  const received = [];
  let listener;
  const editor = { postMessage(message) { received.push(message); } };
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: { origin: "https://site.example" },
    parent: editor,
    opener: null,
    addEventListener(_type, callback) { listener = callback; },
    removeEventListener() {},
    setTimeout,
  };
  let detach;
  try {
    detach = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"] });
    await registry.produceAssetRepresentation("deferred-city", "review", "detail", 256_000, "visible", new AbortController().signal);
    detach();
    detach = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"] });
    const send = (data) => listener({ data, origin: "https://editor.example", source: editor });
    send({ type: SPATIAL_REVIEW_REQUEST, requestId: "reconnect-catalog", profile: "review", capabilities: [SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY], progressive: true, geometryTransfer: { capability: "geometry-transfer-v1", maxBytes: 256_000 } });
    await wait();
    send({ type: SPATIAL_REVIEW_ASSET_REQUEST, requestId: "reconnect-asset", buildId: registry.buildId, assetId: "deferred-city", profile: "review",
      stream: { capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY, representationId: "detail", maxBytes: 256_000, priority: "interactive", knownRevision: "city-detail-r3" } });
    await wait();
    const response = received.find((message) => message.type === SPATIAL_REVIEW_ASSET_RESPONSE && message.requestId === "reconnect-asset");
    assert.equal(response.ok, true);
    assert.notEqual(response.notModified, true);
    assert.ok(response.asset);
    assert.equal(calls, 2);
  } finally {
    detach?.();
    globalThis.window = originalWindow;
    root.geometry.dispose(); root.material.dispose(); texture.dispose();
  }
});

test("a fresh bridge peer receives an eager textured representation before revision reuse", async () => {
  const texture = new THREE.Texture();
  const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture }));
  const registry = new SceneAssetRegistry("eager-known-revision-r1");
  registry.register({ actorId: "eager-placement", assetId: "eager-asset", name: "Eager asset", sourceRef: "fixture#eager", category: "Fixture", root });
  const received = [];
  let listener;
  const editor = { postMessage(message) { received.push(message); } };
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: { origin: "https://site.example" },
    parent: editor,
    opener: null,
    addEventListener(_type, callback) { listener = callback; },
    removeEventListener() {},
    setTimeout,
  };
  let detach;
  try {
    const connect = async (requestId) => {
      listener({ data: { type: SPATIAL_REVIEW_REQUEST, requestId, profile: "review", capabilities: [SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY], progressive: true,
        geometryTransfer: { capability: "geometry-transfer-v1", maxBytes: 256_000 } }, origin: "https://editor.example", source: editor });
      await wait();
      return received.find((message) => message.type === SPATIAL_REVIEW_CATALOG && message.requestId === requestId);
    };
    const requestAsset = async (requestId, revision) => {
      listener({ data: { type: SPATIAL_REVIEW_ASSET_REQUEST, requestId, buildId: registry.buildId, assetId: "eager-asset", profile: "review",
        stream: { capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY, representationId: "detail", maxBytes: 256_000, priority: "interactive", knownRevision: revision } },
      origin: "https://editor.example", source: editor });
      await wait();
      return received.find((message) => message.type === SPATIAL_REVIEW_ASSET_RESPONSE && message.requestId === requestId);
    };

    detach = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"] });
    const firstCatalog = await connect("catalog-a");
    const revision = firstCatalog.payload.assetCatalog.assets[0].stream.representations[0].revision;
    const first = await requestAsset("asset-a", revision);
    assert.equal(first.ok, true);
    assert.notEqual(first.notModified, true);
    assert.ok(first.asset.materials[0].maps[0].resourceId);
    assert.equal((await requestAsset("asset-a-reuse", revision)).notModified, true);

    detach();
    detach = attachSceneAssetRegistryBridge(registry, { allowedOrigins: ["https://editor.example"] });
    await connect("catalog-b");
    const freshPeer = await requestAsset("asset-b", revision);
    assert.equal(freshPeer.ok, true);
    assert.notEqual(freshPeer.notModified, true, "a new peer must not inherit the previous peer's delivery history");
    assert.ok(freshPeer.asset.materials[0].maps[0].resourceId);
  } finally {
    detach?.();
    globalThis.window = originalWindow;
    root.geometry.dispose(); root.material.dispose(); texture.dispose();
  }
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

  const sharedInstanceBuffer = new ArrayBuffer(2_000 * 16 * 4);
  const sharedInstanceAsset = streamedAsset("typed-aliases", 0);
  sharedInstanceAsset.nodes = [new Float32Array(sharedInstanceBuffer), new Float32Array(sharedInstanceBuffer)].map((transforms, index) => ({
    ...sharedInstanceAsset.nodes[0],
    id: `typed-alias-${index}`,
    instances: undefined,
    instanceData: { encoding: "matrix-f32-v1", count: 2_000, transforms },
  }));
  assert.throws(() => prepareAssetTransfer(sharedInstanceAsset, 132_000, { typedInstances: true }), /transfer budget/,
    "typed views that alias one source buffer reserve each owned transfer copy");
  const preparedAliases = prepareAssetTransfer(sharedInstanceAsset, 300_000, { typedInstances: true });
  const transferredAliasBytes = preparedAliases.transfer.reduce((total, buffer) => total + buffer.byteLength, 0);
  assert.ok(preparedAliases.bytes >= transferredAliasBytes);
  assert.notEqual(preparedAliases.asset.nodes[0].instanceData.transforms.buffer, preparedAliases.asset.nodes[1].instanceData.transforms.buffer);
  assert.equal(validateSpatialReviewAssetResponse({
    type: SPATIAL_REVIEW_ASSET_RESPONSE,
    requestId: "typed-aliases",
    buildId: "b",
    assetId: "typed-aliases",
    profile: "review",
    ok: true,
    asset: preparedAliases.asset,
    representationId: "detail",
    revision: "r1",
  }, 300_000).ok, true);

  const packedInstanceBuffer = new ArrayBuffer(1_000_000);
  const packedInstanceSubview = new Float32Array(packedInstanceBuffer, 4_096, 32);
  const packedInstanceAsset = streamedAsset("packed-instance-alias", 0);
  packedInstanceAsset.nodes = [0, 1].map((index) => ({
    ...packedInstanceAsset.nodes[0],
    id: `packed-instance-alias-${index}`,
    instances: undefined,
    instanceData: { encoding: "matrix-f32-v1", count: 2, transforms: packedInstanceSubview },
  }));
  const preparedSubviews = prepareAssetTransfer(packedInstanceAsset, 5_000, { typedInstances: true });
  assert.ok(preparedSubviews.bytes <= 5_000, "fully compacted subviews do not reserve unused backing-buffer bytes");
  assert.notEqual(preparedSubviews.asset.nodes[0].instanceData.transforms.buffer, preparedSubviews.asset.nodes[1].instanceData.transforms.buffer);
  assert.throws(() => prepareAssetTransfer({ ...packedInstanceAsset, retainedSubview: packedInstanceSubview }, 5_000, { typedInstances: true }), /transfer budget/,
    "an unprojected alias still reserves its retained backing buffer");
  assert.equal(validateSpatialReviewSourceStatus({ type: "alterno:spatial-review:source-status", buildId: "b", catalogRevision: "r", phase: "streaming", expectedActors: 1, readyActors: 2 }).ok, false);
});

test("bridge caps a derived aggregate stream offer at the protocol maximum", async () => {
  const registry = new SceneAssetRegistry("bounded-derived-offer");
  const received = [];
  let listener;
  const editor = { postMessage(message) { received.push(message); } };
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: { origin: "https://site.example" },
    parent: editor,
    opener: null,
    addEventListener(_type, callback) { listener = callback; },
    removeEventListener() {},
    setTimeout,
  };
  let detach;
  try {
    detach = attachSceneAssetRegistryBridge(registry, {
      allowedOrigins: ["https://editor.example"],
      maxGeometryBytes: 1024 * 1024 * 1024,
    });
    listener({
      origin: "https://editor.example",
      source: editor,
      data: {
        type: SPATIAL_REVIEW_REQUEST,
        requestId: "bounded-offer",
        profile: "review",
        capabilities: [SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY],
        progressive: true,
        geometryTransfer: { capability: "geometry-transfer-v1", maxBytes: 1024 * 1024 * 1024 },
      },
    });
    await wait();
    const offer = received.find((message) => message.requestId === "bounded-offer").assetStream;
    assert.equal(offer.maxInFlightBytes, 1024 * 1024 * 1024);
    assert.equal(validateSpatialReviewAssetStreamOffer(offer).ok, true);
  } finally {
    detach?.();
    globalThis.window = originalWindow;
  }
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
    await wait(30);
    const firstKnownRevision = received.find(({ message }) => message.requestId === "cached" && message.type === SPATIAL_REVIEW_ASSET_RESPONSE)?.message;
    assert.equal(firstKnownRevision.ok, true);
    assert.notEqual(firstKnownRevision.notModified, true, "a peer cannot reuse a representation it has not received in this bridge session");
    assert.ok(firstKnownRevision.asset);
    assert.equal(calls, 1);

    send({ ...request, requestId: "same-session-cached" });
    const sameSession = received.find(({ message }) => message.requestId === "same-session-cached")?.message;
    assert.equal(sameSession.notModified, true, "the same peer can reuse a still-owned representation after its full delivery");
    assert.equal(calls, 1);

    send({ ...request, requestId: "detail", stream: { ...request.stream, knownRevision: undefined } });
    await wait(30);
    const response = received.find(({ message }) => message.requestId === "detail" && message.type === SPATIAL_REVIEW_ASSET_RESPONSE);
    assert.equal(response.message.ok, true);
    assert.equal(response.message.asset.nodes[0].instanceData.count, 2_048);
    assert.equal(response.message.asset.nodes[0].instances, undefined);
    assert.ok(response.transfer.length > 0);
    assert.equal(calls, 1, "an uncached request reuses the source's immutable snapshot while still returning the full representation");
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
