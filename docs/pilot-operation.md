# Focx v0.1 pilot

Focx.ai is an AI product and experience company covering end-to-end technology-company operations. Agents belong to Focx.ai and may serve any explicitly assigned project within their role. Connect is the only currently active product, not the permanent scope of the company. Project context, repository/workspace and revision belong to each task; assignment alone does not expand access.

Ryan owns priorities, approval and deliberate starts. The Steward reconciles architecture/documentation, the Implementation Engineer executes one approved task, and QA verifies independently. All three remain paused during migration. The other 23 identities remain disabled retirement candidates, with their historical configurations retained for comparison.

`.focx/agents.json` is the current desired-state manifest. `pipeline/org/roster.json` is historical and must not be applied. The old CLI refuses `--apply` before contacting Paperclip, including all former override flags. This guard exists only in this revision and later: do not execute an older checkout's reconciler.

The two `.yaml` control files use JSON syntax, a YAML 1.2 subset, to permit dependency-free validation. The baseline pins the observed implementation separately from the legacy recovery candidate. It deliberately leaves unapproved feature adoption unknown.

## Review and synchronize

1. Human-review and merge the source PR. Do not apply unmerged source to the live organization.
2. With existing authorized board credentials, run `pnpm pilot:check`, then `pnpm pilot:plan`. No credential is needed for the offline check. Set `PAPERCLIP_API_KEY` and, if needed, `PAPERCLIP_API_URL` in your existing secure environment for live read-only planning. Do not put credentials in commands, files, PRs or reports.
3. Review the returned fields and digest. The plan exposes no credential values. Apply that exact preview with `node tools/pilot-org/index.mjs --apply --plan-sha=<digest>` only when ready. Source or live changes invalidate the digest.
4. Run `pnpm pilot:verify`. A nonempty plan fails verification. Partial writes fail rather than reporting success; keep agents paused and inspect a fresh plan.

Synchronization requires all expected agents already paused and all schedules disabled. Missing, extra, renamed-by-ID, or terminated identities are not treated as reasons to create or delete agents. Names may be reconciled only for the same pinned identity. Unknown IDs and unexpected instruction files halt the whole preflight. API read failures also halt it. No resume, termination, agent creation, routine creation or schedule-enabling endpoint is used.

In capped mode the tool keeps stricter existing run caps; the explicit development policy removes daily caps for the three pilot roles. It turns off wake/continuation paths, converges pilot permissions and role files, and preserves existing adapter models, credentials and workspace settings. Per-role methods are copied into visible `skills/focx-*/SKILL.md` instruction-bundle files at the reviewed source revision. They are not globally installed plugins or registry skill assignments. Preflight permits only Paperclip’s built-in coordination skill in registry assignments and rejects other inherited registry skills. The operator must separately review adapter-local plugins and conflicting personal instructions before activation.

## First task gate

Before any model run: confirm the legacy PR queue has only one selected implementation task; give it explicit approval, criteria and source revision; review remaining local skill/session exposure; verify isolated implementation and QA workspaces. Start only the selected role deliberately. The source retains paused status; activation is a separate human action, not a synchronization option.

During development, the three pilot roles have no daily run cap, as explicitly approved by Ryan. A 15-minute timeout remains configured for each pilot. Steward also has a 20-turn limit. These limits are not a measured token budget or proof of runtime enforcement. The first bounded task must verify the installed runtime honors them. One active implementation task/PR is a human admission rule in v0.1, not a global Paperclip scheduler lock.

New findings go into the existing task report for Ryan. They do not automatically create tasks, PRs, comments that trigger more work, or retry chains. A blocked role reports once and stops. Runtime tests, product behavior recovery, production deployment and repository-wide physical archival are outside this migration PR.
