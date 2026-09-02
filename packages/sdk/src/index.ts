export {
  SceneAssetRegistry,
  type DeferredSceneAssetRegistration,
  type NavigationSequenceRegistration,
  type SceneAssetRegistration,
  type SceneAssetRepresentationContext,
  type SceneAssetRepresentationProgress,
} from "./registry.js";
export type { SceneAssemblyRegistration } from "./assemblies.js";
export { attachSceneAssetRegistryBridge, type SceneAssetRegistryBridgeOptions } from "./bridge.js";
export { attachSpatialReviewDiscoveryBridge, type SpatialReviewDiscoveryBridgeOptions, type SpatialReviewDiscoveryRegistration } from "./discovery-bridge.js";
export {
  createSpatialReviewEditorAuthorization,
  spatialReviewEditorOriginAllowed,
  spatialReviewEditorOriginPolicy,
  type SpatialReviewEditorAuthorization,
  type SpatialReviewEditorAuthorizationConfiguration,
  type SpatialReviewEditorAuthorizationOptions,
} from "./origin-authorization.js";
export { assetFromObject3DRoots, type Object3DAssetOptions } from "./serializer.js";
export * from "@alterno-dev/spatial-review-protocol";
export * from "./runtime.js";
export { prepareAssetTransfer, type PrepareAssetTransferOptions } from "./geometry-transfer.js";
