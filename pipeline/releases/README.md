# Releases

One record per Render deploy, written by the deploy role
([`docs/roles/deploy.md`](../../docs/roles/deploy.md),
charter [`pipeline/prompts/deploy-agent.md`](../prompts/deploy-agent.md)) and
validated against
[`release-record.schema.json`](../contracts/release-record.schema.json).

`<deploy-id>.json` — what commit reached which public URL, whether the site
answered, whether live Render configuration still matches the repository, and
one outcome: `live`, `degraded`, `failed`, or `blocked`. Supporting output goes
under `evidence/<deploy-id>/`.

Records are keyed by Render deploy id rather than run id because deploys also
happen from commits with no pipeline run behind them — a human's direct merge
is still a release, and still gets a record. When a deploy does trace to a run,
the record cross-references it in `runId`.

Deploy is not a stage inside a run. Runs deliberately end at a draft PR awaiting
human review; deployment happens after that review, so this is a second loop
triggered by deploy events. The role has no merge authority: it assembles the
promotion case and a human merges it.

Records are committed to the branch whose deploy they verify, so staging and
main each accumulate their own environment's records and the branches diverge
by design between promotions. The promotion merge reconciles them — record
filenames are unique per deploy id, so these merges never conflict. Do not
"fix" the divergence by force-syncing one branch over the other; that erases
the other environment's release history.
