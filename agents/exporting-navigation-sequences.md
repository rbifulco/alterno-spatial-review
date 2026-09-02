# Export navigation sequences

Use this procedure when a website has an authored camera route, scroll route,
guided view, or comparable spatial journey. Apply the procedure to every
journey selected for Experience review.

Use this procedure as a conditional branch of
[Install or update Spatial Review](install.md). For a new or updated
integration, first [obtain permission](install.md#1-obtain-permission) and
[define the review representation](install.md#2-define-the-review-representation).
Apply [Choose actor boundaries](structuring-for-review.md#choose-actor-boundaries)
and [Preserve identity and source mapping](structuring-for-review.md#preserve-identity-and-source-mapping).
Apply the [stable semantic ID and searchable source reference definitions](install.md#terms).
Apply sections 1 through 6 while you define the review representation. Then
return to [Complete the integration plan](install.md#complete-the-integration-plan).
The main procedure points back to section 7 during implementation and section 8
during browser verification.

## 1. Locate the authoritative journey

Find the source definitions that control these values:

- camera position;
- aim target or facing direction;
- named pauses, reveals, portals, or other milestones;
- input or timeline allocation; and
- FOV changes.

Build integration code that maps those definitions to a `NavigationSequence`.
This integration code is the navigation adapter. Use the same world axes and
metres as the registered scene actors.

When source controls use a parent-local frame, convert them to world space for
review. Record the inverse conversion beside the adapter. Keep a `sourceRef` to
the local authored definition.

**Complete when:** each exported behavior has an authoritative source. Each
coordinate conversion has a recorded inverse operation.

## 2. Choose stops by user meaning

A stop is recognizable when a reviewer can match its name, camera, target, and
FOV to one distinct runtime state without inspecting code. Use a stop for each
such state. Add a stop when the journey changes destination, view, FOV, or
phase. Keep implementation-only spline knots out of the stop list.

Use a segment between two stops. Start a new segment when the authored curve
model, aim, timing, or lens behavior changes. Export mutually exclusive routes
as separate `NavigationSequence` records.

**Complete when:** every journey has named stops and ordered segments. Each
boundary matches a recognizable view or runtime behavior change.

## 3. Preserve the authored curve model

A lossless mapping preserves the authored curve model, every editable input,
and endpoint identity without resampling. The protocol `kind` identifies the
curve model. Select the `kind` that matches the authoritative authored model.
Do not infer the model from the evaluated curve shape.

| Runtime intent | Protocol `kind` | Authored points |
| --- | --- | --- |
| Straight movement | `line` | Start and end |
| One Bézier control | `quadratic-bezier` | Start, control, and end |
| Outgoing and incoming controls | `cubic-bezier` | Start, control-out, control-in, and end |
| Rail through authored knots | `catmull-rom` | Stops and through-points |
| Opaque evaluated function | `sampled` | Read-only samples |

Meet these protocol limits:

| Field | Valid value |
| --- | --- |
| `line.points` | Exactly 2 finite XYZ points |
| `quadratic-bezier.points` | Exactly 3 finite XYZ points |
| `cubic-bezier.points` | Exactly 4 finite XYZ points |
| `catmull-rom.points` | At least 2 finite XYZ points |
| `sampled.samples` | At least 2 finite XYZ samples |
| Stop `fov` | More than 0 degrees and less than 180 degrees |
| Segment `weight` | More than 0 |
| `lensStart` | From 0 through 1 |
| `path-facing.lookDistance` | More than 0 |
| `path-facing.maximumPitchRatio` | 0 or more |
| `path-facing.turnFraction` | From 0 through 0.5 |

Give each stop, segment, and authored point a nonempty ID. Keep each ID unique
within its sequence or curve scope. Reference only declared stop IDs.

Give each authored point these fields:

- a stable semantic `id`;
- its actual role;
- `stopId` when it represents a canonical stop;
- the closest searchable `sourceRef`; and
- `editable: false` when it is calculated output.

Use these point roles:

| Role | Meaning |
| --- | --- |
| `stop` | Canonical journey endpoint linked by `stopId` |
| `through` | Authored point that a Catmull–Rom curve passes through |
| `control` | Single quadratic Bézier control |
| `control-out` | Cubic Bézier control that leaves the start stop |
| `control-in` | Cubic Bézier control that enters the end stop |

For `catmull-rom`, also map `closed`, `curveType`, and `tension` from the
authoritative curve. Here, `curveType` is the Catmull–Rom runtime parameter. It
does not select the protocol curve model.

When no authored protocol curve can represent the runtime curve, use `sampled`.
Treat a proposed replacement of a sampled curve as a source-design change.

**Complete when:** each curve uses the first matching protocol `kind`. Every
authored point has stable identity, role, editability, and source mapping.

## 4. Export the aim behavior

Select one aim strategy for each segment:

| Aim intent | Representation |
| --- | --- |
| Authored target path | `{ kind: "curve", curve }` |
| Face along travel | `{ kind: "path-facing", ... }` |
| Keep one subject centered | `{ kind: "fixed-target", target }` |

For `path-facing`, preserve the runtime look distance, pitch restriction, and
turn fraction when the protocol has equivalent fields. Record each unsupported
difference as an approximation in the integration plan.

**Complete when:** every segment has an aim strategy that maps to runtime
behavior. The integration plan contains each approximation.

## 5. Preserve timing and lens intent

Set `weight` from the runtime share of input or timeline duration. Keep it
independent of geometric distance.

Give each stop its camera position, target, and FOV. Set `lensStart` to the
normalized segment progress from `0` to `1` where interpolation to the
destination FOV starts.
Record an unsupported easing function as an approximation.

**Complete when:** segment weights preserve runtime ratios. Each stop has its
FOV. Each lens transition has an explicit source mapping or approximation.

## 6. Map controls to source

Put a `sourceRef` on the sequence. Add more specific references to stops,
segments, and points when they use different source definitions.

Connect a shared endpoint with its canonical `stopId`. Use the same relation for
camera endpoints and aim endpoints that represent the same stop.

**Complete when:** every editable control resolves to an authored input. Every
shared endpoint resolves to the intended stop.

## 7. Register the sequence

Build the `NavigationSequence` from authoritative runtime data. Register it
after that data is ready and before you attach the capture bridge. The SDK
publishes `catalog-ready` after the first catalog request.

Use `registry.registerNavigationSequence(sequence)`. Registration stores a
snapshot. Register the sequence again when the application replaces its
authoritative route.

Use the [SDK navigation example](../packages/sdk/README.md#register-camera-journeys)
for field-level code. Keep the procedure in this file as the source of truth for
selection, mapping, and verification rules.

**Complete when:** a fresh catalog contains every selected journey. A route
replacement refreshes the registered snapshot.

## 8. Verify the selected journey

Select one representative journey. Open it with its surrounding actors. Compare
one recognizable stop and one segment with the website runtime. Confirm the
camera, target, FOV, motion, aim, and relative duration.

Move one representative editable handle. Pass when the export contains its
stable point ID and searchable `sourceRef`. When the selected journey exposes a
read-only handle, inspect one. Pass when the editor prevents an edit and keeps
its calculated position unchanged.

When the selected journey contains a shared stop, inspect one connected pair.
Pass when both endpoints reference the same `stopId` and remain coincident after
one permitted edit. Add one view or spline comment. Pass when its exported
target identifies the selected journey and segment.

Run unchanged-rebuild and route-replacement checks only when this integration
adds or changes navigation registration or refresh behavior. Pass when an
unchanged rebuild preserves the selected IDs. Pass when replacement data
appears after refresh without retaining the replaced snapshot.

Record each approximation and unsupported feedback field.

**Complete when:** the representative runtime comparison passes. The supported
feedback export maps to source. Each triggered rebuild or replacement check has
an explicit result. Return to the
[lean browser checks](install.md#6-verify-the-review-loop).
