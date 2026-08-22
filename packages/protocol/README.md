# `@alterno-dev/spatial-review-protocol`

Versioned, engine-neutral TypeScript contracts and URL normalization for
Alterno Spatial Review.

The browser discovery request/response messages let an embedded website
advertise its normalized discovery document without CORS or an editor backend.

The live browser protocol includes an optional `resource-transfer-v1`
capability. Texture map descriptors carry resource IDs, and request/response
messages move encoded image bytes with transferable `ArrayBuffer` values. Both
peers advertise `maxBytes` during the catalog handshake and use the lower limit.
