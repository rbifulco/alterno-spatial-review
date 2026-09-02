# Install or update Spatial Review on an existing website

Use this procedure for a new integration or an update of an existing
integration. Complete the steps in order. Record evidence for each completion
condition.

## Terms

Use these terms throughout the procedure:

- **Integration plan:** the single record for permission, scope, implementation,
  evidence, and remaining limitations.
- **User:** the person who approves package, access, and repository changes.
- **Reviewer:** the person who evaluates the review representation in the
  editor.
- **Producer:** the integrated website that publishes review data.
- **Consumer:** an editor or tool that requests review data.
- **Peer:** one authorized producer-consumer connection with negotiated
  capabilities and limits.
- **Browser bridge:** either of the two SDK message interfaces below.
- **Discovery bridge:** the interface started by
  `attachSpatialReviewDiscoveryBridge()`. It exposes discovery metadata.
- **Capture bridge:** the interface started by
  `attachSceneAssetRegistryBridge()`. It exposes registered review data and
  registered texture resources.
- **Capture page:** the document that owns the registry and capture bridge. It
  can be a dedicated capture document or the ordinary document in a
  same-document integration. The capture URL identifies it.
- **Ordinary page:** the website route and state as a visitor experiences it,
  without an active editor request. It can host a dormant discovery bridge or a
  same-document capture bridge.
- **Registered root:** a Three.js `Object3D` passed through `root` or `roots`.
  It owns one rendered subtree in the review representation.
- **Ordinary-page baseline:** one or more recorded views and representative
  interactions on the ordinary page before the integration change.
- **Capture baseline:** the smallest set of review subjects and interactions
  that proves the intended development-review workflow for one build.
- **Review baseline:** the source revision and review representation that saved
  feedback targets.
- **Build ID:** the registry identity for one source build. Change it when a new
  website build can change registered review data.
- **Catalog revision:** the SDK-generated identity for one registry catalog
  state. Registration changes advance it.
- **Representation revision:** the producer-supplied immutable identity for one
  deferred asset representation. Change it when that representation changes.
- **Decision-relevant:** content whose omission or incorrect representation can
  change the requested review decision.
- **Expensive:** work that exceeds an existing performance or transport budget.
  When no project budget exists, use a main-thread chunk of 50 milliseconds or
  more, a visible editor stall, or the negotiated transfer byte ceiling as the
  trigger. Record the observed trigger.
- **Applicable check:** a check for content present in the integration plan or
  for a capability negotiated by the tested peers.
- **Blocked check:** an applicable check that cannot run because a required
  capability, environment, or dependency is unavailable. Record the reason,
  available evidence, and user decision. A blocked check remains unverified.
- **Serialization profile:** the SDK `scene` or `review` export mode. It is not
  a performance test configuration.
- **Representation family:** one advertised asset representation identified by
  `representationId`, such as an overview or detail representation. It is not a
  serialization profile.
- **Compatible Three.js version:** a version inside the installed SDK's
  `peerDependencies` range that passes the website tests and build.
- **Review subject:** an actor, asset, material, texture, or journey selected for
  review. Do not use this term for a feedback-schema `target` or camera `target`.
- **Authoritative source definition:** the repository-relative file and symbol or
  content key that controls a review subject.
- **Eager registration:** a `register()` call that can supply a representation
  synchronously when requested. A deferred registration uses
  `registerDeferred()` and an asynchronous producer. In a negotiated progressive
  catalog, both types can publish metadata before geometry.
- **Supported fallback peer:** a consumer version named in the integration
  plan's compatibility target and verified against the complete-catalog path.
- **Stable semantic ID:** a deterministic ID derived from authoritative content
  and role. It stays unchanged when the target stays unchanged. It is unique
  among targets of the same kind. Actor and assembly IDs also share one
  cross-kind namespace.
- **Searchable source reference:** a repository-relative path plus a symbol or
  content key that a repository text search can resolve.
- **Texture source URL:** a stable, credential-free image URL stored in a
  texture map's `sourceRef` field. It is not a searchable source reference.
