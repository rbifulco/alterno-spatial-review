import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as THREE from "three";
import { preparedReviewFixture, fixtureCaptureOptions } from "./fixtures/prepared-review.mjs";
import { exportPreparedReviewPackage } from "../packages/sdk/dist/index.js";
import { decodePreparedReviewCatalog, encodePreparedReviewPackage, normalizePreparedReviewManifest, normalizeSpatialReviewDiscovery, preparedReviewSha256 } from "../packages/protocol/dist/index.js";
import { prepareReviewPackage, validateWebsite } from "../packages/cli/dist/index.js";
import { validateReviewIndex } from "../packages/validator/dist/index.js";

async function packageFixture(options = {}) {
  const fixture = preparedReviewFixture();
  const exported = await exportPreparedReviewPackage(fixture.registry, { ...fixtureCaptureOptions, ...options });
  const manifest = normalizePreparedReviewManifest(exported.manifest, "https://fixture.example/prepared/manifest.json");
  const files = new Map(exported.files.map((file) => [new URL(file.path, "https://fixture.example/prepared/").href, file]));
  const buffers = new Map();
  for (const resource of manifest.resources) {
    const file = files.get(resource.url);
    assert.equal(await preparedReviewSha256(file.bytes), resource.sha256);
    if (resource.kind === "buffer") buffers.set(resource.id, new Uint8Array(file.bytes).buffer);
  }
  const catalog = JSON.parse(new TextDecoder().decode(files.get(manifest.catalog.url).bytes));
  return { ...fixture, exported, manifest, files, buffers, catalog, decoded: decodePreparedReviewCatalog(catalog, manifest, buffers) };
}

test("registry exporter preserves the canonical detailed source, hierarchy, navigation and shared binary resources", async () => {
  const { registry, exported, manifest, decoded, geometry } = await packageFixture();
  assert.deepEqual(decoded.index.scene, JSON.parse(JSON.stringify(registry.toReviewIndex("review", false, true, true, true).scene)));
  assert.equal(validateReviewIndex(decoded.index).ok, true);
  assert.equal(manifest.captureId, fixtureCaptureOptions.captureId);
  assert.equal(manifest.source.revision, fixtureCaptureOptions.sourceRevision);
  assert.deepEqual(manifest.fidelity, fixtureCaptureOptions.fidelity);
  assert.equal(decoded.index.assetCatalog.assets.length, 2);
  const [shared, instanced] = decoded.index.assetCatalog.assets;
  assert.equal(shared.id, "shared-box");
  assert.equal(shared.sourceRef, "src/site.js#boxes");
  assert.equal(shared.geometries.length, 1, "two components share a source geometry definition");
  assert.equal(shared.geometries[0].geometry.positions, instanced.geometries[0].geometry.positions, "equal geometry bytes share the same decoded typed view across families");
  assert.ok(shared.geometries[0].geometry.positions instanceof Float32Array);
  assert.deepEqual([...shared.geometries[0].geometry.positions], [...geometry.attributes.position.array]);
  assert.ok(shared.geometries[0].geometry.normals instanceof Float32Array);
  assert.ok(shared.geometries[0].geometry.uvs instanceof Float32Array);
  const instances = instanced.nodes.find((node) => node.instanceData)?.instanceData;
  assert.equal(instances.count, 2); assert.ok(instances.transforms instanceof Float32Array);
  assert.deepEqual([...instances.transforms.slice(12, 15)], [0, 0, 3]);
  assert.equal(manifest.resources.filter((resource) => resource.kind === "texture").length, 1);
  assert.equal(Object.keys(decoded.textures).length, 1);
  assert.equal(manifest.resources.length, 2, "numeric arrays share one aligned chunk; the captured texture is stored once");
  assert.equal(exported.stats.bytes, exported.files.reduce((sum, file) => sum + file.bytes.byteLength, 0));
  assert.ok(exported.files.find((file) => file.path === "manifest.json").bytes.byteLength < 4096);
});

