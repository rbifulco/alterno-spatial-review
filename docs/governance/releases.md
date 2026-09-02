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
   same-repository `chore/release-*` branch.
7. Merge the release branch through the normal protected-branch flow. CI
   reserves that branch prefix for release PRs. It skips the contributor
   Changeset check because versioning has already consumed the reviewed
   Changeset.

**Complete when:** `main` contains the prepared release commit. The repeated
test, package, version, changelog, dependency-range, and migration-note checks
all pass.

## Publish

From the exact reviewed release commit, authenticate to npm with an account authorized for the `@alterno-dev` packages, then run:

```bash
npm ci
npm test
npm run pack:check
npm run release
```

Verify all four versions on npm. Create a matching GitHub release. Summarize the
generated changelogs in that release. Do not reuse a version. Do not publish from
an uncommitted working tree.

**Complete when:** npm shows all four matching versions. The GitHub release
points to the reviewed release commit and contains the compatibility and
migration notes.

Publication remains an explicit maintainer action. Before introducing trusted
publishing automation, complete a dedicated security review. Include workflow
permissions, npm trust configuration, environment protection, and rollback
behavior in that review.
