# `@alterno-dev/spatial-review-validator`

Small dependency-free validators for untrusted Spatial Review documents.

Use `validateSceneDocument` and `validateAssetDocument` for advertised static
documents. They validate required render structure, references, hierarchy,
finite transforms and geometry, and aggregate safety limits. Use
`validateReviewIndex` for a combined live catalog. Static asset validation
requires embedded renderable geometry; consumers validating a standalone live
metadata catalog can explicitly pass `{ allowStreamMetadata: true }`.

Deferred live-transfer validation is split by trust boundary:
`validateAssetStreamDescriptor`, `validateSpatialReviewAssetStreamOffer`,
`validateSpatialReviewAssetRequest`,
`validateSpatialReviewAssetResponse`, `validateSpatialReviewSourceStatus`,
`validateSpatialReviewAssetProgress`, `validateSpatialReviewAssetCancel`, and
`validateAssetInstanceData`. Supply the negotiated byte ceiling when validating
a response or typed instance buffer.

`validateSpatialReviewEditorOriginPolicy` checks advisory discovery policy,
including exact canonical origins and loopback-only HTTP.
`validateSpatialReviewConnectionRejected` checks the correlated live-capture
authorization rejection. Its optional message remains untrusted display text.
