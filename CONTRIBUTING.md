# Contributing to Alterno Spatial Review

Thank you for helping make spatial feedback easier to give, interpret, and act on. Contributions to the protocol, SDK, validators, CLI, examples, and documentation are welcome.

## Choose the right path

- For a bug fix, documentation improvement, test, or compatible feature, open a pull request directly.
- For a large feature, open a feature request before investing substantial work.
- For a schema, protocol, discovery, transport, or compatibility change, open a **Protocol change** issue first and follow the [protocol-change process](docs/governance/protocol-changes.md).
- For a suspected vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Set up the project

Prerequisites: Git and Node.js 22 or 24.

```bash
git clone https://github.com/rbifulco/alterno-spatial-review.git
cd alterno-spatial-review
npm ci
npm test
npm run pack:check
```

Create a focused branch from the latest `main`. Keep unrelated changes in separate pull requests.

## Commits and pull-request titles

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Pull requests are squash-merged, so the pull-request title must use the same format:

```text
type(scope): concise description
```

Accepted types are `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, and `chore`.

Recommended scopes are `protocol`, `sdk`, `validator`, `cli`, `schema`, `examples`, `docs`, and `release`. A scope is helpful but optional.

Examples:

```text
feat(sdk): expose scene selection metadata
fix(validator): reject duplicate asset identifiers
docs: clarify source installation
```

Use `!` and a `BREAKING CHANGE:` footer only for an accepted breaking change.

## Add a changeset

Run this for changes that affect a published package:

```bash
npm run changeset
```

Choose every affected package and describe the user-visible result. A changeset is normally unnecessary for documentation, examples, tests, CI, and internal refactors that do not change published behavior.

All four packages currently share a fixed version because the protocol, SDK, validator, and CLI are released as one compatible toolset.

## Submit a pull request

Before opening it:

```bash
npm test
npm run pack:check
```

Complete the pull-request template, keep the diff focused, add tests for behavioral changes, and update documentation when the public interface or integration flow changes. Mark protocol and compatibility consequences explicitly.

A pull request is ready to merge when required checks pass, review conversations are resolved, and any required protocol proposal has been accepted. Maintainers use squash merging so `main` keeps one meaningful conventional commit per pull request.

By contributing, you agree that your contribution is licensed under the project's [MIT License](LICENSE).

## Community

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Use GitHub Discussions for questions and early ideas; reserve issues for reproducible bugs and actionable proposals.
