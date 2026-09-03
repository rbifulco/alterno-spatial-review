# @alterno-dev/spatial-review-validator

## 0.7.0

### Minor Changes

- 5990868: Add advisory editor-origin policy discovery, policy evaluation and validation,
  and correlated exact-origin rejection for unauthorized live-capture handshakes.
  Configured editor origins now require exact canonical HTTPS values (HTTP only
  for loopback). Browser discovery keeps runtime origins private unless a frozen
  shared authorization explicitly discloses the complete finite set. This release
  also changes cross-origin loopback from implicitly allowed to denied by default;
  existing local integrations must set `allowLoopbackPeers: true` to retain the
  previous behavior.

### Patch Changes

- Updated dependencies [5990868]
  - @alterno-dev/spatial-review-protocol@0.7.0

## 0.6.0

### Minor Changes

- 952e334: Add negotiated deferred asset streaming, cancellable asynchronous SDK producers,
  revision-aware representation requests, bounded progress/status messages, and
  typed instance transfer buffers while retaining complete and progressive legacy
  fallbacks. Cancellation releases scheduler capacity even when a producer is
  uncooperative, source status aggregates all peers, and superseded live texture
  leases no longer survive their asset revision. Negotiated byte limits cover the
  complete clone payload, and deferred catalog responses cannot mix conflicting
  per-peer negotiation state. Completed geometry and asynchronously requested
  texture resources use independent bounded caches with a delivery grace, and the
  last detached bridge releases all deferred session resources. Resource eviction
  also invalidates stale geometry and revision reuse until a complete replacement
  has been produced. Catalog retries remain recoverable with the same request ID
  when a transient scene-validation failure prevents the earlier response.
- 5431f9c: Add explicit and project-relative discovery locators across the protocol, SDK,
  validator release set, and CLI while preserving canonical root discovery for
  existing integrations. Resolve browser-bridge fields from the advertised
  manifest URL and reject embedded credentials in every discovery payload URL.
- e3810b2: Keep deferred representation revisions stable across concurrent requests, reject
  stale producer completions, validate complete static scene and asset structures,
  and constrain CLI document fetches to explicitly trusted origins and redirects.

### Patch Changes

- cdf7588: Align producer and consumer safety limits, preserve shared deferred asset
  resources while their canonical registration remains live, accept valid line
  and point geometry, reject non-renderable static assets, and validate bounded
  material references and geometry groups. Bare-host CLI discovery remains
  compatible with protocol URL normalization. Derived stream offers and cloned
  typed-instance aliases remain within the same negotiated transfer ceiling.
- Updated dependencies [952e334]
- Updated dependencies [5431f9c]
- Updated dependencies [cdf7588]
  - @alterno-dev/spatial-review-protocol@0.6.0

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
