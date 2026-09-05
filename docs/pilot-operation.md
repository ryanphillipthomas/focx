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

## Execution permission policy

Paperclip 2026.831.1 defaults both Claude and Codex ACP engines to `approve-all`. The CLI bypass flags do not select ACP permission policy. Each pilot therefore explicitly declares `permissionMode: approve-reads` and `nonInteractivePermissions: deny`; CLI bypass flags remain false. Synchronization preserves stricter existing `deny-all` or `fail` policies.

This is an agent permission policy, not a filesystem or network sandbox. Whether a tool request is classified as read-only depends on the adapter. An operation needing approval must stop when no interactive approver is present. Before implementation work, deliberately establish an appropriate scoped write workflow; do not resolve permission failures by silently restoring `approve-all`. The earlier smoke test proved task context and stopping behavior, not this corrected permission behavior.

## Adapter migration

The tool never changes an agent's adapter, model, or credentials: binding the Claude token to an agent that ran Codex is new access, and access is granted by a human. To move a pilot between adapters, a human performs the change in Paperclip (adapter type, model, thinking effort, environment bindings), with the exact fields reviewed first; the source PR then records it on the agent as `adapterMigration: { from, to, approvedBy, date }` and sets `adapterType` to match. Preflight refuses while the live adapter still equals `from`, and refuses any adapter mismatch that has no migration record.

## Adapter-local plugins and the QA write workflow

Claude Code plugins a pilot relies on are installed on this host by a human (`/plugin marketplace add`, `/plugin install`). The manifest records the required plugins as `adapterLocal.claudeCodePlugins`, using Claude Code's own `<plugin>@<marketplace>` keys. Repository `.claude/settings.json` mirrors those keys in `enabledPlugins` only. This project setting applies to every Claude session in this repository, including human interactive sessions; it grants no additional permissions and does not install plugins. Update the mirror with any reviewed manifest plugin change.

Paperclip's vendored acpx 0.12.0 excludes the `user` setting source for `claude-agent-acp`, loading only `project` and `local` by default. Consequently, the agent's own `settings.json` under `CLAUDE_CONFIG_DIR` is ignored. The 2026-09-05 handoff records direct ACP probes advertising 44 commands without plugins and 49 with project-level plugin settings. Repository settings provide the durable plugin delivery path without changing the Paperclip service environment. The FOC-92 smoke run at `5e2fb9bea11aac885e887f7effacbecb9dfaba9c` advertised 49 commands and completed the silent-failure review subagent. Skill execution, evidence writes and reporting were denied; plugin loading passed independently of those permission failures.

`CLAUDE_CODE_PLUGIN_CACHE_DIR` in the agent environment points at the host plugin root. The synchronization tool preserves but never writes that environment or installed plugins. Source validation requires repository settings to mirror only the manifest plugin keys. `pnpm pilot:verify` checks plugin installation and the selected QA permission launcher; it no longer treats permissions in the ignored user settings file as evidence of effective permission delivery.

QA's scoped rules remain in `adapterLocal.permissionsAllow`. Its `permissionDelivery: qa-worktree-local` selects `engine: acp` and `agentCommand: node tools/qa-claude-agent-acp/index.mjs` through the existing reviewed plan/apply flow. This requires the source PR to be human-merged before live synchronization. `approve-reads`, unattended denial and disabled bypass flags remain unchanged. Pinning ACP prevents a silent CLI fallback that would omit the launcher.

Before starting the installed ACP server, the launcher loads the manifest in the run's checkout and mirrors the rules into that worktree's `.claude/settings.local.json`. Paperclip writes this file before starting the agent and preserves existing entries on subsequent runs; the launcher preserves its five known coordination grants, additional directories, and any ask/deny settings. It refuses unexpected or stale allow rules and non-default modes instead of silently widening them. A permission removal may therefore require reviewed cleanup of an existing worktree; fresh worktrees avoid stale entries.

The launcher requires the QA/company identity, a task and run binding, and an isolated `FOC-*` worktree under the repository's `.paperclip/worktrees/`. It refuses an ordinary developer checkout and symlinked settings paths. It writes atomically, checks the readback, and logs a rule count and SHA-256 digest before inheriting ACP's standard input/output. This is a configuration guard, not a security sandbox: anyone deliberately entering that same QA worktree inherits its local settings. Shared repository settings remain plugin-only.

The ACP executable resolves through this host's managed `~/.paperclip/cli/current` installation, so routine version changes do not require a version-pinned vendor path. Missing installation or changed Paperclip local-setting conventions stop the launch and require review. No service plist or vendor file is edited. The source plan digest includes the launcher source; `pilot:verify` rejects a missing managed ACP entrypoint or an adapter that does not select this delivery mechanism.

The permission changes remove `Write(/tmp/**)`, narrow `mkdir` to `pipeline/runs/*`, and add only `Skill(differential-review:diff-review)` for the skill denied in FOC-92. The remaining manifest rules are preserved. QA must not attempt alternate scratch locations or probe denials. A denied operation is reported once; it never authorizes a broader rule.

After human merge and a freshly reviewed synchronization plan, a bounded fresh-session smoke must verify the launcher readiness log, plugin resolution, evidence mkdir/Write, differential-review invocation, and successful reporting-script delivery. Restore QA's paused state and both disabled wakeups afterward. A clean static verification is not a live workflow pass; permission matching and reporting remain unproven until that smoke succeeds.

## Reporting from inside a run

A pilot that cannot write to its task has no voice: it finishes the work and the board sees a `blocked` issue with no explanation. Under `approve-reads` that is the default outcome, because Claude Code does not prefix-match a Bash command containing a variable expansion against a permission rule, and Paperclip's built-in coordination skill teaches exactly such a command — `curl` with `$PAPERCLIP_API_URL` and `$PAPERCLIP_API_KEY`. The 2026-09-04 QA smoke test isolated this in a single run: under one `Bash(curl:*)` rule, a curl to a literal URL completed and `curl -s "$PAPERCLIP_API_URL"` was refused.

Paperclip already allow-lists `<worktree>/scripts/paperclip-issue-update.sh` in every run's `.claude/settings.local.json` but ships no such file, and every worktree is a checkout of this repository. So the script lives here, at `scripts/paperclip-issue-update.sh`. It reads `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_TASK_ID` and `PAPERCLIP_RUN_ID` from the environment, leaving the call site free of expansion:

```
scripts/paperclip-issue-update.sh --status done <<'MD'
report body, blank lines intact
MD
```

QA's manifest carries the matching rule `Bash(scripts/paperclip-issue-update.sh:*)`, because Paperclip's own rule names an absolute path while the documented call is relative. The script verifies rather than infers, as Paperclip's skill requires: a successful update echoes the issue, so an empty body, an unparseable body, a different issue id, or a status the server did not apply are all reported as FAILED with a nonzero exit. One connection-level failure is retried once; an HTTP error is never retried, because a PATCH that may already have applied must not be sent twice. The bearer token is passed to curl through `--config` on stdin so it never appears in this host's process list. `node --test scripts/paperclip-issue-update.test.mjs` covers these paths and runs in the drift gate.

The reporting script has passed its local suite but has not yet executed successfully in a live QA run. FOC-92 confirmed plugin loading and the remaining permission failures. It also recorded a prohibited, denied `/tmp` write attempt and changed shared plugin metadata mtimes with no identified writer; neither finding is proof that the new permission delivery works. The post-merge smoke must establish that separately.
