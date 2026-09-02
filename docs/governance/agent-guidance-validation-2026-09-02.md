# Agent guidance validation: 2026-09-02

This record validates the substantive agent-guidance revision against one new
integration and one existing integration. It applies the proportionality rules
in [Agent guidance quality rubric](agent-guidance-quality.md). The record uses
independent ordinary-page evidence for installation acceptance. It uses package
and protocol tests only for their stated lower-level purpose.

## Environment

| Item | Value |
| --- | --- |
| Date | 2026-09-02 |
| Browser | Codex in-app Chromium browser |
| Editor | `alterno-spatial-review-editor` `main` at `1d52a07ae046d2ea96aa6070a5e993414b43a6b4`, local Vite server |
| Protocol and SDK | `main` at `0c5d127a832516b0e1c818f9e76106d1f32ea3d3` plus the current uncommitted guidance fixture; repository build of `0.6.0` |
| Existing integration | Kage `spatial-review-pages` at `2a2443ac0dcb6c0c587fdf236a4eb49751ca414d` |
| Protocol repository server | `http://127.0.0.1:4190` |
| Editor server | `http://127.0.0.1:5173` |
| Existing integration server | Kage at `http://127.0.0.1:4183` |
| Scope | Development review on loopback; production deployment is outside the standard installation |

Run `npm test` in the protocol repository before the browser checks. The run
passed all 76 tests. The build produced all four package distributions.
Run `npm run pack:check` with an isolated npm cache. All four package dry runs
passed. The isolated cache avoided a pre-existing ownership error in the user
npm cache.

The 76-test run supplies repository-level contract evidence. A website
installation does not repeat these checks unless it changes the corresponding
protocol capability:

| Guidance branch | Automated evidence |
| --- | --- |
| Authorization and discovery | Exact official-origin defaults, opt-out, configured production origins, rejected untrusted origins, loopback discovery, normalized locators, unsafe redirects, credentials, and cross-origin documents |
| Lifecycle and streaming | Source-status ordering, catalog negotiation, queue bounds, priority, cancellation, retry, and terminal settlement |
| Resource lifetime | Texture transfer, 60-second grace behavior, independent cache bounds, eviction invalidation, regeneration, and final-bridge teardown |
| Compatibility | Complete JSON, progressive geometry, deferred families, typed instances, and flat or hierarchical ownership paths |
| Representation fidelity | Geometry groups, materials, map hydration, texture sources, transforms, bounds, visibility, and navigation validation |

A focused serializer probe also confirmed that texture URL strings are not
redacted. A URL with user information and a query token appeared unchanged in
the material map `sourceRef`. This result supports the required credential
preflight. It does not claim automatic SDK sanitization.

These automated results do not replace the browser checks below.

## Fresh package-installation check

Pack the built protocol and SDK packages into an empty temporary consumer. Add
the compatible local Three.js package. Run `npm install --offline
--ignore-scripts`. Import `SceneAssetRegistry` and Three.js from the installed
packages. Register and serialize one box actor.

The install added the three declared packages without a registry fetch. The
runtime check serialized exactly one actor. This check verifies package
installation and exports only. It does not prove catalog completeness or
ordinary-page non-interference.

## New integration fixture

Use `examples/three/index.html` as the new-install fixture. Its integration is
in `examples/three/src/browser-fixture.js`. The query
`?spatial-review=off` omits the review integration. This state is the independent
ordinary-page baseline. The default enabled state uses a dedicated capture
mode. The query `?spatial-review-same-document=1` attaches the same capture
integration to the ordinary document. Each capture state registers one actor,
one generated live texture, and one two-stop navigation sequence.
It sets `allowOfficialEditor: false` and configures no production origin. The
editor connection therefore tests the built-in loopback exception.

Open the fixture URL directly. Then connect its website URL through `/review`.
Open Scene, Asset, and Experience in that order. A previously reported
order-dependent texture failure triggered one separate Asset-first diagnostic.
That diagnostic is not part of the standard installation check set.

| Check | Observed result | Status |
| --- | --- | --- |
| Visual non-interference | Full-page PNG bytes were identical with review disabled and enabled. Both states showed the same textured cube. | Pass |
| Functional non-interference | Both states reached the same visible `fixture-ready` result. The fixture has no other authored interaction. | Pass |
| Source boundary | The disabled state skips the dynamic SDK import and both bridges. The default enabled ordinary page starts discovery only. Registry construction and the capture bridge require capture mode or the explicit same-document fixture flag. Rendering runs before the optional integration block. | Pass |
| Same-document path | The disabled baseline and same-document capture produced byte-identical full-page PNGs and the same `fixture-ready` result. The editor connected to the same-document URL and reached ready. | Pass |
| Lightweight performance screen | Three matched warm-cache runs reached `fixture-ready` at disabled/enabled pairs of 382.1/322.9 ms, 706.0/576.5 ms, and 499.7/750.0 ms. The medians were 499.7 and 576.5 ms. The 76.8 ms difference stayed below the 100 ms investigation threshold. | Pass |
| Discovery and connection | Browser discovery connected without a static discovery document. | Pass |
| Local authorization | A fresh Scene route loaded through the editor on another loopback port while official-editor authorization was disabled. | Pass |
| Scene | Scene loaded `1/1` asset meshes, one object, and one path reference. | Pass |
| Scene to Asset | Asset loaded 12 triangles, 24 vertices, one material, and `1/1 textures ready`. The generated checker texture was visible. | Pass |
| Scene to Experience | Experience loaded two stops, one transition, and the 48° to 42° FOV values. | Pass |
| Asset before Experience | A cold Asset-first route loaded geometry. Its live texture failed with `requested live texture is not registered`. Retry returned the same explicit failed result. The result is unsuitable for texture and appearance review in this order. Experience then loaded. | Fail |
| Catalog diagnostic | The visible cube and authoritative fixture source identify one representative actor. The editor reported that actor ready. | Pass |
| Material result | Asset appearance was faithful after Scene-first hydration. Scene used its documented review-safe profile and did not show the texture. | Pass |

