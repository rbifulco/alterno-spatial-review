# Prepared review packages

A prepared package moves source execution, procedural generation, canonical
capture and conversion **before the editor URL is shared**. The editor loads a
captured review representation directly, without starting the source website
in an iframe. Preparation is real work moved earlier; it is excluded from an
editor first-open measurement.

The protocol supplies a shared view of a site so people can express intent and
agents can map feedback back to source. Packages preserve the canonical
registry's actor, assembly, asset, component, material, navigation, source
reference and representation identities. They do not improve the capture
adapter's fidelity. Standard review materials can still approximate custom
source shaders, lighting or unsupported effects.

## Prepare, publish, validate, share

1. Run the actual source capture and wait for its registry/resources to settle.
   Pause animation, scene mutation and asynchronous authoring changes during
   export. Optional proxy/fallback discovery manifests are not canonical input.
2. Call `exportPreparedReviewPackage(registry, options)`, or use the CLI with an
   explicit local module exposing that registry. Every detailed representation
   uses the existing serializers. The exporter captures texture bytes and
   checks scene/representation revisions again before completing. Source
   changes are rejected; a bounded whole-capture retry after settling is safe.
3. Publish every returned file beside the matching source revision. Publish
   immutable package data first, then update discovery.
4. Validate the published package and share the site's ordinary editor URL.

A capture that can run in Node can expose a local module:

```js
// capture-review.mjs — import the site's actual registry/bootstrap.
import { createSettledReviewRegistry } from "./src/review/capture.mjs";

export default async () => ({
  registry: await createSettledReviewRegistry(),
  options: {
    websiteUrl: "https://project.example/",
    sourceRevision: "git-or-content-revision",
    captureUrl: "https://project.example/?spatial-review-capture=1",
    fidelity: {
      geometry: "source",
      materials: "approximate",
      limitations: ["Custom source shaders use standard review materials."],
    },
  },
});
```

```bash
spatial-review prepare ./capture-review.mjs --out ./dist/prepared-review
```

The output directory must be new. The CLI executes only the supplied module,
verifies its exported files and decoded index, then writes them. It does not
execute a remote website.

For browser-dependent generation, call the exporter in the settled capture
page with the same registry instance used by the live bridge:

```js
import { exportPreparedReviewPackage } from "@alterno-dev/spatial-review";

const prepared = await exportPreparedReviewPackage(actualRegistry, {
  websiteUrl: "https://project.example/",
  sourceRevision: "git-or-content-revision",
  fidelity: {
    geometry: "source",
    materials: "approximate",
    limitations: ["Custom source shaders use standard review materials."],
  },
});

// Supply the build/capture harness's own binary file sink.
for (const file of prepared.files) {
  await writeCapturedFile(file.path, file.bytes, file.contentType);
}
console.log(prepared.stats);
```

The structural registry interface lets a newer exporter consume an existing
capture page's registry without creating a second Three.js scene. A temporary
local harness can serve an exporter bundle and write its files without editing
the site's source. SDK `stats.elapsedMs` measures export work; record source
startup before the registry is available separately.

The CLI also accepts complete `spatial-review-capture/v1` JSON containing
`index`, `source`, `fidelity`, optional `captureId`/`capturedAt`, and `textures`.
A texture is `{ resourceId, path, contentType }`, naming a binary sidecar under
the JSON's directory. Absolute paths, directory escapes and escaping symlinks
are rejected. JSON geometry/instance arrays become packed binary buffers.
Lightweight metadata with unresolved geometry is rejected.

## Discovery and compatibility

```json
{
  "schema": "spatial-review-discovery/v1",
  "version": 1,
  "name": "Project review",
  "websiteUrl": "https://project.example/",
  "liveCapture": "/?spatial-review-capture=1",
  "capabilities": {
    "preparedPackage": {
      "capability": "prepared-review-package-v1",
      "manifest": "/prepared-review/manifest.json"
    }
  }
}
```

