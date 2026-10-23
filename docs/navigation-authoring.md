# Navigation authoring: shape and saved-view timing

This contract extends `NavigationSequence` without changing `scene-actors/v1`.
Existing line, quadratic/cubic Bézier, Catmull–Rom, sampled, fixed-target, and
path-facing definitions retain their existing meaning when the new fields are
absent. The extension describes data, not a required site camera controller.
The SDK registers and transports snapshots; it does not play camera journeys.

## Two independent paths, one clock

- Camera geometry determines where the viewer travels.
- Aim geometry determines the world-space point the camera looks at.
- A saved view pairs one point on each curve at a shared segment playback time.
- Shape handles lie on the curve. Internal interpolation offsets are not
  off-curve controls exposed to the reviewer.

Each segment still has a positive relative `weight`. Convert journey progress
to segment-local progress using these weights, not curve length. Evaluate both
tracks at that same local playback progress, using their separate timing maps.
FOV and `lensStart` remain driven by segment playback progress, not by either
track's geometry parameter. A saved view is not an additional stop or FOV key.

## Fields and invariants

`NavigationSegment.name` and `NavigationCurvePoint.name` are optional display
names. Journey and stop names remain required. Stable IDs and `sourceRef` do
not change when an item is renamed. Names need not be unique; IDs are the
reference keys. An unnamed transition can display its connected stop names;
an unnamed handle can display a numbered default.

On `catmull-rom` points the following optional fields are supported:

| Field | Meaning |
| --- | --- |
| `time` | Normalized **geometry parameter**, not playback time when a map exists |
| `incoming`, `outgoing` | Finite XYZ offsets relative to this point, used by cubic spans |
| `generated` | Hidden shape-preservation knot; retain it when evaluating/exporting |
| `momentId` | Stable identity of a saved view, shared across camera and aim |
| `momentName` | Saved-view display name, separate from the handle's `name` |

If any point has `time`, all points must have finite, strictly increasing times.
The first is 0. For an open curve the last is 1; for a closed curve it is less
than 1 and the closing span ends at the first point at parameter 1. Offsets
require explicit point times. Without explicit times, the geometry spans are
equal: `i / (N - 1)` for open curves, `i / N` for closed curves.

A saved-view point has role `through`, is not a stop endpoint or generated
knot, and its `momentId` is unique within the curve. `momentName` requires
`momentId`. The same saved view has the same name on both tracks.

Curves with a timing map have **both** `timingVersion: 1` and a `timing` array.
Each entry is `{ id, time, parameter }`:

- `id` matches one point's `momentId` on that curve;
- `time` is normalized segment playback time;
- `parameter` equals that point's explicit or implicit geometry parameter;
- both numeric fields are finite and strictly between 0 and 1;
- entries are strictly increasing on both axes, with unique IDs;
- every saved-view point on a mapped curve has exactly one timing entry.

Camera and aim maps contain the same IDs in the same order and the same
playback times. Their geometry parameters can differ. Nonempty maps therefore
require an explicit aim curve, not automatic or fixed-target aim. Empty maps
are valid and mean identity mapping. Legacy `momentId` points without maps
remain readable; materialize identity maps from their geometry parameters
before editing their saved-view timing, ensuring the two tracks agree.

## Evaluation

1. Clamp local playback progress `t` to `[0, 1]`.
2. For each track, add implicit map endpoints `(time=0, parameter=0)` and
   `(time=1, parameter=1)`. Find the surrounding anchors and linearly
   interpolate `parameter`. Without a map, `parameter = t`.
3. Find the geometry span containing that parameter. For points A and B with
   parameters `a` and `b`, use local `u = (parameter - a) / (b - a)`.
4. If A has `outgoing` and B has `incoming`, evaluate the cubic with controls
   `A.position`, `A.position + A.outgoing`, `B.position + B.incoming`,
   `B.position`. Offsets are **relative**, not absolute positions.
