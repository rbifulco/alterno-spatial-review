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
or cloned textures, assign their original URL to `texture.userData.sourceRef`
when the texture itself no longer retains it.

Live texture resources use the same `postMessage` bridge as the scene catalog.
The editor may try a direct CORS-enabled URL first, but CORS is not required:
it requests unavailable textures from the embedded website and the SDK returns
their encoded bytes as transferable `ArrayBuffer` values. Keep the capture page
alive while its live assets are being reviewed. During the catalog handshake,
the editor and SDK advertise their limits and use the lower value. The SDK
defaults to 16 MB per texture; `maxResourceBytes` can lower or raise its offer,
but it cannot override a lower editor limit.

Loopback origins are mutually accepted during local development, so the editor
and website can run on different ports before a production editor domain exists.
