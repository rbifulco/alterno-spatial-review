---
"@alterno-dev/spatial-review-protocol": minor
"@alterno-dev/spatial-review": minor
"@alterno-dev/spatial-review-validator": minor
"@alterno-dev/spatial-review-cli": minor
---

Add advisory editor-origin policy discovery, policy evaluation and validation,
and correlated exact-origin rejection for unauthorized live-capture handshakes.
Configured editor origins now require exact canonical HTTPS values (HTTP only
for loopback). Browser discovery keeps runtime origins private unless a frozen
shared authorization explicitly discloses the complete finite set. This release
also changes cross-origin loopback from implicitly allowed to denied by default;
existing local integrations must set `allowLoopbackPeers: true` to retain the
previous behavior.
