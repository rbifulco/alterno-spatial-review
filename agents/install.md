# Install or update Spatial Review on an existing website

Use this procedure to add the SDK to an existing website or refine an existing
integration and its exports against updated guidance.
If the target website or its source is missing, ask for its location
before proceeding.

Derive review exports from the website's authoritative scene, asset, and
navigation definitions. The examples use Three.js and TypeScript; adapt paths
and lifecycle hooks to the existing framework.

Complete the steps in order. Preserve the website's behavior while exporting
its scene, assets, and applicable journeys according to
[Structuring for review](structuring-for-review.md). A reviewer must be able to
connect, identify a target, export feedback, and map it back to source in every
applicable editor. Package installation and bridge connectivity are intermediate
checks, not completion of the integration.

## 1. Obtain permission

For an existing integration, retain the user's recorded authorization when the
origins, exposed data, and framing scope remain unchanged. Ask for approval
before expanding that scope. If no recorded decision covers the intended access,
use the checkpoint below.

Before installing the SDK or enabling either bridge, ask the user to approve
the review access. A general request to add Spatial Review is not approval.
Include these facts in the question:

- The exact official editor origin is `https://spatial-review.alterno.dev`.
- Installation alone exposes nothing; starting a bridge enables access.
- The editor may receive discovery metadata, deliberately registered scene
  and asset structures, materials, source references, and registered texture bytes.
- It receives no arbitrary DOM, application state, credentials, or unregistered
  scene objects.
- The discovery and capture pages must permit embedding by that exact origin;
  this may require a scoped HTTP framing-policy change.
- `allowOfficialEditor: false` disables official-editor authorization.

Use this formulation:

> Do you approve enabling `https://spatial-review.alterno.dev` as an editor?
> This grants permission to that domain to receive the
> scene, asset, material, source-reference, and texture data we explicitly
> decide to register for review, and to embed the discovery and capture pages,

Wait for an affirmative answer before writing `allowOfficialEditor: true` or
broadening framing permissions. If declined, record `false`. Ask separately
for each additional production origin before adding it to `allowedOrigins`.

**Complete when:** the user has made a decision covering data access and framing,
and every proposed production editor origin has an explicit authorization decision.

## 2. Define the review structure

Inspect the target website's scene creation, asset factories/loaders, placement
data, camera controller, entry route, and deployment headers. Identify any
installed SDK, bridge configuration, registrations, and static exports.

Read and apply [Structuring for review](structuring-for-review.md) before
changing construction or registrations. Compare existing exports with the
current guidance, identify gaps, and record a compact integration plan:

| Inventory | Required decisions |
| --- | --- |
| Integration | First installation or refinement; current SDK and exports, guidance gaps, required changes |
| Actors | Independent selections, placement IDs, relevant surrounding context |
| Assets | Shared designs, distinct variants, component hierarchy, materials |
| Journeys | Applicable routes, meaningful stops, authored camera and aim inputs |
| Source mapping | Source definitions for placements, components, and path controls; coordinate conversions |
| Capture | Entry URL, readiness condition, reproducible scene state, refresh lifecycle |

For the website's authored camera, scroll, or guided-view motion, also read and
apply [Export navigation sequences](exporting-navigation-sequences.md). Mark
review scales as not applicable only when the existing experience does not
use them; missing exports for existing content remain integration work.

**Complete when:** every intended review target has an owner in source and a
review scale, the required integration changes are identified, and exclusions,
proxies, and unsupported behavior are recorded.

## 3. Install or update the SDK as needed

Retain the website's framework, routes, and working behavior. Use its existing
run/build commands to establish a baseline before changing the integration.
Record pre-existing failures separately from failures introduced by this work.

If the SDK is already installed, keep the compatible version unless the plan
requires an upgrade. Review compatibility and permission changes before
upgrading. Refining registrations or exports may require no package change.

Inspect the website's dependencies and retain its compatible Three.js runtime.
If the SDK is missing, run from the website using its package manager
(npm shown):

```sh
npm install @alterno-dev/spatial-review
```

