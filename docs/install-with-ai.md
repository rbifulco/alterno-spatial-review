# Install Alterno Spatial Review with an AI coding agent

This guide is written as an implementation procedure for a coding agent. Its
goal is not merely to make a website technically discoverable. The integration
must present the scene and its assets in a form that helps a reviewer express
clear intent and helps the agent map that feedback back to code.

The examples use Three.js and TypeScript. Adapt file locations and environment
variable syntax to the website's framework without changing the protocol.

## Expected result

After completing the guide, the website will:

- expose deliberately selected scene actors through the public SDK;
- preserve canonical asset/component hierarchy, materials, and texture
  references;
- optionally publish a versioned discovery document for non-browser tools;
- expose the same discovery metadata through the browser bridge;
- accept live review requests only from allowed origins;
- work with an editor on a different localhost port;
- optionally publish static scene and asset manifests; and
- pass the Spatial Review validator after deployment when publishing the
  optional discovery document.

Do not change the rendered experience solely for the integration. The review
representation should describe the existing experience.

## Step 1: inspect the project before editing

Locate:

1. the installed Three.js version;
2. the code that creates the authoritative `THREE.Scene`;
3. factories or loaders that create the meaningful buildings, props,
   characters, environment pieces, and other reviewable roots;
4. repeated placements that share one canonical design;
5. the deployment platform's public environment-variable convention;
6. the public/static directory; and
7. any existing build step that can generate JSON manifests.

Do not register a second copy of the scene. Integrate with the same Object3D
roots that the user sees.

## Step 2: install the SDK

Retain the project's existing compatible Three.js version. Choose exactly one
of the following installation methods.

### Option A: install the published package

```sh
npm install @alterno-dev/spatial-review
```

If Three.js is not already installed:

```sh
npm install three @alterno-dev/spatial-review
```

The SDK declares Three.js as a peer dependency so the application and
integration use the same runtime.

### Option B: install from source

Use this option when the task requires auditing, modifying, or testing the SDK
source alongside the website:

```sh
git clone https://github.com/rbifulco/alterno-spatial-review.git
cd alterno-spatial-review
npm ci
npm test
npm run build

cd ../my-spatial-website
npm install \
  file:../alterno-spatial-review/packages/protocol \
  file:../alterno-spatial-review/packages/sdk
```

Both local packages are required because the SDK imports the engine-neutral
protocol package. Build the source checkout before installing it; package
exports point to compiled `dist` files.

Local `file:` dependencies are appropriate when the checkout will remain next
to the website. For a portable repository or deployment, build tarballs from a
pinned checkout and keep them inside the consuming project. Follow
[Install from source](install-from-source.md) for that workflow.

## Step 3: create one integration module

Create a module such as `src/spatial-review.ts`. Keep review-specific setup in
this file while registrations remain close to the code that creates each
reviewable root.

```ts
import {
  SceneAssetRegistry,
  attachSceneAssetRegistryBridge,
  attachSpatialReviewDiscoveryBridge,
  type SceneAssetRegistryBridgeOptions,
} from "@alterno-dev/spatial-review";

const buildId =
  import.meta.env.VITE_APP_VERSION ??
  import.meta.env.VITE_GIT_COMMIT ??
  "development";

export const spatialReviewRegistry = new SceneAssetRegistry(buildId);

function configuredEditorOrigins() {
  return String(import.meta.env.VITE_SPATIAL_REVIEW_EDITOR_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function startSpatialReviewBridge() {
  const options: SceneAssetRegistryBridgeOptions = {
    allowedOrigins: configuredEditorOrigins(),
  };
  return attachSceneAssetRegistryBridge(spatialReviewRegistry, options);
}

export function startSpatialReviewDiscoveryBridge() {
  return attachSpatialReviewDiscoveryBridge({
    name: "Afterlight village",
    liveCapture: "/?spatial-review-capture=1",
  }, {
    allowedOrigins: configuredEditorOrigins(),
  });
}
```

Use the equivalent public environment API for Next.js, Astro, SvelteKit,
webpack, or another framework. The origin allowlist is public configuration,
not a secret.

Do not use a timestamp as the supplied build ID. Prefer a release version or
commit identifier that helps connect a review to the code that produced it.

## Step 4: register coherent scene actors

Register an Object3D after its hierarchy, names, geometry, and materials are
ready. The root may be a mesh, group, imported GLTF scene, or an assembly of
multiple roots.

```ts
import { spatialReviewRegistry } from "./spatial-review";

const gate = createVillageGate();
scene.add(gate);

spatialReviewRegistry.register({
  actorId: "village-gate",
  assetId: "village-gate",
  name: "Village gate",
  category: "Architecture",
  sourceRef: "src/scene/architecture/createVillageGate.ts#createVillageGate",
  root: gate,
  tags: ["entrance", "architecture", "navigation-landmark"],
  order: 10,
});
```

