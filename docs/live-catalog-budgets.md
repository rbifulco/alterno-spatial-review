# Live catalog budgets

Schema-valid data can exceed a receiver's resource budgets. These are editor
implementation policies, not universal protocol or camera-runtime limits.
The current Alterno editor applies these limits to each complete catalog:

| Resource | Maximum |
| --- | ---: |
| Actors | 5,000 |
| Asset families | 2,000 |
| Navigation sequences | 200 |
| Navigation stops, summed across sequences | 5,000 |
| Navigation segments, summed across sequences | 5,000 |
| Camera and aim points, summed across sequences | 50,000 |
| Estimated structured-clone payload | 64 MiB |

The payload estimate includes object overhead and extension data; JSON string
length is not equivalent. Geometry, materials, textures and expanded instances
have additional budgets. Negotiated resource/geometry byte offers do not raise
catalog limits. Progressive asset loading does not defer navigation curves.

## Exporter / SDK guidance

SDK registration preserves data; it does not automatically resample it or
guarantee acceptance by every editor. Count the complete export, including
primary routes, optional journeys, representative transfers and `baseline`
(or legacy `baselineSequence`). Count every serialized occurrence of
`points.length` or, for sampled curves, `samples.length`. Both camera and
explicit aim curves count, including hidden/generated knots.

Thirty transfers with 1,025 camera and 1,025 aim samples already use 61,500
points. Prefer native authored curve definitions where they accurately model
runtime motion. For opaque playback, choose a bounded preview density with
headroom. Agree any narrower review scope with the user; do not silently omit
requested journeys. Reducing review sampling must not change live motion.

Preserve endpoints and shared playback timing. Sampled arrays are uniformly
timed: dropping arbitrary samples changes their timing. Compare interpolated
exported camera and aim poses against runtime poses between samples, including
sharp turns and arrival framing. Test aggregate counts and site-appropriate
position/angular error tolerances, then verify a real editor connection.

## Receiver guidance

Keep origin, source-window and request/profile checks before processing data;
ignore unrelated or stale messages. For a matching catalog rejected by
validation, stop retries and report the failure immediately. Show the count,
limit and remedy when known; use a clear invalid/over-budget diagnostic for
other failures. Do not silently wait for a connection timeout, relax validation,
or allocate rejected data. This is a local receiver diagnostic, not the
editor-origin authorization rejection wire message.

## Installation acceptance

Record review scope and aggregate navigation count in the integration plan.
Connect the ordinary website URL through the selected editor and verify catalog
acceptance and the exposed views. Bridge authorization tests alone do not prove
acceptance. If rejected, reduce density or agree a narrower scope and retry.
SDK upgrades alone do not fix oversized exports. Recheck budgets against the
target editor when upgrading.
