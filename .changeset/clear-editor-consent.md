---
"@alterno-dev/spatial-review-protocol": minor
"@alterno-dev/spatial-review": minor
"@alterno-dev/spatial-review-cli": minor
---

Add the official hosted editor URL and deep-link helper, print the hosted review
link after CLI validation, and make the SDK browser bridges trust the exact
`https://spatial-review.alterno.dev` origin by default.

Upgrade notice: installing the package still performs no network or page access,
but starting either SDK bridge after upgrading authorizes the official editor to
request deliberately registered discovery, scene, asset, material,
source-reference, and texture data. Set `allowOfficialEditor: false` on both
bridges to opt out. Additional editor origins remain explicitly allowlisted.
