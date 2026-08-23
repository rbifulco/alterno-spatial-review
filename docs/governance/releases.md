# Maintainer release process

Alterno Spatial Review uses Changesets and keeps the protocol, SDK, validator, and CLI on one fixed version.

## Prepare a release

1. Confirm `main` is clean and up to date.
2. Confirm every user-visible package change has a reviewed changeset.
3. Run:

   ```bash
   npm ci
   npm test
   npm run pack:check
   npm run changeset:status
   npm run version-packages
   ```

4. Review all package versions, generated changelogs, internal dependency ranges, and migration notes.
5. Run the test and package checks again.
6. Commit the prepared release as `chore(release): version packages` on a
   same-repository `chore/release-*` branch and merge it through the normal
   protected-branch flow. CI reserves that branch prefix for release PRs and
   skips the contributor Changeset check because versioning has already
   consumed the reviewed Changeset.

## Publish

From the exact reviewed release commit, authenticate to npm with an account authorized for the `@alterno-dev` packages, then run:

```bash
npm ci
npm test
npm run pack:check
npm run release
```

Verify all four versions on npm and create a matching GitHub release summarizing the generated changelogs. Do not reuse a version or publish from an uncommitted working tree.

Publication remains an explicit maintainer action. If trusted publishing automation is introduced later, its workflow permissions, npm package trust configuration, environment protection, and rollback behavior must receive a dedicated security review.
