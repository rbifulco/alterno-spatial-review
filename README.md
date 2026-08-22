# Alterno Spatial Review

Alterno Spatial Review is an engine-neutral, open contract for exposing a
semantic 3D scene to review tools and coding agents. This repository contains
the protocol, website SDK, validators, CLI, adapters, examples, and conformance
fixtures. The hosted editor is a separate, closed product.

## Packages

- `@alterno-dev/spatial-review-protocol` — contracts, identifiers, and URL normalization.
- `@alterno-dev/spatial-review` — Three.js registry, serializer, and cross-origin bridge.
- `@alterno-dev/spatial-review-validator` — runtime validation for untrusted manifests.
- `@alterno-dev/spatial-review-cli` — integration validation from a terminal or CI.

## Install

```bash
npm install @alterno-dev/spatial-review three
```

See [the website integration guide](docs/integrating-a-website.md) and
[the AI-agent installation recipe](docs/install-with-ai.md).

## Development

```bash
npm install
npm test
npm run pack:check
```

## Ownership boundary

This repository is deliberately independent from both the proprietary Alterno
Spatial Review editor and from Sole, the first production website that uses the
contract. Neither is required to validate an integration.

## License

MIT
