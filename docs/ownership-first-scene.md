# Ownership-first scene contract

Status: implementation draft requested by the repository owner on 2026-08-28.
This local implementation is not a published protocol release. No accepted
Protocol change issue has been supplied or created by this work. Before merging
or releasing, a maintainer must record acceptance of this exact contract in a
Protocol change issue and link it from the PR, following
[the protocol change process](governance/protocol-changes.md). The implementation
request authorizes isolated development; it does not fabricate that decision record.

## Three independent relationships

- Ownership: a building, room, or street owns independently editable placements.
- Shared design: those placements reference canonical assets through `assetId`.
- Classification: categories, tags, and editor layers support alternative views.

Ownership is authored, never inferred from distance, physical attachment, names,
categories, or `AssetNode.parentId`. Assembly records contain no render geometry.
Asset nodes still describe the internal construction of one canonical design.

## Wire contract

The existing `scene-actors/v1` document gains optional `assemblies` and `ownership`.
Full hierarchical scenes explicitly declare:

```json
{
  "ownership": { "capability": "scene-assemblies-v1", "mode": "hierarchical" },
  "assemblies": [{
    "assemblyId": "BE1",
    "name": "Building BE1",
    "sourceRef": "src/buildings.ts#BE1",
    "localTransform": { "position": [10, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
    "transform": { "position": [10, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
    "bounds": { "center": [10, 2, 0], "size": [6, 4, 6] },
    "visible": true
  }]
}
```

Each actor in hierarchical mode has `localTransform`, including actors directly
under World. Assemblies and actors have at most one optional `parentAssemblyId`;
omitting it means World. Only assemblies can be parents. IDs are unique across
scene placements and assemblies. They must survive reparenting. Every assembly
has a stable `sourceRef` and human-readable name.

`localTransform` uses parent-local metres, XYZ Euler degrees, and dimensionless
scale. `transform` **continues to mean world space**, for both records:

```text
worldMatrix = parentWorldMatrix × localMatrix
```

Assembly scales must be positive and uniform. Actor scales must be finite and
invertible; non-uniform actor scales are allowed beneath uniform-scale owners.
Sheared source-root matrices are rejected instead of being approximated as TRS.
An assembly's world-space `bounds` is the union of its owned actor subtree,
including hidden contents; an empty assembly has zero size at its world pivot.
Bounds are presentation data, never an ownership inference.

`visible` is the record's own choice. Effective visibility is its own visibility
AND every ancestor's visibility. Hiding or showing an owner never rewrites child
choices. Selection of an assembly highlights its entire owned actor subtree.
Reparenting preserves world pose by default by computing the new parent-local
pose. Render batches remain independent of ownership records.

The [JSON schema](../schemas/scene-actors-v1.schema.json) covers structure.
`validateSceneOwnership` additionally checks references, cross-kind duplicate IDs,
cycles, depth (128), finite/invertible poses, uniform assembly scale, and evaluated
world/local consistency. Limits are 10,000 assemblies and 100,000 actors in the
extension; consumer transport budgets may be lower (the editor allows 5,000 live
actors). Legacy flat validation is not tightened by opting in other producers.

## Negotiation and compatibility

The ready message advertises `scene-assemblies-v1`. A consumer explicitly requests
it through `SpatialReviewCatalogRequest.capabilities`. This is independent of
progressive geometry and texture transfer. The SDK returns hierarchical data only
for a modern request that opts in. No opt-in, or a legacy wire alias, gets evaluated
world-space actors without `assemblies`, `parentAssemblyId`, or `localTransform`.
Effectively hidden actors are omitted from this legacy fallback because pre-extension
editors may ignore even actor visibility. Hierarchical captures retain all records
and their independent visibility choices.

The flattened scene includes `ownership.mode: "flattened"` and a human-readable
`reason` disclosing that assembly editing is unavailable. Older consumers may
ignore this new disclosure field; the producer must not advertise them as capable
of editing assemblies. An old producer remains flat in the new editor; no inferred
ownership is added. Static `toReviewIndex()`/`toScene()` exports include hierarchy;
use `toScene(false)` or `toReviewIndex(profile, false, false, false)` for a flattened
static fallback. Actor-only `toActors()` and the legacy index option always return
flattened records; use `toScene()` to retain ownership context.

## Registration without changing the game