This capability is additive. Keep legacy transports for older consumers, or
advertise only the prepared transport. Current consumers prefer the package.
An advertised package failure is explicit and retryable: it cannot silently
mix an older snapshot, proxy manifest or live runtime. Sites without the
capability retain their existing live-capture behavior and authorization.

Discovery, package documents and resources need browser CORS access from the
editor. The discovery locator stays on the website origin. A package can use a
CDN, with catalog/resources on the manifest's origin. The CLI requires
`--allow-origin https://cdn.example` for an additional origin, and checks
redirects before following them.

```bash
spatial-review validate https://project.example/
```

Validation verifies the preferred package's source identity, lengths, SHA-256
digests, buffer references and canonical index. A corrupt prepared package fails
even when legacy transports are advertised.

## Files, identity and fidelity

| File | Contents |
| --- | --- |
| `manifest.json` | Small versioned identity/fidelity metadata, catalog descriptor and resource descriptors. |
| `catalog.<sha256>.json` | Canonical detailed index with external numeric references, plus the source texture ID mapping. |
| `resources/<sha256>.bin` | Deduplicated numeric arrays in aligned chunks, normally up to 16 MiB. |
| `resources/<sha256>.<image-type>` | Captured texture bytes without lossy recompression. |

The manifest binds `buildId`, `captureId`, `capturedAt`, source website URL,
source revision and generator. The catalog repeats build/capture identity;
index `generatedAt` must match `capturedAt`. Digests bind all published bytes.
Source revision and capture identity are distinct: several intentional
captures can come from one revision.

`fidelity` declares `geometry` and `materials` as `source`, `approximate` or
`proxy`, with explicit `limitations`. The exporter requires this metadata and
never upgrades it. The editor retains it in `document.source.preparedReview`,
saved review state, agent context and feedback exports. A compact prepared
status exposes fidelity, with full identity/limitations in its description.

Scene, Asset and Experience share one detailed catalog, decoded typed buffers
and normalized render sources. Existing readiness checks still require assets
and rendered canvases. Hidden workspaces retain canvases for immediate switching.

## Binary layout and bounds

```json
{
  "$spatialReviewBuffer": "buffer:sha256:<chunk-digest>",
  "componentType": "f32",
  "length": 72,
  "byteOffset": 0
}
```

Components are little-endian `f32`, `u32`, `u16`, or `u8`. Length counts
elements. Offsets must align to the component size; the full view must fit its
chunk. Identical array bytes share a range across families. Repeated references
return the same view. Most arrays share a few 16 MiB chunks, avoiding one HTTP
request per tiny attribute; a larger array gets its own bounded chunk.

Current v1 budgets: 4 MiB manifest, 24 MiB catalog metadata, 64 MiB per resource,
256 MiB total catalog/resources, and 16,384 resources. Existing geometry,
hierarchy, navigation, instance and allocation limits still apply after
decoding. Rendering resources register only after the entire package verifies.

Every new connection rechecks discovery and the manifest. A bounded session
cache reuses decoded/normalized data only when the complete manifest matches.
Saved legacy bundles cannot bypass prepared freshness. Workers stop on
cancellation or the first failure. Prepared transfers have a 20-second idle
deadline renewed by actual bytes and a 180-second absolute ceiling; discovery
and legacy stages retain their separate bounds.

Enable Brotli/gzip for JSON and sufficiently large binary chunks. Digests and
lengths describe decoded file bytes. Do not lossily re-encode images for a
benchmark. Content-addressed names suit immutable CDN distribution; the current
editor still verifies transfers with `cache: no-store` and reuses decoded data
within a session after checking the fresh manifest.

Cold localhost timing is not a WAN promise. Bytes, bandwidth, texture decode,
GPU work and all-workspace readiness remain costs. Report source startup,
export duration, package size/request count and editor first-open time separately.

Schemas: [discovery](../schemas/discovery-v1.schema.json),
[manifest](../schemas/prepared-package-v1.schema.json),
[catalog/buffer reference](../schemas/prepared-catalog-v1.schema.json).
The deterministic integration registry is
[`tests/fixtures/prepared-review.mjs`](../tests/fixtures/prepared-review.mjs).
