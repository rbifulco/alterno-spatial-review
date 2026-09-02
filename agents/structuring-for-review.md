# Structure a website for review

Use this reference before you change actor boundaries, asset hierarchy,
materials, navigation exports, or source mappings. Record every exclusion in
the integration plan from
[Define the review representation](install.md#2-define-the-review-representation).
Use the controlled terms in [Install or update Spatial Review](install.md#terms).

Apply the sections with these triggers:

| Trigger | Required sections |
| --- | --- |
| Every integration | [Understand the representation](#understand-the-review-representation), [Separate the scales](#separate-the-three-review-scales), [Choose actor boundaries](#choose-actor-boundaries), [Separate placement, asset, and ownership](#separate-placements-assets-and-ownership), [Preserve identity](#preserve-identity-and-source-mapping), [Keep feedback reversible](#keep-spatial-feedback-reversible), [Preserve the feedback loop](#preserve-the-feedback-loop), and [Acceptance checklist](#acceptance-checklist) |
| A registered asset has reviewable construction parts | [Organize asset components](#organize-asset-components) |
| Scene or Experience needs surrounding content | [Organize Scene context](#organize-scene-context) |
| Appearance can affect the review decision | [Preserve material and geometry evidence](#preserve-material-and-geometry-evidence) |
| The website has an authored journey | [Make navigation reviewable](#make-navigation-reviewable) |
| The change can affect startup, rendering, generation, transfer, refresh, or memory | [Keep performance bounded](#keep-performance-bounded) |

## Understand the review representation

The review representation is a deliberate export. It is not the live website
and it is not the authoritative source. The agent selects the content that the
reviewer needs for a decision.

Use this feedback loop:

1. Read authoritative website source.
2. Export a traceable review representation.
3. Collect precise feedback in the applicable editor view.
4. Map the feedback to authoritative source.
5. Change the source.
6. Refresh the website and review representation.
7. Verify the result.

An intentional omission from the representation is not an omission from the
website. Record each omission, proxy, and approximation. Add more representation
detail when the current scope cannot support the requested decision.

**Complete when:** the integration plan identifies the authoritative source,
review representation, and each omission, proxy, or approximation.

## Separate the three review scales

| Scale | Reviewer intent | Source responsibility |
| --- | --- | --- |
| Scene | Change one placement or one assembly and its owned contents | Actor or assembly placement data |
| Experience | Change a reveal, view, camera route, aim, timing, or FOV | `NavigationSequence` inputs |
| Asset | Change the canonical construction of a shared design | Asset geometry, components, and materials |

Scene and Experience use the same surrounding actors. Experience uses those
actors as read-only context. Asset isolates one canonical design in its local
frame. Preserve these boundaries when you map feedback to source.

**Complete when:** every review subject belongs to Scene, Experience, or Asset
at the scale of the requested decision.

## Choose actor boundaries

When a placement or independently selectable silhouette can receive a Scene
instruction, register an actor. Register the roots that the website already
renders. Register them after their hierarchy and required resources are ready.
Do not create an actor only for material or navigation feedback. Expose a
material under its Asset. Expose navigation as a `NavigationSequence` in
Experience.

Include each context object whose omission changes a judgment about scale,
clearance, occlusion, or framing.
Register each rendered subtree once.

| Condition | Use this boundary |
| --- | --- |
| One object must move without its surroundings | One actor for that object and separate actors for decision-relevant context |
| Construction parts need local feedback | One actor with a named asset-component hierarchy |
| Several placements use the same design | One actor ID per placement and one shared asset ID |
| A helper, private object, or duplicate LOD is outside review scope | Keep it outside every registered root |

**Complete when:** each independent placement decision has one actor and each
rendered subtree has one registered root.

## Separate placements, assets, and ownership

An assembly is a transform-only scene owner. It has no render geometry. World
is the implicit owner when no assembly owns a placement. A named top-level owner,
such as Street, is an ordinary assembly whose name and source reference come
from the website.

Use one stable `actorId` for each placement. Use one stable `assetId` for each
canonical design. Use an explicit assembly ID for coordinated scene ownership.

| Relationship | Meaning |
| --- | --- |
| Actor to asset | A placement uses a canonical design. |
| Actor to assembly | A placement belongs to an authored place or owner. |
| Category or layer | The editor groups or controls display. It does not define ownership. |

Keep canonical construction separate from placement data. Give variants
different asset IDs when a reviewer must distinguish their geometry or
materials.

When the installed SDK supports `scene-assemblies-v1`, use
`registerAssembly()` and `parentAssemblyId`. The bridge negotiates hierarchy
with each consumer. Use the
[ownership-first scene contract](../docs/ownership-first-scene.md) for transform,
visibility, scaling, fallback, and compatibility rules.

When the current SDK serves a consumer that does not negotiate
`scene-assemblies-v1`, use its automatic flat fallback. Do not add a second
registration for that consumer. Record the lost inherited movement, visibility,
and assembly editing.

When an older SDK cannot register assemblies, choose one legacy representation.
Use one actor with named asset components for coordinated movement. Use
independent actors for separate placement feedback. Do not publish both
representations as the same actor set.

Use construction and placement data to define ownership. Keep rendering batches,
proximity, names, categories, and material sharing outside ownership logic.

**Complete when:** each placement, canonical design, and owner has a stable and
independent identity. Each consumer in the compatibility target has an explicit
hierarchy result.

## Organize asset components

Name each component for the construction part that a reviewer can discuss.
Group mesh fragments that have one construction responsibility. Keep separate
components when they need separate instructions.

Use a stable asset-local origin, orientation, hierarchy, and child order. Keep
placement transforms outside canonical construction. For a registration with
multiple sibling `roots`, keep root order stable. The first root defines the
asset frame.

**Complete when:** each reviewable construction part has a stable name,
asset-local hierarchy, transform, and order.

## Preserve identity and source mapping

Apply the [stable semantic ID and searchable source reference definitions](install.md#terms).

Use semantic IDs for actors, assets, assemblies, asset nodes, materials,
journeys, stops, segments, and points. Use names for human recognition. Use
`sourceRef` for source lookup where the protocol field exists.

Record a material's authoritative definition in the integration plan because
`AssetMaterial` has no `sourceRef` field. Identify a texture map by its stable
material ID and map slot. Record its authoritative construction beside the
material mapping. Do not use the texture source URL as a code reference.

Keep object names, hierarchy order, material order, and registration order
stable when the target identity does not change. When identity changes, map the
old target to the new target or start a new review baseline.

Resolve each generated component reference to its canonical factory or content
definition. The Three.js serializer does not discover arbitrary source symbols
inside a mesh.

**Complete when:** every addressable review subject has stable protocol
identity. Every subject maps to an authoritative definition through its
`sourceRef` or the integration plan. Every texture map uses a stable material ID
and slot.

## Keep spatial feedback reversible

Use metres and the same world axes for actors and navigation. Record each unit
or coordinate conversion beside its adapter. Record the inverse conversion for
feedback.

The imported editor actor frame is the actor-local frame reconstructed from the
captured world transform. Convert feedback through the inverse capture-axis and
unit conversion before you apply it in the source parent frame. The editing
frame is the local frame of the selected review subject. For a flat actor, it is
the imported editor actor frame. For an asset component, it is component-local.

| Feedback | Coordinate meaning |
| --- | --- |
| Flat Scene transform | Imported editor actor frame; size is in metres |
| Assembly or owned actor transform | Parent-local position, XYZ rotation in degrees, scale, and owner ID |
| Asset component transform | Component-local transform |
| Experience camera or aim point | World-space position in metres |
| Scene surface anchor | Actor-local anchor |
| Asset surface anchor | Component-local anchor with optional normal, UV, and instance ID |

For a flat actor, translate feedback through the imported frame and the source
transform. The bounds center can differ from the source pivot.

For an owned actor, apply the assembly operation once. Keep each derived child
world transform out of the source change. For reparenting, set the new owner and
the supplied absolute local pose. Preserve the actor ID and asset ID.

Keep geometry bounds separate from the source pivot. Transform the captured
bounds into the editing frame for selection, focus, and placeholders.

**Complete when:** each feedback coordinate can be converted to source and back
without applying a derived transform twice.

## Organize Scene context

Organize Scene around authored places and their contents. Use categories and
layers as independent display controls. Use an explicit World or Street owner
for content that crosses place boundaries.

When missing detail cannot change the review decision, use a lightweight
context proxy. Name the proxy and record its limitation. Keep canonical Asset
detail available when construction feedback remains in scope.

**Complete when:** Scene contains each named context object whose omission would
change a composition decision. The integration plan records every context proxy
limitation.

## Preserve material and geometry evidence

Run this material preflight for each decision-relevant registered renderable.
A renderable is decision-relevant when an appearance error can change the
requested review decision:

- Identify custom shader materials and shader injection.
- Identify textures stored only in custom uniforms or application metadata.
- Identify triplanar, world-space, procedural, or non-UV projection.
- Identify vertex colors or custom attributes that carry essential appearance.
- Identify neutral base colors whose visible result comes from another stage.
- Identify geometry without compatible UVs.
- Identify texture references without an exportable image source.
- Identify credentials, signatures, tokens, or session identifiers in
  `sourceRef`, `requestUrl`, `currentSrc`, and `src` strings.

Select one representation for each affected material:

A declared simple approximation preserves each decision-relevant supported
field. It labels every unsupported shading effect. A minimal review-only proxy
contains only the geometry or component boundary needed for a planned decision.

| Source condition | Review representation |
| --- | --- |
| Supported material and compatible UVs | Export supported material fields and map slots. |
| Custom appearance with a declared simple approximation | Use a capture-only material or a review-safe base color. |
| Optimized rendering removed a planned decision boundary | Use a minimal review-only proxy that restores that boundary. |
| No faithful or useful approximation exists | Record that appearance review is unsupported. |

This example creates a capture-only approximation. It keeps source geometry and
uses a review-safe material. It does not change the ordinary page:

```ts
const reviewMaterial = new THREE.MeshStandardMaterial({
  name: "Review sandstone approximation",
  color: 0xb96f45,
  roughness: 0.82,
});

const reviewRoot = sourceRoot.clone(true);
reviewRoot.traverse((object) => {
  if ((object as THREE.Mesh).isMesh) {
    (object as THREE.Mesh).material = reviewMaterial;
  }
});

registry.register({
  actorId: "canyon-wall",
  assetId: "canyon-wall",
  name: "Canyon wall",
  category: "Terrain",
  sourceRef: "src/terrain/canyon-wall.ts#sourceRoot",
  root: reviewRoot,
});

const disposeReviewRepresentation = () => reviewMaterial.dispose();
```

When one approximation is correct for all affected meshes, use one shared
review material. When source roles differ, use separate named materials.
Call `disposeReviewRepresentation()` during capture teardown. Dispose only
capture-owned materials.

Use the `scene` profile for composition. It omits supplied normals, UVs, and
texture maps. A review-safe base color gives a distinguishable and honest
approximation of the source appearance. Use it for texture-driven materials so
Scene remains legible.

Use the `review` profile for Asset detail. Preserve component hierarchy,
geometry groups, normals, UVs, supported material fields, and supported texture
slots.

Keep an original stable texture source URL in `texture.userData.sourceRef` when
one exists. This protocol field does not contain a searchable source reference.
Make generated and live-only texture sources exportable through the capture
bridge. A resource ID is a session transport address. It is not a feedback
identity.

Use only a credential-free stable URL as `texture.userData.sourceRef`. When the
source URL contains credentials, a signature, a token, or a session identifier,
omit it from the review representation. Use a capture-only texture with cleared
URL metadata. Make its decoded source available through the capture bridge. Do not
remove secret fields from a texture that the ordinary page still owns.

Give a changed appearance a new build ID or representation revision. This
prevents saved consumer state from retaining stale material data.

Inspect each affected subject without selection highlighting. Compare Scene and
Asset with the live website. Use these result classes:

| Class | Checkable threshold |
| --- | --- |
| Faithful | The deterministic comparison has no decision-relevant visual difference. |
| Intentionally approximate | Every visual difference is recorded. The reviewer confirms that no difference can change the named review decision. |
| Unsuitable | A missing, misleading, or unverified difference can change the named review decision. |

Use [Integrating a website](../docs/integrating-a-website.md#transfer-textures)
for transport requirements and failure checks.

**Complete when:** each decision-relevant material has a faithful,
intentionally approximate, or explicitly unsuitable result.

## Make navigation reviewable

Export recognizable stops, authored camera and aim controls, segment timing,
and FOV intent. Keep calculated output read-only. Apply
[Export navigation sequences](exporting-navigation-sequences.md) to each
selected journey.

**Complete when:** each selected journey exposes recognizable stops and
traceable authored camera, aim, timing, and FOV inputs.

## Keep performance bounded

Apply the [Spatial Review performance screen](../docs/performance-profile.md)
when integration code runs on the ordinary page. Also apply it when the change
modifies shared rendering, state, routing, input, or lifecycle code.

Select actor and asset boundaries that preserve stable identity. Provide one
selection target for each planned decision. Use deferred representations for
expensive procedural or review-only geometry. Use accurate bounds, immutable
revisions, cancellation, byte limits, queue limits, concurrency limits, bounded
caches, and complete teardown.

Keep the ordinary page free of continuous review-only frame and memory work. A
same-document bridge and registry may reuse the website scene when the ordinary
page passes the performance screen. Do not construct a duplicate scene for that
integration. When freezing capture-only simulation and presentation does not
change registered evidence, freeze that work.

**Complete when:** the ordinary-page baseline stays within budget and all
capture work, transfers, caches, and teardown stay within recorded limits.

## Preserve the feedback loop

Use these terms in this section:

- **Local operation:** a proposed editor change that is not yet in source.
- **Review set:** saved feedback and proposed operations for one review
  baseline.
- **Compact feedback export:** an editor-produced payload that contains selected
  feedback for implementation. Its `kind` identifies the feedback schema.
- **Full review export:** an editor-produced payload that contains the complete
  review set for continued review work.
- **Retire:** remove a pending local operation after the refreshed source
  contains its intended result.

Apply editor feedback to authoritative source. Refresh both the website and the
review representation. When the refreshed source matches a local operation,
retire that operation.

When identity changes, keep old review sets. Map old targets explicitly. Keep
unmatched feedback for manual migration.

Use a compact feedback export for implementation instructions. Use a full
review export to continue a review session. Check the export schema and `kind`
before you treat it as a complete scene or asset document.

**Complete when:**

- Refreshed source contains each applied intent.
- Each matching local operation is retired.
- The review set preserves unresolved feedback.

## Acceptance checklist

Account for every review subject before you complete the structure step:

- Each actor is selectable at the scale of one placement decision.
- Repeated placements share canonical construction and keep individual actor IDs.
- Each rendered piece has one registration owner.
- Each assembly is transform-only. Each nonempty assembly has explicit owned
  actors. Each intentionally empty assembly has a recorded purpose and zero-size
  bounds at its world pivot.
- Each child remains independently selectable when the negotiated capability
  supports independent owned actors.
- Each asset exposes the components and materials needed for specific feedback.
- Each affected material has a recorded representation decision.
- Each decision-relevant texture has an exportable source or a recorded
  limitation.
- Each registered texture source string is free of credentials and secrets.
- Each journey has recognizable stops and traceable authored inputs.
- Each source mapping includes the inverse coordinate conversion.
- Each proxy, approximation, exclusion, and capability limit is recorded.
- Each expensive producer has accurate metadata, immutable revisions,
  cancellation, budgets, bounded caches, and teardown evidence.
- The ordinary page retains its ordinary-page baseline.
- The capture matches the capture baseline.

Return to the main procedure. Continue with
[Complete the integration plan](install.md#complete-the-integration-plan). The
main procedure continues with installation after it completes the plan.