test("prepared discovery is additive, resolves its manifest and works without a live transport", () => {
  const discovery = normalizeSpatialReviewDiscovery({ schema: "spatial-review-discovery/v1", version: 1, name: "Prepared only", websiteUrl: "../",
    capabilities: { preparedPackage: { capability: "prepared-review-package-v1", manifest: "../prepared/manifest.json" } } }, "https://fixture.example/.well-known/spatial-review.json");
  assert.equal(discovery.capabilities.preparedPackage.manifest, "https://fixture.example/prepared/manifest.json");
  assert.equal(discovery.liveCapture, undefined);
  assert.throws(() => normalizeSpatialReviewDiscovery({ ...discovery, capabilities: { preparedPackage: { capability: "unknown", manifest: "/p" } } }, "https://fixture.example/discovery.json"), /capability/);
});

test("manifest and decoder reject mixed identities, invalid references, origins and budgets", async () => {
  const { manifest, catalog, buffers } = await packageFixture();
  assert.throws(() => decodePreparedReviewCatalog({ ...catalog, captureId: "different" }, manifest, buffers), /capture identity/);
  assert.throws(() => decodePreparedReviewCatalog(catalog, { ...manifest, buildId: "different" }, buffers), /capture identity/);
  assert.throws(() => decodePreparedReviewCatalog(catalog, { ...manifest, capturedAt: "2026-10-23T11:00:00Z" }, buffers), /capture time/);
  const broken = structuredClone(catalog);
  broken.index.assetCatalog.assets[0].geometries[0].geometry.positions.byteOffset = 100_000;
  assert.throws(() => decodePreparedReviewCatalog(broken, manifest, buffers), /buffer length/i);
  assert.throws(() => normalizePreparedReviewManifest({ ...manifest, resources: [...manifest.resources, manifest.resources[0]] }, "https://fixture.example/prepared/manifest.json"), /unique/);
  assert.throws(() => normalizePreparedReviewManifest({ ...manifest, catalog: { ...manifest.catalog, url: "https://other.example/catalog.json" } }, "https://fixture.example/prepared/manifest.json"), /package origin/);
  assert.throws(() => normalizePreparedReviewManifest({ ...manifest, catalog: { ...manifest.catalog, byteLength: 24 * 1024 * 1024 + 1 } }, "https://fixture.example/prepared/manifest.json"), /budget/);
});

test("packed chunks retain mixed component types, aligned offsets and repeated view identity", async () => {
  const fixture = await packageFixture();
  const index = fixture.decoded.index;
  const instances = index.assetCatalog.assets[1].nodes.find((node) => node.instanceData).instanceData;
  instances.colors = new Uint8Array([255, 20, 0, 0, 30, 255]);
  instances.stableIds = new Uint32Array([1, 70_000]);
  const texture = fixture.manifest.resources.find((resource) => resource.kind === "texture");
  const packed = await encodePreparedReviewPackage(index, { source: fixture.manifest.source, fidelity: fixture.manifest.fidelity, captureId: "mixed-types",
    textures: [{ resourceId: Object.keys(fixture.decoded.textures)[0], contentType: "image/png", bytes: fixture.files.get(texture.url).bytes }] });
  const manifest = normalizePreparedReviewManifest(packed.manifest, "https://fixture.example/prepared/manifest.json");
  const buffers = new Map();
  for (const resource of packed.manifest.resources) if (resource.kind === "buffer") buffers.set(resource.id, new Uint8Array(packed.files.find((file) => file.path === resource.url).bytes).buffer);
  const catalog = JSON.parse(new TextDecoder().decode(packed.files.find((file) => file.path === packed.manifest.catalog.url).bytes));
  const decoded = decodePreparedReviewCatalog(catalog, manifest, buffers).index;
  const geometry = decoded.assetCatalog.assets[0].geometries[0].geometry;
  const data = decoded.assetCatalog.assets[1].nodes.find((node) => node.instanceData).instanceData;
  assert.ok(geometry.positions instanceof Float32Array); assert.ok(geometry.indices instanceof Uint16Array);
  assert.ok(data.colors instanceof Uint8Array); assert.ok(data.stableIds instanceof Uint32Array);
  for (const view of [geometry.positions, geometry.indices, data.colors, data.stableIds, data.transforms]) {
    assert.equal(view.buffer, geometry.positions.buffer, "all fixture arrays share one numeric chunk");
    assert.equal(view.byteOffset % view.BYTES_PER_ELEMENT, 0);
  }
  assert.deepEqual([...data.colors], [...instances.colors]); assert.deepEqual([...data.stableIds], [1, 70_000]);
  assert.equal(decoded.assetCatalog.assets[1].geometries[0].geometry.positions, geometry.positions);
  const misaligned = structuredClone(catalog);
  misaligned.index.assetCatalog.assets[1].nodes.find((node) => node.instanceData).instanceData.stableIds.byteOffset += 1;
  assert.throws(() => decodePreparedReviewCatalog(misaligned, manifest, buffers), /buffer length/i);
  const outOfBounds = structuredClone(catalog);
  outOfBounds.index.assetCatalog.assets[1].nodes.find((node) => node.instanceData).instanceData.colors.length = 10_000_000;
  assert.throws(() => decodePreparedReviewCatalog(outOfBounds, manifest, buffers), /buffer length/i);
});

