# Drift Check

A dependency-free GitHub Action that finds raw visual values that do not resolve to a repository's published design tokens. It reads only the checked-out repository and sends no telemetry.

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

With no configuration, Drift Check:

- auto-detects token files in token-, theme-, palette-, and color-named files and directories
- reads published values from JSON, TypeScript, JavaScript, CSS, SCSS, and the other configured source extensions
- scans `apps`, `src`, and `packages`
- scan extensions: `.js`, `.jsx`, `.ts`, `.tsx`, `.css`, `.scss`, `.svelte`, `.vue`, `.html`
- excludes generated output, token definitions, SVG artwork, and test/story fixtures

This default is the portable raw-value check. The focx-specific parent/child JSON convention is available as an explicit opt-in.

## Configuration

Add `drift-check.config.json` at the consumer repository root:

```json
{
  "tokenFiles": ["foundations/colors.scss", "foundations/spacing.ts"],
  "scanDirs": ["src", "components"],
  "scanExtensions": [".ts", ".tsx", ".css"]
}
```

`tokenFiles` is optional and supplements auto-detection. Use it when token files have names and paths the detector cannot recognize.

Repositories that intentionally use the focx parent/child JSON convention can opt into its integrity check:

```json
{
  "validateParentChild": true,
  "parentNamespace": "acme",
  "tokenPathPattern": "design/tokens/{namespace}/tokens.json"
}
```

The token pattern must contain `{namespace}` as one complete path segment. When validation is enabled, every sibling namespace is treated as a child layer. Child tokens must either begin with that child's namespace or declare both `"override": true` and an `"overrides"` path that exists in the parent.

Action inputs override values from the config file:

```yaml
- uses: ryanphillipthomas/drift-check@v1
  with:
    token-files: foundations/colors.scss,foundations/spacing.ts
    scan-dirs: src,components
    scan-extensions: .ts,.tsx,.css
```

Inputs are also available as `validate-parent-child`, `parent-namespace`, and `token-path-pattern`.

Violations exit with status 1 and appear as file/line annotations in pull requests. A reviewed exception can include `drift-allow` on the affected line.

The zero-delta comparison against the seven outreach targets is recorded in [`verification.md`](verification.md).

## Local use

Requires Node.js 20 or newer and no install step:

```sh
node tools/drift-check/index.mjs
```
