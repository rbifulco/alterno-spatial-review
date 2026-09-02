# Protocol change process

The spatial-review contract lets independently deployed websites and editors exchange scenes, assets, capabilities, and review intent. Compatibility is therefore more important than implementation convenience.

## What counts as a protocol change

Use this process when a proposal changes any externally observable contract, including:

- a discovery document or JSON schema;
- required or optional scene and asset fields;
- URL, origin, transport, or capability behavior;
- identifier, coordinate, units, or transform semantics;
- validator conformance rules that previously valid integrations could fail;
- behavior expected from every compatible adapter or editor.

An additive SDK helper that does not alter interoperable behavior can use the normal feature process.

## Lifecycle

1. **Propose.** Open a Protocol change issue with the problem, concrete examples, compatibility impact, migration plan, and security considerations.
2. **Triage.** Ask maintainers to classify the proposal as protocol, package, or documentation work.
3. **Design.** Record the exact schema and behavior. For a significant proposal, add example producer and consumer payloads.
4. **Accept.** Obtain a maintainer's recorded acceptance in the issue. Do not treat silence or an open issue as acceptance.
5. **Implement.** Link the accepted issue from the pull request. Update the schemas, TypeScript types, validators, fixtures, tests, and integration documentation together.
6. **Release.** Add a changeset. Publish clear compatibility and migration notes.

**Complete when:** the issue contains recorded acceptance for the implemented
design. The change has matching contracts, validation, tests, documentation,
versioning, and migration evidence.

## Compatibility rules

- Prefer additive optional fields and explicitly advertised capabilities.
- Keep existing valid documents valid within a major protocol version.
- Do not silently change the meaning, units, coordinate space, or lifecycle of an existing field.
- Ignore unknown optional fields unless a schema explicitly says otherwise.
- Keep important producer behavior explicit. Do not require a consumer to infer it from presentation.
- A breaking contract requires a new major protocol version or a versioned schema path plus a documented migration.
- During transitions, define how old producers and new consumers—and new producers and old consumers—behave.

## Acceptance criteria

Before acceptance, verify that the proposal solves a demonstrated
interoperability problem. Verify that ordinary websites and AI coding agents can
implement it. Verify consistent validation, clear security boundaries, and a
credible compatibility plan.

The issue discussion is the decision record. If implementation reveals a material design change, return to the proposal before merging it.