test("exporter rejects incomplete textures, missing detail and source mutation instead of proxy fallback", async () => {
  const missing = preparedReviewFixture(); missing.registry.readTextureResource = async () => undefined;
  await assert.rejects(exportPreparedReviewPackage(missing.registry, fixtureCaptureOptions), /Texture .* unavailable/);
  const moving = preparedReviewFixture();
  const produce = moving.registry.produceAssetRepresentation.bind(moving.registry);
  moving.registry.produceAssetRepresentation = async (...args) => { const result = await produce(...args); moving.roots[0].position.x += 1; return result; };
  await assert.rejects(exportPreparedReviewPackage(moving.registry, fixtureCaptureOptions), /changed.*export/i);
  const deferred = preparedReviewFixture(); let generations = 0;
  deferred.registry.registerDeferred({ actorId: "deferred", assetId: "deferred", name: "Deferred source", sourceRef: "src/site.js#deferred", category: "Fixture",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, bounds: { center: [0, 0, 0], size: [1, 1, 1] },
    stream: { capability: "asset-stream-v1", revision: "r1", representations: [{ id: "detail", purpose: "detail", revision: "r1-detail", estimatedBytes: 4096, attributes: ["position", "normal", "uv"] }] },
    produceRepresentation: async () => { generations++; return new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); },
  });
  const result = await exportPreparedReviewPackage(deferred.registry, fixtureCaptureOptions);
  assert.equal(result.stats.assets, 3); assert.equal(generations, 1);
  const noDetail = preparedReviewFixture();
  noDetail.registry.getAssetStreamDescriptor = () => ({ representations: [{ id: "overview", purpose: "overview" }] });
  await assert.rejects(exportPreparedReviewPackage(noDetail.registry, fixtureCaptureOptions), /no detailed representation/);
});

