# Export navigation sequences

Use this procedure when exposing or revising an authored camera, scroll, or
guided-view route. For first-time integration, follow the permission and setup
steps in [Install Spatial Review](install.md). For actor boundaries and shared
source-mapping rules, read [Structuring for review](structuring-for-review.md).

Export one recognizable journey as a `NavigationSequence`: named stops,
ordered segments, camera and aim behavior, timing, FOV, and authored controls.
Complete the steps below for every journey selected for review.

## 1. Locate the authoritative journey

Before creating review data, find the code that actually controls:

- camera position;
- look target or facing direction;
- named pauses, reveals, portals, or other journey milestones;
- input or timeline allocation between phases; and
- FOV changes.

Build an adapter around those definitions so runtime changes also change the
review representation.

Navigation positions must use the same world-space axes and metres as the
registered scene actors. When runtime controls are stored in a parent's local
space, transform them to world space for review and retain a `sourceRef` to the
local authored definition. Record that conversion in the integration so a
later agent can correctly apply world-space feedback back to source.

**Complete when:** every exported behavior has an identified source definition,
and any coordinate conversion is recorded beside the adapter.

## 2. Choose stops by user meaning

A stop is a view or moment the reviewer can recognize, not every spline knot.
Good stops include “Entrance,” “Courtyard reveal,” “Doorway,” and “Final room.”
Create a new stop when the journey meaningfully changes its destination, view,
FOV, or phase.

Split the journey into segments between those stops. A segment is a useful
review boundary when the curve kind, aim behavior, timing, or lens behavior
changes. Export mutually exclusive routes or camera modes as separate
sequences instead of interleaving them into one ambiguous journey.

**Complete when:** each journey has named stops and ordered transitions whose
boundaries correspond to recognizable views or changes in runtime behavior.

## 3. Preserve the authored curve kind

Map the runtime representation to the closest lossless protocol form:

| Runtime intent | `NavigationCurve3` form | Authored points |
| --- | --- | --- |
| Straight movement | `line` | start, end |
| One Bézier control | `quadratic-bezier` | start, control, end |
| Outgoing and incoming controls | `cubic-bezier` | start, control-out, control-in, end |
| A rail through authored knots | `catmull-rom` | stop and through points |
| Opaque evaluated function | `sampled` | none; read-only samples |

For every authored point:

- use a stable semantic `id`, such as `doorway-camera-out`;
- assign its real role: `stop`, `through`, `control`, `control-in`, or
  `control-out`;
- attach `stopId` to endpoints that represent a canonical stop;
- attach the closest searchable `sourceRef`; and
- set `editable: false` when the position is calculated output rather than an
  input an agent should change.

Use `sampled` when the runtime curve cannot be expressed in an authored form.
It has no source-owned editable controls. A reviewer may propose a replacement
curve, but that proposal requires adapting the source implementation rather
than moving an existing authored input.

**Complete when:** each curve uses the closest supported representation, every
authored point has its role and identity, and calculated points and sampled
approximations are identified.

## 4. Export what the camera looks at

The camera path alone does not describe the resulting view. Choose one aim
strategy for every segment:

| Aim intent | Representation |
| --- | --- |
| Authored look-target path | `{ kind: "curve", curve }` |
| Face along travel, blending from and into stop views | `{ kind: "path-facing", ... }` |
| Keep one subject centered | `{ kind: "fixed-target", target }` |

For `path-facing`, preserve the runtime's look distance, pitch restriction, and
turn fraction when equivalent values exist. If the runtime uses an aim model the
contract cannot reproduce exactly, choose the closest honest representation
and state the approximation in the completion report.

**Complete when:** every segment has an aim strategy tied to runtime behavior,
with unsupported differences recorded.

## 5. Preserve timing and lens intent

`weight` is the segment's relative share of input or timeline duration. It is
deliberately independent of geometric distance. Use the same ratios as the
runtime rather than inserting extra curve points to make a segment feel longer.

Each stop owns its camera position, target, and FOV. `lensStart` is normalized
segment progress from `0` to `1` at which interpolation toward the destination
stop's FOV begins. Exact custom easing is not currently part of the contract;
report relative timing and any easing mismatch separately.

**Complete when:** weights preserve runtime ratios, each stop has its FOV, and
every lens transition has an explicit mapping or recorded approximation.

## 6. Map controls to source

Put a `sourceRef` on the sequence and more specific references on stops,
segments, and points wherever their authored definitions differ. For example,
`courtyard-camera-in` can refer to `src/scene/rail.ts#courtyardCameraIn`.

Connect shared endpoints through their canonical `stopId`. Adjacent camera
segments should refer to the same stop when they meet there; a stop edit can
then update both sides of the transition. Apply the same relation to aim-curve
endpoints representing that stop's target.

**Complete when:** every editable control resolves to an authored input and
shared endpoints resolve to the intended stop.

## 7. Register the sequence

