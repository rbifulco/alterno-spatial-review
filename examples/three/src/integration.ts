import * as THREE from "three";
import { SceneAssetRegistry, attachSceneAssetRegistryBridge } from "@alterno-dev/spatial-review";

const root = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
const registry = new SceneAssetRegistry("example-v1");
registry.register({ actorId: "example-cube", assetId: "example-cube", name: "Example cube", category: "Example", sourceRef: "src/integration.ts", root });
// This example explicitly authorizes the official hosted editor. Set false to opt out.
attachSceneAssetRegistryBridge(registry, { allowOfficialEditor: true });
