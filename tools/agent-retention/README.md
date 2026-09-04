# agent-retention

The retention clock and secret scrubber for the local agent data store. Dependency-free, no network, no telemetry. The standard it enforces is [`docs/data-retention.md`](../../docs/data-retention.md); the numbers come from [`retention.config.json`](../../retention.config.json) at the repository root.

## Commands

```sh
node tools/agent-retention/index.mjs status              # what exists, what the next sweep takes
node tools/agent-retention/index.mjs scrub               # dry run: what would be redacted
node tools/agent-retention/index.mjs scrub --apply       # redact in place
node tools/agent-retention/index.mjs sweep               # dry run: what would be deleted, and what is held back and why
node tools/agent-retention/index.mjs sweep --apply       # delete
node tools/agent-retention/index.mjs install-schedule    # make expiry actually run (launchd)
node tools/agent-retention/index.mjs uninstall-schedule
```

`--json` on `status`, `scrub`, and `sweep` gives the full plan as data. **Nothing is deleted or rewritten without `--apply`.**

## What it covers

The record directories listed in `retention.config.json`, plus `.paperclip/worktrees/`. Entries are glob patterns with whole-segment `*`, so one line covers every agent:

| Store | Pattern |
|---|---|
| Claude transcripts | `~/.paperclip/…/workspaces/*/.claude/projects` |
| ACP session records | `~/.paperclip/…/companies/*/acp-engine/agents/*/sessions` |
| Codex sessions | `~/.paperclip/…/companies/*/codex-home/sessions` |
| Run logs | `~/.paperclip/…/data/run-logs` |

An entry may be `{ "path": "…", "retentionDays": 7 }` to give one store its own clock. **A store that is not listed is not scrubbed and not swept, and nothing reports its absence** — `status` prints a line per store so a missing one is at least visible.

## What it will not touch

- Anything outside those directories — agent memory under `.claude/memory/` is explicitly not a session record
- A worktree that is locked, dirty, unmerged, recently active, in use by the running process, or the primary checkout
- A transcript whose session has written within the last 15 minutes (`scrubQuietMinutes`) — rewriting a file a live session holds open can lose that session's lines

Every held-back item prints its reason. `sweep` exits non-zero if a deletion it planned then failed.

## Design notes worth knowing before you change it

- **Scrubbing preserves mtime.** The retention clock is the file's mtime; a scrubber that touched it would keep transcripts alive forever.
- **Redaction is by kind, not by hash.** `[redacted:github-token]`, never a truncated prefix and never a digest — a digest of a token is a verification oracle for that token.
- **The deletion log records metadata only** and expires on its own 400-day clock, pruned on every append so it cannot outlive its clock just because nobody ran a prune.
- **Environment-derived patterns name the variable, never the value.** `envSecretPatterns` builds exact-match rules from the sweeper's own env so a credential with no recognisable format — `PAPERCLIP_API_KEY` — still gets caught.
- **Repo-relative worktree roots resolve against the primary checkout**, because the tool normally runs from inside one of the worktrees it is scanning.
- **`install-schedule` stages a copy** into `~/.paperclip/retention/bin/` rather than pointing launchd at a checkout. A scheduled job living in a worktree stops the day that worktree is reclaimed — by this very tool — with no error anywhere. The staged config pins the checkout path absolutely so the worktree sweep still works from outside any repository; `status` reports the staged copy as `STALE` when it drifts from the repository copy.
- **`scrub --apply` is the retroactive purge.** It rewrites what is already on disk, so remediation and the ongoing control are the same command. On-write scrubbing alone would leave already-exposed files sitting until their clock ran out.

## Scope this tool does not cover

True on-write scrubbing requires a change to the runtime that writes these records (FOC-81). That write path is harness-side and not in this repository, so the periodic scrubber is the repo-side half of the control. Consequence: a rotated credential is re-serialised on the next spawn, so **rotation must be sequenced against FOC-81, not against this tool**. See the honest-limit section of [`docs/data-retention.md`](../../docs/data-retention.md).

## Tests

```sh
pnpm test:agent-retention
```

36 tests. Expiry is proved by building a store, ageing it, sweeping, and checking what survived — see [`verification.md`](verification.md).
