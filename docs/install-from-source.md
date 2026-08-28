# Install Alterno Spatial Review from source

Use a source installation when you want to audit the implementation, develop
the SDK and a website together, test an unreleased change, or avoid downloading
Alterno Spatial Review packages from the npm registry.

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
- Node.js `>=22.13.0`
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
npm ci
npm test
npm run build
```

For reproducible work, check out a reviewed commit or release tag before
building:

```sh
git checkout <commit-or-tag>
```

The build creates the `dist` directories exported by each package.

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

### Linked-checkout limitation

The relative `file:` paths must exist anywhere the website runs. This is ideal
for local development or a parent workspace, but it is not portable when the
website repository is cloned by itself.

Use vendored tarballs when CI or deployment receives only the website
repository.

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
├── alterno-dev-spatial-review-protocol-0.1.0.tgz
└── alterno-dev-spatial-review-0.1.0.tgz
```

The protocol archive is required even when the website imports only the SDK,
because it is an exact runtime dependency of the SDK.

### 3. Install both local archives

```sh
cd ../my-spatial-website

npm install \
  ./vendor/alterno-spatial-review/alterno-dev-spatial-review-protocol-0.1.0.tgz \
  ./vendor/alterno-spatial-review/alterno-dev-spatial-review-0.1.0.tgz
```

Commit the selected archives, `package.json`, and `package-lock.json` if the
repository is expected to install without the source checkout or npm registry.

### 4. Verify an offline-compatible install

First perform the normal clean install:

```sh
npm ci
npm test
npm run build
```

Then verify in the actual CI or deployment environment that the committed
archives are available before `npm ci`. Other third-party dependencies may
still require their configured registry; this workflow only removes the npm
registry requirement for the Alterno Spatial Review packages.

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
2. delete or archive the old local tarballs;
3. run `npm pack` again;
4. install the new local archives;
5. inspect the package and lockfile diff; and
6. rerun website tests and the production build.

Never change the contents of a previously published or vendored version while
keeping the same version label. Pin the source commit alongside the archive
names when testing unreleased code.

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

Then follow the [integration workflow](../agents/install.md), retaining the
completed package installation and checking its permission and review-structure steps.
