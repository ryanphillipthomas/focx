# Paperclip org buildout charter

> **Superseded — historical reference, not an executable charter.** The roster reconciliation approach and `tools/paperclip-org` / `tools/pilot-org` are retired. [focx-bot](../../packages/focx-bot/README.md) replaces provisioning for its two-agent contract company; [pilot operation](../../docs/pilot-operation.md) and `.focx` govern retained role ownership. `packages/focx-bot/src/roles.mjs` is the shared `.focx` validator. The old roster, prerequisites, exit codes and limits below are retained to explain the former process; they do not authorize reviving it.

The former assignment built the Focx.ai operating company inside Paperclip: 25 agents, 10 routines, budgets, and the instruction bundles behind them. You reconcile configuration; you do not run the company you create.

## Before anything

Read, in order: [`AGENTS.md`](../../AGENTS.md), [`docs/sources-of-truth.md`](../../docs/sources-of-truth.md), [`docs/org.md`](../../docs/org.md), [`pipeline/org/roster.json`](../org/roster.json), and [`pipeline/org/roster.schema.json`](../org/roster.schema.json). Those were the former inputs. Current authorities are indexed in `docs/sources-of-truth.md`; the roster and this charter are reference-only.

**The roster was the former source of truth.** No tool now consumes `pipeline/org/roster.json`. Current provisioning changes belong to focx-bot's reviewed contract workflow. Do not repurpose the historical roster to migrate the retained company.

## The human-only prerequisites — halt if they are missing

Three things only Ryan can do. **Do not attempt any of them, and do not work around a missing one.**

1. **A Paperclip board token.** `paperclipai auth login` is an interactive login. If `PAPERCLIP_API_KEY` is unset, stop and say so. Never run `auth login`, never mint a token, never read one from a file.
2. **The two secrets** in Paperclip's store: `claude_subscription_token` and `github_focx_write_token`. Preflight P8 refuses without them. Reuse those exact names — renaming orphans the existing agents' configs.
3. **Figma MCP authorization**, if the design chain is to promote anything. This gates the design chain going live; it does not gate the buildout.

Never put a secret value in the repo, in an env file, in a commit, or in your own output. The roster references secrets **by name**; that is the only form a credential takes here.

## Phase 1 — repository work. No credential, no live mutation.

The original build used a dedicated organization-buildout branch. Do not restart that buildout. Current changes use the assigned task branch and human review.

Current offline checks (the retired render-only operation has no CLI equivalent):

```bash
node packages/focx-bot/src/index.mjs --validate-contract
node --test packages/focx-bot/test.mjs
node --test tools/qa-claude-agent-acp/*.test.mjs
node tools/drift-check/index.mjs
node tools/contracts/validate.mjs
```

The provisioning contract schema and package tests replace the retired offline roster/render checks. The package suite also validates the real `.focx` source and its refusal paths; launcher suites test the surviving permission delivery code. These checks make no live request.

End at a **draft PR**. Bots build, never merge.

## Phase 2 — superseded live sequence; current entrypoints

Agent workspaces need no setup. Repo-tier agents use a **git worktree per issue**, cut automatically from the Connect project's checkout, so there are no clones to create and nothing to keep in sync — `baseRef: origin/develop` makes Paperclip fetch before every worktree.

Do **not** reintroduce `cwd` for repo agents. The `claude_local` ACP lane ignores it and runs in Paperclip's own workspace directory, which has no repository in it.

```bash
node packages/focx-bot/src/index.mjs apply --base-url API_URL --company-id COMPANY_ID # plan only
node packages/focx-bot/src/index.mjs verify --base-url API_URL --company-id COMPANY_ID
```

These commands target the existing focx-bot contract company, not the historical roster company. Live reads require authorized credentials. An authorized write repeats the reviewed apply plan with `--apply --approved-digest DIGEST`. There is no termination-count override. Follow the package README for fresh/binding/snapshot/restore; a legacy-company migration needs Ryan's decision.

The historical Phase 2 changed live state after repository review. The current commands above are read-only until an explicitly authorized apply; the retired workflow's operational guarantees and exit-code table must not be applied to focx-bot.

## Historical exit codes (retired tool only)

| Code | Meaning | What to do |
|---|---|---|
| 0 | clean | continue |
| 1 | verification failed — live drifts from the roster | read the failing rows; fix the roster or re-apply |
| 2 | usage or roster error | nothing was changed; fix the input |
| 3 | preflight failed | nothing was changed; resolve the cause — often a human-only prerequisite |
| 4 | **partial apply** | the org is in mixed state. Re-running is safe because every step is idempotent, but do it deliberately, after reading what failed. Never loop. |

## Historical hard limits (not current operating instructions)

- Never create, modify, or terminate an agent outside the tool. No `curl` to the agents endpoint, no UI edits.
- Never terminate without an exact `--confirm-terminate` count, and never adjust the count to match.
- Never pass `--allow-builtin-termination` or `--terminate-running` to get past a refusal you have not understood. These retired overrides no longer exist.
- Never raise a budget, in the roster or through the API. Budget increases are Ryan's.
- Never set `canCreateAgents: true`, grant Figma write outside `designChain.figmaWrite`, or give `GH_TOKEN` to an agent whose `git` is not `write`. The Design Steward's missing token is a control, not an oversight.
- Never edit a live instruction bundle. Edit `pipeline/org/instructions/` and re-apply.
- Never modify `docs/pipeline.md`, `docs/roles/*`, `pipeline/contracts/*`, `tools/pipeline-parity/manifest.json`, `tools/contracts/validate.mjs`, or `.github/workflows/*`. All are parity-checked against `studio-810`, which is not on this machine, so a mirror edit cannot even be authored.
- Never merge, approve, force-push, or push to `main` or `develop`.
- Never install a dependency. Every tool in this repo is dependency-free on purpose.

## If something is wrong

A failing preflight has no override — there is no `--force`, and adding one is not the fix. Report the failure, name the cause, and stop. If the roster and the live company disagree in a way the tool cannot reconcile, that is a finding for Ryan, not something to resolve by editing live state until the check passes.
