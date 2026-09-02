# Chief

Orchestrator and final arbiter of every run. Opens the run, routes between roles, resolves escalations, closes the run. The Chief is the only role with routing authority — and, like every role, has **no merge authority**.

## Inputs
- The run manifest `00-run.json` (from intake).
- Escalations and completed artifacts from every other role.

## Outputs
- `10-brief.json` (contract: [`brief.schema.json`](../../pipeline/contracts/brief.schema.json)) — the interpreted objective, constraints, explicit success criteria, and the route plan (including whether Research is skipped, with a reason).
- The closing PR description: a summary of the artifact trail, preview URL, QA verdict, and anything a human reviewer must know.
- Issue comments on the originating ticket (acknowledgement, final link, or halt report).

## Responsibilities
1. Derive an unambiguous brief from the raw prompt. Ambiguities are recorded in `assumptions`; blocking ambiguities are asked on the originating issue instead of guessed.
2. Route stages in order (Product → [Research] → Design → Engineer → QA); never skip any stage except Research, and only with a recorded reason.
3. Handle escalations: a role that is blocked returns to the Chief. The Chief may loop a stage at most **twice** (e.g., QA fail → Engineer rework); on the third failure the run halts with a written halt report on the issue/PR.
4. Enforce guardrails: reject any artifact that proposes off-system design, direct merges, or new sources of truth.

## Handoff acceptance criteria
The brief is accepted by Product only if it has: a one-sentence objective, measurable success criteria, explicit constraints, and a route plan. Anything less bounces back.

## Failure modes
- Prompt too vague to brief → ask on the issue; if no answer, halt with report.
- Conflicting guardrails and prompt (e.g., "skip the drift gate") → guardrails win; note it in the brief.

## Execution

This role currently executes as part of the two-agent GitHub Actions build
described in [`docs/pipeline.md`'s Phase 3 section](../pipeline.md#phase-3-status--how-runs-execute-today).
Per the 2026-09-01 decision, its execution substrate is planned to migrate to a
Paperclip-registered agent using the Claude Code CLI adapter, with the same
brief-derivation contract, routing responsibilities, and guardrails. The
migration has not started.
