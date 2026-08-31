# AGENTS.md — Operating manual

You are an agent (or a human) working in the focx.ai autonomous development repository. This file tells you everything you must know before touching anything. Read it fully; it is short on purpose.

## Read order for a cold start

1. This file.
2. [`docs/sources-of-truth.md`](docs/sources-of-truth.md) — where every concern canonically lives.
3. [`docs/pipeline.md`](docs/pipeline.md) — how a run flows and what artifact each stage produces.
4. The role file for the role you are playing, in [`docs/roles/`](docs/roles/).
5. The JSON Schema for the artifact you must produce, in [`pipeline/contracts/`](pipeline/contracts/).

## Non-negotiable guardrails

1. **No design drift.** Figma is the design source of truth. Every color, spacing, radius, type style, and component you use must resolve to a published token in `design/tokens/` or a component in `packages/design-focx` / `packages/design-connect`. Raw hex values, raw pixel values, and invented components fail the drift gate ([`docs/drift-gate.md`](docs/drift-gate.md)) and the run dies there. Do not try to route around the gate; fix the build or escalate to the Chief.
2. **Build, never merge.** Your output is a pull request with a Render deploy preview. You do not merge, approve, force-push to `main`, or dismiss reviews. Human review is the only path to merge. `CODEOWNERS` enforces this.
3. **One source of truth per concern.** Never create a second home for design values, tickets, run state, or deployment config. If information seems to be missing from its canonical home, that is a finding to report — not a license to improvise a new location.

## How to work

- **Every run has a run ID** (assigned at trigger time) and a branch `run/<run-id>`. All of your work happens on that branch.
- **Every stage writes an artifact** to `pipeline/runs/<run-id>/` conforming to its schema in `pipeline/contracts/`. Commit the artifact before handing off. An artifact that fails schema validation is an incomplete handoff.
- **Handoffs are explicit.** You receive the previous role's artifact; you produce yours; the Chief routes between roles. Do not skip stages or consume artifacts out of order.
- **Ask rather than assume.** If the brief is ambiguous, record the ambiguity and your chosen interpretation in your artifact's `assumptions` field. If the ambiguity is blocking, halt and escalate to the Chief, who may ask the human on the originating issue.
- **Design system extension rules.** `design-connect` extends `design-focx`. Connect may **add** tokens under the `connect.*` namespace and may **override** a parent token only with an explicit `"override": true` marker. Silent redefinition of parent values is drift.

## What you may never do

- Merge or approve pull requests, or modify `.github/CODEOWNERS`, branch protection, or the drift-gate workflow to weaken them.
- Write design values anywhere except `design/tokens/` (and only via the Design role's sync process from Figma).
- Create tickets anywhere other than GitHub Issues, or track run state outside `pipeline/runs/`.
- Deploy anywhere other than through `render.yaml` previews attached to your PR.

## Where things are

| Concern | Canonical home |
|---|---|
| Design (visual truth) | Figma → mirrored to `design/tokens/` + `design/figma.manifest.json` |
| Tickets | GitHub Issues (this repo) |
| Code | This repo, `main` branch |
| Run state & audit trail | `pipeline/runs/<run-id>/` on the run branch + the PR |
| Deployment | Render, via `render.yaml` |
