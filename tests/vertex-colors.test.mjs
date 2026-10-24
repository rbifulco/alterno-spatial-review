import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { assetFromObject3DRoots, buildThreeAsset, disposeThreeAsset, prepareAssetTransfer, SceneAssetRegistry, exportPreparedReviewPackage } from '../packages/sdk/dist/index.js';
import { decodePreparedReviewCatalog, normalizePreparedReviewManifest } from '../packages/protocol/dist/index.js';
import { fixtureCaptureOptions } from './fixtures/prepared-review.mjs';
import { validateAssetDocument } from '../packages/validator/dist/index.js';

function source(channels = 3, enabled = true) {
  const geometry = new THREE.BoxGeometry();
  const bytes = new Uint8Array(geometry.attributes.position.count * channels);
  for (let i = 0; i < bytes.length; i += channels) { bytes[i] = 26; bytes[i + 1] = 153; bytes[i + 2] = 13; if (channels === 4) bytes[i + 3] = 128; }
  geometry.setAttribute('color', new THREE.BufferAttribute(bytes, channels, true));
  const material = new THREE.MeshStandardMaterial({ vertexColors: enabled, transparent: channels === 4 });
  return new THREE.Mesh(geometry, material);
}
function meshIn(root) { let mesh; root.traverse(o => { if (o.isMesh) mesh = o; }); return mesh; }
function documentFor(asset) { return { schema: 'asset-review-3d/v1', id: 'colours', name: 'Colours', units: 'm', assets: [asset] }; }

for (const channels of [3, 4]) for (const profile of ['scene', 'review']) {
  test(`${profile} retains normalized ${channels}-channel colours through JSON, transfer and reconstruction`, () => {
    const mesh = source(channels);
    const asset = assetFromObject3DRoots([mesh], 'Leaves', 'test:leaves', { profile });
    const json = JSON.parse(JSON.stringify(asset));
    assert.equal(validateAssetDocument(documentFor(json)).ok, true);
    assert.equal(json.materials[0].vertexColors, true);
    const colours = json.geometries[0].geometry.colors;
    assert.equal(colours.length, mesh.geometry.attributes.position.count * channels);
    assert.ok(Math.abs(colours[1] - 153 / 255) < 1e-6);
    const transferred = prepareAssetTransfer(json);
    const typed = transferred.asset.geometries[0].geometry.colors;
    assert.ok(typed instanceof Float32Array);
    assert.ok(transferred.transfer.includes(typed.buffer));
    const withoutColours = structuredClone(json); delete withoutColours.geometries[0].geometry.colors;
    assert.ok(transferred.bytes >= prepareAssetTransfer(withoutColours).bytes + typed.byteLength);
    const built = buildThreeAsset(transferred.asset, 'lit');
    const result = meshIn(built.root);
    assert.equal(result.material.vertexColors, true);
    assert.equal(result.material.transparent, channels === 4);
    assert.equal(result.geometry.getAttribute('color').itemSize, channels);
    assert.ok(Math.abs(result.geometry.getAttribute('color').getY(0) - 153 / 255) < 1e-6);
    disposeThreeAsset(built.root); mesh.geometry.dispose(); mesh.material.dispose();
  });
}

test('colour opt-out, interleaved attributes, and malformed transfer colours are respected', () => {
  const mesh = source(3, false);
  const values = new Float32Array(mesh.geometry.attributes.position.count * 4);
  for (let i = 0; i < values.length; i += 4) { values[i] = 99; values[i + 1] = 0.2; values[i + 2] = 0.7; values[i + 3] = 0.1; }
  mesh.geometry.setAttribute('color', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(values, 4), 3, 1));
  const asset = assetFromObject3DRoots([mesh], 'Mask', 'test:mask', { geometryEncoding: 'typed' });
  assert.deepEqual([...asset.geometries[0].geometry.colors.slice(0, 3)], [...values.slice(1, 4)]);
  const built = buildThreeAsset(asset, 'lit');
  assert.equal(meshIn(built.root).material.vertexColors, false);
  for (const bad of [new Float32Array(2), new Float32Array(asset.geometries[0].geometry.colors.length).fill(NaN)]) {
    const broken = structuredClone(asset); broken.geometries[0].geometry.colors = bad;
    assert.equal(validateAssetDocument(documentFor(broken)).ok, false);
    assert.throws(() => prepareAssetTransfer(broken), /[Cc]olor/);
  }
  const broken = structuredClone(asset); broken.materials[0].vertexColors = 'true';
  assert.equal(validateAssetDocument(documentFor(broken)).ok, false);
  disposeThreeAsset(built.root); mesh.geometry.dispose(); mesh.material.dispose();
});

test('prepared packages retain shared colour buffers and material opt-in', async () => {
  const mesh = source(4);
  const registry = new SceneAssetRegistry('vertex-colours');
  registry.register({ actorId: 'a', assetId: 'leaf', name: 'Leaf', sourceRef: 'test:leaf', category: 'Test', root: mesh });
  const exported = await exportPreparedReviewPackage(registry, fixtureCaptureOptions);
  const files = new Map(exported.files.map(f => [f.path, f.bytes]));
  const manifest = normalizePreparedReviewManifest(JSON.parse(new TextDecoder().decode(files.get('manifest.json'))), 'https://fixture.example/manifest.json');
  const catalog = JSON.parse(new TextDecoder().decode(files.get(new URL(manifest.catalog.url).pathname.slice(1))));
  const buffers = new Map(manifest.resources.filter(r => r.kind === 'buffer').map(r => [r.id, new Uint8Array(files.get(new URL(r.url).pathname.slice(1))).buffer]));
  const decoded = decodePreparedReviewCatalog(catalog, manifest, buffers).index.assetCatalog.assets[0];
  assert.ok(decoded.geometries[0].geometry.colors instanceof Float32Array);
  assert.equal(decoded.materials[0].vertexColors, true);
  assert.ok(Math.abs(decoded.geometries[0].geometry.colors[3] - 128 / 255) < 1e-6);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('Scene exports retain UVs and live texture resources within their geometry budget', async () => {
  const mesh = source();
  const texture = new THREE.DataTexture(new Uint8Array([40, 150, 20, 255]), 1, 1);
  mesh.material.map = texture;
  const registry = new SceneAssetRegistry('textured-scene');
  registry.register({ actorId: 'tree', assetId: 'tree', name: 'Tree', sourceRef: 'test:tree', root: mesh });
  const representation = registry.getAssetStreamDescriptor('tree', 'scene').representations[0];
  assert.ok(representation.attributes.includes('uv'));
  assert.ok(representation.attributes.includes('color'));
  const result = await registry.produceAssetRepresentation('tree', 'scene', representation.id, 64 * 1024, 'visible', new AbortController().signal);
  const geometry = result.asset.geometries[0].geometry;
  assert.equal(geometry.normals, undefined, 'Scene still lets the consumer reconstruct normals');
  assert.equal(geometry.uvs.length, mesh.geometry.attributes.uv.count * 2);
  assert.equal(result.asset.materials[0].maps[0].slot, 'map');
  assert.equal(result.asset.materials[0].maps[0].resourceId, `three-texture:${texture.uuid}`);
  assert.ok(representation.estimatedBytes >= geometry.positions.byteLength + geometry.indices.byteLength + geometry.uvs.byteLength + geometry.colors.byteLength);
  const review = registry.toAsset('tree', 'review');
  assert.ok(review.geometries[0].geometry.normals.length);
  mesh.geometry.dispose(); mesh.material.dispose(); texture.dispose();
});
