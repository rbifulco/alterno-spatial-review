# @alterno-dev/spatial-review-validator

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

### Patch Changes

- Updated dependencies [61ff4c3]
  - @alterno-dev/spatial-review-protocol@0.5.0

## 0.4.0

### Minor Changes

- 84e9efe: Add engine-neutral navigation sequences with authored camera and aim curves,
  journey stops, timing weights, lens transitions, stable control IDs, and source
  references. The SDK can register these sequences without scene actors, the
  browser bridge advertises them, and the validator checks their structure and
  cross-references.

### Patch Changes

- Updated dependencies [84e9efe]
- Updated dependencies [d0e5af6]
  - @alterno-dev/spatial-review-protocol@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [bc2feea]
  - @alterno-dev/spatial-review-protocol@0.3.0

## 0.2.0

### Minor Changes

- d8950b8: Add origin-checked browser discovery and transferable live texture resources so client-only review editors can connect, render registered scenes, and load textures without CORS or a server relay. Editors and websites negotiate and enforce the lower per-resource byte limit during the catalog handshake.

### Patch Changes

- Updated dependencies [d8950b8]
  - @alterno-dev/spatial-review-protocol@0.2.0
