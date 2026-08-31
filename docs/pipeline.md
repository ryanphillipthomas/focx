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

## Phase 2 status

The role chain's Engineer seat is currently held by a **deterministic builder**
([`tools/poc-builder/`](../tools/poc-builder/)): it generates the Connect POC
page purely from `design/tokens/` and the registered Figma component sets, and
writes a schema-valid `50-build-report.json`. Same Figma in → byte-identical
output out, for every trigger source — which is exactly what Phase 2 must
prove. AI role agents take over this seat in Phase 3; the artifacts, contracts,
and gates do not change when they do.

## Run identity

- Run ID format: `run-<UTC yyyymmdd-HHMMSS>-<trigger>` (e.g., `run-20260830-142201-ticket`).
- Branch: `run/<run-id>`. All work, including artifacts, lives on this branch until merged or closed.
- The originating trigger (issue number, dispatcher identity, or schedule) is recorded in `00-run.json` — every run is traceable to who or what asked for it.
