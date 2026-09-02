# Agent guidance quality rubric

Use this rubric when you add or change guidance that an AI coding agent reads.
Apply it to files in `agents/` and to documents that those files require.

The minimum passing score is 90 points. Each dimension must have a rating of
at least 3. These two rules prevent a high score in one dimension from hiding a
critical weakness in another dimension.

## Ratings

Use an integer rating from 0 to 4:

| Rating | Meaning |
| ---: | --- |
| 0 | The guidance is missing, incorrect, or contradictory. |
| 1 | The guidance mentions the subject, but it is vague. |
| 2 | The guidance is partial. The agent must infer an important requirement. |
| 3 | The guidance is clear and checkable. A minor gap can remain. |
| 4 | The guidance is complete, consistent, and confirmed with applicable evidence. |

## Dimensions

For each dimension, calculate `weight × rating ÷ 4`.

| Dimension | Weight | Requirements for rating 4 |
| --- | ---: | --- |
| Structure and routing | 20 | Each pointer names its task and trigger conditions. Required steps stay in the main procedure. Conditional reference material uses precise pointers. Each rule has one source of truth. |
| Clarity and actionability | 20 | Procedures use active imperatives. Sentences are short and contain one action or topic. Technical terms have one defined meaning. Each step states its required result. |
| Technical correctness and scope | 30 | The guidance matches the current protocol and supported SDK behavior. Requirements apply to compatible producers and consumers. Authorization, lifecycle, resource, security, and compatibility rules are correct. Examples do not become normative requirements. |
| Verification and leanness | 30 | Each procedure uses the least costly independent evidence that can prove its changed requirements. Installation guidance proves that the ordinary website is unchanged and that one representative review loop works. It reuses protocol tests instead of repeating protocol conformance checks in each website. Extra checks have an explicit risk trigger. |

Add the four weighted values. The maximum score is 100.

## Passing rules

The guidance passes only when it meets all these conditions:

1. The total score is 90 or more.
2. Each dimension has a rating of 3 or more.
3. The guidance has no protocol, lifecycle, authorization, security, or
   data-integrity contradiction.
4. Independent evidence covers each changed requirement.

A contradiction in condition 3 is an automatic failure. Correct the
contradiction before you use the numeric score.

## Evidence

Record evidence with the score. Use file references, quoted requirements, test
results, or observed agent behavior. Do not assign a rating from intent alone.

Evidence is independent when its expected result does not come only from the
code path under test. Compare the integrated ordinary page with a recorded
pre-integration baseline. Compare review output with visible website content or
an authoritative source definition. Do not use a registry count to validate a
count produced by the same registry.

## Verification proportionality

Use the least costly evidence that can detect a meaningful failure. Select the
evidence from the risk to the ordinary website:

Score this dimension with two subratings. Use the lower subrating as the
dimension rating. A large test plan cannot compensate for redundant effort. A
small test plan cannot compensate for weak evidence.

| Subrating | Rating 4 | Rating 3 | Rating 2 or less |
| --- | --- | --- | --- |
| Evidence sufficiency | Independent evidence proves ordinary-page visual and functional non-interference, the intended review loop, and every triggered risk. | Independent evidence proves non-interference and the intended review loop. One minor triggered-risk gap remains. | A meaningful regression or intended review failure can escape the required checks. |
| Verification economy | The procedure contains no tautological or duplicate checks. It reuses lower-level tests. Every extra check has a stated risk trigger. | The core procedure is lean. One minor check is redundant or lacks a precise trigger. | The procedure requires broad matrices, repeated conformance work, or evidence that does not affect the acceptance decision. |

| Risk | Required evidence |
| --- | --- |
| Integration code is isolated from the ordinary page | Confirm the isolation in source. Repeat one representative visual check and one representative interaction on the ordinary page. |
| Integration code runs on the ordinary page | Compare the same representative view and interactions before and after the change. Run the lightweight performance screen in `docs/performance-profile.md`. |
| The change modifies shared rendering, state, routing, input, or lifecycle code | Run the affected website tests. Compare every affected ordinary-page behavior. Run the lightweight performance screen. |
| The integration adds or changes a protocol capability | Run the focused protocol or SDK test for that capability. Test the capability once through the editor. |

The standard installation is for development review. Do not require production
deployment, exhaustive protocol conformance, every editor order, every catalog
item, mobile hardware, or a sustained performance study. Require one editor
smoke test for each view that the integration exposes. Require one feedback
round trip for the intended review workflow.

Add a check only when one of these conditions is true:

- the integration changes the corresponding code path;
- the ordinary-page baseline identifies that path as important;
- the integration advertises the corresponding review capability; or
- the lightweight screen reports a failure or material regression.

Mark an unrelated check as not applicable. Record one sentence that identifies
the missing trigger. Test effort alone is not a reason to omit an applicable
check.

An editor defect does not prove that the website integration changes the
ordinary website. Report the defect as a review-tool limitation. Fail the
installation only when the defect prevents the intended review workflow or the
integration changes the ordinary website.

Use this table in the change record or pull request:

| Dimension | Rating | Weighted score | Evidence | Remaining gap |
| --- | ---: | ---: | --- | --- |
| Structure and routing |  |  |  |  |
| Clarity and actionability |  |  |  |  |
| Technical correctness and scope |  |  |  |  |
| Verification and leanness |  |  |  |  |
| **Total** |  | **/100** |  |  |

For a substantive installation-procedure change, test one new installation and
one update of an existing integration. In each fixture, compare the ordinary
page before and after the change. Use two different fixtures only when the
change claims to apply to different frameworks, rendering methods, or transport
paths.

Store repository-level execution records in `docs/governance/`. Name the tested
revision, environment, commands, observed results, and unverified checks.

For an editorial change, reuse current execution evidence only when the change
does not alter a requirement, step, trigger, or completion condition. Record why
the existing evidence remains applicable.

## Writing rules

Use ASD-STE100-inspired controlled language:

- Use active voice.
- Use the imperative form for procedures.
- Put one action or topic in each sentence.
- Put a condition before an action when the agent must know the condition first.
- Use one term for one meaning.
- Prefer a positive instruction. Use a prohibition only for a necessary guardrail.
- Define project-specific technical nouns and technical verbs before ambiguous use.

Use precise context pointers. Keep required steps in the primary procedure.
Move branch-specific reference material behind a pointer. Keep each meaning in
one authoritative location.