- **Reproducible capture state:** a state in which one build and one recorded
  input set produce the same inventory, IDs, transforms, and bounds. Fix random
  seeds, time inputs, and user inputs when they affect registered evidence.
- **Forward status:** a source-status phase that does not precede the current
  catalog phase.
- **Resource lifetime:** the installed SDK's session boundary, delivery grace,
  and cache bounds for one resource class.
- **Terminal result:** a final recorded success or explicit failure after the
  retry policy. A `busy`, progress, queued, or active result is not terminal. An
  `asset-stream-v1` terminal result is an asset, `notModified`, `not-found`,
  `too-large`, `unavailable`, or `cancelled` response.
- **Settled demand:** a demand in which every requested item has a terminal
  result and no item remains queued, active, or scheduled for retry.
- **Installation retry policy:** wait at least the returned `retryAfterMs`.
  Attempt the representative request no more than three times. After the third
  `busy` result, record the request as failed and unsettled.

A review representation is not the live website. It is a deliberate export of
the website's scene, assets, and navigation. The editor collects feedback on
that representation. An agent applies the feedback to authoritative source.
Read [Structuring for review](structuring-for-review.md) before you select the
exported content.

Use each reference for its named subject:

| Subject | Authoritative reference | Use it when |
| --- | --- | --- |
| Review boundaries, identity, source mapping, and materials | [Structure a website for review](structuring-for-review.md) | You select or change exported content. |
| Camera, scroll, or guided routes | [Export navigation sequences](exporting-navigation-sequences.md) | The integration plan includes an authored journey. |
| Bridge API, discovery, framing, and texture transport | [Integrate a website](../docs/integrating-a-website.md) | You implement or deploy transport. |
| Deferred representation behavior | [Deferred asset streaming](../docs/deferred-asset-streaming.md) | Geometry is expensive to construct, serialize, or transfer under the defined trigger. |
| Ordinary-page performance screen | [Spatial Review performance screen](../docs/performance-profile.md) | Integration code runs on the ordinary page or changes shared rendering, state, routing, input, or lifecycle code. |
| Local and vendored package installation | [Install from source](../docs/install-from-source.md) | The integration does not use the published npm package. |

Keep permission, integration order, browser acceptance, and final reporting in
this procedure.

The integration is complete only when a reviewer can do these actions:

1. Connect to the website.
2. Identify a review subject.
3. Export feedback.
4. Map the feedback to authoritative source.
5. Refresh the review and verify the source change.

## 1. Obtain permission

Check the recorded authorization for an existing integration. Reuse it only
when the editor origins, exposed data, and framing scope are unchanged.

When no recorded decision covers the intended access, ask for approval before
you install the SDK or start a bridge. Include these facts:

A request to install or configure Spatial Review does not approve the official
editor origin.

- The official editor origin is `https://spatial-review.alterno.dev`.
- Package installation does not expose website data.
- A started capture bridge exposes deliberately registered roots and their
  supported descendants. This data can include descendant geometry, materials,
  and textures.
- Registered data can include discovery metadata, scene and asset structures,
  materials, source references, texture URL strings, and texture bytes.
- The bridge does not automatically expose arbitrary DOM, cookies, storage,
  unrelated application state, or objects outside registered roots.
- The serializer can copy registered texture `sourceRef`, `requestUrl`,
  `currentSrc`, or `src` strings. Inspect them for embedded credentials, signed
  query tokens, and other secrets before bridge attachment.
- When an approved editor embeds the discovery page or capture page, that page
  must permit framing by the editor origin. An opener-based popup workflow does
  not require framing permission.
- Both bridges always accept the website's own origin.
- `allowOfficialEditor: false` disables official-editor authorization.
- A loopback website accepts other loopback origins for local development.
- The capture bridge sends a readiness announcement to its parent or opener
  before it authorizes a request. This announcement contains build identity,
  counts, capabilities, and transfer limits. It contains no catalog or texture
  bytes. The discovery bridge sends no readiness announcement.

Use this question:

