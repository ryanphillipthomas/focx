# Sources of truth

One canonical home per concern. Everything else is a mirror, a consumer, or drift.

| Concern | Canonical home | Mirrored where | Handoff mechanism |
|---|---|---|---|
| **Design** | Figma (files listed in [`design/figma.manifest.json`](../design/figma.manifest.json)) | `design/tokens/` in this repo | **Product Designer** is the only agent with Figma write, and promotes only after a `DESIGN_APPROVAL verdict=approved` from **Design Steward** ([`org.md`](org.md)); it then syncs published Figma variables/components → tokens via the Figma MCP. The drift gate verifies code against the mirror |
| **Tickets** | GitHub Issues in this repository | Run brief artifact (`10-brief.json`) | The `pipeline:build` label fires the pipeline; the Chief derives the brief from the issue body and links the run back on the issue |
| **Development** | This repository, `develop` branch | Run branches (`run/<run-id>`) | Pull requests; human review is the only path to `develop` — bot PRs get inline QA, hand-written PRs get the `pr-review` check |
| **Orchestration / execution substrate** | The Paperclip company `Focx.ai` (`5f772ef2-…`). Desired state is [`pipeline/org/roster.json`](../pipeline/org/roster.json); the org is documented in [`org.md`](org.md) | Paperclip holds live state | [`tools/paperclip-org/`](../tools/paperclip-org/index.mjs) reconciles live state to the roster; `--verify-only` makes divergence a failing check. GitHub Actions is retained for the drift gate and deploy verification |
| **Who runs which pipeline stage** | [`org.md`](org.md) | Instruction bundles under [`pipeline/org/instructions/`](../pipeline/org/instructions/), rendered into Paperclip | Bundles are a pure function of this repo; a hand-edit in the Paperclip UI is drift, not a change |
| **Agent credentials** | Paperclip's secret store | — | The roster references secrets **by name** only. A credential value never enters this repository |
| **Run state / audit** | `pipeline/runs/<run-id>/` on the run branch, plus the PR itself | GitHub Actions run logs; once Paperclip-native execution lands per the 2026-09-01 decision, Paperclip's task, budget, and audit trail will be an additional mirror | Each role commits its artifact before handing off |
| **Deployment** | Render, configured by [`render.yaml`](../render.yaml) | PR deploy previews | Render generates a preview per PR; the preview URL is recorded in the build report artifact |
| **Distribution** (future: App Store, TestFlight) | To be decided when Apple targets land — will be a single home, documented here first | — | — |

## Rules

1. **Writes go to the canonical home only.** A bot that wants to change a design value changes it in Figma (or escalates to a human who can); it never edits `design/tokens/` directly except through the Design role's sync process.
2. **Mirrors are read-only for consumers.** Code reads tokens from `design/tokens/`; it never defines its own.
3. **A missing fact is a finding, not an invitation.** If the canonical home lacks something a role needs, the role records it in its artifact and escalates — it does not create a shadow copy elsewhere.
4. **Changing a canonical home is a human decision.** Moving tickets off GitHub Issues, deployment off Render, etc. requires updating this document first, by a human-merged PR.

## Design parent/child relationship

The focx design system is the **parent**; Connect's is a **child** that extends it — the way Grok's extends xAI's.

- `design/tokens/focx/` — the parent tokens, extracted from the focx Figma foundation.
- `design/tokens/connect/` — **deltas only**: new `connect.*` tokens, plus explicit overrides marked `"override": true`. Never a copy of the parent.
- `packages/design-connect` declares a dependency on `packages/design-focx` and re-exports what it does not override.

This makes extension mechanically checkable: the drift gate fails any Connect token that silently redefines a parent path.