When one semantic actor is assembled from several sibling roots, pass
`roots`:

```ts
const bridgeParts = createFootbridge();
bridgeParts.forEach((part) => scene.add(part));

spatialReviewRegistry.register({
  actorId: "footbridge",
  assetId: "footbridge",
  name: "Footbridge",
  category: "Architecture",
  sourceRef: "src/scene/architecture/createFootbridge.ts#createFootbridge",
  roots: bridgeParts,
  tags: ["bridge", "circulation"],
});
```

Do not register every triangle or leaf as a separate actor. Do not register the
entire `THREE.Scene` as one asset. Choose roots at the scale on which a person
can express a meaningful design decision.

## Step 5: represent repeated assets correctly

`actorId` identifies one placement in the scene. `assetId` identifies the
canonical design shared by placements.

```ts
const chairPlacements = [
  { id: "chair-table-north", position: [-0.8, 0, -0.4], rotationY: 0.2 },
  { id: "chair-table-south", position: [0.9, 0, 0.5], rotationY: 3.25 },
];

for (const [index, placement] of chairPlacements.entries()) {
  const chair = createDiningChair();
  chair.position.fromArray(placement.position);
  chair.rotation.y = placement.rotationY;
  scene.add(chair);

  spatialReviewRegistry.register({
    actorId: placement.id,
    assetId: "dining-chair",
    name: `Dining chair / ${placement.id}`,
    category: "Furniture",
    sourceRef: "src/scene/furniture/placeDiningChairs.ts#chairPlacements",
    root: chair,
    tags: ["furniture", "seating"],
    order: 100 + index,
  });
}
```

This lets scene review discuss one chair's placement while asset review discusses
the shared chair design once. Never use an array index alone as a durable
`actorId`; give each intended placement a stable authored ID.

## Step 6: make component hierarchy stable and meaningful

The serializer preserves the registered Object3D hierarchy. Component IDs are
derived from the asset ID, semantic object names, and hierarchy paths. Before
registration:

- assign stable names to important groups and meshes;
- preserve child order across builds;
- keep meaningful components separate when they may receive separate feedback;
- group implementation-only fragments when they should be reviewed as one
  component; and
- name materials according to their design role.

```ts
const canopy = new THREE.Group();
canopy.name = "Entrance canopy";

const frame = buildCanopyFrame();
frame.name = "Structural frame";

const roofPanel = buildCanopyRoof();
roofPanel.name = "Roof panel";

const drainage = buildCanopyDrainage();
drainage.name = "Rainwater channel";

roofPanel.material.name = "Weathered zinc";
frame.material.name = "Painted steel";

canopy.add(frame, roofPanel, drainage);
```

Avoid names such as `Mesh_17`, `Group004`, or random UUIDs when a semantic
name is available. Avoid rebuilding a hierarchy from unordered object keys.
Stable structure is what allows feedback such as “raise the rainwater channel
by 8 cm” to remain addressable after another build.

## Step 7: preserve texture sources

Asset review is much more useful when the presented material matches the
website. The serializer recognizes normal decoded image URLs. Explicitly
annotate URL-backed textures when they were cloned, created through a custom
loader, or otherwise lose their original source. Canvas and other generated
textures can be transferred from their in-memory image data without a URL.

```ts
const wallTextureUrl = new URL(
  "/assets/materials/weathered-wall.webp",
  window.location.href,
).href;

const wallTexture = await new THREE.TextureLoader().loadAsync(wallTextureUrl);
wallTexture.name = "Weathered wall albedo";
wallTexture.userData.sourceRef = wallTextureUrl;

const wallMaterial = new THREE.MeshStandardMaterial({
  name: "Weathered limestone",
  map: wallTexture,
  roughness: 0.88,
  metalness: 0,
});
```

The editor first tries a source URL directly when CORS permits it. If that is
unavailable, it requests the registered texture through the live bridge and
the SDK transfers encoded bytes with `postMessage`. A texture therefore does
not need a public or CORS-enabled URL. Do not register textures that expose
secrets or data the trusted review origin should not receive.

The live catalog handshake negotiates the per-texture byte ceiling. The editor
and SDK each advertise a maximum and both enforce the lower value; the SDK
defaults to 16 MB.

The review profile transfers color, emissive, roughness, metalness, opacity,
double-sided state, supported texture slots, UV data, and texture transforms.
The scene profile intentionally omits supplied normals, UVs, and texture maps to
reduce transfer size; it does not decimate polygons.