> Do you approve `https://spatial-review.alterno.dev` as a Spatial Review
> editor? The editor can embed the discovery page and capture page. It can
> receive the scene, asset, material, source-reference, and texture data that
> this integration explicitly registers. Registered texture references can
> include URL strings. The integration will anyway do its best to remove any secrets
> from those strings before it starts the bridge.

Record `allowOfficialEditor: true` only after approval. Record `false` when the
user declines. Get a separate decision for each additional production origin.

**Complete when:** the integration plan contains the data-access decision,
the framing decision, and a decision for each proposed production origin.

## 2. Define the review representation

Inspect the authoritative construction code before you change registration.
Inspect these items:

- scene construction and placement data;
- asset factories and loaders;
- material and texture creation;
- camera and navigation controllers;
- entry routes and the capture page;
- deployment headers and static-file behavior;
- current SDK configuration and registrations; and
- static review exports.

Apply [Structuring for review](structuring-for-review.md) to every review
subject. If the website has authored camera, scroll, or guided-view motion, also
apply [Export navigation sequences](exporting-navigation-sequences.md).

### Complete the integration plan

Create a repository-relative Markdown integration plan. Use
`docs/spatial-review-integration-plan.md` when the repository has no established
location. Record an existing location when you reuse one. Include at least this
inventory:

| Inventory | Required decision |
| --- | --- |
| Scope | New integration or update; representation boundaries; intentional exclusions |
| Actors | Independent placements; stable actor IDs; decision-relevant context |
| Ownership | Explicit assembly owners; World or Street owners; flat fallback limitations |
| Assets | Canonical designs; variants; components; materials; texture sources |
| Experience | Applicable journeys; stops; camera and aim controls; timing; FOV |
| Source mapping | Authoritative definitions; source references; coordinate conversions |
| Migration | Stable IDs; explicit target mapping; new review baseline when identity changes |
| Capture | Capture URL; deterministic capture-page state; bootstrap phases; refresh and teardown |
| Transport | Development editor origins; capture route; discovery path; texture path used by the representative asset |
| Ordinary page | Representative views and interactions; integration isolation; existing performance budget |
| Review smoke | One representative subject for each exposed editor view; one intended feedback round trip |
| Deferred trigger | Observed construction, serialization, or transfer cost; applicable budget or default trigger; eager or deferred decision |

