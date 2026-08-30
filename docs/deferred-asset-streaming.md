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

## Handshake and message order

1. The editor requests progressive capture, includes `asset-stream-v1` in
   `capabilities`, and offers a `geometry-transfer-v1` byte ceiling.
2. The website returns the metadata catalog before invoking any producer. Its
   `assetStream` offer declares `maxConcurrentRequests` and
   `maxInFlightBytes`.
3. Each asset descriptor declares an opaque catalog revision and one or more
   immutable representation revisions. An editor normally requests `overview`
   for visible bounds and `detail` for the actively selected asset.
4. The editor sends a representation-aware asset request. `maxBytes` may lower,
   but never raise, the website's negotiated ceiling. `knownRevision` lets the
   website return `notModified` without regenerating or retransferring data.
5. The website may send bounded `queued`, `generating`, and `serializing`
   progress. The editor can cancel by request/build identity. Exactly one
   terminal asset response is sent, including `cancelled` for a cancellation.

`alterno:spatial-review:source-status` is advisory build/catalog progress. Its
phase moves monotonically through `booting`, `catalog-ready`, `streaming`, and
`complete` (or `error`) within one catalog revision. Counts and messages are
bounded. A new catalog revision may start again at `booting`.

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

Call `registry.setSourceStatus()` when application-level generation has useful
catalog progress to report. The bridge also publishes streaming activity.
Re-registering an actor creates a new catalog revision and resets the phase.

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
streaming and never detaches renderer or producer-owned buffers.

Typed instance data is a structured-clone transport encoding, not static JSON.
JSON snapshots and feedback exports continue to use nested number-array
matrices.

## Budgets, authorization, and caching

Origin and source-window checks are unchanged. Request and cancellation IDs are
scoped to that authorized peer and build. The bridge bounds identifiers,
descriptor counts, queue length, concurrency, per-request bytes, aggregate
in-flight bytes, progress frequency, geometry values, and instance counts.
Cancellation aborts the producer and prevents any later asset response from
winning the race.

Consumers should validate the complete payload before GPU allocation. Cache
entries must include protocol/schema versions, source origin, normalized
website/capture URL, profile, asset ID, representation ID, and representation
revision. Never reuse a revision across another source or representation.

The machine-readable live-transfer schema is
[`schemas/asset-stream-v1.schema.json`](../schemas/asset-stream-v1.schema.json).
Runtime validators cover descriptors, requests, responses, status, progress,
cancellation, and typed instance buffers.
