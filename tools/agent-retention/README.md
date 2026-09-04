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

## What it will not touch

- Anything outside `<workspaces>/<agentId>/.claude/projects/**` and `.paperclip/worktrees/` — agent memory under `.claude/memory/` is explicitly not a transcript
- A worktree that is locked, dirty, unmerged, recently active, in use by the running process, or the primary checkout
- A transcript whose session has written within the last 15 minutes (`scrubQuietMinutes`) — rewriting a file a live session holds open can lose that session's lines

Every held-back item prints its reason. `sweep` exits non-zero if a deletion it planned then failed.

## Design notes worth knowing before you change it

- **Scrubbing preserves mtime.** The retention clock is the file's mtime; a scrubber that touched it would keep transcripts alive forever.
- **Redaction is by kind, not by hash.** `[redacted:github-token]`, never a truncated prefix and never a digest — a digest of a token is a verification oracle for that token.
- **The deletion log records metadata only** and expires on its own 400-day clock, pruned on every append so it cannot outlive its clock just because nobody ran a prune.
- **Environment-derived patterns name the variable, never the value.** `envSecretPatterns` builds exact-match rules from the sweeper's own env so a credential with no recognisable format — `PAPERCLIP_API_KEY` — still gets caught.
- **Repo-relative worktree roots resolve against the primary checkout**, because the tool normally runs from inside one of the worktrees it is scanning.

## Scope this tool does not cover

True on-write scrubbing requires a hook in the Claude Code settings Paperclip generates per agent. Those settings are harness-generated and are not in this repository, so the periodic scrubber is the repo-side half of the control. See the honest-limit section of [`docs/data-retention.md`](../../docs/data-retention.md).

## Tests

```sh
pnpm test:agent-retention
```

26 tests. Expiry is proved by building a store, ageing it, sweeping, and checking what survived — see [`verification.md`](verification.md).
