# `@alterno-dev/spatial-review-protocol`

Versioned, engine-neutral TypeScript contracts and URL normalization for
Alterno Spatial Review.

## Ownership-first scenes (implementation draft)

The optional `scene-assemblies-v1` capability adds transform-only assemblies,
explicit actor ownership, and parent-local poses without changing the existing
world-space `transform` field. `SceneOwnershipOperation` separates assembly
placement, actor placement, and reparenting intent. Shared designs remain assets.
`validateSceneOwnership()` validates graph and transform consistency. Read the
[contract, compatibility, migration, and acceptance gate](../../docs/ownership-first-scene.md)
before using this unreleased extension.

The browser discovery request/response messages let an embedded website
advertise its normalized discovery document without CORS or an editor backend.

## Discovery locators

`discoveryUrlForWebsite(websiteUrl)` remains the compatibility helper for the
canonical origin-root document:

```text
https://example.com/.well-known/spatial-review.json
```

Use `discoveryUrlsForWebsite(websiteUrl, explicitDiscoveryUrl?)` when connecting
to a deployed project. It returns de-duplicated candidates in this order:

1. an explicitly supplied, same-origin HTTP(S) locator;
2. the canonical origin-root document;
3. `.well-known/spatial-review.json` below the website's project path.

Query strings and fragments on the website URL do not become part of the
project locator. A fragment on an explicit locator is removed. Cross-origin
locators, embedded credentials, and non-HTTP(S) URLs are rejected before any
request is made.

After a candidate succeeds, pass that response's actual URL to
`normalizeSpatialReviewDiscovery()`. Relative `websiteUrl`, `scene`, `assets`,
and `liveCapture` fields are resolved from the successful document, including
after a same-origin redirect. This supports project hosting such as
`https://owner.github.io/project/` without changing existing root-hosted
producers.

`spatialReviewEditorUrl()` accepts `{ workspace, discoveryUrl }` to carry an
explicit locator into the hosted editor. The prior workspace-string argument
continues to work.

The live browser protocol includes an optional `resource-transfer-v1`
capability. Texture map descriptors carry resource IDs, and request/response
messages move encoded image bytes with transferable `ArrayBuffer` values. Both
peers advertise `maxBytes` during the catalog handshake and use the lower limit.

## Progressive asset families

The optional `progressive-assets-v1` and `geometry-transfer-v1` capabilities
extend the existing live catalog exchange without changing the default JSON
path:

1. The editor requests a catalog with `progressive: true` and a
   `geometryTransfer` offer containing the capability and `maxBytes`.
2. A supporting website confirms the capabilities and negotiated limit in its
   catalog response. That catalog includes actor metadata, world bounds, and
   asset descriptors with empty node/material lists.
3. The editor sends `alterno:spatial-review:asset-request` for a specific
   `assetId`, `profile`, `buildId`, and unique `requestId`.
4. The website answers with `alterno:spatial-review:asset-response`, matching
   those identities, and either an asset or a bounded error result.

Positions, normals and UVs accept `Float32Array`; indices accept `Uint16Array`
or `Uint32Array`. Legacy `number[]` geometry remains valid. Typed buffers are
transferred through the browser's structured-clone channel, not encoded as JSON.
Each response owns its transferable buffers; sending a response must not detach
the source renderer or a reusable catalog cache. JSON files must represent
attributes as number arrays.

Receivers must validate the negotiated byte limit, geometry shape, finite
values, indices, hierarchy and expanded-instance budgets before allocating GPU
resources. They must also keep the original origin/window authorization and
match request, build, family and profile identities. Limits are implementation
policy in addition to these type contracts. Empty descriptor geometry is a
loading state; it is not a replacement for detailed asset data in a complete
export. Peers that do not negotiate the extension retain the full-catalog path.

The package exports the official editor origin and
`spatialReviewEditorUrl(websiteUrl)` as convenience values. Exporting an origin
does not itself authorize access; origin authorization is applied by a website
when it starts an SDK browser bridge.