```ts
registry.registerAssembly({
  assemblyId: "BE1", name: "Building BE1", sourceRef: "src/buildings.ts#BE1",
  root: buildingAnchor, // Reads only its pose and own visibility, never its geometry.
});
registry.registerAssembly({
  assemblyId: "BE1-room", parentAssemblyId: "BE1", name: "Ground-floor room",
  sourceRef: "src/buildings.ts#BE1.room",
  localTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
});
registry.register({
  actorId: "chair-01", assetId: "shared-chair", parentAssemblyId: "BE1-room",
  name: "Chair 01", sourceRef: "src/placements.ts#chair01", category: "Furniture",
  root: existingRenderedChair,
});
```

Choose either an existing `root` pose anchor or an explicit `localTransform` for
each assembly. The first reads current world pose on capture and derives its
parent-local pose; the second is a snapshot that must be re-registered after
source edits. Actor-local poses are derived from their actual root world poses.
Registration does not physically reparent, move, clone, or replace game objects.
Register structure and contained props once each; do not also register the whole
building subtree as a geometry actor. The SDK rejects overlapping render ownership
when exporting hierarchical scenes. Sharing a geometry/material resource across
distinct Object3Ds is allowed. Assembly removal requires first unregistering or
reparenting its owned records.

For a single-root registration, the root's visibility is placement state, not a
hidden canonical design that could hide unrelated shared placements. Descendant
visibility remains component state. For a multi-root registration, **each root's
visibility remains component state**, including in flattened exports; one actor
flag cannot represent a mixture of visible and hidden parts. Use the registration's
`visible` option to hide/show the whole placement without changing those component
choices. When omitted, placement visibility defaults to whether any root is visible.
All placements sharing an `assetId` share the canonical component choices.

## Feedback and refresh

`SceneOwnershipOperation` distinguishes `target.kind: "assembly"` from
`target.kind: "placement"`. A placement target retains `actorId`, `assetId`, and
`sourceRef`. A transform operation carries absolute parent-local `before`/`after`
poses. A reparent operation carries both owner IDs and complete local poses;
if it also changes placement, that pose is part of the single reparent operation,
not another child transform. The editor exports `application: "absolute-intent"`.
Apply final ownership before final local poses, independently of array order.
Do not replay a parent operation as a delta or also apply derived child world frames.

Shared construction edits remain in `asset-feedback-3d/v2`, targeting the canonical
asset and its components. Scene visibility remains a review-view preference, not
an implicit source-modification operation.

Duplicating an owned actor produces a new placement proposal, with a new ID and
the same shared `assetId`. Its `add` feedback carries `space: "parent-local"` and
an explicit `placement` (owner and local pose), not another world-space instruction.

On verification refresh the editor shows the new source baseline. Unapplied local
intent stays attached as feedback rather than being replayed onto that baseline.
When source matches the requested pose/owner, the pending operation retires.
Ordinary progressive hydration preserves the same semantics and stable IDs.

## Migrating the v6 component-based representation

Do not reuse component identities as actor/assembly identities merely because
their names or source paths look similar. Choose an explicit reviewed mapping
from each old target to its new target, or start a new review baseline and retain
the old review set. Preserve asset-local component ordering/names for designs
whose internal construction did not change. The editor matches ownership targets
by stable IDs only, not by category, source-ref coincidence, or a unique asset.
Unmatched ownership feedback is retained in `unresolvedTargets` for manual migration
and is not an instruction to apply to a replacement object.
Old bounds-centred scene pins and placement intent are not reinterpreted in the
new source-root-local frame. They are retained for explicit coordinate mapping.
Missing owners and newly conflicting reparent graphs also retain their original
intent as unresolved feedback. Reference merging that rewrites IDs is blocked
for ownership-aware review sets; choose an intentional baseline or explicit mapping.

## Acceptance evidence

`tests/fixtures/ownership.mjs` contains BE1, its room and roof, BE2, a street,
shared chair placements, and owned fixtures. `tests/ownership.test.mjs` verifies
ownership, source-world compatibility, validation, visibility, negotiation, and
unchanged game object/geometry identities. The paired editor tests additionally
exercise parent and child edits, reparenting, refresh, full-review round-trips,
instancing, and cross-repository SDK captures. Regression cases include mixed
root visibility in hierarchical/flat/progressive exports and offset/thin geometry
with actual rendered matrix, selection bounds, camera-focus, and picking checks.
This work does not migrate a game
adapter or authorize publishing; validate the real game after its separate migration.
