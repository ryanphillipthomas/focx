# Deploy

The boundary between merged and live. Render performs deploys; this role proves what actually reached the internet, governs the staging→production promotion, and owns infrastructure drift. Like every role it has **no merge authority** — it assembles the promotion case and a human merges it.

Deploy is not a stage inside a run. It is a second loop, triggered by deploy events rather than by intake, because deployment happens after the human review a run deliberately ends at.

It runs as code, not as an agent: `tools/deploy-verify/index.mjs` is the deterministic gate on every deploy, because everything below is a field compare, a poll, or a probe. The charter (`pipeline/prompts/deploy-agent.md`) remains the role's rulebook and governs any agent summoned for the judgment work code can't do — prose-vs-reality audits, failure triage — which is occasional, never per-deploy, and never holds the Render API key as a standing grant.

## Inputs
- The deploy event: environment, expected commit SHA, Render service id, public URL.
- The Render API (`api.render.com/v1`): deploy status, custom domains, service configuration.
- `render.yaml` and `docs/sources-of-truth.md` — what the infrastructure is *declared* to be.
- `60-qa-verdict.json`, when the deploy traces to a pipeline run.

## Outputs
- `pipeline/releases/<deploy-id>.json` (contract: [`release-record.schema.json`](../../pipeline/contracts/release-record.schema.json)) — deploy status, the commit actually serving, health evidence, infrastructure drift, and one outcome: `live`, `degraded`, `failed`, or `blocked`.
- On a healthy staging release: a `staging → main` pull request whose body is the promotion evidence, opened for human review and never merged.
- On a failed production release: a rollback to the last known-good deploy, plus an issue recording what failed.

## Responsibilities
1. **Prove the commit, not the color.** A green deploy of the wrong commit is a failure. Verify the live deploy's SHA against the expected one.
2. **Health-check the public URL**, not the `onrender.com` hostname — the custom domain and its certificate are part of what shipped.
3. **Own infrastructure drift.** Settings that live only in the Render dashboard (PR previews, headers, redirects) revert silently and no gate watches them; a recreated service resets its preview toggle. Compare live configuration against the repository every release, and report mismatches in both directions.
4. **Propose promotions with evidence.** Never merge one.
5. **Restore, never advance.** Rollback to a previously approved state is the one write this role owns.

## Handoff acceptance criteria
A human accepts a promotion PR only if the release record shows `live`, every check is evidence-backed, and `infraDrift` is empty. Non-empty drift keeps the PR in draft with the drift described.

## Failure modes
- Deploy status not terminal within the poll window → `failed` with the deploy id, never an optimistic pass.
- Wrong commit serving → `failed`, naming the commit that is actually live.
- Infrastructure drift found → `degraded`; report it, never silently fix the dashboard to match.
- Site unreachable from one resolver while the authoritative nameservers answer → a caching artifact, not an outage. Confirm before reporting.