The Asset-first result is an order-dependent editor resource defect. It does not
change the ordinary website. Record it as a review-tool limitation. It blocks a
workflow that requires reliable textured Asset review in every view order.

The same browser session exercised one representative feedback loop:

| Action | Observed result | Status |
| --- | --- | --- |
| Scene placement feedback | A 0.25 m X move and a placement observation exported the stable actor ID and `examples/three/src/browser-fixture.js#root`. | Pass |
| Refresh | The editor reported one feedback item after source refresh. The unresolved observation remained attached. | Pass |
| Source application | The exported +0.25 m X placement intent was applied to `root.position.x` in the authoritative fixture source. After refresh, the matching local transform operation was retired. The unresolved observation remained in the change set. | Pass |
| Experience feedback | The `lensStart` control changed from 55 to 57 percent. A view comment attached to segment `start-detail` at 0 percent. | Pass |
| Asset feedback | A component move enabled Undo. A surface note exported the component source reference and actor-local anchor. | Pass |

## Existing integration update fixture

Use the Kage integration on branch `spatial-review-pages`. This integration was
previously updated to SDK `0.6.0`. The run used its existing build output and
the repository's `npm run dev` command.

Connect the Kage URL through `/review` in a fresh editor tab. Wait until the
workspace becomes ready. Open Scene, Asset, and Experience in that order.

| Check | Observed result | Status |
| --- | --- | --- |
| Ordinary-page regression reference | The retained Kage integration record names the pre-upgrade normal-page reference and the matching current normal entry and Still Gardens results. Chapter navigation changed the authored page state while review readiness remained present. | Pass |
| Discovery and bootstrap | Browser discovery completed. The editor reported its intermediate preparation states before it became ready. | Pass |
| Scene catalog | Scene loaded `37/37` asset meshes, 37 objects, and six path references. | Pass |
| Scene to Asset | The selected Night sky asset loaded two triangles, four vertices, and one material. Its one live texture failed with `requested live texture is not registered`. The material is unsuitable for the Night sky texture and appearance review decision. | Fail |
| Asset to Experience | Experience loaded six stops, five transitions, and the complete FOV sequence after the Asset view. | Pass |
| Browser diagnostics | The source emitted one Three.js legacy-lighting deprecation warning. It emitted no browser error. | Pass with warning |

The existing integration confirms that the ordinary website and representative
review navigation can pass while one resource class fails. Keep the texture
result separate from website non-interference, geometry readiness, and
view-navigation readiness.

## Tautology and applicability review

Do not use the serializer actor count, registry size, or editor catalog total as
independent proof of completeness. Those values share the same registration
path. Use them only as diagnostics after the visible website or authoritative
source identifies the expected representative subject.

The standard installation did not trigger these checks:

| Omitted check | Reason |
| --- | --- |
| Production framing, discovery, and authorization | Spatial Review is used for development review. No production deployment was requested. |
| Queue overflow, cancellation, eviction, and resource lifetime | The fixtures did not add or change those protocol capabilities. Repository tests already cover them. |
| Ownership edit and reparent | The new fixture did not expose ownership. Kage ownership was not changed by this guidance validation. |
| Mobile, high-DPI, and sustained performance | The integration did not target those conditions. The ordinary-page screen did not identify that risk. |
| Every view order and catalog item | One representative result per exposed view is sufficient for installation acceptance. The separate Asset-first run was a risk-triggered diagnostic for a previously reported order defect. |

The fixture comparison proves visual and basic functional non-interference. The
matched browser runs also record time to the same stable ready state. The
fixture has no authored ordinary-page interaction beyond that ready state.

Use the lean checks in
[Install or update Spatial Review](../../agents/install.md#6-verify-the-review-loop)
before you claim completion for a development integration.

## Independent rubric result

Four context-free Sol/high-reasoning agents scored one dimension each against
the current working tree. The verification agent scored both required
subratings and used the lower value.

| Dimension | Rating | Weighted score | Remaining gap |
| --- | ---: | ---: | --- |
| Structure and routing | 4 | 20/20 | None |
| Clarity and actionability | 4 | 20/20 | None |
| Technical correctness and scope | 4 | 30/30 | None |
| Verification and leanness | 4 | 30/30 | None |
| **Total** |  | **100/100** |  |

For Verification and leanness, evidence sufficiency scored 4 and verification
economy scored 4. The lower subrating is 4.

| Gate | Result |
| --- | --- |
| Total is at least 90 | Pass |
| Each dimension is at least 3 | Pass |
| No automatic contradiction | Pass |
| Independent evidence covers each changed requirement | Pass |

The Asset-first fixture texture failure and the Kage Night sky texture failure
remain recorded product limitations. They do not change the guidance score.
They block an installation only when its intended review workflow requires the
failing texture path.
