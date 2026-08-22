# Integrating a website

Install the SDK and register meaningful Three.js roots where they are created.

```ts
import { SceneAssetRegistry, attachSceneAssetRegistryBridge } from "@alterno-dev/spatial-review";

const registry = new SceneAssetRegistry("my-site-v1");
registry.register({
  actorId: "main-building",
  assetId: "main-building",
  name: "Main building",
  category: "Architecture",
  sourceRef: "src/scene/building.ts",
  root: mainBuilding,
});

attachSceneAssetRegistryBridge(registry, {
  allowedOrigins: ["http://localhost:3000", "https://review.alterno.dev"],
});
```

Publish `/.well-known/spatial-review.json` with at least one of `scene`,
`assets`, or `liveCapture`. IDs must remain stable between builds. For runtime
or cloned textures, assign the public URL to `texture.userData.sourceRef`.

Loopback origins are mutually accepted during local development, so the editor
and website can run on different ports before a production editor domain exists.
