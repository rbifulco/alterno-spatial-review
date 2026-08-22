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
2. **Triage.** Maintainers confirm whether the proposal belongs in the protocol, an implementation package, or documentation.
3. **Design.** Discussion converges on exact schema and behavior. Significant proposals should include example producer and consumer payloads.
4. **Accept.** A maintainer records acceptance in the issue. Silence or an open issue is not acceptance.
5. **Implement.** The pull request links the accepted issue and updates schemas, TypeScript types, validators, fixtures, tests, and integration documentation together.
6. **Release.** The change receives a changeset and is published with clear compatibility and migration notes.

## Compatibility rules

- Prefer additive optional fields and explicitly advertised capabilities.
- Existing valid documents should remain valid within a major protocol version.
- Do not silently change the meaning, units, coordinate space, or lifecycle of an existing field.
- Consumers should ignore unknown optional fields unless a schema explicitly says otherwise.
- Producers must not require consumers to infer important behavior from presentation alone.
- A breaking contract requires a new major protocol version or a versioned schema path plus a documented migration.
- During transitions, define how old producers and new consumers—and new producers and old consumers—behave.

## Acceptance criteria

A protocol proposal is judged on whether it solves a demonstrated interoperability problem, remains practical for ordinary websites and AI coding agents, can be validated consistently, has clear security boundaries, and has a credible compatibility story.

The issue discussion is the decision record. If implementation reveals a material design change, return to the proposal before merging it.
