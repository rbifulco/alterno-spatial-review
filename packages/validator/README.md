# `@alterno-dev/spatial-review-validator`

Small dependency-free validators for untrusted Spatial Review documents.

Deferred live-transfer validation is split by trust boundary:
`validateAssetStreamDescriptor`, `validateSpatialReviewAssetStreamOffer`,
`validateSpatialReviewAssetRequest`,
`validateSpatialReviewAssetResponse`, `validateSpatialReviewSourceStatus`,
`validateSpatialReviewAssetProgress`, `validateSpatialReviewAssetCancel`, and
`validateAssetInstanceData`. Supply the negotiated byte ceiling when validating
a response or typed instance buffer.
