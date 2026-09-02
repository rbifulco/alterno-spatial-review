# Install Alterno Spatial Review from source

Use this document only for the package-install branch of
[Install or update Spatial Review](../agents/install.md#3-install-or-update-the-sdk).
Complete permission and representation planning in steps 1 and 2 of that
procedure before you run these commands. Return to step 4 after the source
installation is complete.

When you must audit the implementation, develop the SDK and a website together,
test an unreleased change, or avoid registry downloads, use a source
installation.

The commands still use npm as the local build/package tool. They install code
from a Git checkout or locally built archive rather than fetching
`@alterno-dev` from the registry.

Choose one workflow:

- **Linked checkout** for active development on one machine.
- **Vendored tarballs** for a portable project, CI, or deployment.

Do not copy individual SDK source files into the website. The public packages
have an intentional boundary, build output, and dependency on the protocol
package.

## Requirements

- Git
- Node.js `^22.11` or `^24`
- npm
- The website's existing compatible `three` dependency, or permission to add
  it

## Workflow A: linked checkout

This is the fastest option when the website and Spatial Review checkouts remain
next to each other.

### 1. Clone and build

```sh
git clone https://github.com/rbifulco/alterno-spatial-review.git
cd alterno-spatial-review
git checkout <reviewed-commit-or-tag>
npm ci
npm test
npm run build
```

The build creates the `dist` directories exported by each package.

**Complete when:** tests pass at the selected commit and all package `dist`
directories exist.

### 2. Install the local protocol and SDK

From the consuming website:

```sh
cd ../my-spatial-website
npm install \
  file:../alterno-spatial-review/packages/protocol \
  file:../alterno-spatial-review/packages/sdk
```

If Three.js is not already installed:

```sh
npm install three
```

The website's `package.json` will contain local dependencies similar to:

```json
{
  "dependencies": {
    "@alterno-dev/spatial-review": "file:../alterno-spatial-review/packages/sdk",
    "@alterno-dev/spatial-review-protocol": "file:../alterno-spatial-review/packages/protocol",
    "three": "^0.180.0"
  }
}
```

Use paths relative to the website repository. Do not commit absolute paths such
as `/Users/name/workspace/...`.

**Complete when:** the website lockfile resolves the local protocol package,
SDK package, and compatible Three.js package through relative paths.

### 3. Use the normal package imports

Application code is identical whether the package came from the registry or a
checkout:

```ts
import {
  SceneAssetRegistry,
  attachSceneAssetRegistryBridge,
} from "@alterno-dev/spatial-review";
```

Do not import from `packages/sdk/src` in application code. The normal package
entry point preserves the same boundary used by released builds.

**Complete when:** application imports use only public package entry points.

### 4. Iterate on SDK source

After editing the Spatial Review checkout:

```sh
cd ../alterno-spatial-review
npm test
npm run build

cd ../my-spatial-website
npm install
npm test
npm run build
```

Some package managers cache local packages. If a consumer does not see a source
change, reinstall the two local dependencies explicitly.

**Complete when:** the SDK tests, SDK build, website tests, and website build all
pass with the changed source.

### Linked-checkout limitation

The relative `file:` paths must exist anywhere the website runs. This is ideal
for local development or a parent workspace, but it is not portable when the
website repository is cloned by itself.

When CI or deployment receives only the website repository, use vendored
tarballs.

## Workflow B: vendored tarballs

This workflow builds standard npm package archives from source and stores them
inside the consuming repository. npm installs those local files without
downloading Alterno Spatial Review from the registry.

### 1. Clone and pin the source

```sh
git clone https://github.com/rbifulco/alterno-spatial-review.git
cd alterno-spatial-review
git checkout <commit-or-tag>
npm ci
npm test
npm run build
```

Record the selected commit in the website's dependency documentation so an
agent can reproduce the archives.

**Complete when:** the source checkout is pinned, tested, built, and recorded.

### 2. Pack the required packages into the website

Assuming the website is next to the source checkout:

```sh
mkdir -p ../my-spatial-website/vendor/alterno-spatial-review

npm pack \
  --workspace=@alterno-dev/spatial-review-protocol \
  --pack-destination=../my-spatial-website/vendor/alterno-spatial-review

npm pack \
  --workspace=@alterno-dev/spatial-review \
  --pack-destination=../my-spatial-website/vendor/alterno-spatial-review
```

This produces files similar to:

```text
vendor/alterno-spatial-review/
├── alterno-dev-spatial-review-protocol-VERSION.tgz
└── alterno-dev-spatial-review-VERSION.tgz
```

The protocol archive is required even when the website imports only the SDK,
because it is an exact runtime dependency of the SDK.

**Complete when:** the vendor directory contains archives for the protocol and
SDK from the recorded source revision.

### 3. Install both local archives

```sh
cd ../my-spatial-website

npm install \
  ./vendor/alterno-spatial-review/alterno-dev-spatial-review-protocol-VERSION.tgz \
  ./vendor/alterno-spatial-review/alterno-dev-spatial-review-VERSION.tgz
```

Replace `VERSION` with the archive version that `npm pack` prints.

Commit the selected archives, `package.json`, and `package-lock.json` if the
repository is expected to install without the source checkout or npm registry.

**Complete when:** `package.json` and the lockfile resolve both committed local
archives.

### 4. Verify an offline-compatible install

First perform the normal clean install:

```sh
npm ci
npm test
npm run build
```

When CI or another environment must consume the archives, verify that the
committed archives are available there before `npm ci`. Other third-party
dependencies may still require their configured registry. This workflow only
removes the npm registry requirement for the Alterno Spatial Review packages.

**Complete when:** the clean install, affected tests, and existing build resolve
the committed archives without the Spatial Review source checkout. Each
explicitly targeted CI or deployment environment also resolves them.

## Installing validators and the CLI from source

Websites need only the protocol and SDK. If a repository also wants local
validator or CLI archives, build and pack in dependency order:

```sh
npm pack \
  --workspace=@alterno-dev/spatial-review-validator \
  --pack-destination=../my-spatial-website/vendor/alterno-spatial-review

npm pack \
  --workspace=@alterno-dev/spatial-review-cli \
  --pack-destination=../my-spatial-website/vendor/alterno-spatial-review
```

Install the protocol, validator, and CLI archives together so all exact local
dependencies are available.

**Complete when:** the lockfile resolves the selected protocol, validator, and
CLI archives from the recorded source revision. The CLI runs from its public
package entry point.

## Updating a source installation

For a linked checkout:

```sh
cd ../alterno-spatial-review
git fetch origin
git checkout <new-commit-or-tag>
npm ci
npm test
npm run build

cd ../my-spatial-website
npm install
npm test
npm run build
```

For vendored tarballs:

1. check out and validate the new source revision;
2. archive old local tarballs when an audit or rollback needs them, and label the
   archive with its source revision;
3. otherwise, delete the old local tarballs;
4. run `npm pack` again;
5. install the new local archives;
6. inspect the package and lockfile diff; and
7. rerun the affected website tests and its existing build when the integration
   changed build inputs or shared application code.

Never change the contents of a previously published or vendored version while
keeping the same version label. Pin the source commit alongside the archive
names when testing unreleased code.

**Complete when:** the consuming website records the new revision, passes its
tests and build, and contains no stale package reference.

## Verification

Confirm the website resolves the expected package:

```sh
node --input-type=module -e \
  'import("@alterno-dev/spatial-review").then((sdk) => console.log(typeof sdk.SceneAssetRegistry))'
```

Expected output:

```text
function
```

**Complete when:** the import prints `function` and the website uses the expected
package revision.

Return to
[Implement the representation](../agents/install.md#4-implement-the-representation).
Keep the completed package-installation evidence. Repeat permission or planning
only when the selected integration scope changed during installation.

**Complete when:** the integration plan links the source-installation evidence
and the agent continues at step 4 of the main procedure.
