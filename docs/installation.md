# Install Spatial Review manually

This guide introduces the SDK and browser bridges for developers installing
Spatial Review by hand. Coding agents must follow the complete
[installation and update workflow](../agents/install.md), which also covers
planning, lifecycle, browser checks, performance, and reporting.

[Return to the project overview](../README.md).

> [!IMPORTANT]
> Installing the package alone does not expose data or start a connection.
> Calling either bridge enables its corresponding browser access.
> Both bridges trust the exact official editor origin by default:
> `https://spatial-review.alterno.dev`.
> The discovery bridge exposes discovery metadata.
> The capture bridge exposes registered roots and their supported descendants.
> This data can include descendant geometry, materials, textures, and texture
> bytes that are intended for review.
> Neither bridge automatically exposes arbitrary DOM, cookies, storage,
> unrelated application state, or objects outside registered roots.
> Registered texture URL strings are part of review data. Remove credentials,
> signed query tokens, and other secrets from those strings before bridge
> attachment.
>
> Websites may advertise an optional editor-origin compatibility policy and the
> capture bridge explicitly rejects a correlated unauthorized handshake without
> exposing scene data. The advertised policy improves preflight UX but never
> replaces runtime origin checks. See the
> [editor-origin authorization contract](editor-origin-authorization.md).
>
> When the editor embeds the discovery page or capture page, that page must
> permit framing by the exact editor origin. An opener-based popup does not
> require a framing exception.

Before you call either bridge, follow
[Obtain permission](../agents/install.md#1-obtain-permission).

Select one representative subject for each editor view that the integration
exposes. Record its authoritative source, expected appearance, and expected
behavior. These records are the capture baseline.

## 1. Install the Three.js SDK

```sh
npm install @alterno-dev/spatial-review three
```

**Complete when:** the lockfile resolves the SDK and a Three.js version inside
the SDK's `peerDependencies` range. The website build passes.

## 2. Register meaningful scene objects

```ts
import {
  SceneAssetRegistry,
  attachSceneAssetRegistryBridge,
  attachSpatialReviewDiscoveryBridge,
  createSpatialReviewEditorAuthorization,
} from "@alterno-dev/spatial-review";

const authorization = createSpatialReviewEditorAuthorization({
  // Use true only after the user approves the official hosted editor.
  allowOfficialEditor: true,
  // Different loopback ports are trusted only with an explicit local-dev opt-in.
  allowLoopbackPeers: false,
  // Public discovery is opt-in and must list every finite runtime editor origin.
  advertiseEditorOriginPolicy: {
    publicOrigins: ["https://spatial-review.alterno.dev"],
  },
});

attachSpatialReviewDiscoveryBridge({
  name: "My spatial project",
  liveCapture: "/?spatial-review-capture=1",
}, authorization);

const registry = new SceneAssetRegistry("project-v1");

registry.register({
  actorId: "main-building",
  assetId: "main-building",
  name: "Main building",
  category: "Architecture",
  sourceRef: "src/scene/buildings/createMainBuilding.ts#createMainBuilding",
  root: mainBuilding,
  tags: ["building", "primary"],
});

registry.registerNavigationSequence({
  id: "arrival-journey",
  name: "Arrival journey",
  sourceRef: "src/scene/rail.ts#arrivalJourney",
  stops: [
    { id: "entry", name: "Entry", camera: [0, 1.7, 6], target: [0, 1.5, 0], fov: 50, sourceRef: "src/scene/rail.ts#entry" },
    { id: "court", name: "Courtyard", camera: [4, 1.7, 1], target: [0, 1.5, 0], fov: 44, sourceRef: "src/scene/rail.ts#court" },
  ],
  segments: [{
    id: "entry--court",
    fromStopId: "entry",
    toStopId: "court",
    weight: 1,
    camera: {
      kind: "line",
      points: [
        { id: "entry-camera", role: "stop", stopId: "entry", position: [0, 1.7, 6], sourceRef: "src/scene/rail.ts#entry" },
        { id: "court-camera", role: "stop", stopId: "court", position: [4, 1.7, 1], sourceRef: "src/scene/rail.ts#court" },
      ],
    },
    aim: { kind: "fixed-target", target: [0, 1.5, 0] },
  }],
});

attachSceneAssetRegistryBridge(registry, authorization);
```

`allowOfficialEditor` defaults to `true`, but the example spells it out so the
authorization is visible in source. Cross-origin loopback access requires
`allowLoopbackPeers: true` during local development. Additional production
editors must be exact canonical HTTPS origins in `allowedOrigins`. Runtime
origins stay private unless an immutable shared configuration explicitly lists
the complete finite set in `advertiseEditorOriginPolicy.publicOrigins`.

Navigation sequences are semantic camera journeys rather than generic splines.
They keep camera position, aim, journey stops, segment timing, lens transitions,
stable point IDs, and source references together so review tools can return
spatially anchored feedback an agent can apply to the original implementation.
See [Export navigation sequences](../agents/exporting-navigation-sequences.md)
for the agent-facing extraction and presentation guide.

**Complete when:** the capture page registers each listed review subject and starts
only the bridges approved by the user.

## 3. Open the hosted editor

Open [Spatial Review](https://spatial-review.alterno.dev/) and paste the website
URL, or deep-link directly:

```ts
import { spatialReviewEditorUrl } from "@alterno-dev/spatial-review";

const reviewUrl = spatialReviewEditorUrl(window.location.href);
// https://spatial-review.alterno.dev/review?site=...
```

**Complete when:** the editor connects and shows each representative subject in
the capture baseline.

## 4. Optionally publish the discovery document

The discovery bridge above is sufficient for a client-only editor. To support
the CLI and other non-browser tools, also serve
`/.well-known/spatial-review.json`:

```json
{
  "schema": "spatial-review-discovery/v1",
  "version": 1,
  "name": "My spatial project",
  "websiteUrl": "/",
  "liveCapture": "/?spatial-review-capture=1"
}
```

**Complete when:** each advertised static URL returns a valid document. Skip
this step when the integration uses browser discovery only.

## 5. Optionally validate the deployed document

Run this command when the deployment publishes static discovery:

```sh
npx @alterno-dev/spatial-review-cli validate https://project.example
```

**Complete when:** the CLI reports no discovery, schema, or reference error.
When the deployment does not publish static discovery, skip this step and record
that validation is browser-only.

> [!TIP]
> Using an AI coding agent? Point it to the
> [installation and update workflow](../agents/install.md). It covers adding the SDK
> to an existing website or refining its integration and exports against updated
> guidance, then verifying feedback in each applicable editor.

<details>
<summary><strong>Install directly from source instead of npm</strong></summary>

```sh
git clone https://github.com/rbifulco/alterno-spatial-review.git
cd alterno-spatial-review
npm ci
npm run build

cd ../my-spatial-website
npm install \
  file:../alterno-spatial-review/packages/protocol \
  file:../alterno-spatial-review/packages/sdk
```

The local packages export their compiled `dist` directories, so build the
checkout before installing it. The [source-installation guide](install-from-source.md)
covers active development, vendoring, CI, and updates.

</details>
