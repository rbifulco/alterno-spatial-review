# Integrate a website

Use this reference for bridge configuration, discovery, framing, and texture
transport. Use [Install or update Spatial Review](../agents/install.md) for the
complete procedure and acceptance matrix.

## Configure review access

Use [Obtain permission](../agents/install.md#1-obtain-permission) as the source
of truth for authorization decisions and disclosed data.
Use the definitions of terminal result and settled demand in
[Terms](../agents/install.md#terms).

Package installation does not start a bridge. A started capture bridge sends a
readiness announcement to its parent or opener before request authorization.
The announcement contains build identity, counts, capabilities, and transfer
limits. It contains no protected catalog or texture bytes. The discovery bridge
sends no readiness announcement.

The official editor origin is `https://spatial-review.alterno.dev`.
Use the recorded permission decision for `allowOfficialEditor` and
`allowedOrigins`.

A loopback website accepts requests from other loopback origins only when
`allowLoopbackPeers: true`. Use this explicit opt-in only for local development.
Production websites use the configured exact-origin policy.

Apply the framing decision from the permission record. When the website uses
Content Security Policy, add the approved origin to the HTTP response header:

```http
Content-Security-Policy: frame-ancestors 'self' https://spatial-review.alterno.dev
```

A `<meta>` element cannot set `frame-ancestors`. Remove a conflicting
`X-Frame-Options` header from the review routes. Keep anti-framing protection on
other routes. Use exact origins. Keep wildcard origins out of the policy.

**Complete when:** bridge options and framing headers match the permission
record. Other routes keep their existing anti-framing protection.

## Configure discovery and capture

Select browser discovery or static discovery for each workflow. Do not add both
paths unless named consumers require both. This example uses browser discovery.
Keep its bridge configuration in one integration module:

```ts
import {
  SceneAssetRegistry,
  attachSceneAssetRegistryBridge,
  attachSpatialReviewDiscoveryBridge,
  createSpatialReviewEditorAuthorization,
} from "@alterno-dev/spatial-review";

const authorization = createSpatialReviewEditorAuthorization({
  allowOfficialEditor: true, // Use the recorded permission decision.
  allowedOrigins: [],
  allowLoopbackPeers: false, // Opt in only for cross-origin local development.
  advertiseEditorOriginPolicy: {
    // Explicit public disclosure; must equal the complete finite runtime set.
    publicOrigins: ["https://spatial-review.alterno.dev"],
  },
});

attachSpatialReviewDiscoveryBridge({
  name: "My spatial project",
  liveCapture: "/?spatial-review-capture=1",
}, authorization);

const registry = new SceneAssetRegistry("release-or-commit-id");

registry.register({
  actorId: "main-building",
  assetId: "main-building",
  name: "Main building",
  category: "Architecture",
  sourceRef: "src/scene/building.ts#mainBuilding",
  root: mainBuilding,
});

registry.registerNavigationSequence(arrivalJourneyForReview);

const detachCapture = attachSceneAssetRegistryBridge(registry, {
  authorization,
  maxGeometryBytes: 64 * 1024 * 1024,
  maxConcurrentAssetRequests: 2,
  maxInFlightBytes: 96 * 1024 * 1024,
  maxQueuedAssetRequests: 24,
});
```

The frozen `authorization` is reused by both bridges. Runtime `allowedOrigins`
are never advertised by default. Browser discovery derives a policy only when
`advertiseEditorOriginPolicy.publicOrigins` explicitly discloses exactly the
complete finite runtime set; a mismatch fails during configuration. Dynamic
`allowOrigin` authorization always leaves policy unspecified. Raw bridge option
objects remain supported for runtime compatibility but cannot claim alignment
with an explicit discovery policy. Separately deployed pages and static
discovery documents cannot share the in-memory object; generate their public
policy from the same reviewed deployment decision and verify it independently.
Never use discovery metadata as authorization input. See
[Editor-origin compatibility and live-capture rejection](editor-origin-authorization.md)
for validation, consumer state, and mixed-version rules.

This example uses the current catalog lifecycle. It completes registration
before bridge attachment. The first requested catalog becomes `catalog-ready`.

Apply the authoritative lifecycle in
[Implement the representation](../agents/install.md#4-implement-the-representation).
That procedure defines the required registration order and status limits.

Call each detach function on unmount or hot reload. Release capture-owned
resources after the last capture bridge detaches.

Use `registerAssembly()` for transform-only owners when the installed SDK
supports `scene-assemblies-v1`. The bridge negotiates hierarchy with each
consumer. Use
[Structure a website for review](../agents/structuring-for-review.md) for actor,
asset, ownership, and material decisions.

Use `registerDeferred()` for expensive geometry. Configure queue, concurrency,
per-request byte, and aggregate byte limits. Apply
[Deferred asset streaming](deferred-asset-streaming.md).

**Complete when:** one integration module owns the capture bridge, the registry,
the selected lifecycle, and teardown. When the workflow uses browser discovery,
the same module also owns the discovery bridge.

## Publish static discovery

The discovery bridge is sufficient for browser review. Publish a discovery
document when CLI validation or non-browser discovery is required. Also publish
one when the ordinary page must not load review code. When the static document
is sufficient for the selected consumers, do not add a browser discovery bridge.

The canonical path is:

```text
/.well-known/spatial-review.json
```

Use a project-relative path when the application cannot write to the origin
root:

```text
https://owner.github.io/project/.well-known/spatial-review.json
```

The editor and CLI try the origin-root document before the project-relative
document. An explicit same-origin locator can select another path.

Resolve relative fields from the final discovery-document URL. Keep redirects
on the same origin. Enable CORS when a browser requests a static discovery
document across origins. The CLI does not require CORS.

Some deployment systems omit dot-directories. For GitHub Pages Actions, use:

```yaml
- uses: actions/upload-pages-artifact@v5
  with:
    path: dist
    include-hidden-files: true
```

After deployment, request each advertised URL directly. Verify its response and
schema. Browser fallback does not prove that an advertised static URL works.

**Complete when:** every advertised static URL returns a valid document from
its deployed location.

## Transfer textures

Keep an original stable, credential-free URL in `texture.userData.sourceRef`
when one exists.
The editor can try that URL before it requests the registered live resource.

Before bridge attachment, inspect registered texture `sourceRef`, `requestUrl`,
`currentSrc`, and `src` strings. The serializer copies supported strings into
the catalog. It does not redact URL user information, signatures, query tokens,
or session identifiers. For a sensitive URL, use a capture-only texture with
cleared URL metadata and an exportable decoded source. Transfer that source
through the capture bridge.

A direct texture response must meet these conditions:

- The response status is successful.
- `Content-Type` starts with `image/`.
- The response body contains decodable image bytes.
- CORS permits the consumer when direct cross-origin loading is intended.

Inspect the deployed response headers for one representative texture instead
of relying on its file extension. If a successful `sourceRef` response has a
non-image MIME type, the SDK rejects those fetched bytes and uses an exportable
already-decoded registered source when one is available.

The capture bridge can transfer generated textures and textures without direct
CORS access. Make the decoded texture source exportable before the material
representation becomes available.

A safe decoded-image fallback has an image MIME type, decodable bytes, no
credential-bearing source string, and a size within the negotiated resource
limit. An actionable texture failure identifies the asset, material, map slot,
attempted direct and live paths, and terminal reason.

The SDK creates a resource ID when it serializes a supported texture map. The ID
does not prove that transferable bytes are available. Verify the live result.
Keep the capture page alive while the consumer requests live resources. Request
each ID within the installed SDK's delivery grace.

Deferred live texture owners have a 60-second delivery grace in the current
SDK. After that grace, the bounded texture-owner cache can evict them. Geometry
snapshots use separate entry and byte bounds. Texture-owner eviction invalidates
the cached representation. Request the representation again to get current
resource IDs. Give a changed texture representation a new revision.

Test the representative texture path in the integration plan. When a failure
class occurs, apply its required result. Do not inject every failure class during
a standard installation.

| Failure | Required result |
| --- | --- |
| Direct URL returns an error | The capture bridge succeeds or the consumer reports both failed paths. |
| Direct URL has a non-image MIME type | The SDK uses a safe decoded-image fallback when supported, or reports an actionable failure. |
| Texture has no exportable source | The integration records an unsupported appearance limitation. |
| Published resource ID is unavailable | Classify the cause. A missing current producer registration fails the integration. An expired ID requires a regenerated representation and current ID. An ID that works in another view order identifies a consumer or editor defect. |
| Transient resource failure | Retry reaches a terminal result without changing view order. |

The negotiated peer limits bound each texture response. `maxResourceBytes` can
change the producer offer. It cannot raise a lower consumer limit.

**Complete when:** every decision-relevant texture has a successful direct or
live result, or an explicit unsupported result. Every retry reaches a terminal
result.

## Verify the deployed integration

Open the website directly and through the approved editor. Use
`spatialReviewEditorUrl(websiteUrl)` to create an official-editor link.

Run the production transport and browser checks in
[Verify the review loop](../agents/install.md#6-verify-the-review-loop). Record
direct discovery, browser discovery, direct texture, live texture, authorization,
framing, refresh, and teardown as separate results.

**Complete when:** the integration plan separates each result and identifies
every unverified production check.
