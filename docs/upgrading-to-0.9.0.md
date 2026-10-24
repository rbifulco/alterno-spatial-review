# Upgrade an existing website to Spatial Review 0.9.0

Version 0.9.0 preserves RGB/RGBA vertex colors and retains UVs and supported
texture maps in Scene exports. Use a compatible editor to display them. It does
not reproduce custom shaders, procedural projection, or the website's lighting.

## Instructions for the website developer

1. Follow [agents/install.md](../agents/install.md) as an update of the existing
   integration. Keep the existing review boundaries, stable IDs, and approved
   editor origins unless the requested work changes them.
2. Install `@alterno-dev/spatial-review@0.9.0` with the project's package manager
   and commit its lockfile. If the project directly depends on
   `@alterno-dev/spatial-review-protocol`, update that to `0.9.0` too. Keep the
   existing compatible Three.js version. The validator and CLI also use 0.9.0
   when the project depends on them.
3. Preserve geometry color attributes and the source material's `vertexColors`
   setting. Check how custom shaders use RGB: some store dirt, wear, or AO masks
   there. Do not enable color shading indiscriminately. Use a capture-only
   material approximation for such masks and record the omitted effects.
4. Keep the UVs and exportable texture sources required by the representation.
   Shared geometry and textures should remain shared. For deferred exports,
   list `"color"` when present and include exported float attribute sizes in
   `estimatedBytes`: RGB is 12 bytes per vertex, RGBA 16, and UVs 8. Texture
   bytes, decoded images, and GPU texture storage are separate costs.
5. Change the capture build identity or representation revision for the upgrade.
   Include dependency changes in any content-derived identity. Regenerate old
   prepared packages and static exports from source; updating the editor cannot
   restore fields already discarded by an older export.
6. Run the project's tests and production build. Starting from the ordinary
   website URL, connect the updated editor and compare one affected colored or
   textured subject without selection highlighting. Check texture readiness in
   Scene and Asset when exposed, stable feedback targets, and unchanged ordinary
   website behavior. Record remaining shader/lighting approximations and
   observed resource cost. Use the existing deployment workflow, then repeat
   the representative check on the published URL.

## Copyable coding-agent request

```text
Update this website's existing Spatial Review integration to SDK 0.9.0.
Follow https://github.com/rbifulco/alterno-spatial-review/blob/main/agents/install.md
and https://github.com/rbifulco/alterno-spatial-review/blob/main/docs/upgrading-to-0.9.0.md.
Preserve existing review IDs, boundaries, approved origins, and ordinary website
behavior. Retain visible vertex colors, UVs, and supported textures. Inspect
custom shader color masks rather than enabling vertexColors on every material.
Update the lockfile and capture revisions, regenerate older exports, and verify
one affected subject in the updated editor. Run the existing tests and build,
publish using this project's deployment workflow, and report the deployed URL,
installed versions, checks, resource costs, and remaining visual limitations.
```
