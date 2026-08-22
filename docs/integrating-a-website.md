# Integrating a website

Install the SDK, expose discovery from the ordinary website entry page, and
register meaningful Three.js roots where they are created.

```ts
import {
  SceneAssetRegistry,
  attachSceneAssetRegistryBridge,
  attachSpatialReviewDiscoveryBridge,
} from "@alterno-dev/spatial-review";

attachSpatialReviewDiscoveryBridge({
  name: "My spatial project",
  liveCapture: "/?spatial-review-capture=1",
}, {
  allowedOrigins: ["http://localhost:3000", "https://review.alterno.dev"],
});

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

Optionally publish `/.well-known/spatial-review.json` with at least one of
`scene`, `assets`, or `liveCapture` for CLI validation and non-browser tools.
IDs must remain stable between builds. For runtime or cloned textures, assign
their original URL to `texture.userData.sourceRef` when the texture itself no
longer retains it.

The discovery bridge makes the live path fully client-only: the editor embeds
the supplied website URL and requests this metadata with `postMessage`. The
well-known document remains useful for CLI validation and as a direct CORS
optimization, but the editor does not require CORS or a discovery backend.

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
