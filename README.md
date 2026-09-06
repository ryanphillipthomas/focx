# focx

Autonomous development repository for **focx.ai** — an umbrella organization containing multiple sub-applications. The first is **Connect**, a web app extending later to iOS, iPadOS, and macOS. Connect's design system *extends* the focx design system: shared fundamentals, distinct identity.

This repository is built so that work can enter from a GitHub Issue, a manual invocation, or a grok bot — and flow through a role-based bot pipeline (Chief → Product → Research → Design → Engineer → QA) that produces reviewable, drift-free pull requests. **Bots build; humans merge.**

## Drift Check GitHub Action

Drift Check is a dependency-free GitHub Action that finds raw visual values which do not resolve to a repository's published design tokens. It reads only the checked-out repository and sends no telemetry.

### Quickstart

Add one workflow file at `.github/workflows/drift-check.yml`:

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

By default it auto-detects token/theme/palette files, scans `apps`, `src`, and `packages`, and excludes generated output, token definitions, SVG artwork, and test/story fixtures. It accepts JSON, TypeScript, JavaScript, CSS, SCSS, and the other scanned source formats without evaluating repository code.

To customize them, add `drift-check.config.json` at the repository root:

```json
{
  "tokenFiles": ["foundations/colors.scss"],
  "scanDirs": ["src", "components"],
  "scanExtensions": [".ts", ".tsx", ".css"]
}
```

The focx-only parent/child JSON integrity convention is disabled for third parties and enabled here through `validateParentChild: true` in this repository's config. Workflow inputs named `token-files`, `validate-parent-child`, `parent-namespace`, `token-path-pattern`, `scan-dirs`, and `scan-extensions` override corresponding config values. List inputs are comma-separated. Violations exit non-zero and are emitted as GitHub file/line annotations; reviewed exceptions can include `drift-allow` on the affected line.

## Map

| Path | What lives here |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Operating manual — start here if you are a bot or a new human |
| [`docs/sources-of-truth.md`](docs/sources-of-truth.md) | The canonical home for every concern, and the handoffs between them |
| [`docs/pipeline.md`](docs/pipeline.md) | How a run flows through the roles, with an artifact at every stage |
| [`docs/org.md`](docs/org.md) | The operating company: which agents exist, who they report to, and which pipeline stage each one runs |
| [`docs/triggers.md`](docs/triggers.md) | How each of the three trigger sources invokes the pipeline |
| [`docs/drift-gate.md`](docs/drift-gate.md) | The design-drift fail-safe: what drift is, how it is measured, how it blocks |
| [`docs/roles/`](docs/roles/) | Role definitions: inputs, outputs, handoff contracts |
| [`pipeline/contracts/`](pipeline/contracts/) | JSON Schemas for every role-to-role handoff artifact |
| [`pipeline/runs/`](pipeline/runs/) | Auditable per-run artifacts, committed on run branches |
| [`pipeline/org/`](pipeline/org/) | The agent roster and instruction bundles — desired state for the Paperclip company |
| [`design/`](design/) | Figma manifest + extracted design tokens (parent `focx`, child `connect`) |
| [`packages/design-focx/`](packages/design-focx/) | Parent design-system package |
| [`packages/design-connect/`](packages/design-connect/) | Connect's design system — extends `design-focx` |
| [`apps/connect/`](apps/connect/) | The Connect web app (scaffolded by the pipeline in Phase 2) |
| [`tools/drift-check/`](tools/drift-check/) | The drift-gate CLI run on every pull request |
| [`.github/workflows/`](.github/workflows/) | The trigger surface: pipeline, nightly research, drift gate |

## Sources of truth (summary)

- **Design** → Figma (via the Figma MCP), mirrored into `design/tokens/`
- **Tickets** → GitHub Issues in this repository
- **Development** → this repository
- **Deployment & previews** → Render (`render.yaml`)

## Quick start

- **File a ticket:** open a [Build request](../../issues/new?template=build-request.yml) issue — the `pipeline:build` label fires the pipeline.
- **Run manually:** `gh workflow run pipeline.yml -f prompt="build me this idea"`
- **Grok bot:** POST a `repository_dispatch` event of type `grok-build` (see [`docs/triggers.md`](docs/triggers.md)).

Every run lands as a draft PR with its artifacts under `pipeline/runs/<run-id>/`. The drift gate must pass and a human must review before anything merges.
