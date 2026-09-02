---
"@alterno-dev/spatial-review": patch
---

Fall back to safe decoded texture sources when a registered source URL returns
a non-image MIME type, while preserving resource byte limits and actionable
failures for arbitrary non-image responses.