## Step 8: start and clean up the bridges

Start the lightweight discovery bridge from the ordinary website entry page.
It lets a client-only editor learn the live-capture URL through `postMessage`
when CORS is unavailable:

```ts
import { startSpatialReviewDiscoveryBridge } from "./spatial-review";

const stopSpatialReviewDiscovery = startSpatialReviewDiscoveryBridge();

if (import.meta.hot) {
  import.meta.hot.dispose(() => stopSpatialReviewDiscovery());
}
```

Start the scene bridge after the website has created its reviewable scene. Keep the
returned cleanup function for hot reload or component unmount.

```ts
import { startSpatialReviewBridge } from "./spatial-review";

const stopSpatialReviewBridge = startSpatialReviewBridge();

if (import.meta.hot) {
  import.meta.hot.dispose(() => stopSpatialReviewBridge());
}
```

In React, start it in the effect that owns the Three.js scene and call the
returned function during cleanup:

```tsx
useEffect(() => {
  const scene = createExperienceScene();
  registerExperienceForSpatialReview(scene);
  const detach = startSpatialReviewBridge();

  return () => {
    detach();
    disposeExperienceScene(scene);
  };
}, []);
```

Both bridges reply only to allowed origins and only to their parent/opener
window. Do not replace this with a wildcard discovery or catalog response.

## Step 9: configure local and production origins

Local development should use different ports so it exercises real cross-origin
behavior:

```text
Review tool:       http://localhost:3000
Integrated site:  http://localhost:4000
```

Loopback origins are mutually accepted by the SDK. No future production domain
is needed for local testing.

For deployment, provide one or more exact origins:

```env
VITE_SPATIAL_REVIEW_EDITOR_ORIGINS=https://review.example.com
```

Multiple origins are comma-separated:

```env
VITE_SPATIAL_REVIEW_EDITOR_ORIGINS=https://review.example.com,https://staging-review.example.com
```

Use origins only—scheme, hostname, and optional port—with no path.

## Step 10: optionally publish discovery for non-browser tools

Skip this step when only the client-only editor must connect. To additionally
support the CLI or another non-browser consumer, create
`public/.well-known/spatial-review.json`, or the equivalent static route for the
framework:

```json
{
  "schema": "spatial-review-discovery/v1",
  "version": 1,
  "name": "Afterlight village",
  "websiteUrl": "/",
  "liveCapture": "/?spatial-review-capture=1"
}
```

The optional document must advertise at least one transport:

- `liveCapture` points to a page that creates and registers the live scene;
- `scene` points to a published scene manifest; and
- `assets` points to a published asset manifest.

When static manifests are available, advertise all useful fallbacks:

```json
{
  "schema": "spatial-review-discovery/v1",
  "version": 1,
  "name": "Afterlight village",
  "websiteUrl": "/",
  "scene": "/spatial-review/scene.json",
  "assets": "/spatial-review/assets.json",
  "liveCapture": "/?spatial-review-capture=1"
}
```

Relative paths resolve from the discovery URL. The discovery document and
advertised static manifests must be public JSON for CLI validation. Cross-origin
browser access is optional: the editor races a direct CORS request against the
discovery bridge, then uses the live capture when static manifests cannot be
fetched directly.

### Optional: generate the asset manifest at build time

If the application can construct its reviewable Three.js roots during a Node.js
build step, use the same registration function and serialize the detailed asset
catalog:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { SceneAssetRegistry } from "@alterno-dev/spatial-review";
import { buildReviewableScene } from "../src/scene/buildReviewableScene";

const registry = new SceneAssetRegistry(process.env.GIT_COMMIT ?? "build");
await buildReviewableScene({ registry });

