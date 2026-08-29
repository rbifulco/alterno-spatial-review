# @alterno-dev/spatial-review-protocol

## 0.5.0

### Minor Changes

- 61ff4c3: Add the opt-in `scene-assemblies-v1` ownership contract, transform-only assembly
  registration, parent-local actor poses, inherited visibility, and flattened
  world-space fallback for consumers that do not negotiate hierarchy. Add ownership
  validation, explicit assembly/placement feedback targets, migration guidance, and
  fixtures. Existing world-space transform semantics and flat producers are retained.
  Accepted in [Protocol change issue #11](https://github.com/rbifulco/alterno-spatial-review/issues/11).
  Component visibility remains independent from placement visibility, and valid
  near-singular XYZ transforms retain their exact source poses.

## 0.4.0

### Minor Changes

- 84e9efe: Add engine-neutral navigation sequences with authored camera and aim curves,
  journey stops, timing weights, lens transitions, stable control IDs, and source
  references. The SDK can register these sequences without scene actors, the
  browser bridge advertises them, and the validator checks their structure and
  cross-references.
- d0e5af6: Add negotiated metadata-first asset catalogs, per-family geometry requests and
  owned transferable typed arrays while retaining the existing JSON catalog path
  and browser bridge authorization. Bound family transfers and deduplicate modern
  and legacy catalog requests.

  Cache actor world transforms/bounds and serialized asset families with incremental
  invalidation. Add explicit registry invalidation and unregister operations.

  Share runtime geometry and materials with reference-counted disposal and retained
  preview cloning. Preserve explicit asset IDs and avoid copying typed attributes
  when building GPU buffers.

## 0.3.0

### Minor Changes

- bc2feea: Add the official hosted editor URL and deep-link helper, print the hosted review
  link after CLI validation, and make the SDK browser bridges trust the exact
  `https://spatial-review.alterno.dev` origin by default.

  Upgrade notice: installing the package still performs no network or page access,
  but starting either SDK bridge after upgrading authorizes the official editor to
  request deliberately registered discovery, scene, asset, material,
  source-reference, and texture data. Set `allowOfficialEditor: false` on both
  bridges to opt out. Additional editor origins remain explicitly allowlisted.

## 0.2.0

### Minor Changes

- d8950b8: Add origin-checked browser discovery and transferable live texture resources so client-only review editors can connect, render registered scenes, and load textures without CORS or a server relay. Editors and websites negotiate and enforce the lower per-resource byte limit during the catalog handshake.
