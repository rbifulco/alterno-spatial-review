# `@alterno-dev/spatial-review-cli`

Validate a published discovery document and its advertised transports:

```bash
npx @alterno-dev/spatial-review-cli validate https://project.example
```

The CLI is a non-browser tool and cannot use the SDK's `postMessage` discovery
bridge. It tries the canonical origin-root document and then a project-relative
document, in order. Use an explicit same-origin HTTP(S) locator when needed:

```bash
npx @alterno-dev/spatial-review-cli validate https://owner.github.io/project/ \
  --discovery-url https://owner.github.io/project/review-manifest.json
```

Publishing a static document is optional for the client-only editor but required
when using this command. Diagnostics list every attempted URL and distinguish an
unavailable response (network failure or non-success HTTP status) from an invalid
JSON or protocol document. Relative discovery fields resolve from the final URL
of the successful same-origin response.

After successful validation, the CLI prints a deep link to the official hosted
editor at `https://spatial-review.alterno.dev`. Opening that link still requires
the website's SDK bridge to authorize the official editor origin, or the static
discovery resources to be directly accessible.