test("CLI prepares a canonical registry module into a new directory and refuses overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "prepared-cli-"));
  try {
    const output = join(root, "package");
    const report = await prepareReviewPackage(new URL("./fixtures/prepared-review.mjs", import.meta.url).pathname, output);
    assert.match(report, /fixture-build-1/);
    const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    assert.equal(manifest.resources.length, 2);
    await assert.rejects(prepareReviewPackage(new URL("./fixtures/prepared-review.mjs", import.meta.url).pathname, output), /exist/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CLI packages captured JSON and binary texture sidecars without executing a source site", async () => {
  const fixture = preparedReviewFixture();
  const index = fixture.registry.toReviewIndex("review", false, false, true, false);
  const resourceId = index.assetCatalog.assets[0].materials[0].maps[0].resourceId;
  const texture = await fixture.registry.readTextureResource(resourceId, 1024);
  const root = await mkdtemp(join(tmpdir(), "prepared-json-"));
  try {
    await writeFile(join(root, "texture.png"), new Uint8Array(texture.bytes));
    await writeFile(join(root, "capture.json"), JSON.stringify({ schema: "spatial-review-capture/v1", index,
      source: { websiteUrl: fixtureCaptureOptions.websiteUrl, revision: "fixture-source-1", generator: "canonical-json-fixture" }, fidelity: fixtureCaptureOptions.fidelity,
      textures: [{ resourceId, path: "texture.png", contentType: "image/png" }] }));
    await prepareReviewPackage(join(root, "capture.json"), join(root, "package"));
    const manifest = JSON.parse(await readFile(join(root, "package/manifest.json"), "utf8"));
    assert.equal(manifest.resources.length, 2);
    const capture = JSON.parse(await readFile(join(root, "capture.json"), "utf8"));
    capture.textures[0].path = "../escape.png";
    await writeFile(join(root, "capture.json"), JSON.stringify(capture));
    await assert.rejects(prepareReviewPackage(join(root, "capture.json"), join(root, "escape")), /inside/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CLI validates the preferred package bytes and rejects corruption even when legacy transports are advertised", async () => {
  const { exported, files } = await packageFixture();
  let corrupt = false; let wrongSource = false; let compressed = false; const requested = [];
  const fetcher = async (url) => {
    requested.push(url);
    let bytes;
    if (url.endsWith("/.well-known/spatial-review.json")) bytes = new TextEncoder().encode(JSON.stringify({ schema: "spatial-review-discovery/v1", version: 1, name: "Fixture", websiteUrl: fixtureCaptureOptions.websiteUrl,
      scene: "/proxy-scene.json", liveCapture: "/capture", capabilities: { preparedPackage: { capability: "prepared-review-package-v1", manifest: "/prepared/manifest.json" } } }));
    else if (url.endsWith("/manifest.json")) bytes = new TextEncoder().encode(JSON.stringify({ ...exported.manifest, ...(wrongSource ? { source: { ...exported.manifest.source, websiteUrl: "https://other.example/" } } : {}) }));
    else {
      const file = files.get(url); assert.ok(file, `Unexpected request ${url}`);
      bytes = new Uint8Array(file.bytes);
      if (corrupt) bytes[0] ^= 1;
    }
    const response = new Response(bytes, compressed ? { headers: { "content-encoding": "gzip", "content-length": String(bytes.byteLength + 64) } } : undefined); Object.defineProperty(response, "url", { value: url }); return response;
  };
  const report = await validateWebsite(fixtureCaptureOptions.websiteUrl, { fetch: fetcher });
  assert.match(report, /Prepared: fixture-capture-1/);
  assert.ok(!requested.some((url) => url.endsWith("proxy-scene.json") || url.endsWith("/capture")));
  compressed = true;
  assert.match(await validateWebsite(fixtureCaptureOptions.websiteUrl, { fetch: fetcher }), /Prepared: fixture-capture-1/);
  compressed = false;
  corrupt = true;
  await assert.rejects(validateWebsite(fixtureCaptureOptions.websiteUrl, { fetch: fetcher }), /SHA-256/);
  corrupt = false; wrongSource = true;
  await assert.rejects(validateWebsite(fixtureCaptureOptions.websiteUrl, { fetch: fetcher }), /different source website/);
});

test("encoder rejects invalid numeric data instead of truncating geometry indices", async () => {
  const { decoded } = await packageFixture();
  const index = structuredClone(decoded.index); index.assetCatalog.assets[0].geometries[0].geometry.indices = [-1, 1, 2];
  await assert.rejects(encodePreparedReviewPackage(index, { source: { websiteUrl: fixtureCaptureOptions.websiteUrl, revision: "r1", generator: "fixture" }, fidelity: fixtureCaptureOptions.fidelity }), /invalid index/);
});