Create the sequence from the authoritative runtime data, then register it
before starting the scene bridge:

```ts
import * as THREE from "three";
import type { NavigationSequence, Vec3 } from "@alterno-dev/spatial-review";
import { spatialReviewRegistry } from "./spatial-review";

const xyz = (value: THREE.Vector3): Vec3 => [value.x, value.y, value.z];

function buildArrivalJourneyForReview(): NavigationSequence {
  // These names stand for the existing runtime stops, curve, and timing data.
  const outside = arrivalStops.outside;
  const inside = arrivalStops.inside;

  return {
    id: "arrival-journey",
    name: "Arrival journey",
    category: "Primary navigation",
    sourceRef: "src/scene/rail.ts#arrivalJourney",
    stops: [
      {
        id: "outside",
        name: "Outside threshold",
        camera: xyz(outside.camera),
        target: xyz(outside.target),
        fov: outside.fov,
        sourceRef: "src/scene/rail.ts#outsideStop",
      },
      {
        id: "inside",
        name: "Interior reveal",
        camera: xyz(inside.camera),
        target: xyz(inside.target),
        fov: inside.fov,
        sourceRef: "src/scene/rail.ts#insideStop",
      },
    ],
    segments: [
      {
        id: "outside--inside",
        fromStopId: "outside",
        toStopId: "inside",
        sourceRef: "src/scene/rail.ts#arrivalCameraCurve",
        weight: arrivalScrollWeight,
        lensStart: arrivalLensStart,
        camera: {
          kind: "cubic-bezier",
          points: [
            {
              id: "outside-camera",
              role: "stop",
              stopId: "outside",
              position: xyz(outside.camera),
              sourceRef: "src/scene/rail.ts#outsideStop",
            },
            {
              id: "outside-camera-out",
              role: "control-out",
              position: xyz(arrivalCameraCurve.v1),
              sourceRef: "src/scene/rail.ts#outsideCameraOut",
            },
            {
              id: "inside-camera-in",
              role: "control-in",
              position: xyz(arrivalCameraCurve.v2),
              sourceRef: "src/scene/rail.ts#insideCameraIn",
            },
            {
              id: "inside-camera",
              role: "stop",
              stopId: "inside",
              position: xyz(inside.camera),
              sourceRef: "src/scene/rail.ts#insideStop",
            },
          ],
        },
        aim: {
          kind: "path-facing",
          lookDistance: arrivalLookDistance,
          maximumPitchRatio: 0.1,
          turnFraction: 0.18,
        },
      },
    ],
  };
}

spatialReviewRegistry.registerNavigationSequence(
  buildArrivalJourneyForReview(),
);
```

`registerNavigationSequence()` includes the journey in the live bridge and in
`registry.toReviewIndex()`. Registration takes a snapshot, so build and
register the definition after its authoritative route data is ready. Re-register
it when a live application intentionally replaces that route.

**Complete when:** a fresh catalog contains every intended journey with its
current source data, and route replacement refreshes the registered snapshot.

## 8. Verify the export

For each registered journey:

1. Open it with surrounding actors visible and compare coordinates, scale,
   and axes with the website.
2. Compare every named stop's camera position, target, and FOV with the runtime.
3. Scrub every segment and compare camera movement, aim, relative duration,
   and lens transition. Record any approximation.
4. Select every editable handle and resolve its ID and `sourceRef` to the
   authored input. Check read-only controls separately.
5. Move a representative handle and add a view or spline comment in disposable
   review state. Inspect the exported operation and anchor, including track,
   segment, progress, and evaluated view when present.
6. Test a shared stop at a segment boundary; confirm connected endpoints remain
   consistent. If handle additions or removals are relevant, inspect their
   insertion/removal IDs and any curve replacement in the export.
7. Rebuild unchanged source and confirm sequence, stop, segment, and point IDs
   remain stable. Replace route data and confirm refresh shows the new route.

**Complete when:** every exported journey has observed comparisons and a
traceable feedback example. Report blocked checks as unverified. Return to
[integration verification](install.md#6-verify-the-review-loop) for website tests,
builds, transport checks, and the completion report.

## Reference: editor behavior

The editor presents camera and aim trajectories separately, with stop handles,
authored controls, a camera frustum, and a playable timeline. Keep the controls
that explain the route, including through-points that are not journey stops.

Scene and Path share navigation behavior. Both support moving authored points,
camera and target stops, adjusting stop FOV, segment weight and `lensStart`,
playback, and comments anchored to a view or picked camera/aim spline location.

Reviewers can add local handles and delete eligible controls. Additions can
replace fixed-control curves with Catmull–Rom tracks; deleting Bézier controls
can reduce their degree. Shared stops, required endpoints, and read-only handles
are protected from deletion. Journey structure and stop ordering remain in source.

Treat exported additions, removals, curve replacements, and aim changes as
implementation proposals. Preserve their target IDs and insertion order when
mapping them to source; a replacement curve is more than a moved control.
