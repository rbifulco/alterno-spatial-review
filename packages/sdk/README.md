# `@alterno-dev/spatial-review`

Register semantic Three.js roots and expose them to compatible review tools.
The editor receives only explicitly registered objects.

## Scene ownership

Use `registerAssembly()` for explicit transform-only place/room owners and
`parentAssemblyId` on actor registrations for their contents. Assemblies read an
existing root's pose or accept a `localTransform` snapshot; they never register
its geometry. `toScene()` exports hierarchy and world-space compatibility data;
`toScene(false)` provides a flattened fallback. The bridge negotiates
`scene-assemblies-v1` explicitly and preserves the old flat producer path.
Read the [complete example and migration rules](../../docs/ownership-first-scene.md)
before adopting this capability. Apply the registration-owner rule in
[Choose actor boundaries](../../agents/structuring-for-review.md#choose-actor-boundaries).

## Official editor authorization

Use [Obtain permission](../../agents/install.md#1-obtain-permission) for the
authorization decision. This section describes the package behavior.

Installing this package alone does not expose page data or start a bridge.
`attachSpatialReviewDiscoveryBridge()` starts the discovery bridge.
`attachSceneAssetRegistryBridge()` starts the capture bridge. In this document,
browser bridge means either interface.
By default, both functions trust the exact official Alterno editor origin:

```text
https://spatial-review.alterno.dev
```

Through the discovery bridge, that origin may request discovery metadata.
Through the capture bridge, it may request registered roots and their supported
descendants. Capture data can include scene and asset structures, descendant
geometry, materials, textures, and registered texture bytes. Neither bridge
exposes arbitrary DOM, cookies, storage, unrelated application state, or
objects outside registered roots. The serializer can copy registered texture
`sourceRef`, `requestUrl`, `currentSrc`, and `src` strings. The integration must
remove credentials and secrets from those strings before bridge attachment.

`allowOfficialEditor: true` enables the official editor origin.
`allowOfficialEditor: false` disables it. `allowedOrigins` adds exact
self-hosted editor origins. `allowLoopbackPeers: true` explicitly enables
cross-origin loopback development; it defaults to `false`.

Both bridges always accept the producer's own origin. A different loopback
origin is a separate security principal and is accepted only with the explicit
loopback opt-in. Earlier SDK versions allowed cross-origin loopback implicitly;
existing local integrations must set `allowLoopbackPeers: true` to retain that
behavior after upgrading.

```ts
import { createSpatialReviewEditorAuthorization } from "@alterno-dev/spatial-review";

const authorization = createSpatialReviewEditorAuthorization({
  allowOfficialEditor: true,
  allowedOrigins: [],
  allowLoopbackPeers: false,
  advertiseEditorOriginPolicy: {
    publicOrigins: ["https://spatial-review.alterno.dev"],
  },
});

attachSpatialReviewDiscoveryBridge(registration, authorization);
attachSceneAssetRegistryBridge(registry, authorization);
```

`spatialReviewEditorUrl(websiteUrl)` creates a hosted-editor deep link that
connects to the supplied website. It does not bypass the website's bridge origin
checks.

`allowedOrigins` accepts only exact canonical origins: no credentials, paths,
queries, fragments, wildcards, default-port aliases, or insecure non-loopback
HTTP. Invalid input fails before a bridge listener is attached.

For browser discovery, runtime origins remain private by default. The SDK
derives `capabilities.liveCapture.editorOriginPolicy` only from a frozen shared
authorization created with an explicit
`advertiseEditorOriginPolicy.publicOrigins` disclosure. That public list must
exactly match every finite non-same-origin runtime origin, including the
official editor when enabled. Reuse the same authorization with both bridges.
Raw option objects still configure runtime access but never advertise a policy,
and cannot accompany an explicit policy. Dynamic `allowOrigin` authorization
always remains unspecified. Discovery metadata never authorizes a request. A
recognized unauthorized catalog handshake with a valid request ID receives a
correlated, exact-origin
`spatial-review:connection-rejected` response and no scene data. See the
[complete authorization contract](../../docs/editor-origin-authorization.md).

When an editor embeds a website page, that page must permit framing by the
editor. An editor that opens the page as a popup can use the opener bridge and
does not require a framing exception. The SDK does not modify Content Security
Policy or `X-Frame-Options` headers.

`attachSpatialReviewDiscoveryBridge()` lets a client-only editor discover the
website's live-capture URL through an embedded landing page. A direct CORS fetch
of `/.well-known/spatial-review.json` is optional rather than required.

For a project-path or custom static manifest, set `discoveryUrl` on the bridge
registration. It must be an HTTP(S), credential-free URL on the website origin;
relative values resolve below the normalized website project path. The bridge
returns this locator alongside its message, but it never inserts it into the
discovery document itself:

```ts
attachSpatialReviewDiscoveryBridge({
  name: "GitHub Pages project",
  websiteUrl: "https://owner.github.io/project/",
  discoveryUrl: ".well-known/spatial-review.json",
  liveCapture: "../?spatial-review-capture=1",
});
```

Editors first try an explicit locator, the canonical origin-root locator, and
the project-relative locator in order. They use the discovery bridge only after
those static candidates fail. Existing root-only integrations and registrations
without `discoveryUrl` retain their previous behavior.

Registered texture maps receive session resource IDs. Compatible editors can
request their bytes over the origin-checked capture bridge, so integrated
websites do not need to expose texture CORS headers. Direct URL loading remains
an optional editor optimization. The editor and website negotiate a per-resource
byte limit during the catalog handshake and enforce the lower offer.

A registered `sourceRef` is expected to return a successful response whose
`Content-Type` starts with `image/`. Check that header on the deployed asset,
especially when a CDN or static host serves WebP or other image formats. When a
successful response instead has a non-image MIME type, the SDK discards those
response bytes and tries the already-decoded registered texture source. Canvas,
image, bitmap, video, and supported RGB/RGBA data sources can be encoded as a
safe image fallback. If neither path is exportable, the resource response names
the MIME mismatch and remediation. Both direct and decoded paths enforce the
negotiated byte limit.

As an installation check, open one representative textured asset in the editor
and confirm that its live texture reports ready and matches the website. This
check complements inspecting the deployed `Content-Type`; a resource ID alone
does not prove that transferable texture bytes are available.

The package also exports `buildThreeAsset()`, `makeAssetGeometry()`, and
`disposeThreeAsset()` for websites that render an engine-neutral
`ReviewAsset3D` contract back into a Three.js hierarchy.

`buildThreeAsset()` remains synchronous and never fetches texture references.
Use `buildThreeAssetAsync()` when a trusted integration wants to hydrate the
protocol's supported material-map slots:

```ts
const textureCache = new Map<string, Promise<THREE.Texture>>();
const built = await buildThreeAssetAsync(asset, {
  resolveTexture(map) {
    if (!map.sourceRef) throw new Error("This integration requires a source URL.");
    const url = new URL(map.sourceRef, approvedAssetBaseUrl);
    if (url.origin !== approvedAssetBaseUrl.origin) throw new Error("Cross-origin texture rejected.");
    let pending = textureCache.get(url.href);
    if (!pending) {
      pending = new THREE.TextureLoader().loadAsync(url.href);
      textureCache.set(url.href, pending);
    }
    return pending;
  },
});
```

The SDK calls only the supplied resolver; source allowlists, credentials,
response-size limits, decoding, and live `resourceId` lookup remain application
policy. Resolver results are caller-owned cache entries. Each material binding
receives a Texture clone that shares the decoded source while retaining its own
wrap, repeat, offset, rotation, `flipY`, and color-space settings. Existing
hierarchies can use `hydrateThreeAssetTextures(asset, built, resolver)` directly.

## Large scenes and resource ownership

Register each independently reviewable actor with its own stable `actorId`.
Actors may share an `assetId` when they use the same canonical model. The
catalog sends one asset definition and each actor's own source transform and
world bounds; sharing the asset does not merge the actors or their feedback.

The registry caches world transforms, bounds and serialized asset families.
Normal transform/hierarchy changes, geometry attribute identity/version changes,
instance updates and material changes are detected on the next request. A cheap
hierarchy inspection still runs; unchanged actors do not repeat their bounds
calculations. Use the usual `attribute.needsUpdate = true` after editing attribute
data. If changing raw buffers without updating their version, explicitly call:

```ts
registry.invalidate("actor-id"); // or invalidate() for all registered actors
registry.unregister("removed-actor-id");
```

`registry.cacheMetrics` exposes the latest inspection's matrix, bounds and
geometry calculation counts and the number of cached asset variants.
`toAsset(assetId, profile, compact)` serializes only the requested profile;
`toReviewIndex(profile, false, true)` produces actors and asset descriptors
without serializing geometry. Existing catalog methods continue to return JSON
number arrays by default.

The runtime shares geometry and materials between live builds of the same
immutable definitions and view mode. Always release a built hierarchy with
`disposeThreeAsset(root)`. Use `cloneThreeAssetObject(root)` for a retained
preview clone. Dispose both hierarchies independently. Calling Three's raw
`geometry.dispose()` or `material.dispose()` on a shared resource bypasses this
ownership contract. A `ThreeAssetResourceCache` can be supplied as the fourth
argument of `buildThreeAsset` to scope sharing explicitly. Resources are released
when the last owner is disposed, not kept indefinitely.

## Progressive live geometry

Compatible editors negotiate `progressive-assets-v1` and
`geometry-transfer-v1` in the catalog handshake. They first receive actors,
bounds and asset descriptors, then request individual scene or review families.
Geometry attributes use transferable typed arrays; transfer buffers are owned
copies, so the source scene and registry's reusable cache remain attached.
Older editors continue to receive the complete JSON-compatible catalog.

The existing origin and window-source checks apply to the new requests. The
bridge negotiates a geometry byte limit (64 MiB by default), checks family size
before allocating its serialized buffers, bounds pending requests, and cancels
queued work on detach. Texture resources keep their separate negotiated limit.
Completed deferred geometry uses a 32-entry / 64 MiB LRU. Because texture bytes
are requested after geometry delivery, generated texture owners receive a
60-second delivery grace and then use a separate 64-owner / approximately
256 MiB LRU. Resource eviction invalidates the matching geometry/revision reuse
so a later request regenerates valid IDs; detaching the final bridge clears all
deferred session resources.
For direct protocol implementations, see the
[progressive asset family contract](../protocol/README.md#progressive-asset-families).

These capabilities require upgrading the SDK used by the integrated website.
Upgrading an editor alone cannot enable partial catalogs on an older bridge.
This work includes a coordinated release Changeset; the development changes do
not publish or deploy a release automatically.

For geometry that should not exist until requested, use
`registry.registerDeferred()`. Negotiated `asset-stream-v1` catalogs expose its
world transform, bounds, and immutable overview/detail revisions before calling
the asynchronous producer. The producer receives the lower byte budget, request
priority, an `AbortSignal`, and progress callback. The bridge enforces bounded
priority queues, aggregate in-flight bytes, cancellation, and revision-aware
`notModified` responses. Configured and derived aggregate limits are clamped
to the protocol ceiling. Streamed instance matrices use owned `Float32Array`
buffers, and the byte budget reserves every owned copy when source views alias
one buffer; ordinary JSON exports retain nested number arrays.

Cancellation releases the bridge's queue and aggregate-byte reservation
immediately and suppresses late producer results. Producers remain responsible
for observing their `AbortSignal` and disposing only review-owned temporary
work. Live texture IDs are leased to the serialized asset/representation that
advertises them; superseded catalog resources are forgotten without disposing
textures owned by the website.

Read [Deferred asset streaming](../../docs/deferred-asset-streaming.md) for the
registration example, wire order, status lifecycle, cache identity, migration
fallback, and security limits.

## Register camera journeys

Use [Export navigation sequences](../../agents/exporting-navigation-sequences.md)
as the source of truth for identity, source mapping, editability, and curve
selection. The example below shows the SDK field shape.

`registerNavigationSequence()` exposes an engine-neutral, semantically named
camera journey alongside registered scene actors. A sequence may use linear,
quadratic Bézier, cubic Bézier, Catmull–Rom, or read-only sampled curves. It also
describes how the camera aims, how long each segment feels, and when its FOV
transition begins.

```ts
registry.registerNavigationSequence({
  id: "arrival",
  name: "Arrival journey",
  sourceRef: "src/scene/rail.ts#arrivalJourney",
  stops: [
    { id: "outside", name: "Outside", camera: [0, 1.7, 6], target: [0, 1.5, 0], fov: 50, sourceRef: "src/scene/rail.ts#outside" },
    { id: "inside", name: "Inside", camera: [4, 1.7, 1], target: [0, 1.5, 0], fov: 44, sourceRef: "src/scene/rail.ts#inside" },
  ],
  segments: [{
    id: "outside--inside",
    fromStopId: "outside",
    toStopId: "inside",
    weight: 1.4,
    lensStart: 0.2,
    camera: {
      kind: "cubic-bezier",
      points: [
        { id: "outside-camera", role: "stop", stopId: "outside", position: [0, 1.7, 6], sourceRef: "src/scene/rail.ts#outside" },
        { id: "outside-out", role: "control-out", position: [1, 1.7, 6], sourceRef: "src/scene/rail.ts#outsideOut" },
        { id: "inside-in", role: "control-in", position: [3, 1.7, 2], sourceRef: "src/scene/rail.ts#insideIn" },
        { id: "inside-camera", role: "stop", stopId: "inside", position: [4, 1.7, 1], sourceRef: "src/scene/rail.ts#inside" },
      ],
    },
    aim: { kind: "path-facing", lookDistance: 6, turnFraction: 0.18 },
  }],
});
```
