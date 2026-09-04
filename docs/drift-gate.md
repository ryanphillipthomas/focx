# The drift gate

The design-drift fail-safe. It runs on **every pull request** ([`.github/workflows/drift-gate.yml`](../.github/workflows/drift-gate.yml)) as a required status check, for every trigger source. A build that drifts from the published design system does not proceed — not to QA `pass`, not to merge.

## What drift is

Figma is the design source of truth. Its published variables and components are mirrored into this repo as `design/tokens/` (via the Figma MCP; file keys in [`design/figma.manifest.json`](../design/figma.manifest.json)). Drift is any of:

1. **Raw values** — a color, spacing, radius, or type value written literally in app/package code instead of resolving to a published token.
2. **Off-system components** — UI constructed outside `packages/design-focx` / `packages/design-connect` that duplicates or approximates a system component.
3. **Unapproved visual changes** — a change to `design/tokens/` that does not correspond to a published change in Figma.
4. **Broken extension** — `design/tokens/connect/` silently redefining a parent (`focx`) token path without an explicit `"override": true` marker, or copying parent values instead of referencing them.

## How it is measured

[`tools/drift-check`](../tools/drift-check/) — a dependency-free Node CLI, runnable locally with `pnpm drift-check`, and published as the standalone `ryanphillipthomas/drift-check@v1` GitHub Action:

- **Token integrity:** validates both token files parse, and that every `connect` token is either namespaced `connect.*` or an explicit override of an existing `focx` path.
- **Raw-value scan:** scans `apps/` and `packages/` source for literal color values (hex, `rgb()`) and hard-coded typography/spacing pixel values that do not correspond to a published token value. Token definition files themselves are exempt.
- **Figma freshness (Phase 2):** compares `design/tokens/focx/` against the published Figma variables via the Figma MCP and fails on divergence. Until the MCP runs in CI, freshness is enforced at Design-role sync time and by review.

Exit code 0 = clean; non-zero = drift, with a file/line report.

The CLI resolves the consumer repository from `GITHUB_WORKSPACE`, falling back to the current working directory outside GitHub Actions. Repository-specific settings live in root-level [`drift-check.config.json`](../drift-check.config.json); explicitly supplied Action inputs override that file. The Action sends no telemetry.

## What happens on failure

- The PR check goes red; QA cannot issue a `pass` verdict (its artifact schema requires the gate result).
- The Engineer fixes the build to use system tokens/components — **the fix is never to weaken the gate**.
- If the design system genuinely lacks what the build needs, that is a design-system gap: the Design role records it, the change is made **in Figma first**, synced to tokens, and only then consumed.

## Amnesty

There is none. The gate applies to bot runs, manual runs, scheduled runs, and human PRs equally.
