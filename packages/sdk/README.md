# `@alterno-dev/spatial-review`

Register semantic Three.js roots and expose them to compatible review tools.
The editor receives only explicitly registered objects.

## Official editor authorization

Installing this package alone does not expose page data or start a bridge.
Calling `attachSpatialReviewDiscoveryBridge()` or
`attachSceneAssetRegistryBridge()` enables the corresponding browser bridge.
By default, both functions trust the exact official Alterno editor origin:

```text
https://spatial-review.alterno.dev
```

That origin may request discovery metadata, registered scene and asset
structures, and registered texture bytes. It does not receive arbitrary DOM,
application state, credentials, or unregistered Three.js objects.

Write `allowOfficialEditor: true` in integration code when you want the
authorization to remain explicit. Set it to `false` on both bridges to opt out.
Use `allowedOrigins` to authorize any additional self-hosted editor origins.

This default begins in version 0.3.0. The minor version boundary prevents
existing `^0.2.x` consumers from receiving the new authorization through an
automatic patch upgrade. Choose an explicit `allowOfficialEditor` value when
upgrading.

```ts
attachSpatialReviewDiscoveryBridge(registration, {
  allowOfficialEditor: true,
});

attachSceneAssetRegistryBridge(registry, {
  allowOfficialEditor: true,
});
```

`spatialReviewEditorUrl(websiteUrl)` creates a hosted-editor deep link that
connects to the supplied website. It does not bypass the website's bridge origin
checks.

The browser bridge also requires the relevant website page to permit framing by
the editor. This is a separate site-security decision; the SDK does not modify
Content Security Policy or `X-Frame-Options` headers.

`attachSpatialReviewDiscoveryBridge()` lets a client-only editor discover the
website's live-capture URL through an embedded landing page. A direct CORS fetch
of `/.well-known/spatial-review.json` is optional rather than required.

Registered texture maps receive session resource IDs. Compatible editors can
request their bytes over the origin-checked browser bridge, so integrated
websites do not need to expose texture CORS headers. Direct URL loading remains
an optional editor optimization. The editor and website negotiate a per-resource
byte limit during the catalog handshake and enforce the lower offer.

The package also exports `buildThreeAsset()`, `makeAssetGeometry()`, and
`disposeThreeAsset()` for websites that render an engine-neutral
`ReviewAsset3D` contract back into a Three.js hierarchy.
