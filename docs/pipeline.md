# The pipeline

A **run** is one pass of work through the role-based bot team. Runs are triggered by a ticket, a manual invocation, or a grok bot ([`triggers.md`](triggers.md)); every run produces an auditable artifact trail and ends as a draft pull request a human can review, preview, and merge — or close.

## Flow

```
trigger ──▶ Chief ──▶ Product ──▶ Research ──▶ Design ──▶ Engineer ──▶ QA ──▶ Chief ──▶ draft PR
              │          (Research is skippable when the         │                 ▲
              │           brief needs no investigation)          │                 │
              └────────────── escalations return to Chief ───────┴─────────────────┘
```

The Chief opens and closes every run and is the only role that routes between roles. Any role that is blocked escalates to the Chief; the Chief may loop a stage (e.g., send a failed QA verdict back to the Engineer) at most twice before halting the run and reporting on the originating issue/PR.

## Stages and artifacts

Every stage commits its artifact to `pipeline/runs/<run-id>/` **before** handing off. Artifacts are JSON, validated against the schemas in [`pipeline/contracts/`](../pipeline/contracts/). An artifact that fails validation is an incomplete handoff.

| # | Stage | Role | Artifact | Contract |
|---|---|---|---|---|
| 0 | Intake | (automation) | `00-run.json` — run manifest: id, trigger source, raw prompt | `run.schema.json` |
| 1 | Brief | Chief | `10-brief.json` — interpreted objective, constraints, success criteria, route plan | `brief.schema.json` |
| 2 | Spec | Product | `20-product-spec.json` — user stories, scope, out-of-scope, acceptance criteria | `product-spec.schema.json` |
| 3 | Research | Research | `30-research.json` — findings, references, recommendation (omitted if skipped) | `research-report.schema.json` |
| 4 | Design | Design | `40-design-spec.json` — Figma node refs, components and tokens to use | `design-spec.schema.json` |
| 5 | Build | Engineer | `50-build-report.json` — branch, files changed, components/tokens used, preview URL | `build-report.schema.json` |
| 6 | Verify | QA | `60-qa-verdict.json` — drift result, acceptance criteria pass/fail, verdict | `qa-verdict.schema.json` |
| 7 | Close | Chief | PR description summarizing the trail; issue comment linking the PR | — |

## Hard rules

- **The drift gate runs on every PR** and is a required check. A QA `pass` verdict is impossible while the gate is red. See [`drift-gate.md`](drift-gate.md).
- **Bots never merge.** The run ends at a draft PR with a Render preview. Only a human review moves it further.
- **No stage skipping.** Only Research may be skipped, and only when the Chief's brief says so with a reason.
- **Determinism of record.** Anything a role decided must be recoverable from its artifact alone. If it isn't in the artifact, it didn't happen.

## After the run — deploy

A run ends at a draft PR on purpose, so deployment happens *after* the human
review the run stops at. The **Deploy** role ([`roles/deploy.md`](roles/deploy.md)) is therefore not a
stage in the chain above — it is a second loop, triggered by deploy events
rather than by intake, and it runs as deterministic code
([`tools/deploy-verify/`](../tools/deploy-verify/index.mjs)); its charter
([`pipeline/prompts/deploy-agent.md`](../pipeline/prompts/deploy-agent.md))
governs any agent summoned for audits or failure triage.

```
human merges ──▶ Render deploys ──▶ Deploy ──▶ release record
   (staging)                           │       └─▶ staging→main PR, for a human
                                       │
   (main) ─────────────────────────────┴─▶ verified live, or rolled back
```

It proves what actually reached the internet — that the expected commit is the
one serving, that the public URL answers over a valid certificate, and that live
Render configuration still matches `render.yaml`. Its record is
`pipeline/releases/<deploy-id>.json`
([`release-record.schema.json`](../pipeline/contracts/release-record.schema.json)),
keyed by deploy rather than by run because a human's direct merge is a release
too.

The **bots never merge** rule holds here without exception. Deploy assembles the
promotion case and a human merges it. Its one write authority is *backward*: it
may roll production back to a deploy a human already approved, never forward
into one they have not.

## Phase 3 status — how runs execute today

When the `ANTHROPIC_API_KEY` secret is configured, each run executes as **two
independent Claude agents** inside the pipeline workflow:

1. **Build agent** ([`pipeline/prompts/build-agent.md`](../pipeline/prompts/build-agent.md))
   executes the role chain Chief → Product → (Research) → Design → Engineer in
   one invocation, writing each artifact and validating it against its contract
   before moving on. Design works from the synced mirrors (`design/tokens/`,
   `design/figma.manifest.json`) — CI has no live Figma access.
2. **QA agent** ([`pipeline/prompts/qa-agent.md`](../pipeline/prompts/qa-agent.md))
   runs with fresh context after the PR opens and the drift gate reports,
   verifies every acceptance criterion with evidence, and writes the verdict.
   Separate invocation on purpose: an agent grading its own homework isn't QA.

The roles remain real as **contract stages** — every artifact is mechanically
validated in CI (`tools/contracts/validate.mjs`, part of the gate check) — but
Phase 3 deliberately uses one process for the build chain rather than six, for
cost. The contracts make per-role isolation a drop-in change later.

Without the key — and for `[drift-test]` negative tests — the Phase 2
**deterministic builder** ([`tools/poc-builder/`](../tools/poc-builder/)) runs
instead: same Figma in → byte-identical POC out, at zero agent cost. Fallback
runs produce only `00-run.json` and `50-build-report.json`; the full artifact
trail is an agent-path feature.

## Phase 4 (planned) — Paperclip-native execution

The 2026-09-01 **Option B** decision is to move the same Chief → Product →
Research → Design → Engineer → QA → Deploy role chain and contract-stage
artifacts to Paperclip-registered Claude/Codex agents. This will replace GitHub
Actions execution rather than wrap or dispatch work into the unchanged GitHub
Actions pipeline. The drift gate, artifact contracts, and Render deploy target
remain unchanged.

Status: **not started**, tracked as Phase 1 on the focx Command Deck. Once the
transition lands, `00-run.json`'s optional `trigger.paperclipTaskId` field will
cross-reference the Paperclip task that owns the run.

## Run identity

- Run ID format: `run-<UTC yyyymmdd-HHMMSS>-<trigger>` (e.g., `run-20260830-142201-ticket`).
- Branch: `run/<run-id>`. All work, including artifacts, lives on this branch until merged or closed.
- The originating trigger (issue number, dispatcher identity, or schedule) is recorded in `00-run.json` — every run is traceable to who or what asked for it.
