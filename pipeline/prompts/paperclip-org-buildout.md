# Paperclip org buildout charter

You are building the Focx.ai operating company inside Paperclip: 25 agents, 10 routines, budgets, and the instruction bundles behind them. You reconcile configuration; you do not run the company you create.

## Before anything

Read, in order: [`AGENTS.md`](../../AGENTS.md), [`docs/sources-of-truth.md`](../../docs/sources-of-truth.md), [`docs/org.md`](../../docs/org.md), [`pipeline/org/roster.json`](../org/roster.json), and [`pipeline/org/roster.schema.json`](../org/roster.schema.json). Those are authoritative. This charter adds only the operating sequence.

**The roster is the source of truth.** If the org needs to change, change `pipeline/org/roster.json` and re-run the tool. Never configure an agent by hand in the Paperclip UI — a hand-edit is drift that `--verify-only` will report, and the next apply will overwrite it.

## The human-only prerequisites — halt if they are missing

Three things only Ryan can do. **Do not attempt any of them, and do not work around a missing one.**

1. **A Paperclip board token.** `paperclipai auth login` is an interactive login. If `PAPERCLIP_API_KEY` is unset, stop and say so. Never run `auth login`, never mint a token, never read one from a file.
2. **The two secrets** in Paperclip's store: `claude_subscription_token` and `github_focx_write_token`. Preflight P8 refuses without them. Reuse those exact names — renaming orphans the existing agents' configs.
3. **Figma MCP authorization**, if the design chain is to promote anything. This gates the design chain going live; it does not gate the buildout.

Never put a secret value in the repo, in an env file, in a commit, or in your own output. The roster references secrets **by name**; that is the only form a credential takes here.

## Phase 1 — repository work. No credential, no live mutation.

```bash
git checkout develop && git pull
git checkout -b org/paperclip-25-agent-buildout
```

Everything in this phase is offline and reviewable. Run, and require green:

```bash
node --test tools/paperclip-org/test.mjs      # the offline half, plus a stub-API pass
node tools/paperclip-org/index.mjs --render-only
node tools/drift-check/index.mjs
node tools/contracts/validate.mjs
```

`--render-only` proves the roster and the 28 instruction files are self-consistent **before a credential exists**. If it fails, the roster is wrong; fix the roster, not the tool.

End at a **draft PR**. Bots build, never merge.

## Phase 2 — live operations. Only after Ryan merges and exports the token.

Agent workspaces need no setup. Repo-tier agents use a **git worktree per issue**, cut automatically from the Connect project's checkout, so there are no clones to create and nothing to keep in sync — `baseRef: origin/develop` makes Paperclip fetch before every worktree.

Do **not** reintroduce `cwd` for repo agents. The `claude_local` ACP lane ignores it and runs in Paperclip's own workspace directory, which has no repository in it.

```bash
node tools/paperclip-org/index.mjs                                  # dry run — READ THE PLAN
node tools/paperclip-org/index.mjs --apply --confirm-terminate=<N>  # N from the dry run
node tools/paperclip-org/index.mjs --verify-only
```

`<N>` is the exact number the dry run printed. Do not guess it, and do not pass a number to make the tool proceed — the count is the confirmation.

Phase 2 changes live state and touches no repository file. That split is the point: everything reviewable is in the PR, everything credentialed is an operation.

## Reading the exit code

| Code | Meaning | What to do |
|---|---|---|
| 0 | clean | continue |
| 1 | verification failed — live drifts from the roster | read the failing rows; fix the roster or re-apply |
| 2 | usage or roster error | nothing was changed; fix the input |
| 3 | preflight failed | nothing was changed; resolve the cause — often a human-only prerequisite |
| 4 | **partial apply** | the org is in mixed state. Re-running is safe because every step is idempotent, but do it deliberately, after reading what failed. Never loop. |

## Hard limits

- Never create, modify, or terminate an agent outside the tool. No `curl` to the agents endpoint, no UI edits.
- Never terminate without an exact `--confirm-terminate` count, and never adjust the count to match.
- Never pass `--allow-builtin-termination` or `--terminate-running` to get past a refusal you have not understood. Both exist for a human to use knowingly.
- Never raise a budget, in the roster or through the API. Budget increases are Ryan's.
- Never set `canCreateAgents: true`, grant Figma write outside `designChain.figmaWrite`, or give `GH_TOKEN` to an agent whose `git` is not `write`. The Design Steward's missing token is a control, not an oversight.
- Never edit a live instruction bundle. Edit `pipeline/org/instructions/` and re-apply.
- Never modify `docs/pipeline.md`, `docs/roles/*`, `pipeline/contracts/*`, `tools/pipeline-parity/manifest.json`, `tools/contracts/validate.mjs`, or `.github/workflows/*`. All are parity-checked against `studio-810`, which is not on this machine, so a mirror edit cannot even be authored.
- Never merge, approve, force-push, or push to `main` or `develop`.
- Never install a dependency. Every tool in this repo is dependency-free on purpose.

## If something is wrong

A failing preflight has no override — there is no `--force`, and adding one is not the fix. Report the failure, name the cause, and stop. If the roster and the live company disagree in a way the tool cannot reconcile, that is a finding for Ryan, not something to resolve by editing live state until the check passes.
