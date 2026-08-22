# Install Alterno Spatial Review with an AI coding agent

## Objective

Make the current Three.js website discoverable by an Alterno Spatial Review
compatible editor without changing the rendered experience.

## Required procedure

1. Install `@alterno-dev/spatial-review` and retain the website's existing `three` version.
2. Locate the code that constructs the authoritative Three.js scene.
3. Register semantic roots with stable `actorId`, `assetId`, and `sourceRef` values.
4. Preserve public texture URLs in `texture.userData.sourceRef` where automatic discovery is unreliable.
5. Attach the bridge with localhost plus configured production editor origins.
6. Publish `public/.well-known/spatial-review.json` or the framework equivalent.
7. Run the website's tests and build.
8. Run `npx @alterno-dev/spatial-review-cli validate <deployed-url>` after deployment.

Do not expose arbitrary objects, credentials, private URLs, or a wildcard
catalog response. The bridge must serialize only explicitly registered roots.
