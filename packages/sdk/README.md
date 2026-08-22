# `@alterno-dev/spatial-review`

Register semantic Three.js roots and expose them to compatible review tools.
The editor receives only explicitly registered objects.

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
