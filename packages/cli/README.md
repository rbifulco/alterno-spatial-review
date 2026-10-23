# `@alterno-dev/spatial-review-cli`

Prepare an actual source registry before sharing its editor link:

```bash
npx @alterno-dev/spatial-review-cli prepare ./capture-review.mjs --out ./dist/prepared-review
```

The explicit local module exports `{ registry, options }` or a factory returning
that value/an SDK-exported package. Options identify the website, source revision
and fidelity. Browser-dependent generation can instead export from the settled
capture page through the SDK and a local binary sink. Complete captured JSON
with binary texture sidecars is also supported. Output directories must be new;
the command never substitutes optional proxy manifests for canonical geometry.
See [the capture, publishing and validation workflow](../../docs/prepared-review-packages.md).

Validate a published discovery document and its advertised transports:

```bash
npx @alterno-dev/spatial-review-cli validate https://project.example
```

When a prepared package is advertised, validation verifies the preferred
package's identity, all file lengths/digests, references and decoded index.
Corruption fails validation even when legacy transports are also advertised.

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

The success report names an advertised live-capture editor-origin policy mode,
or `unspecified` for existing producers. The CLI validates policy syntax but is
not a browser editor and does not use the metadata as authorization.

Static scene and asset documents must use the website origin by default, and
every redirect is checked before it is followed. This keeps validation of a
public website from reaching unrelated internal or local services. If a site
intentionally publishes static data from a CDN, opt in to that exact origin:

```bash
npx @alterno-dev/spatial-review-cli validate https://project.example \
  --allow-origin https://assets.example
```

`--allow-origin` may be repeated. Local development remains supported: documents
on the same localhost origin work without a flag; a different local port needs
an explicit opt-in.

After successful validation, the CLI prints a deep link to the official hosted
editor at `https://spatial-review.alterno.dev`. Opening that link still requires
the website's SDK bridge to authorize the official editor origin, or the static
discovery resources to be directly accessible.
