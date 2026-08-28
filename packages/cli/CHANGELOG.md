# @alterno-dev/spatial-review-cli

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
  - @alterno-dev/spatial-review-validator@0.4.0

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

### Patch Changes

- Updated dependencies [bc2feea]
  - @alterno-dev/spatial-review-protocol@0.3.0
  - @alterno-dev/spatial-review-validator@0.3.0

## 0.2.0

### Minor Changes

- d8950b8: Add origin-checked browser discovery and transferable live texture resources so client-only review editors can connect, render registered scenes, and load textures without CORS or a server relay. Editors and websites negotiate and enforce the lower per-resource byte limit during the catalog handshake.

### Patch Changes

- Updated dependencies [d8950b8]
  - @alterno-dev/spatial-review-protocol@0.2.0
  - @alterno-dev/spatial-review-validator@0.2.0