const assets = registry.toAssetDocument("review");
await mkdir("public/spatial-review", { recursive: true });
await writeFile(
  "public/spatial-review/assets.json",
  JSON.stringify(assets, null, 2),
);
```

Do not maintain a separate hand-written asset hierarchy if the live scene can
authoritatively generate it. One construction path reduces drift between what
the user sees and what the reviewer inspects.

An authored scene manifest may deliberately be lighter. It should preserve
layers, world-space placement, canonical `assetId` links, stable source
references, and enough geometry or primitive bounds to recognize composition:

```json
{
  "schema": "spatial-feedback/v1",
  "id": "courtyard",
  "name": "Courtyard proposal",
  "units": "m",
  "layers": [
    {
      "id": "reference",
      "name": "Existing context",
      "color": "#87949a",
      "visible": true,
      "locked": true
    },
    {
      "id": "proposal",
      "name": "Design proposal",
      "color": "#e7a849",
      "visible": true,
      "locked": false
    }
  ],
  "objects": [
    {
      "id": "main-building-placement",
      "assetId": "main-building",
      "name": "Main building",
      "shape": "box",
      "layerId": "proposal",
      "position": [0, 0, 0],
      "rotation": [0, 18, 0],
      "size": [12, 7.5, 8],
      "color": "#c2a477",
      "opacity": 1,
      "visible": true,
      "sourceRef": "src/scene/buildings/createMainBuilding.ts#createMainBuilding",
      "feedback": {
        "state": "open",
        "note": "",
        "comments": []
      }
    }
  ]
}
```

This box is an authored scene-level proxy for judging placement and scale. The
linked `main-building` asset remains the detailed canonical presentation for
component and material review.

## Present scenes and assets for effective review

Technical validity alone is not enough. Structure the presentation around the
decisions a reviewer may ask the agent to make.

### Scene presentation: preserve context and relationships

The scene view should answer:

- Where is each important actor?
- How large is it relative to nearby actors and the user?
- Which layer or design system does it belong to?
- Is it visible, locked reference context, or an editable proposal?
- Which canonical asset does the placement use?

Include enough surrounding context to judge distance, silhouette, circulation,
occlusion, alignment, and scale. Large terrain or background context may use an
authored lightweight proxy when full detail adds cost without improving the
decision.

Keep scene transforms in world space and use metres. A coarse scene proxy is an
explicit authored representation; the SDK's `scene` profile is not automatic
polygon simplification.

### Asset presentation: preserve construction and material intent

An asset should appear at a stable local origin as a canonical object, separate
from any one scene placement. Its hierarchy should correspond to editable
design responsibilities:

```text
Village gate
├── Masonry body
│   ├── Left pier
│   ├── Right pier
│   └── Arch ring
├── Timber door
│   ├── Door leaf
│   └── Iron hardware
└── Drainage
    └── Rainwater channel
```

This is more effective than either extreme:

- one flattened mesh, which prevents component-specific feedback; or
- thousands of anonymous fragments, which overwhelm the reviewer and give the
  agent no clear implementation boundary.

Retain geometry and UV detail when it affects silhouette, topology, continuity,
material placement, or surface notes. Use primitives for genuinely primitive
intent or deliberately authored proxy geometry—not as an automatic replacement
for recognizable assets.

### Source references: make feedback actionable

`sourceRef` is the handoff from visual feedback to code. Prefer references an
agent can search:

```text
src/scene/architecture/createVillageGate.ts#createVillageGate
src/content/assets/village-gate.glb#ArchRing
src/scene/furniture/placeDiningChairs.ts#chairPlacements
```

Avoid ephemeral blob URLs, generated bundle filenames, temporary IDs, and line
numbers that change on every edit.

### Review selection checklist

Register an object when at least one of these is true:

- its placement or scale affects the experience;
- its silhouette or proportions may change;
- its components may receive different instructions;
- its material or texture treatment matters;
- it is a navigation, interaction, or composition landmark; or
- the agent needs a direct source mapping to revise it.

Exclude:

- cameras, lights, transform controls, bounding boxes, and debug helpers;
- particle fragments or foliage leaves that have no individual design intent;
- duplicate LODs unless the LOD itself is under review;
- hidden implementation geometry that would confuse selection; and
- anything private or inaccessible to the intended reviewer.

## Step 11: verify the integration

Run the application tests and production build first:

```sh
npm test
npm run build
```

After deploying, validate the public URL:

```sh
npx @alterno-dev/spatial-review-cli validate https://project.example.com
```

The command should report whether scene, asset, and live transports are
available.

Also perform these behavioral checks:

1. `/.well-known/spatial-review.json` returns JSON with status 200.
2. An editor on another origin can discover `liveCapture` through
   `postMessage` while the discovery response omits CORS headers.
3. Every advertised scene or asset URL intended as a static fallback returns public JSON.
4. A review tool on another localhost port receives both `scene` and
   `review` profiles.
5. An unlisted production origin cannot retrieve discovery or the live catalog.
6. Rebuilding without content changes preserves actor IDs, asset IDs, component
   names, hierarchy order, and source references.
7. Repeated placements share an `assetId` but retain unique `actorId` values.
8. Important materials show the expected texture maps.
9. Selecting an asset component gives the agent a recognizable name and
   searchable source reference.

## Completion report for the coding agent

When finished, report:

- package version installed;
- files added or changed;
- discovery URL and advertised transports;
- number and categories of registered actors;
- how repeated assets were represented;
- how component names and source references were stabilized;
- which texture sources were preserved;
- configured local and production origins;
- validation/build results; and
- any assets intentionally excluded or represented by authored proxies.
