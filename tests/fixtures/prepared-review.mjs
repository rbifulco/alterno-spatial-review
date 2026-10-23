import * as THREE from "three";
import { SceneAssetRegistry } from "../../packages/sdk/dist/index.js";

export const fixtureCaptureOptions = {
  websiteUrl: "https://fixture.example/",
  sourceRevision: "fixture-source-1",
  sourceGenerator: "canonical-registry-fixture",
  captureId: "fixture-capture-1",
  capturedAt: "2026-10-23T10:00:00.000Z",
  fidelity: { geometry: "source", materials: "approximate", limitations: ["Standard review materials approximate the source renderer's lighting."] },
};

/** Identical registry for the legacy bridge and prepared export. No synthetic
 * startup delay; geometry, texture bytes and navigation are deterministic. */
export function preparedReviewFixture() {
  const registry = new SceneAssetRegistry("fixture-build-1");
  const owner = new THREE.Group(); owner.position.x = 3;
  registry.registerAssembly({ assemblyId: "room", name: "Fixture room", sourceRef: "src/site.js#room", root: owner });
  const geometry = new THREE.BoxGeometry(1, 2, 1); geometry.name = "Shared box";
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="), (character) => character.charCodeAt(0));
  const texture = new THREE.Texture(); texture.uuid = "00000000-0000-4000-8000-000000000001";
  texture.name = "Captured red texel"; texture.userData.sourceBlob = new Blob([png], { type: "image/png" });
  texture.userData.sourceRef = "https://fixture.example/textures/red.png";
  const material = new THREE.MeshStandardMaterial({ name: "Textured surface", color: "#ffffff", roughness: 0.65, map: texture });
  const roots = [];
  for (let index = 0; index < 2; index++) {
    const root = new THREE.Group(); root.name = "Paired box"; root.position.set(index * 3, 0, 0);
    const first = new THREE.Mesh(geometry, material); first.name = "Front";
    const second = new THREE.Mesh(geometry, material); second.name = "Rear"; second.position.z = -2;
    root.add(first, second); owner.add(root); roots.push(root);
    registry.register({ actorId: `box-${index}`, assetId: "shared-box", name: `Box ${index}`, sourceRef: "src/site.js#boxes", category: "Fixture", roots: [root], parentAssemblyId: "room" });
  }
  const instanced = new THREE.InstancedMesh(geometry, material, 2); instanced.name = "Instanced boxes";
  instanced.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 3));
  instanced.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2, 0, 3));
  instanced.instanceMatrix.needsUpdate = true; owner.add(instanced);
  registry.register({ actorId: "instances", assetId: "instanced-box", name: "Instanced boxes", sourceRef: "src/site.js#instances", category: "Fixture", roots: [instanced], parentAssemblyId: "room" });
  registry.registerNavigationSequence({ id: "walk", name: "Fixture walk", sourceRef: "src/site.js#walk",
    stops: [{ id: "arrival", name: "Arrival", camera: [8, 4, 8], target: [3, 0, 0], fov: 50, sourceRef: "src/site.js#arrival" },
      { id: "detail", name: "Detail", camera: [4, 2, 4], target: [3, 0, 0], fov: 45, sourceRef: "src/site.js#detail" }],
    segments: [{ id: "arrival-detail", fromStopId: "arrival", toStopId: "detail", weight: 1, sourceRef: "src/site.js#walk",
      camera: { kind: "line", points: [{ id: "camera-arrival", role: "stop", stopId: "arrival", position: [8, 4, 8], sourceRef: "src/site.js#arrival" },
        { id: "camera-detail", role: "stop", stopId: "detail", position: [4, 2, 4], sourceRef: "src/site.js#detail" }] }, aim: { kind: "fixed-target", target: [3, 0, 0] } }],
  });
  return { registry, roots, geometry, material, texture, owner };
}

export default () => ({ registry: preparedReviewFixture().registry, options: fixtureCaptureOptions });
