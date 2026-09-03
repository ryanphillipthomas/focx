# Drift Check

A dependency-free GitHub Action that blocks design drift by finding raw visual values and invalid design-token overrides. It reads only the checked-out repository and sends no telemetry.

## Quickstart

Add `.github/workflows/drift-check.yml`:

```yaml
name: drift-check
on: pull_request

permissions:
  contents: read

jobs:
  drift-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ryanphillipthomas/drift-check@v1
```

That is enough for repositories using these defaults:

- parent namespace: `focx`
- token path: `design/tokens/{namespace}/tokens.json`
- scan directories: `apps`, `packages`
- scan extensions: `.js`, `.jsx`, `.ts`, `.tsx`, `.css`, `.scss`, `.svelte`, `.vue`, `.html`

## Configuration

Add `drift-check.config.json` at the consumer repository root:

```json
{
  "parentNamespace": "acme",
  "tokenPathPattern": "design/tokens/{namespace}/tokens.json",
  "scanDirs": ["src", "components"],
  "scanExtensions": [".ts", ".tsx", ".css"]
}
```

The token pattern must contain `{namespace}` as one complete path segment. Every sibling namespace is treated as a child layer. Child tokens must either begin with that child's namespace or declare both `"override": true` and an `"overrides"` path that exists in the parent.

Action inputs override values from the config file:

```yaml
- uses: ryanphillipthomas/drift-check@v1
  with:
    parent-namespace: acme
    token-path-pattern: tokens/{namespace}/tokens.json
    scan-dirs: src,components
    scan-extensions: .ts,.tsx,.css
```

Violations exit with status 1 and appear as file/line annotations in pull requests. A reviewed exception can include `drift-allow` on the affected line.

## Local use

Requires Node.js 20 or newer and no install step:

```sh
node tools/drift-check/index.mjs
```
