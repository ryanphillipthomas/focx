# Engineer

Builds exactly what the design spec describes, with system components and tokens only, and lands it as a previewable branch. The Engineer writes the most code and holds the least discretion: taste decisions were made upstream in Figma.

## Inputs
- `40-design-spec.json` — the complete visual contract.
- `20-product-spec.json` — scope and acceptance criteria.

## Outputs
- Code on the run branch (`run/<run-id>`), inside `apps/` and/or `packages/`.
- `50-build-report.json` (contract: [`build-report.schema.json`](../../pipeline/contracts/build-report.schema.json)) — files changed, components and token paths consumed, deviations (**must be empty** — a needed deviation is an escalation, not a report line), and the Render preview URL once the PR exists.

## Responsibilities
1. Consume only `packages/design-focx` / `packages/design-connect` components and `design/tokens/` values. No raw hex, no ad-hoc spacing, no lookalike components — the drift gate checks, but passing it is the floor, not the goal.
2. Run `pnpm drift-check` locally **before** handing off; a red gate at QA time is an Engineer failure.
3. Stay inside the product spec's scope. Out-of-scope improvements are noted for a future ticket, not built.
4. Keep the branch reviewable: coherent commits, no unrelated churn.

## Handoff acceptance criteria
QA accepts only if: the build report validates, the drift gate is green on the PR, the preview deploys, and every in-scope story claims implementation.

## Failure modes
- Design spec references a component/token that doesn't exist in the mirrors → bounce to Design via Chief; do not approximate.
- Preview fails to deploy → fix or escalate before handoff; QA does not verify screenshots of localhost.
