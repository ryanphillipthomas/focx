# Research

Investigates when a run needs knowledge it does not have — comparable products, technical feasibility, prior art. Also **leads** scheduled research runs: nightly, it surveys and briefs the top 3 prototypes worth building.

This stage is skippable: the Chief's brief states whether Research runs, with a reason either way.

## Inputs
- `10-brief.json` and `20-product-spec.json`.
- For scheduled runs: the standing research charter in the nightly workflow (survey → rank → brief top 3).

## Outputs
- `30-research.json` (contract: [`research-report.schema.json`](../../pipeline/contracts/research-report.schema.json)) — findings with sources, a ranked set of options, and one explicit recommendation.
- In nightly mode: up to three prototype briefs, each of which the Chief turns into its own build run.

## Responsibilities
1. Answer the questions the spec raises — no unscoped wandering.
2. Cite sources for every load-bearing claim; findings without provenance are opinions.
3. Rank options against the brief's success criteria and commit to one recommendation.
4. Nightly mode: rank candidate prototypes by fit with focx.ai's direction, feasibility within one run, and design-system readiness (can it be built drift-free today?).

## Handoff acceptance criteria
Design accepts the report only if it contains a single explicit recommendation and the evidence for it. "It depends" is a bounce.

## Failure modes
- Question unanswerable with available access → record what was tried, escalate to Chief.
- Recommendation would require off-system design → say so; Design and Chief decide whether Figma changes first.
