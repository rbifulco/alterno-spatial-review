# Integrating a website

Install the SDK, expose discovery from the ordinary website entry page, and
register meaningful Three.js roots where they are created.

For buildings, rooms, and owned contents, follow the
[ownership-first scene contract](ownership-first-scene.md). Register transform-only
assemblies separately from render actors; categories do not establish ownership.
The assembly extension is accepted in
[Protocol change issue #11](https://github.com/rbifulco/alterno-spatial-review/issues/11)
and awaits package release. Retain flat exports when the installed SDK lacks it.

Before registering attached fixtures or parts, decide their
[assembly ownership](../agents/structuring-for-review.md#decide-assembly-ownership-explicitly).
Shared asset IDs and catalog categories do not parent actors. For legacy flat
captures, coordinated building/fixture edits require one assembly
actor with asset components, or an explicitly documented capability limitation
when the fixtures must remain independent scene actors.

## Review access and the official editor

Installing the npm package does not run a bridge or expose website data. The
authorization takes effect when the website calls the discovery or scene bridge
functions. Both bridges trust the exact official editor origin
`https://spatial-review.alterno.dev` by default.

This permits the hosted editor to embed the page and request only the discovery
metadata, registered scene/asset structures, and registered texture bytes that
the integration deliberately exposes. It does not grant access to arbitrary DOM,
application state, credentials, or unregistered scene objects.

Set `allowOfficialEditor: false` on both bridges to opt out. Origins for
self-hosted or additional editors remain opt-in through `allowedOrigins`.

The postMessage path embeds the discovery and live-capture pages. Their HTTP
framing policy must therefore allow the exact editor origin. When the site uses
a Content Security Policy, retain its existing entries and add the official
editor explicitly:

```http
Content-Security-Policy: frame-ancestors 'self' https://spatial-review.alterno.dev
```

`frame-ancestors` must be delivered as an HTTP response header; a `<meta>` tag
cannot set it. An `X-Frame-Options: DENY` or `SAMEORIGIN` header will still block
the cross-origin editor and must not be sent on pages intended for live review.
Scope framing permission to the discovery/capture pages when the application's
routing and discovery approach permits it. Never replace the exact origin with
`*` or broadly disable anti-framing protection.

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
  // This is the default, written explicitly to document the authorization.
  allowOfficialEditor: true,
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

// Optional: expose an authored camera journey for spatial motion review.
registry.registerNavigationSequence(arrivalJourneyForReview);

attachSceneAssetRegistryBridge(registry, {
  allowOfficialEditor: true,
});
```

Large or procedural scenes can publish actor bounds and overview/detail
metadata before generating geometry. Use `registerDeferred()` and configure the
bridge's concurrency and in-flight byte ceilings; its producer receives an
`AbortSignal`, request priority, and bounded progress callback. Keep eager
`register()` entries for any assets that must remain available to editors that
do not negotiate `asset-stream-v1`. The full API, cache identity, typed-instance
encoding, and migration rules are in
[Deferred asset streaming](deferred-asset-streaming.md).

A navigation sequence carries camera and aim trajectories, named stops,
relative segment timing, and FOV transitions. Keep its stop, segment, and point
IDs stable and give authored controls source references so feedback can map
back to code. Follow [Export navigation sequences](../agents/exporting-navigation-sequences.md)
for the complete semantic mapping and verification procedure.

After deployment, open the website directly in the hosted editor:

```ts
import { spatialReviewEditorUrl } from "@alterno-dev/spatial-review";

const reviewUrl = spatialReviewEditorUrl("https://project.example");
```

Optionally publish a discovery document with at least one of `scene`, `assets`,
or `liveCapture` for CLI validation and non-browser tools. The canonical
location is `/.well-known/spatial-review.json`. A project hosted below an origin,
such as GitHub Pages, may instead publish the document below its project path:

```text
https://owner.github.io/project/.well-known/spatial-review.json
```

The editor and CLI try the canonical origin-root location before the
project-relative location. Supply an explicit same-origin locator when the
document lives elsewhere:

```ts
const reviewUrl = spatialReviewEditorUrl("https://owner.github.io/project/", {
  discoveryUrl: "https://owner.github.io/project/review-manifest.json",
});

attachSpatialReviewDiscoveryBridge({
  name: "My spatial project",
  websiteUrl: "https://owner.github.io/project/",
  discoveryUrl: "/project/review-manifest.json",
  liveCapture: "/project/?spatial-review-capture=1",
});
```

The bridge's `discoveryUrl` is locator metadata and is not added to the
discovery JSON. Static discovery responses must allow CORS for the editor or CLI.
The editor falls back to the origin-checked browser bridge only after all static
candidates fail, so client-only integrations remain supported.

Resolve relative fields from the discovery document's final response URL, not
from the entered website URL. Keep redirects on the same origin. IDs must remain
stable between builds. For runtime or cloned textures, assign their original URL
to `texture.userData.sourceRef` when the texture itself no longer retains it.

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
and website can run on different ports. The official production default does
not implicitly trust Netlify preview domains, lookalike domains, or other review
tools; those require an exact additional origin.
