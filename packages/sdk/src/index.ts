export { SceneAssetRegistry, type NavigationSequenceRegistration, type SceneAssetRegistration } from "./registry.js";
export type { SceneAssemblyRegistration } from "./assemblies.js";
export { attachSceneAssetRegistryBridge, type SceneAssetRegistryBridgeOptions } from "./bridge.js";
export { attachSpatialReviewDiscoveryBridge, type SpatialReviewDiscoveryBridgeOptions, type SpatialReviewDiscoveryRegistration } from "./discovery-bridge.js";
export { assetFromObject3DRoots, type Object3DAssetOptions } from "./serializer.js";
export * from "@alterno-dev/spatial-review-protocol";
export * from "./runtime.js";
export { prepareAssetTransfer } from "./geometry-transfer.js";
