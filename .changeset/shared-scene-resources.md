---
"@alterno-dev/spatial-review-protocol": minor
"@alterno-dev/spatial-review": minor
---

Add negotiated metadata-first asset catalogs, per-family geometry requests and
owned transferable typed arrays while retaining the existing JSON catalog path
and browser bridge authorization. Bound family transfers and deduplicate modern
and legacy catalog requests.

Cache actor world transforms/bounds and serialized asset families with incremental
invalidation. Add explicit registry invalidation and unregister operations.

Share runtime geometry and materials with reference-counted disposal and retained
preview cloning. Preserve explicit asset IDs and avoid copying typed attributes
when building GPU buffers.