Run the material preflight in
[Preserve material and geometry evidence](structuring-for-review.md#preserve-material-and-geometry-evidence).
Run the [performance screen](../docs/performance-profile.md) when integration
code runs on the ordinary page. Also run it when the change modifies shared
rendering, state, routing, input, or lifecycle code.

Record the ordinary-page baseline and the capture baseline. Select one
representative subject for each editor view that the integration exposes. Add
subjects only when the review request needs them. Do not enumerate the complete
catalog as installation evidence.

**Complete when:** each representative review subject has a review scale and an
authoritative source definition. The plan records the intended review workflow,
ordinary-page baseline, exclusions, known limitations, performance risk, and
each applicable eager or deferred decision.

## 3. Install or update the SDK

Run the website's existing tests before you change dependencies. Run its build.
If either command fails, record the pre-existing failure. Stop the dependency
change. Ask the user whether to repair the baseline. The user can instead
continue with that check blocked.

When the planned work does not require a new capability, keep the compatible
SDK version. Before an upgrade, review permission and compatibility effects.

When the SDK is missing, use the latest released package. Use a local or
unreleased SDK only when the user explicitly requests it. Install the selected
package with the website's package manager. The npm command for the released
package is:

```sh
npm install @alterno-dev/spatial-review
```

When the website declares a compatible Three.js version, keep it. When the
website does not declare `three`, add it. The SDK uses Three.js as a peer
dependency.

For an unreleased or local SDK, follow
[Install from source](../docs/install-from-source.md). Build the source checkout
before the website resolves its package exports.

Start the website with its existing development command. Record the ordinary
page URL and capture URL in the integration plan.

**Complete when:** the website runs at a known URL and the lockfile resolves the
selected SDK and Three.js versions reproducibly. Each pre-change test and build
result passes or is a user-accepted blocked check. Do not use a blocked result
for regression comparison.

## 4. Implement the representation

Use the [website integration reference](../docs/integrating-a-website.md) for
bridge configuration and API examples. Keep bridge configuration in one
integration module. Register content near its authoritative construction code.

Export each applicable review scale:

| Website content | Required representation |
| --- | --- |
| Scene composition | Stable placements, transforms, bounds, asset links, and decision-relevant context |
| Places and contents | Transform-only assemblies with explicit parent-local poses and independent child placements |
| Asset construction | Canonical components, local transforms, geometry, materials, and available textures |
| Authored navigation | `NavigationSequence` data from runtime stops, camera and aim controls, timing, and FOV |

This section is the source of truth for capture readiness. The current SDK
promotes the first serialized catalog from `booting` to `catalog-ready`. It does
not provide a producer-controlled initial readiness gate. Use this sequence:

1. Create the registry on the capture page.
2. Construct every intended eager registration.
3. Register metadata and descriptors for every intended deferred asset.
4. Register every intended navigation sequence and assembly.
5. Attach the authorized capture bridge after the initial registration set is
   complete.
6. Let the first catalog request publish `catalog-ready`.
7. Produce deferred representations on demand.
8. Use `setSourceStatus()` only for forward post-catalog status. The bridge
   sends that status only to peers that negotiated `asset-stream-v1`.

Do not attach the bridge while initial catalog registration is incomplete. The
first request can otherwise publish a partial catalog as ready. Record
producer-controlled initial progress as unsupported. Open an SDK proposal when
the integration requires incremental bootstrap after bridge attachment.

For a refresh that changes multiple registrations, stop requests before the
first change. Detach the old capture bridge or build a replacement registry.
Apply the complete registration set. Then attach one bridge for the new catalog.
Do not expose an intermediate catalog revision.

The ordinary page can start discovery. The capture URL must construct the
documented review state without a reviewer interaction. Use a reproducible state
for procedural or animated content.

Apply the [registration-owner rules](structuring-for-review.md#choose-actor-boundaries)
and the [identity rules](structuring-for-review.md#preserve-identity-and-source-mapping).
Use the actor, asset, and assembly decisions recorded in the integration plan.

When the plan includes authored navigation, apply
[Register the sequence](exporting-navigation-sequences.md#7-register-the-sequence)
to each selected journey.

Make each texture source exportable before its material representation becomes
available. Keep the capture page alive during live-resource requests. Follow
the installed SDK's delivery grace and cache bounds. If an ID expires, request
the representation again. Use the current resource IDs from that regenerated
representation. Give each changed
representation a new build ID or representation revision.

Use `registerDeferred()` for review geometry that is expensive to construct,
serialize, or transfer. Confirm that the producer and intended consumer support
`asset-stream-v1`. Read
[Deferred asset streaming](../docs/deferred-asset-streaming.md) before you add a
producer. Give each producer accurate metadata, immutable revisions,
cancellation, progress, and measured byte and concurrency limits.

When the plan names a supported fallback peer, give each required asset an eager
fallback or record its intentional deferred-only exclusion. Do not claim that a
deferred-only asset is visible to a peer without `asset-stream-v1`.
When an expensive asset is required by that peer, use eager `register()` despite
the cost. Record the cost and optimize the eager representation without removing
required review evidence.

Release capture-owned resources on cancellation, failure, refresh, hot reload,
and unmount. Keep resources that the live website still owns. Bound each cache
by source, build, profile, asset, representation, and revision.

Compare the generated catalog with the integration plan. Resolve every actor,
asset, component, material, texture, and journey to authoritative source.

**Complete when:**

- The initial registration set contains every planned target before bridge
  attachment.
- Applicable post-catalog work reports forward status.
- Published resources remain retrievable for their documented lifetime.
- Refresh and teardown release capture-owned work.
- Each supported fallback peer receives its planned eager content and excludes
  only the recorded deferred-only content.

## 5. Configure development transport

Configure only the recorded development editors. The SDK always accepts the
website's own origin. A loopback website also accepts other loopback origins.
Keep the existing security policy. Add a framing exception only to the capture
and discovery routes that the development editor must embed.

Start the acceptance test with the ordinary website URL in the selected
development editor. Do not use the capture URL as the initial website URL. A
direct capture-page bridge test does not prove discovery from the ordinary
website URL.

Test both browser bridges with the website and editor on different loopback
ports.

Apply [Publish static discovery](../docs/integrating-a-website.md#publish-static-discovery)
only when the development workflow requires CLI or non-browser discovery.

Request the discovery URL used by the development workflow. Treat browser
fallback as separate evidence only when the integration depends on it.

Apply [Transfer textures](../docs/integrating-a-website.md#transfer-textures) to
each decision-relevant texture. That section is the source of truth for direct
URLs, MIME types, decoded sources, live resources, and retry results.

Do not configure or verify production deployment as part of the standard
installation. When the user explicitly requests production access, record that
work as a separate deployment task. Apply the deployment and authorization
rules in [Integrate a website](../docs/integrating-a-website.md).

**Complete when:** the selected development editor can discover the capture
page and receive the representative review data. Other website routes keep
their existing framing policy. The representative texture path has an explicit
result.

## 6. Verify the review loop

Use independent evidence. Do not compare a registry value with a value produced
by the same registry. Compare ordinary-page results with the pre-integration
baseline. Compare editor results with visible website content or an
authoritative source definition.

Run the smallest applicable check set:

| Check | Passing evidence |
| --- | --- |
| Existing website checks | The affected website tests pass. Run the existing build when the integration changes build inputs or shared application code. |
| Visual non-interference | The same representative ordinary-page view has no unintended visual change before and after installation. |
| Functional non-interference | The same representative ordinary-page interactions have the same result before and after installation. |
| Runtime isolation | A dedicated capture route keeps registry construction, capture bridging, serialization, and review resources out of the ordinary page. A same-document integration may reuse the website scene and attach the capture bridge when its visual, functional, and performance comparisons pass. |
| Review connection | Starting with the ordinary website URL, the development editor discovers the capture page and reaches a useful state without an unrelated user interaction. |
| Representative review | Each exposed editor view opens one representative subject. Its identity and visible result agree with the website or authoritative source. |
| Feedback loop | One intended feedback action exports a stable target and a searchable source reference. A refresh preserves unresolved feedback. |
| Performance screen | When its trigger applies, the ordinary page passes the lightweight screen in `docs/performance-profile.md`. |

For a Scene-only integration, do not test Asset or Experience. For an
integration that exposes those views, open each view once. Do not test every
view order, item, representation family, texture class, retry path, queue limit,
or resource-lifetime branch during standard installation. The protocol and SDK
test suites own those conformance checks.

Add a focused integration check only when the integration adds or changes the
corresponding capability. Examples include deferred production, custom
discovery, generated textures, ownership, and authored navigation. Reuse the
focused protocol test. Exercise one representative result through the editor.
For authored navigation, apply the representative check in
[Verify the selected journey](exporting-navigation-sequences.md#8-verify-the-selected-journey).
When the plan names a supported fallback peer, request one representative
catalog with that peer. Pass when its eager content and deferred-only exclusions
match the plan.

Restore disposable editor changes. Preserve existing user feedback. Record
editor defects separately from website regressions.

**Complete when:** the ordinary website retains its recorded rendering and
behavior. The intended development-review workflow works for each exposed view.
Every failure or unverified triggered check is visible in the result.

## 7. Report the result

Report these items:

- added, updated, or retained SDK version;
- website URL, capture URL, and review URL;
- development origins and capture-route framing changes;
- exported inventory and source mappings;
- changed files;
- website, browser, and triggered performance results;
- exclusions, proxies, approximations, and capability limits; and
- incomplete or unverified checks.

When the official editor is approved, use
`spatialReviewEditorUrl(websiteUrl)`.

**Complete when:** the user can open the review and distinguish verified
behavior from every remaining limitation.
