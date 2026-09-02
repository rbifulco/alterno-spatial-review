import * as THREE from "three";

const canvas = document.querySelector("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(720, 520, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171b);
const camera = new THREE.PerspectiveCamera(48, 720 / 520, 0.1, 100);
camera.position.set(3.5, 2.4, 5.5);
camera.lookAt(0, 0, 0);

const texture = new THREE.DataTexture(
  new Uint8Array([
    190, 85, 48, 255, 238, 188, 92, 255,
    238, 188, 92, 255, 190, 85, 48, 255,
  ]),
  2,
  2,
);
texture.needsUpdate = true;
texture.name = "Fixture checker texture";

const material = new THREE.MeshStandardMaterial({
  name: "Fixture terracotta",
  color: 0xffffff,
  map: texture,
  roughness: 0.72,
});
const root = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
root.name = "Fixture cube";
root.position.x = 0.25;
scene.add(root);
scene.add(new THREE.HemisphereLight(0xffffff, 0x443322, 2.2));
renderer.render(scene, camera);

const fixtureParams = new URLSearchParams(location.search);
const reviewEnabled = fixtureParams.get("spatial-review") !== "off";
const sameDocumentEnabled = fixtureParams.get("spatial-review-same-document") === "1";
const captureEnabled = sameDocumentEnabled
  || fixtureParams.get("spatial-review-capture") === "1";
let registry;
if (reviewEnabled) {
  const {
    SceneAssetRegistry,
    attachSceneAssetRegistryBridge,
    attachSpatialReviewDiscoveryBridge,
  } = await import("@alterno-dev/spatial-review");

  // This local fixture authorizes no production editor. Its two loopback origins
  // use the SDK's documented local-development exception.
  const authorization = { allowOfficialEditor: false };
  attachSpatialReviewDiscoveryBridge({
    name: "Spatial Review new-install fixture",
    liveCapture: sameDocumentEnabled
      ? "/examples/three/?spatial-review-same-document=1"
      : "/examples/three/?spatial-review-capture=1",
  }, authorization);

  if (captureEnabled) {
    registry = new SceneAssetRegistry("guidance-new-install-v1");
    registry.register({
      actorId: "fixture-cube",
      assetId: "fixture-cube",
      name: "Fixture cube",
      category: "Guidance fixture",
      sourceRef: "examples/three/src/browser-fixture.js#root",
      root,
    });
    registry.registerNavigationSequence({
      id: "fixture-arrival",
      name: "Fixture arrival",
      category: "Guidance fixture",
      sourceRef: "examples/three/src/browser-fixture.js#fixture-arrival",
      stops: [
        { id: "start", name: "Start", camera: [3.5, 2.4, 5.5], target: [0, 0, 0], fov: 48, sourceRef: "examples/three/src/browser-fixture.js#start" },
        { id: "detail", name: "Detail", camera: [2.2, 1.4, 3.2], target: [0, 0, 0], fov: 42, sourceRef: "examples/three/src/browser-fixture.js#detail" },
      ],
      segments: [{
        id: "start-detail",
        fromStopId: "start",
        toStopId: "detail",
        weight: 1,
        lensStart: 0.55,
        camera: {
          kind: "line",
          points: [
            { id: "start-camera", role: "stop", stopId: "start", position: [3.5, 2.4, 5.5], sourceRef: "examples/three/src/browser-fixture.js#start" },
            { id: "detail-camera", role: "stop", stopId: "detail", position: [2.2, 1.4, 3.2], sourceRef: "examples/three/src/browser-fixture.js#detail" },
          ],
        },
        aim: { kind: "fixed-target", target: [0, 0, 0] },
      }],
    });

    const detachCapture = attachSceneAssetRegistryBridge(registry, authorization);
    window.addEventListener("pagehide", detachCapture, { once: true });
  }
}

document.querySelector("#fixture-status").value = "fixture-ready";
document.documentElement.dataset.fixtureReadyMs = String(performance.now());
window.addEventListener("load", () => {
  const navigation = performance.getEntriesByType("navigation")[0];
  document.documentElement.dataset.fixtureLoadMs = String(
    navigation?.duration ?? performance.now(),
  );
}, { once: true });
window.spatialReviewFixture = {
  reviewEnabled,
  sameDocumentEnabled,
  captureEnabled,
  buildId: registry?.buildId ?? null,
  actors: registry?.size ?? 0,
  journeys: registry?.navigationSize ?? 0,
};
