# Security policy

## Supported versions

Security fixes target the latest published version and the `main` branch. Older releases may not receive backports while the project is in its early development phase.

## Report a vulnerability

Use GitHub's **Report a vulnerability** option in the repository Security tab. This creates a private report visible only to the reporter and maintainers.

Do not open a public issue for an undisclosed vulnerability. Include:

- the affected package and version;
- a clear description of the impact;
- minimal reproduction steps or a proof of concept;
- any suggested mitigation;
- whether the issue has been disclosed elsewhere.

Particularly relevant areas include origin validation, remote resource loading, manifest parsing, URL handling, schema bypasses, and unsafe rendering of third-party scene or asset data.

Maintainers will acknowledge a report as soon as practical, validate it, coordinate a fix and release, and credit the reporter if requested. Please allow a reasonable remediation period before public disclosure.

Questions, configuration problems, and non-sensitive hardening suggestions can use the normal issue templates.
