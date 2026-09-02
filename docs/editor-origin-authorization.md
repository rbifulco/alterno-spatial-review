# Editor-origin compatibility and live-capture rejection

The wire fields are an additive `spatial-review-discovery/v1` extension that
lets an editor detect a known origin mismatch before it opens live capture. The
SDK authorization defaults also tighten cross-origin loopback access, as
described in [Migration and mixed versions](#migration-and-mixed-versions).
The runtime rejection keeps
authorization authoritative when discovery metadata is absent, stale, or
incorrect. Protocol issue
[#24](https://github.com/rbifulco/alterno-spatial-review/issues/24) is the design
record and requires recorded maintainer acceptance before this contract merges.

## Discovery contract

A producer may advertise an advisory policy for its live-capture endpoint:

```json
{
  "schema": "spatial-review-discovery/v1",
  "version": 1,
  "name": "Example project",
  "websiteUrl": "https://project.example/",
  "liveCapture": "https://project.example/capture",
  "capabilities": {
    "liveCapture": {
      "editorOriginPolicy": {
        "mode": "allowlist",
        "origins": ["https://spatial-review.alterno.dev"],
        "allowLoopbackPeers": true
      }
    }
  }
}
```

`mode` has these meanings:

- `allowlist` requires a non-empty, duplicate-free `origins` array.
- `same-origin` accepts an editor whose origin equals the live-capture
  producer's origin. It must not include `origins`.
- `any` declares no discovery-time origin restriction. It must not include
  `origins`; the producer still validates the runtime source window and origin.

Each allowlisted value is an absolute URL origin, not a page URL. Paths,
queries, fragments, credentials, and wildcards are invalid. Production origins
use HTTPS. HTTP is valid only for `localhost`, `127.0.0.1`, and `::1` development
origins. `allowLoopbackPeers: true` accepts differing ports only when both the
editor and live producer are on one of those loopback hosts. This is an
explicit opt-in because different loopback ports are different security
principals and may be controlled by unrelated local processes.

The policy is public compatibility metadata, not an access-control decision.
Do not put private network addresses, tokens, credentials, or other secrets in
it. A producer must check the observed `postMessage` origin and source window
for every runtime request regardless of the advertised result.

Consumers can call `editorOriginPolicyAllows(policy, editorOrigin,
liveCaptureUrl)` after discovery normalization. If the field is absent, its
result is unknown: attempt the existing handshake and keep the existing bounded
timeout. If the result is false, warn before opening an iframe or popup. A
consumer may use a valid static scene/asset fallback, but must explain that the
live source is unavailable.

## Runtime rejection

A producer that recognizes a catalog handshake from its parent or opener but
does not authorize the observed origin returns only this correlated response:

```json
{
  "type": "spatial-review:connection-rejected",
  "requestId": "request-123",
  "code": "editor-origin-not-authorized",
  "message": "Use an authorized editor origin or a bundled scene snapshot."
}
```

The producer sends it to `event.source` with `event.origin` as the exact target
origin. It never uses `*`. `requestId` must match a bounded, non-empty handshake
request ID. Malformed requests and messages from windows other than the parent
or opener receive no response. The rejection contains no scene, asset,
credential, or private allowlist data.

The only defined `code` is `editor-origin-not-authorized`. Additional codes
require protocol review. `message` is optional, untrusted display text; render
it through a text API and never as HTML. Consumer behavior is based on `code`,
not the prose.

An editor accepts a rejection only from the expected live-capture window and
origin and only when its `requestId` matches the active handshake. It then stops
the wait immediately and presents an authorization error. A rejection, a
timeout, an empty response, or missing scene data is not a ready state. Only a
validated catalog with usable review data, or an explicitly loaded usable
static fallback, may make the workspace ready.

The hosted editor implementation is maintained outside this repository. This
repository owns the wire types, policy evaluator, rejection validator, producer
bridge behavior, conformance fixtures, and the editor requirements above.

## SDK producer configuration

Use `createSpatialReviewEditorAuthorization()` to validate and freeze one
authorization decision for both bridges. Runtime origins remain private unless
the configuration explicitly discloses the complete finite set:

```ts
import { createSpatialReviewEditorAuthorization } from "@alterno-dev/spatial-review";

const authorization = createSpatialReviewEditorAuthorization({
  allowOfficialEditor: true,
  allowedOrigins: [],
  allowLoopbackPeers: false,
  advertiseEditorOriginPolicy: {
    publicOrigins: ["https://spatial-review.alterno.dev"],
  },
});

attachSpatialReviewDiscoveryBridge({
  name: "My spatial project",
  liveCapture: "/?spatial-review-capture=1",
}, authorization);

attachSceneAssetRegistryBridge(registry, authorization);
```

Every `allowedOrigins` and public origin value must be an exact canonical HTTPS
origin, except that HTTP is allowed for the three loopback hosts. Invalid
credentials, paths, queries, fragments, wildcards, default-port aliases, and
insecure non-loopback origins fail before bridge attachment.

The public list must exactly equal all finite non-same-origin runtime access,
including the official editor when enabled. This deliberate duplication is the
review boundary that prevents an SDK upgrade from publishing existing private
`allowedOrigins`. A mismatch fails configuration. A shared configuration with
no disclosure, all raw bridge options, and every dynamic `allowOrigin` callback
leave policy unspecified. Supplying an explicit discovery policy with unrelated
raw options also fails; the SDK cannot prove those objects share a decision.

The frozen shared object enforces alignment only for bridges in the same
JavaScript deployment. Static discovery documents and separately deployed pages
remain deployment artifacts; generate and review their public policy from the
same external decision. The capture bridge never trusts public discovery
metadata.

## Migration and mixed versions

Cross-origin loopback authorization is a deliberate compatibility tightening.
Older SDKs accepted another loopback port automatically when the producer was
on loopback. This SDK denies it by default because a different local port may be
controlled by another process. Existing local integrations that rely on the
old behavior must set `allowLoopbackPeers: true` on both bridges, preferably
through one shared authorization. Same-origin loopback access is unchanged.

- Existing discovery documents remain valid because `capabilities` is optional.
- Existing consumers ignore the optional discovery field and rejection message,
  retaining their bounded timeout behavior.
- New consumers connecting to old producers evaluate no policy, attempt the
  existing handshake, and retain their bounded timeout.
- New producers keep the existing successful catalog handshake for authorized
  old and new consumers. Unauthorized requests with a valid request ID receive
  a rejection that old consumers safely ignore.
- Producers may publish the policy and adopt explicit rejection independently;
  discovery never replaces runtime authorization.
- Existing runtime `allowedOrigins` remain private after upgrade. Browser
  discovery advertises them only after explicit complete public disclosure.

Conformance covers policy validation, loopback and same-origin evaluation,
missing-policy compatibility, correlated rejection, exact-origin response,
source-window checks, and absence of protected scene data in rejections.
