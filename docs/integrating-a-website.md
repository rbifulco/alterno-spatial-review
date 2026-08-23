# Integrating a website

Install the SDK, expose discovery from the ordinary website entry page, and
register meaningful Three.js roots where they are created.

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

attachSceneAssetRegistryBridge(registry, {
  allowOfficialEditor: true,
});
```

After deployment, open the website directly in the hosted editor:

```ts
import { spatialReviewEditorUrl } from "@alterno-dev/spatial-review";

const reviewUrl = spatialReviewEditorUrl("https://project.example");
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
and website can run on different ports. The official production default does
not implicitly trust Netlify preview domains, lookalike domains, or other review
tools; those require an exact additional origin.