Add `three` if the website does not already depend on it. The SDK uses Three.js
as a peer dependency so registration and rendering share the same runtime.

For SDK development, unreleased changes, or vendored packages, follow
[Install from source](../docs/install-from-source.md), then return here. Resolve
the normal package exports; a source checkout must be built before use.

**Complete when:** the website runs at a known URL, its build succeeds, and it
resolves the selected SDK and compatible Three.js versions with reproducible
dependency and lockfile changes.

## 4. Implement or refine registration and review exports

Add or update registrations, capture setup, and export code according to the
gaps from step 2. Refine scene or asset construction only where necessary to
expose meaningful review targets, while preserving the rendered experience.
Apply the structure guide throughout implementation: shared assets, named
components, placement data, and authored journey controls must remain traceable
to the source that renders them.

Export each applicable review scale through the registry:

| Website content | Required review representation |
| --- | --- |
| Scene composition | Independent actors with stable placement IDs, asset links, transforms, bounds, and enough context to judge relationships |
| Asset construction | Canonical asset definitions with meaningful component hierarchy, local transforms, geometry, materials, and available textures |
| Authored navigation | Sequences built from runtime stops, camera and aim controls, timing, and FOV; follow the navigation guide for each route |

Live export is required for this workflow. Static JSON exports are an additional
transport when needed in step 5. Both must describe the same rendered content.

Keep bridge configuration in one integration module. Register actors close to
their authoritative construction code, after their hierarchy and resources are
ready. Use the boundaries and source mappings from step 2.

```ts
// src/spatial-review.ts
import {
  SceneAssetRegistry,
  attachSceneAssetRegistryBridge,
  attachSpatialReviewDiscoveryBridge,
} from "@alterno-dev/spatial-review";

// Supply the release version or commit through the website's build system.
const buildId = import.meta.env.VITE_GIT_COMMIT ?? "development";
export const spatialReviewRegistry = new SceneAssetRegistry(buildId);

const bridgeOptions = {
  allowOfficialEditor: false, // Set true only after step 1 approval.
  allowedOrigins: [] as string[], // Additional approved exact origins only.
};

export function startReviewDiscovery() {
  return attachSpatialReviewDiscoveryBridge({
    name: "Courtyard",
    liveCapture: "/?spatial-review-capture=1",
  }, bridgeOptions);
}

export function startReviewCapture() {
  return attachSceneAssetRegistryBridge(spatialReviewRegistry, bridgeOptions);
}
```

Adapt the build variable to the framework. A release or commit identifies the
reviewed code; an explicitly labeled development fallback is for local work.

```ts
// In the scene construction module, after creating and attaching the gate.
spatialReviewRegistry.register({
  actorId: "gate-courtyard-entry",
  assetId: "courtyard-gate",
  name: "Courtyard entrance gate",
  category: "Architecture",
  sourceRef: "src/scene/gates.ts#courtyardEntry",
  root: gate,
  tags: ["entrance", "landmark"],
  order: 10,
});
```

`gate` is the root already used by the website. For one actor assembled from
sibling roots, pass `roots: gateParts`; their order and first-root coordinate
frame must remain stable. Register journeys using the navigation guide.

Start discovery on the ordinary entry page. Start capture after all intended
registrations are ready. The advertised capture URL must construct that same
content without requiring a reviewer to scroll, click, or wait for an unrelated
interaction. Select and document a reproducible state for procedural or animated
experiences, while preserving the normal website behavior.

