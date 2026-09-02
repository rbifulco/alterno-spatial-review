# Ownership-first scene contract

Status: accepted by the repository owner on 2026-08-29. Package version 0.5.0
and later contains the implementation, as recorded in the package changelogs.
The acceptance decision is in
[Protocol change issue #11](https://github.com/rbifulco/alterno-spatial-review/issues/11).
Acceptance covers this exact `scene-assemblies-v1` contract and its compatibility
behavior.

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

Each actor in hierarchical mode has `localTransform`. This rule includes actors
directly under World. An assembly or actor has at most one
`parentAssemblyId`. An omitted `parentAssemblyId` means World. Only an assembly
can be a parent. Each placement and assembly ID is unique. Keep the ID after
reparenting. Give each assembly a stable `sourceRef` and human-readable name.

`localTransform` uses parent-local metres, XYZ Euler degrees, and dimensionless
scale. `transform` **continues to mean world space**, for both records:

```text
worldMatrix = parentWorldMatrix × localMatrix
```

Assembly scales must be positive and uniform. Actor scales must be finite and
invertible. An actor can have non-uniform scale under a uniform-scale owner.
Reject a sheared source-root matrix. Do not approximate it as a translation,
rotation, and scale decomposition.

An assembly's world-space `bounds` includes its complete owned actor subtree.
Include hidden content. Give an empty assembly zero-size bounds at its world
pivot. Treat bounds as presentation data. Do not infer ownership from bounds.

`visible` is the record's own choice. Effective visibility requires the record
and every ancestor to be visible. Do not rewrite child visibility when an owner
changes visibility. A consumer presents an assembly together with its complete
owned actor subtree. For a reparent operation, read `preserveWorldPose`. When it
is true, compute the new parent-local pose from the existing world pose. Keep
render batches independent of ownership records.

The [JSON schema](../schemas/scene-actors-v1.schema.json) checks structure.
`validateSceneOwnership` also checks references and cross-kind duplicate IDs.
It checks cycles, depth, poses, assembly scale, and evaluated world/local
consistency. The maximum depth is 128. The extension limit is 10,000 assemblies
and 100,000 actors. A consumer can set a lower transport budget. Other producers
do not change legacy flat validation.

**Complete when:** the hierarchical document passes its JSON schema and
`validateSceneOwnership`. Each world and local transform satisfies the recorded
relationship. Each ID, parent, scale, bound, and visibility value satisfies the
rules above.

## Negotiation and compatibility

The ready message advertises `scene-assemblies-v1`. A consumer requests it in
`SpatialReviewCatalogRequest.capabilities`. This negotiation is independent of
progressive geometry and texture transfer.

The SDK returns hierarchical data to a request that opts in. A request without
the capability receives evaluated world-space actors. This flat response omits
`assemblies`, `parentAssemblyId`, and `localTransform`.

The flat response omits actors that inherit hidden visibility. Legacy editors
can ignore actor visibility. A hierarchical response keeps all records and each
visibility choice.

The flat scene includes `ownership.mode: "flattened"`. Its `reason` says that
assembly editing is unavailable. A producer reports assembly editing only to a
consumer that negotiated the capability.

An old producer remains flat in a new editor. The editor does not infer
ownership.

Static `toReviewIndex()` and `toScene()` exports include hierarchy. Use
`toScene(false)` or `toReviewIndex(profile, false, false, false)` for a flat
static fallback. `toActors()` and the legacy index option always return flat
records.

**Complete when:** the producer sends hierarchy only to a consumer that
negotiates `scene-assemblies-v1`. Every other consumer receives the documented
flat fallback without inferred ownership.

## Registration without changing the website

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

Choose an existing `root` pose anchor or an explicit `localTransform` for each
assembly. A root supplies its current world pose during capture. The SDK derives
its parent-local pose.

An explicit `localTransform` is a snapshot. Register it again after a source
edit. The SDK derives each actor-local pose from its actual root world pose.

Registration keeps website objects in their source hierarchy. Register each
structure and contained prop once. The SDK rejects overlapping render ownership.
Distinct objects can share geometry and material resources.

Before you remove an assembly, unregister or reparent its owned records.

For a single-root registration, the root's visibility is placement state.
Descendant visibility is component state.

For a multi-root registration, each root's visibility is component state. This
rule also applies to flat exports. One actor flag cannot represent mixed root
visibility. Use the registration `visible` option to change the complete
placement visibility. Do not change component visibility for this action.
When `visible` is omitted, placement visibility is true when any root is visible.
Placements with the same `assetId` share the canonical component choices.

**Complete when:** each rendered subtree has one registration owner. Assembly
registration does not move or duplicate website geometry. Hierarchical and flat
exports preserve the documented transforms and visibility.

## Feedback and refresh

`SceneOwnershipOperation` distinguishes `target.kind: "assembly"` from
`target.kind: "placement"`. A placement target retains `actorId`, `assetId`, and
`sourceRef`. A transform operation carries absolute parent-local `before`/`after`
poses. A reparent operation carries both owner IDs and complete local poses.
Treat each operation as absolute intent against one review baseline. Apply final
ownership before final local poses. Do this independently of array order. Do not
replay a parent operation as a delta. Do not apply derived child world frames.

`SceneOwnershipOperation` defines transform and reparent actions only. It does
not define construction edits, visibility edits, or placement creation. Keep
those actions outside this ownership-operation contract.

Refresh the editor after source verification. Confirm that it shows the new
review baseline. Unapplied local intent stays attached as feedback rather than
being replayed onto that review baseline.
When source matches the requested pose or owner, retire the pending operation.
Ordinary progressive hydration preserves the same semantics and stable IDs.

**Complete when:** each operation applies once in parent-local space. Refresh
retires matching intent and preserves unresolved feedback without replaying it.

## Migrate a pre-ownership component representation

A pre-ownership component representation models coordinated scene content as
asset components without explicit assembly owners. Use this migration only for
review sets created from that older representation.

Map each old target to a reviewed new target. Start a new review baseline when
no reliable mapping exists. Keep the old review set.

Preserve asset-local component order and names when construction is unchanged.
Match ownership targets by stable ID. Category, source-reference similarity, and
unique asset identity do not establish a match.

Keep unmatched ownership feedback for manual migration. Keep old
bounds-centered pins for explicit coordinate mapping.

Missing owners and conflicting reparent graphs also keep unresolved intent. Use
a new review baseline or an explicit mapping for an ownership-aware review set.

**Complete when:** every old target maps to one new target or remains unresolved
in the old review set. No heuristic match silently moves feedback.

## Acceptance evidence

`tests/fixtures/ownership.mjs` contains BE1, its room and roof, BE2, a street,
shared chair placements, and owned fixtures. `tests/ownership.test.mjs` verifies
ownership, source-world compatibility, validation, visibility, negotiation, and
unchanged game object/geometry identities. The paired editor tests additionally
exercise parent and child edits, reparenting, refresh, full-review round-trips,
instancing, and cross-repository SDK captures. Regression cases include mixed
root visibility in hierarchical/flat/progressive exports and offset/thin geometry
with actual rendered matrix, selection bounds, camera-focus, and picking checks.
This repository evidence does not migrate a website adapter or authorize
publishing. Validate the integrated website after its separate migration.
