# Spatial Review performance screen

Use this screen to detect an ordinary-page performance regression from a
Spatial Review integration. Spatial Review is a development review tool. Do not
apply a production-load qualification process to a standard installation.

Use the definitions of integration plan and ordinary-page baseline in
[Install or update Spatial Review](../agents/install.md#terms).

## Decide whether to run the screen

Run the screen when one of these conditions is true:

- integration code runs on the ordinary page;
- the change modifies shared rendering, state, routing, input, or lifecycle
  code;
- the change adds an ordinary-page import, listener, timer, worker, request, or
  frame callback; or
- the ordinary-page comparison shows a possible slowdown.

When none of these conditions is true, inspect the source boundary. Confirm
that review-only work starts only on the capture route. Record the screen as not
applicable. Do not collect performance traces.

## Run the lightweight screen

Use the same device, browser, viewport, route, input sequence, and cache state
before and after the integration change. Use an existing website performance
budget when one exists.

Record these results:

| Area | Required result |
| --- | --- |
| Startup | Compare the time from navigation start to the same stable visible ready state before and after the change. Record the shared cache state. |
| Interaction | Compare the time from the same input to the same stable visible result before and after the change. |
| Runtime work | No new continuous review-only request, worker, timer, or frame callback runs on the ordinary page. A planned discovery listener is allowed. A same-document capture bridge and registry are allowed when they reuse the website scene and pass the other comparisons. |
| Visual result | No unintended rendering difference at the comparison state |

Use the website's existing instrumentation when it is available. Otherwise,
use browser timings and one performance trace. Keep the raw result or a link to
it.

**Complete when:** the before and after results use the same conditions. The
ordinary page has no visible or functional regression. Continuous review-only
work does not run on the ordinary page. Any allowed same-document bridge and
registry pass the recorded comparisons.

## Investigate a possible regression

Treat a changed result as a signal. Repeat the affected before and after sample
three times when one of these conditions is true:

- the after result exceeds an existing website budget;
- the after result is more than 10 percent and at least 100 milliseconds slower;
- the trace contains a new long task of 50 milliseconds or more; or
- the representative interaction feels or appears different.

Compare the medians of the repeated samples. Inspect the new imports, requests,
workers, timers, frame callbacks, and rendering work. Reduce or isolate the
source of the regression. Move review-only work to a capture route when that is
the smallest effective fix. Reuse website-owned resources only when reuse does
not change their ordinary-page lifecycle.

**Complete when:** the repeated result stays within the existing budget. When no
budget exists, the median is not both more than 10 percent and at least 100
milliseconds slower. The visual and functional comparison must still pass.

## Escalate only for an identified risk

Create a detailed performance plan only when the lightweight screen fails or
the integration deliberately changes shared runtime behavior. Select only the
measurements that can explain the identified risk. Examples include startup,
frame time, memory, transfer size, cache growth, refresh, and teardown.

Record the environment, measurement method, existing budget, before result,
after result, and retained evidence. Do not require mobile, high-DPI, sustained,
queue-overflow, or multi-frame tests unless the identified risk includes that
condition.

Protocol and SDK changes use their repository tests for queue bounds,
cancellation, retry, resource lifetime, and teardown. Do not repeat those tests
for each website installation.

**Complete when:** the detailed plan covers the identified risk and no unrelated
test remains in the plan.

## Report the result

Use this table:

| Check | Trigger | Before | After | Result or limitation |
| --- | --- | --- | --- | --- |
| Ordinary-page startup |  |  |  |  |
| Representative interaction |  |  |  |  |
| Review-only runtime work |  |  |  |  |
| Visual and functional parity |  |  |  |  |

State whether the screen was required. When it was not required, cite the
source boundary that isolates review-only work.

**Complete when:** the table records every triggered check, evidence location,
result, and limitation. The report states the applicability decision.
