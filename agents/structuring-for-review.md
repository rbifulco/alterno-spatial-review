# Structuring for review

Read this when adding or refining an existing website's review integration,
before changing construction or registrations. Apply every section relevant to
the experience, and record exclusions in the integration plan from
[Install or update Spatial Review](install.md#2-define-the-review-structure).

The review representation must let a person select a meaningful target, explain
a change in context, and return an instruction an agent can locate in source.
The SDK exposes registered spatial content; HTML layout and arbitrary DOM
elements are outside this contract.

## Separate the three review scales

| Scale | Reviewer intent | Source responsibility |
| --- | --- | --- |
| Scene | Move a building with its contents, or one courtyard gate independently | One assembly or actor's placement |
| Path | Reveal the gate earlier during arrival | Camera/aim controls and timing |
| Asset | Make the gate's arch thinner | Canonical geometry and components |

Scene and Path use the same surrounding actors. Path treats those actors as
read-only context. Asset review isolates a canonical design and its local
construction. Preserve these boundaries when translating feedback.

## Choose actor boundaries

Register an actor when its placement, proportions, silhouette, material, or role
in navigation can receive an independent design instruction. Register the roots
already rendered by the website, after construction and loading complete.

For the courtyard example, expose the gate, steps, and nearby wall as distinct
actors. Include enough ground and neighboring structures to judge clearance,
scale, occlusion, and framing. Keep the gate's arch and hardware inside its asset.

| Structure | Review consequence | Preferred boundary |
| --- | --- | --- |
| Whole courtyard registered as one actor | Moving the gate also moves its surroundings | Gate, steps, wall, and necessary context |
| Each gate fragment registered as an actor | Scene selection is crowded with construction detail | One gate actor with component hierarchy |
| Same mesh registered through parent and child actors | Selection and feedback overlap | One registration owner per rendered subtree |
| Only the gate registered | Clearance and arrival framing cannot be judged | Gate plus decision-relevant surroundings |

Keep debug helpers, duplicate LODs, and private content outside registered
subtrees. Registration traverses descendants: a hidden helper is not a reliable
way to exclude data from review.

## Separate placements and canonical assets

Use one stable `actorId` per placement and one `assetId` per shared design:

| Actor | Asset | Meaning |
| --- | --- | --- |
| `gate-courtyard-entry` | `courtyard-gate` | Entrance placement |
| `gate-garden-exit` | `courtyard-gate` | Another placement of the same construction |
| `gate-service-entry` | `service-gate` | A different design |

Keep factories for canonical construction separate from placement data. A scene
instruction changes one placement; an asset instruction changes the shared
definition. Geometry or material variants need distinct asset IDs when the
reviewer must distinguish them.

Ownership is a third relationship: a chair can belong to a room while sharing
its canonical design with chairs in other buildings. Physical attachment is not
the ownership boundary. Use explicit assemblies for authored places and rooms
when the installed SDK supports `scene-assemblies-v1`; keep child actors
independently addressable. Do not turn a building and all its furniture into one
canonical asset to obtain coordinated movement. An asset's own legs, panels,
and other construction parts can remain asset components.

The current registry takes the first ordered registration for each `assetId` as
the canonical asset. All registrations sharing that ID must therefore agree on
local construction and materials. Name roots inside the factory before placing
them; this prevents a placement label from becoming a component's identity.
Keep the canonical representative and registration order deterministic.

## Decide assembly ownership explicitly

Independent selection does not imply independent ownership. An AC unit can be
a useful individual review target while belonging to a building; a wheel can
be a useful component while belonging to a vehicle. Before registering these
parts, decide whether moving, rotating, scaling, or hiding the owner should
also affect them. Record the owner in authoritative placement data rather than
inferring it from proximity, names, or shared materials.

Keep three relationships distinct:

| Relationship | Example | What it means |
| --- | --- | --- |
| Shared design | AC units on two different buildings use one `assetId` | Reusable construction, not a common scene parent |
| Assembly membership | Building BE1 owns its attached AC unit | Intended coordinated placement and visibility |
| Catalog grouping | AC units appear under a Fixtures category | Browsing organization, not transform inheritance |

With `scene-assemblies-v1`, use the explicit transform-only owners and independent
placements in the [ownership-first contract](../docs/ownership-first-scene.md).
For legacy flat captures without this capability, actor records provide no
inherited ownership. `AssetNode.parentId` describes components **inside one asset**;
it does not parent one scene actor to another. A source `Object3D` parent, an
actor-ID prefix, a tag, a category, or a scene layer does not establish inherited
actor transforms in the editor. A display group with a count of one is also
unrelated to an asset's component count.

For a legacy producer or editor, choose and document a supported representation:

- If coordinated assembly edits are the priority, register the assembly once
  and retain attached parts as named asset components. Moving the assembly in
  Scene then includes its parts; Asset review targets the parts locally. Do not
  also register those descendants as independent actors, which duplicates their
  geometry and review ownership. Only share the assembly's `assetId` between
  placements with the same local construction and materials.
- If independent scene placement and shared canonical part assets are required,
  register the parts separately, retain their ownership in source, and explicitly
  report that the current editor cannot move or hide the owner and parts as one
  assembly. This is a limitation, not a complete ownership handoff.
- If both independent child actors and inherited assembly editing are required,
  identify a protocol/SDK/editor capability gap. Do not invent a parent field or
  promise that naming, categories, or a custom scene manifest implements it.
  Follow the [protocol change process](../docs/governance/protocol-changes.md)
  before extending that contract.

For optimized or procedural scenes, choose ownership from construction and
placement data, not draw-call or material batches. Review-only representations
may restore those boundaries without changing rendering, but must retain one
registration owner per rendered part and reproduce its original world pose.

## Organize components around construction

Give each component a name that identifies the part a reviewer can discuss:

```text
Courtyard gate
├── Masonry
│   ├── Left pier
│   ├── Right pier
│   └── Arch ring
├── Door
│   ├── Timber leaf
│   └── Iron hardware
└── Drainage channel
```

Preserve separate meshes where separate instructions are useful. Group fragments
that serve one construction responsibility. A flattened gate loses part-level
targets; hundreds of unnamed fragments make selection ambiguous.

Use a stable local origin, orientation, and child order. Keep placement transforms
outside internal construction. When an actor uses multiple sibling `roots`, the
serializer uses the first root's world transform as the asset frame; root order
is therefore part of the integration contract.

## Preserve identity and source mapping

IDs identify targets across builds. Names identify them to people. `sourceRef`
connects feedback to implementation.

Use authored semantic IDs such as `gate-courtyard-entry`, `arrival`, and
`gate-reveal-camera-in`. Give materials role-specific names such as
`Weathered limestone` and `Painted iron`. Use durable source references such as
`src/scene/gates.ts#courtyardEntry`, with placement definitions that lead to the
canonical factory they instantiate.

The Three.js serializer currently derives component IDs from the asset ID,
object name, and hierarchy indices. Material IDs also depend on encounter order.
Preserve names and ordering during unrelated edits. For intentional hierarchy
changes, account for existing feedback targets before refreshing the baseline.

The serializer generates component references by appending a component ID to the
registration's `sourceRef`; it does not discover each mesh's source symbol or
read arbitrary per-node source annotations. Keep named construction traceable
from that registration reference. Verify generated references by resolving an
exported component back to its factory or content node.

## Keep spatial feedback reversible

Use the same world axes and metres for actors and navigation. Record any
conversion from runtime units or parent-local coordinates beside the adapter,
including how to convert feedback back. Object Euler rotations are serialized
in degrees; texture-map rotation retains its separate texture convention.

| Feedback | Interpretation |
| --- | --- |
| Flat scene position, rotation, size | Legacy editor actor frame; `size` is dimensions in metres |
| Ownership-aware assembly/placement operation | Explicit parent-local position, XYZ rotation in degrees, dimensionless scale, and owner ID |
| Asset part position, rotation, scale | Component transform relative to its parent |
| Path camera/aim position | World-space position in metres |
| Scene surface pin | Object-local anchor |
| Asset surface pin | Component-local anchor, optionally with normal, UV, and instance ID |

For legacy flat live actors, the scene editor starts from a world-aligned, bounds-centered
frame. Its pivot can differ from the original Three.js root. Translate scene
transform intent through the imported frame and source transform; assigning
exported `size` directly to `Object3D.scale`, or treating the bounds center as the
source pivot, changes the meaning.

Ownership-aware actors instead use the source root's explicit frame and local
pose. The wire `transform` remains world-space, and `localTransform` is a separate
field. Apply one assembly operation to its owner; never also replay its derived
child world changes. For reparent operations, update final ownership and apply
the supplied absolute local pose; keep the actor/asset IDs stable.

Keep geometry bounds separate from that source-root pivot: an offset mesh can be
far from its root origin. Transform the captured world-space bounds into the
editing frame for selection, focus, and placeholders; do not move the pivot to
make those bounds fit.

## Scene organization

Organize Scene around authored places and their contents. Use names and
registration order to keep those places recognizable; keep categories and asset
types as filters or alternative views. The Asset library can remain type-based.
Include only context that supports a review decision. An authored lightweight
terrain or background proxy can reduce cost when its missing detail is irrelevant;
identify it as a proxy and retain detailed assets for construction review.

An assembly is a transform-only owner, not another geometry registration. Expose
the building structure, roof fixtures, and loose furniture once each under their
authored owners. Street litter and cross-building cables need an explicit owner
(possibly Street or World); never infer ownership from proximity. Keep the game's
scene construction and batching unchanged. Sharing geometry resources across
independent Object3Ds is not duplicate registration.

With assemblies, a single registration root's visibility controls its placement;
descendant visibility still describes components. In a multi-root registration,
preserve every root's individual visibility as component state. Use the
registration's `visible` option for whole-placement visibility instead of
overwriting those root flags. Flat fallback must retain hidden component choices.

Read [Ownership-first scene contract](../docs/ownership-first-scene.md) for the
accepted contract, positive uniform assembly scaling, visibility inheritance,
capability negotiation, compatibility fallback, and release status.
If the installed SDK or editor lacks support, retain flat actors and clearly
report that assembly editing is unavailable. Categories/layers are not a
substitute for coordinated transforms.

In the current editor, newly imported live actors enter the `Website scene`
layer. Registration `category` does not automatically create layers or locks.
When grouping and locking are required, author a scene manifest with explicit
`layers`, object `layerId` values, stable actor/asset links, and source references.
Check that organization after live reconciliation as well as static import.

The ownership view is primary in an assembly-capable editor. Layers remain
independent display/lock controls, not inferred ownership. Moving an assembly
containing a locked-layer actor is disabled until its layer is unlocked.

## Preserve material and geometry evidence

Use the `scene` profile for composition and the `review` profile for asset detail.
Both retain hierarchy and silhouette geometry. The scene profile omits supplied
normals, UVs, and texture maps; it does not decimate polygons. Choose registration
boundaries and explicit context proxies accordingly.

For asset review, preserve material assignments, geometry groups, normals, UVs,
and supported texture slots needed to judge the design. Retain texture source
URLs when available; annotate cloned or custom-loaded textures explicitly:

```ts
wallTexture.name = "Weathered limestone albedo";
wallTexture.userData.sourceRef = wallTextureUrl;
wallMaterial.name = "Weathered limestone";
```

Live transfer can supply generated or non-CORS textures from registered image
data. For transport configuration, use the
[integration reference](../docs/integrating-a-website.md). A resource ID is a
session transport address, not a durable feedback target.

The review renderer does not reproduce arbitrary shaders, postprocessing, or
the website's lighting pipeline. State any approximation that affects the
decision and compare the real website when appearance depends on those effects.

## Make navigation reviewable

For the courtyard, expose an `Arrival` journey with recognizable stops such as
`Approach`, `Gate reveal`, and `Courtyard`. Register the gate and surroundings so
the reviewer can judge what appears, what is occluded, and where the camera fits.

Preserve authored camera and aim controls, segment timing, and FOV intent. Keep
calculated outputs distinguishable from editable inputs. For camera, scroll,
or guided-view routes, follow
[Export navigation sequences](exporting-navigation-sequences.md) for the mapping,
editor capabilities, and checks.

## Keep review performance bounded

Review structure and performance are coupled. An actor boundary that creates
thousands of separately retained roots, an asset that serializes an entire world
for one selection, or a capture page that runs the full game in every editor
frame is not a complete integration even when its schema is valid.

Use the authoritative rendered roots when they already have the right semantic
boundaries. Do not clone the full scene for review convenience. When optimized
rendering erased needed boundaries, build the smallest review-only representation
that restores them, share immutable resources, and dispose it through the SDK's
ownership contract. Never trade away stable actor IDs or meaningful component
selection merely to reduce draw calls or catalog entries.

Classify each expensive asset before choosing its transport:

| Asset behavior | Preferred approach |
| --- | --- |
| Already rendered, modest hierarchy | Eager `register()`; progressive transfer keeps geometry serialization request-driven |
| Already rendered, expensive full detail | Eager registration with measured bridge limits, or deferred metadata backed by accurate known bounds when inspection itself is costly |
| Review-only and cheap | Construct once after authoritative data is ready; release it on teardown |
| Review-only and expensive/procedural | `registerDeferred()` with immutable overview/detail revisions, cancellation, progress, and a bounded producer |
| Repeated placement data | Preserve actor identities; share one canonical asset and use typed instance transport where the review boundary supports instances |

A deferred catalog is metadata, not permission to guess. Its world transform and
bounds must match the produced representation, its byte/triangle estimates must
be credible, and one revision must always mean the same immutable result. An
overview may simplify detail only when it preserves the placement, silhouette,
and context needed for Scene review; Asset detail must retain the construction
evidence promised by the integration. Maintain an eager fallback or explicitly
record the minimum editor capability when legacy peers still matter.

Treat the capture document as a resource worker as well as a visible page. Freeze
unrelated simulation and animation, avoid continuous rendering when a deterministic
frame is sufficient, cap device pixel ratio, and disable presentation-only GPU
passes only when registered geometry, materials, transforms, textures, and source
mapping remain unchanged. Bound per-request bytes, queued work, concurrency, and
aggregate in-flight memory. Producers must respond to cancellation and must not
leave timers, workers, GPU resources, or shared cache entries alive after detach.

Measure both sides of the integration: the ordinary website must not pay material
startup, frame, or memory cost merely because discovery is installed, while the
capture must publish metadata promptly and remain responsive during overview and
detail requests. Test refresh and at least one concurrent/multiple-frame scenario;
editor source frames can coexist, so per-frame loops and caches must not scale
without a documented bound.

## Preserve the feedback loop

Editor changes express intent. Implement them in authoritative source, then
refresh and compare the result in both the editor and website. Retain IDs for
targets that still represent the same thing.

When replacing a component-based building export (including the v6 game adapter),
explicitly map old review targets or start a new review baseline. Do not migrate
component comments to similarly named actors by guesswork. Retain old review sets;
unmatched ownership intent is exported separately for manual migration. A refresh
shows the source baseline, retains unapplied local intent, and retires an operation
when source matches it, without replaying both parent and child movement.

Use compact agent feedback for implementation instructions and a full review set
for continuing a session. The compact export intentionally omits mesh buffers
and unchanged content; resolve targets through identity and source references.
Check the export's schema and `kind` before treating it as a complete scene.

## Acceptance checklist

Before completing the review-structure step, account for every intended target:

- Each actor is independently selectable at the scale of a placement decision.
- Repeated placements share construction without losing their individual IDs.
- Moving/rotating a building carries owned structure, fixtures, and furniture,
  but not other buildings or street objects; child-local poses remain unchanged.
- Children remain independently selectable, movable, and reparentable with their
  world pose preserved; parent hide/show preserves each child's hidden choice.
- Every rendered piece has exactly one registration owner; assemblies add no
  geometry and do not change source batching.
- Feedback distinguishes assembly placement, individual placement, reparenting,
  and canonical asset construction, and refresh does not double-apply transforms.
- Attached fixtures and parts have an explicit ownership decision: assembly
  placement, asset component, independent actor with a documented limitation, or
  a capability gap.
- Moving and hiding a representative owner affects exactly the intended parts,
  or the unsupported behavior is reported; unrelated owners remain unchanged.
- Each asset exposes the parts and materials needed for specific feedback.
- Each journey has recognizable moments and traceable authored inputs.
- Each source mapping includes enough information to reverse coordinate changes.
- Context, proxies, unsupported effects, and intentional exclusions are recorded.
- The ordinary website retains its measured startup/frame behavior, and discovery
  does not eagerly construct or serialize review-only detail.
- Capture-specific quality reductions remove only presentation work; registered
  review evidence and documented fidelity remain intact.
- Expensive producers have accurate metadata, immutable revisions, cancellation,
  byte/concurrency/in-flight limits, bounded caches, and teardown coverage.
- Capture readiness, overview/detail requests, refresh, and concurrent editor
  frames complete without unbounded CPU, GPU, or memory growth.

Then perform the [editor checks](install.md#6-verify-the-review-loop). For the
courtyard, the reviewer must be able to move one gate, adjust its arrival reveal,
and comment on its arch as three distinct instructions with distinct source owners.