5. Otherwise evaluate the original Catmull–Rom curve at `(spanIndex + u) /
   spanCount`, preserving `closed`, `curveType`, and `tension`. This retains
   legacy Catmull–Rom behavior and supports nonuniform geometry parameters.

For a closed curve, the final span wraps from the last point to the first.
Do not use an arc-length sampler (`getPointAt`) in place of this parameter
evaluation. Do not feed just the visible handle positions into a fresh spline:
that discards the offsets, hidden knots, and timing map.

For example, a view named “Artwork reveal” can have playback time `0.6`, camera
parameter `0.35`, and aim parameter `0.7`. At 60% through the segment, the camera
reaches its 0.35 geometry point and looks at the aim curve's 0.7 point. Retiming
the view to 80% changes both anchor **times** to `0.8`; neither parameter changes.
Choosing another point on the aim curve changes only its parameter and paired
point association; playback time remains `0.8` and both shapes remain intact.

## Editing semantics

| Action | Geometry | Timing |
| --- | --- | --- |
| Add a shape handle | Subdivide without changing evaluated shape | Unchanged |
| Drag a shape handle | Reshape only that track | Keep saved-view clock anchors |
| Save a view | Add/select a point on each track without changing shape | Add constraints consistent with the current timing maps |
| Retime a saved view | Unchanged on both tracks | Move both anchor times together, between neighboring saved views |
| Choose another point for a saved view | Preserve shape; move the association on one curve | Keep its time, change that map's parameter without crossing neighboring views |
| Remove a saved view | Keep the shaped routes and handles | Remove the paired timing constraints; playback may change |
| Rename | Unchanged | Unchanged; retain IDs and source references |

Deleting an ordinary shape handle may reshape its route. A saved-view anchor
must not be deleted on just one track; remove the saved view first. Shared
stops and required endpoints remain protected. Preserve editability metadata.

When editing a camera that has path-facing gaze, capture the existing evaluated
gaze as an independent aim curve first so camera edits do not inadvertently
move both paths. This capture is an approximation and must be disclosed.
Retain all generated knots. Fixed-target aim can likewise be represented by an
explicit constant aim curve when pairing views. Do not later silently restore
automatic gaze over an independently authored look path.

## Feedback and mixed-version compatibility

The editor's `spatial-feedback/v1` agent change set uses `update-navigation`.
`change-path-curve` carries the complete replacement curve in `after`, including
names, offsets, generated knots, and timing maps. `change-look-behavior` can
carry the complete new aim strategy. `rename-path-item` identifies a journey,
stop, or transition using `item` and `itemId`, with the new name in `after`.
Handle and saved-view renames can arrive in whole-curve replacements.

Apply all operations for one navigation entry as a batch before validating the
result: a camera replacement and an aim replacement may jointly establish a
saved-view pair. Do not merge only changed XYZ positions into the old curve.
Geometry conversion is a replacement proposal, not proof that generated IDs
already refer to symbols in the site's source. Resolve the journey/segment
source reference and establish durable source mappings for newly authored items.

The outer schema version alone does not guarantee support for this extension.
Consumers must explicitly understand these fields and `timingVersion: 1`.
Unknown timing versions must be rejected, not ignored. An older consumer that
only reads Catmull–Rom positions will produce different motion even if it
accepts the JSON. Do not send extended curves to such a consumer as if lossless.

There is no automatic site migration or camera evaluator in this change. A
source author can implement these semantics in the site's controller, or
translate them into an equivalent native representation. If baking playback,
retain explicit sample times, paired camera/target values, and FOV with declared
error tolerances. The existing spatial-only `sampled.samples` point array is
not a time-stamped playback format and is not a lossless timing fallback.

`schemas/navigation-sequence-v1.schema.json` describes field shapes.
`validateSceneDocument` / `validateReviewIndex` additionally validate ordering,
IDs, references, geometry parameters, and cross-track saved-view pairing.
Legacy producers without extension fields continue to validate unchanged.

See [Apply navigation feedback](../agents/applying-navigation-feedback.md) for
the source-author workflow and runtime/editor acceptance checks.