Keep the cleanup functions returned by both bridges and call them on unmount
or hot reload. Retain the capture page while live resource requests are needed.
For runtime actor changes, read the installed SDK's
[cache and lifecycle rules](../packages/sdk/README.md#large-scenes-and-resource-ownership)
and use the APIs available in that version. Navigation registrations are cloned
snapshots: register again after replacing their authoritative definitions.
An updated registry becomes visible when the editor requests fresh data.

Inspect the generated review index against the step 2 inventory. Resolve every
actor, asset, component, and journey to its rendering definition, and apply the
[structure acceptance checklist](structuring-for-review.md#acceptance-checklist).

**Complete when:** the website preserves its existing behavior, its export
contains every planned review target with the required structure, both bridges
use the recorded permission decision, and capture/refresh/unmount behavior is
implemented. Record any incomplete item rather than marking this step complete.

## 5. Configure transport

Read the [website integration reference](../docs/integrating-a-website.md) when
configuring production origins, framing headers, or texture transfer. Preserve
existing security policy; authorize only approved origins on the narrowest
routes the deployment supports.

For browser review, the discovery and capture bridges are sufficient. CORS
access to static JSON and textures is optional. Test with the website and editor
on different localhost ports before checking the approved production origin.

If CLI validation or non-browser discovery is required, publish
`/.well-known/spatial-review.json`:

```json
{
  "schema": "spatial-review-discovery/v1",
  "version": 1,
  "name": "Courtyard",
  "websiteUrl": "/",
  "liveCapture": "/?spatial-review-capture=1"
}
```

If static fallbacks are required, add `scene` and/or `assets` URLs to discovery.
Generate them from the same authoritative construction path as live capture.
`registry.toReviewIndex()` includes actors, journeys, and assets;
`registry.toAssetDocument("review")` exports the detailed asset document.
Publish portable JSON and resolve texture references relative to the manifest.
Advertise only files that the deployment actually serves.

For authored layers or deliberate context proxies, follow
[scene organization](structuring-for-review.md#scene-organization); those are
separate presentation choices from automatic live registration.

**Complete when:** an editor on an approved origin receives the intended
catalog, an unlisted production origin receives no protected data, and every
advertised static fallback resolves to the expected document.

## 6. Verify the review loop

Run the website's existing tests and production build using its package scripts.
When publishing the optional discovery document, also run:

```sh
npx @alterno-dev/spatial-review-cli validate https://project.example
```

CLI validation checks published documents; it does not exercise browser bridges
or editor interactions. Perform these checks separately:

| Check | Passing evidence |
| --- | --- |
| Website | The entry page, existing interactions, and authored camera journeys retain their behavior after integration changes |
| Export coverage | The review index accounts for every planned actor, canonical asset, and journey; names, hierarchy, materials, and source mappings match the rendered content |
| Discovery | Connection from the website URL works through the browser bridge without static-document CORS |
| Permissions | Approved origins can obtain registered data; denied origins cannot obtain discovery, catalogs, or texture bytes |
| Resources | Both scene and detailed asset views load; important textures display or a specific limitation is reported |
| Identity | Rebuilding unchanged content preserves actor, asset, component, material, and navigation identities |
| Refresh | A source change appears after refreshing the connected site, without duplicate registrations or stale geometry |

Exercise one representative interaction in each applicable editor:

| Editor | Interaction and exported result |
| --- | --- |
| Scene | Select a placement, move it, and add a comment. The export identifies that actor and the intended transform; another placement of the same asset remains distinct. |
| Path | Scrub a journey, move an authored handle, and comment on a view. The export identifies the sequence, segment, point or view anchor, and source. Complete the navigation guide's checks for every exported journey. |
| Asset | Open a canonical asset, select a component, adjust it, and pin a surface comment. The export identifies the asset, part, local transform, and surface anchor. |

Trace every representative export to the source edit it would require,
including coordinate conversion. Use disposable review state for these checks;
restore test changes and preserve the user's existing feedback. A requested
implementation change must also be checked in the real website after refresh.

**Complete when:** each applicable interaction has observed evidence and an
unambiguous source mapping. If browser access or another dependency prevents a
check, report it as unverified; compilation alone does not complete this step.

## 7. Report the result

Report whether the SDK was added, upgraded, or retained, which integration and
export gaps were addressed, the website and review URLs, version, and changed files.
Include approved origins, framing changes, the exported review inventory and
source mappings, test results, editor checks, exclusions, approximations, and
anything incomplete or unverified.

Provide a direct review link using `spatialReviewEditorUrl(websiteUrl)` when the
official editor was approved. For another editor, provide its supported entry URL.

**Complete when:** the user can open the review and distinguish verified
behavior from remaining limitations without reconstructing the implementation.
