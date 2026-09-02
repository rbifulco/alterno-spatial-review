# Deferred asset streaming

`asset-stream-v1` is an additive live-capture capability for scenes whose
review geometry is expensive to build, serialize, or transfer. A negotiated
catalog publishes actors, bounds, and representation metadata first. Geometry
is produced only when the editor asks for an overview or detail representation.

The existing `progressive-assets-v1` / `geometry-transfer-v1` family request is
the compatibility floor. A peer that does not advertise `asset-stream-v1`
keeps that behavior, and a peer that does not negotiate progressive capture
keeps the complete JSON catalog. Deferred-only registrations are deliberately
absent from those older catalogs because they have no synchronous geometry
fallback. Keep an eager `register()` path for assets that must remain visible to
older editors.

A representation owner is one cached deferred representation for an asset and
revision. A texture owner is the live texture-source set advertised by that
representation. These owners control cache lifetime. They do not own or dispose
the website's source textures.

## Start the capture bridge

Apply the authoritative lifecycle in
[Implement the representation](../agents/install.md#4-implement-the-representation).
Use the definitions of terminal result and settled demand in
[Terms](../agents/install.md#terms).
For deferred content, publish accurate bounds and descriptors when their
authoritative data is ready. Split expensive construction into abortable
chunks. Check `AbortSignal` before each chunk. Yield to the event loop between
chunks and before each progress update. Use `scheduler.yield()` when it is
available. Otherwise, await a zero-delay timer. Keep each main-thread chunk
shorter than 50 milliseconds when the website has no stricter budget.

Keep the bridge attached while a consumer can request a representation or one
of its live texture resources. Detach the bridge during teardown. Release
capture-owned producers, workers, timers, snapshots, and texture owners after
the last session ends.

**Complete when:** the bridge exposes authoritative metadata during generation
and releases all capture-owned work after the last session.

## Handshake and message order

1. In the editor, request progressive capture. Include `asset-stream-v1` in
   `capabilities`. Offer a `geometry-transfer-v1` byte ceiling.
2. From the website, return the metadata catalog before you invoke a producer.
   Declare `maxConcurrentRequests` and
   `maxInFlightBytes`.
3. In each asset descriptor, declare an opaque asset-stream revision. Declare
   one or more immutable representation revisions.
4. From the editor, request `overview` for visible bounds. Request `detail` for
   the actively selected asset.
5. Send a representation-aware asset request. Use `maxBytes` only to lower the
   negotiated ceiling. Send `knownRevision` to permit a `notModified` result.
6. From the website, send progress only for a named phase or a known
   completed/total count. Keep progress bounded and monotonic. Accept
   cancellation by request and build identity. While the session stays
   attached, send exactly one terminal response. Use `cancelled` for a
   cancellation. On bridge teardown, abort accepted work and send no response
   because the session no longer exists. The consumer treats session loss as
   cancellation.

`alterno:spatial-review:source-status` is advisory build/catalog progress. Its
phase moves monotonically through `booting`, `catalog-ready`, `streaming`, and
`complete` (or `error`) within one catalog revision. Counts and messages are
bounded. A new catalog revision may start again at `booting`.

**Complete when:** metadata precedes producer work. While the session stays
attached, every accepted request has one terminal response within the negotiated
limits. A teardown-aborted request has a recorded session-loss result instead.

## Register deferred geometry

Bounds and transforms are world-space compatibility metadata. The producer may
return a `ReviewAsset3D`, one Three.js root, or an array of roots. It receives
the selected descriptor, the lower request budget, priority, an `AbortSignal`,
and a rate-limited progress callback.

```ts
import {
  SceneAssetRegistry,
  SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY,
  attachSceneAssetRegistryBridge,
} from "@alterno-dev/spatial-review";

const registry = new SceneAssetRegistry("campus-2026-08-30");

registry.registerDeferred({
  actorId: "campus-placement",
  assetId: "campus",
  name: "Campus",
  category: "Architecture",
  sourceRef: "src/campus/review-geometry.ts#campus",
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  bounds: { center: [0, 18, 0], size: [480, 36, 360] },
  stream: {
    capability: SPATIAL_REVIEW_ASSET_STREAM_CAPABILITY,
    revision: "campus-catalog-r7",
    representations: [
      {
        id: "overview",
        purpose: "overview",
        revision: "campus-overview-r4",
        estimatedBytes: 900_000,
        triangles: 18_000,
        attributes: ["position", "normal"],
        geometricError: 2,
      },
      {
        id: "detail",
        purpose: "detail",
        revision: "campus-detail-r12",
        estimatedBytes: 28_000_000,
        triangles: 620_000,
        attributes: ["position", "normal", "uv"],
        geometricError: 0,
      },
    ],
  },
  async produceRepresentation({ representation, signal, reportProgress }) {
    reportProgress({ phase: "generating", completed: 0, total: 2 });
    const roots = await buildReviewRoots(representation.purpose, signal);
    signal.throwIfAborted();
    reportProgress({ phase: "generating", completed: 2, total: 2 });
    return roots;
  },
});

const detach = attachSceneAssetRegistryBridge(registry, {
  maxGeometryBytes: 64 * 1024 * 1024,
  maxConcurrentAssetRequests: 2,
  maxInFlightBytes: 128 * 1024 * 1024,
  maxQueuedAssetRequests: 32,
});
```

Call `registry.setSourceStatus()` only for forward post-catalog progress. The
bridge sends the status only to peers that negotiated `asset-stream-v1`. The
bridge also publishes streaming activity. Re-registering an actor creates a new
catalog revision and resets the phase. When a refresh changes multiple
registrations, stop requests and apply the complete set before the new catalog
can receive a request.

**Complete when:** each descriptor has accurate bounds, immutable revisions,
and a producer that honors budget and cancellation.

## Typed instances

Negotiated responses may replace legacy `number[][]` matrices with
`matrix-f32-v1`:

```ts
node.instanceData = {
  encoding: "matrix-f32-v1",
  count,
  transforms: new Float32Array(count * 16),
  colors: new Uint8Array(count * 3),
  stableIds: new Uint32Array(count),
  selection: "instance",
};
```

Lengths are exact: transforms contain `count * 16` finite values, colors contain
three or four channels per instance, and stable IDs contain `count` unique
values. A node must use exactly one of `instances` and `instanceData`. The SDK
converts legacy instance matrices to owned `Float32Array` buffers for negotiated
streaming. Renderer-owned and producer-owned buffers stay attached.

Typed instance data is a structured-clone transport encoding, not static JSON.
JSON snapshots and feedback exports continue to use nested number-array
matrices.

**Complete when:** each typed instance field has the exact required length and
the source buffer remains attached after transfer preparation.

## Budgets, authorization, and caching

Origin and source-window checks apply to each request. Request and cancellation
IDs belong to one authorized peer and build.

The bridge bounds identifiers, descriptors, queue length, concurrency, bytes,
progress frequency, geometry values, and instance counts. The per-request byte
budget covers the complete structured-clone payload. It includes metadata and
extension fields.

A typed instance view that aliases a source buffer reserves one owned transfer
copy. The bridge rejects cyclic, accessor-backed, and non-plain extension values
before cloning.

Cancellation aborts the producer. The bridge releases scheduler and byte
reservations when it accepts the cancellation. It ignores each late result. A
producer stops promptly so canceled work releases CPU, worker, and GPU resources.

The SDK keeps at most 32 completed geometry snapshots and 64 MiB of snapshot
data. Texture resources use a separate lifetime. They have a 60-second delivery
grace.

After the grace period, an LRU keeps at most 64 representation owners and
approximately 256 MiB of texture source data. The last attached bridge releases
all deferred session resources.

Resource eviction invalidates the related geometry snapshot and its
`knownRevision` shortcut. The next request regenerates the complete
representation. Use the resource IDs in that regenerated representation. An ID
can stay the same when the source texture keeps the same UUID.

Keep texture identity stable in one representation revision. Provide a stable,
credential-free `texture.userData.sourceRef` when possible. This URL gives the
consumer a direct fallback. When a source URL contains credentials or secrets,
use a capture-only texture. Clear its `sourceRef`, `requestUrl`, `currentSrc`,
and `src` metadata. Transfer its decoded source through the capture bridge.

Consumers validate the complete payload before GPU allocation. Cache
entries must include protocol/schema versions, source origin, normalized
website/capture URL, profile, asset ID, representation ID, and representation
revision. Use a unique revision for each source and representation.

For a website installation, request one representative deferred result through
the editor. When it returns `busy`, use the
[installation retry policy](../agents/install.md#terms). Record a terminal
result or the explicit unsettled failure.

Add only the checks whose trigger applies:

| Check | Trigger |
| --- | --- |
| Cancellation | The integration adds or changes a deferred producer. |
| Queue overflow | The integration changes queue, concurrency, priority, or scheduling policy. |
| Live-texture grace | The representative deferred result contains a live texture. |
| Eviction and regeneration | The integration adds or changes a representation or texture-owner cache. |
| Final teardown | The integration creates capture-owned producer work, workers, timers, or cached results. |

Use the repository protocol and SDK tests for the generic queue, retry,
cancellation, lifetime, and eviction contracts. Test only the integration's
triggered behavior through the editor.

The machine-readable live-transfer schema is
[`schemas/asset-stream-v1.schema.json`](../schemas/asset-stream-v1.schema.json).
Runtime validators cover descriptors, requests, responses, status, progress,
cancellation, and typed instance buffers.

**Complete when:** the representative request has an explicit result. Each
triggered check has an observed result. No unrelated conformance check remains
in the installation plan.
