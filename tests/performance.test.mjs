import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { SceneAssetRegistry, buildThreeAsset, disposeThreeAsset, ThreeAssetResourceCache, prepareAssetTransfer, attachSceneAssetRegistryBridge, SPATIAL_REVIEW_REQUEST, SPATIAL_REVIEW_CATALOG, SPATIAL_REVIEW_ASSET_REQUEST, SPATIAL_REVIEW_ASSET_RESPONSE } from '../packages/sdk/dist/index.js';

function fixture(count = 1000) {
  const registry = new SceneAssetRegistry('performance-test');
  const geometry = new THREE.BoxGeometry(1, 2, 3);
  const material = new THREE.MeshBasicMaterial({color: '#ccaabb'});
  const parent = new THREE.Group(); const roots = [];
  for (let index = 0; index < count; index++) {
    const root = new THREE.Mesh(geometry, material); root.position.x = index * 2; parent.add(root); roots.push(root);
    registry.register({ actorId: `actor-${index}`, assetId: 'shared/box', name: `Box ${index}`, sourceRef: 'fixture', category: 'Test', root });
  }
  return {registry, roots, parent, geometry, material};
}

test('unchanged handoffs do no matrix products or bounds rebuilds; one moved actor updates one bound', () => {
  const {registry, roots, parent} = fixture();
  const first = registry.toActors();
  assert.equal(first.length, 1000);
  assert.equal(registry.cacheMetrics.geometries, 1);
  assert.deepEqual(registry.toActors(), first);
  assert.deepEqual(registry.cacheMetrics, {worldMatrices: 0, bounds: 0, geometries: 0, assets: 0});
  roots[333].position.y = 7;
  const moved = registry.toActors();
  assert.equal(moved[333].bounds.center[1], 7);
  assert.equal(registry.cacheMetrics.bounds, 1);
  assert.equal(registry.cacheMetrics.worldMatrices, 1);
  parent.position.z = 10;
  assert.equal(registry.toActors()[999].bounds.center[2], 10);
  moved[333].bounds.center[1] = -999;
  assert.equal(registry.toActors()[333].bounds.center[1], 7, 'public actor values cannot corrupt the cache');
});

test('nested transforms, reparenting, attribute versions and explicit invalidation refresh bounds', () => {
  const {registry, roots, geometry} = fixture(2);
  const child = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); roots[0].add(child);
  registry.toActors(); child.position.y = 20;
  assert.ok(registry.toActors()[0].bounds.center[1] > 9);
  roots[1].add(child);
  assert.equal(registry.toActors()[0].bounds.center[1], 0);
  const positions = geometry.getAttribute('position');
  for (let i=0; i<positions.count; i++) positions.setY(i, positions.getY(i) + 5);
  positions.needsUpdate = true;
  assert.equal(registry.toActors()[0].bounds.center[1], 5);
  for (let i=0; i<positions.count; i++) positions.setY(i, positions.getY(i) + 2);
  registry.invalidate('actor-0');
  assert.equal(registry.toActors()[0].bounds.center[1], 7);
  assert.equal(registry.unregister('actor-0'), true);
  assert.equal(registry.toActors().length, 1);
});

test('instance matrices and manual matrices invalidate cached bounds', () => {
  const registry = new SceneAssetRegistry();
  const root = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
  registry.register({ actorId: 'a', assetId: 'a', name: 'A', sourceRef: 'a', category: 'Test', root });
  registry.toActors(); root.setMatrixAt(1, new THREE.Matrix4().makeTranslation(10,0,0)); root.instanceMatrix.needsUpdate = true;
  assert.equal(registry.toActors()[0].bounds.center[0], 5);
  root.matrixAutoUpdate = false; root.matrix.makeTranslation(2, 0, 0);
  assert.equal(registry.toActors()[0].bounds.center[0], 7);
});

test('metadata handoffs serialize zero geometry; families retain IDs and are cached independently', () => {
  const {registry, roots} = fixture(10);
  const metadata = registry.toReviewIndex('scene', false, true);
  assert.equal(metadata.scene.actors.length, 10);
  assert.equal(metadata.assetCatalog.assets.length, 1);
  assert.equal(metadata.assetCatalog.assets[0].nodes.length, 0);
  assert.equal(registry.cacheMetrics.assets, 0);
  const asset = registry.toAsset('shared/box', 'scene', true);
  assert.equal(asset.id, 'shared/box');
  assert.equal(registry.toAsset('shared/box', 'scene', true), asset);
  roots[1].position.x = 50;
  assert.equal(registry.toAsset('shared/box', 'scene', true), asset, 'moving another actor does not reserialize its shared family');
  assert.throws(() => registry.toAsset('shared/box','review',true,8), RangeError);
  assert.equal(registry.toAsset('unknown'), undefined);
});

