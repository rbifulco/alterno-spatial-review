# `@alterno-dev/spatial-review`

Register semantic Three.js roots and expose them to compatible review tools.
The editor receives only explicitly registered objects.

## Scene ownership (implementation draft)

Use `registerAssembly()` for explicit transform-only place/room owners and
`parentAssemblyId` on actor registrations for their contents. Assemblies read an
existing root's pose or accept a `localTransform` snapshot; they never register
its geometry. `toScene()` exports hierarchy and world-space compatibility data;
`toScene(false)` provides a flattened fallback. The bridge negotiates
`scene-assemblies-v1` explicitly and preserves the old flat producer path.
Read the [complete example and migration rules](../../docs/ownership-first-scene.md)
before adopting this unreleased extension. Every rendered subtree still needs
exactly one geometry registration owner, independent of shared asset identity.

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
`toAsset(assetId, profile, compact)` serializes only the requested family;
`toReviewIndex(profile, false, true)` produces actors and asset descriptors
without serializing geometry. Existing catalog methods continue to return JSON
number arrays by default.

The runtime shares geometry and materials between live builds of the same
immutable definitions and view mode. Always release a built hierarchy with
`disposeThreeAsset(root)`. Use `cloneThreeAssetObject(root)` for a retained preview
clone, then dispose both hierarchies independently. Calling Three's raw
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
For direct protocol implementations, see the
[protocol package](../protocol/README.md).

These capabilities require upgrading the SDK used by the integrated website.
Upgrading an editor alone cannot enable partial catalogs on an older bridge.
This work includes a coordinated release Changeset; the development changes do
not publish or deploy a release automatically.

## Register camera journeys

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
    { id: "outside", name: "Outside", camera: [0, 1.7, 6], target: [0, 1.5, 0], fov: 50 },
    { id: "inside", name: "Inside", camera: [4, 1.7, 1], target: [0, 1.5, 0], fov: 44 },
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
        { id: "outside-camera", role: "stop", stopId: "outside", position: [0, 1.7, 6] },
        { id: "outside-out", role: "control-out", position: [1, 1.7, 6], sourceRef: "src/scene/rail.ts#outsideOut" },
        { id: "inside-in", role: "control-in", position: [3, 1.7, 2], sourceRef: "src/scene/rail.ts#insideIn" },
        { id: "inside-camera", role: "stop", stopId: "inside", position: [4, 1.7, 1] },
      ],
    },
    aim: { kind: "path-facing", lookDistance: 6, turnFraction: 0.18 },
  }],
});
```

Use stable IDs and `sourceRef` values for every authored control that should be
actionable. Set `editable: false` on explanatory points, or publish a `sampled`
curve when the runtime curve cannot be mapped back to authored controls.
