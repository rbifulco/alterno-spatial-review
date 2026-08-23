# `@alterno-dev/spatial-review-cli`

Validate a published discovery document and its advertised transports:

```bash
npx @alterno-dev/spatial-review-cli validate https://project.example
```

The CLI is a non-browser tool and cannot use the SDK's `postMessage` discovery
bridge. Publishing `/.well-known/spatial-review.json` is optional for the
client-only editor but required when using this command.