test('compact transfer owns its buffers, preserves surfaces/groups, and leaves JSON and source buffers intact', () => {
  const {registry, geometry} = fixture(1);
  const original = geometry.getAttribute('position').array;
  const compact = registry.toAsset('shared/box', 'review', true);
  const mesh = compact.geometries[0].geometry;
  assert.ok(mesh.positions instanceof Float32Array); assert.ok(mesh.indices instanceof Uint16Array);
  const {asset, transfer} = prepareAssetTransfer(compact);
  const received = structuredClone(asset, {transfer});
  assert.ok(transfer.every(buffer => buffer.byteLength === 0));
  assert.ok(mesh.positions.byteLength > 0); assert.ok(original.byteLength > 0);
  assert.deepEqual([...received.geometries[0].geometry.positions], [...mesh.positions]);
  assert.deepEqual(received.geometries[0].geometry.groups, mesh.groups);
  assert.ok(Array.isArray(registry.toAsset('shared/box','review').geometries[0].geometry.positions));
  assert.throws(() => prepareAssetTransfer(compact, 8), RangeError);
});

test('runtime caches geometry across nodes/builds/view modes and disposes only at the last release', () => {
  const {registry} = fixture(1);
  const asset = registry.toAsset('shared/box','review',true); const cache = new ThreeAssetResourceCache();
  const a = buildThreeAsset(asset,'lit',new Set(),cache); const b = buildThreeAsset(asset,'lit',new Set(),cache); const c = buildThreeAsset(asset,'normals',new Set(),cache);
  const mesh = [...a.nodes.values()].find(n => n.isMesh); const second = [...b.nodes.values()].find(n => n.isMesh);
  assert.equal(mesh.geometry,second.geometry); assert.equal(mesh.material,second.material);
  assert.equal(mesh.geometry.getAttribute('position').array,asset.geometries[0].geometry.positions);
  assert.equal(cache.geometries.size,1); assert.equal(cache.materials.size,2);
  let disposals=0; mesh.geometry.addEventListener('dispose',()=>disposals++);
  disposeThreeAsset(a.root); disposeThreeAsset(a.root); assert.equal(disposals,0);
  disposeThreeAsset(b.root); assert.equal(disposals,0); disposeThreeAsset(c.root); assert.equal(disposals,1);
  assert.equal(cache.materials.size,0); assert.equal(cache.geometries.size,0);
});

test('bridge negotiates progressive capture, deduplicates aliases, rejects oversized families and cancels queued work', async () => {
  const {registry} = fixture(2); const received=[]; let listener;
  const editor={postMessage(message,origin,transfer){received.push({message,origin,transfer});}};
  const old=globalThis.window;
  globalThis.window={location:{origin:'https://site.example'},parent:editor,opener:null,addEventListener(_,callback){listener=callback;},removeEventListener(){},setTimeout};
  try {
    const detach=attachSceneAssetRegistryBridge(registry,{allowedOrigins:['https://editor.example']});
    const send=(data,origin='https://editor.example',source=editor)=>listener({origin,source,data});
    const request={type:SPATIAL_REVIEW_REQUEST,profile:'scene',requestId:'metadata',progressive:true,geometryTransfer:{capability:'geometry-transfer-v1',maxBytes:65536}};
    send(request);send({...request,type:'sole:scene-asset-registry:request'});
    await new Promise(resolve=>setTimeout(resolve,5));
    const catalogs=received.filter(x=>x.message.type===SPATIAL_REVIEW_CATALOG);assert.equal(catalogs.length,1);assert.equal(catalogs[0].message.progressive,true);
    const family={type:SPATIAL_REVIEW_ASSET_REQUEST,requestId:'family',buildId:registry.buildId,assetId:'shared/box',profile:'scene'};
    send(family,'https://evil.example');send(family,'https://editor.example',{});
    await new Promise(resolve=>setTimeout(resolve,5));assert.equal(received.filter(x=>x.message.type===SPATIAL_REVIEW_ASSET_RESPONSE).length,0);
    send(family);await new Promise(resolve=>setTimeout(resolve,5));
    const response=received.find(x=>x.message.type===SPATIAL_REVIEW_ASSET_RESPONSE);assert.equal(response.message.ok,true);assert.ok(response.transfer.length>0);
    send({...request,requestId:'small',geometryTransfer:{capability:'geometry-transfer-v1',maxBytes:4}});await new Promise(resolve=>setTimeout(resolve,5));
    send({...family,requestId:'too-large'});await new Promise(resolve=>setTimeout(resolve,5));assert.equal(received.find(x=>x.message.requestId==='too-large').message.error,'too-large');
    const count=received.length;send({...request,requestId:'cancel'});detach();await new Promise(resolve=>setTimeout(resolve,5));assert.equal(received.length,count);
  } finally {globalThis.window=old;}
});
