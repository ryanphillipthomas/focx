# Data retention — the local agent data store

Raised by [FOC-72](https://github.com/ryanphillipthomas/focx/issues/72)'s privacy review and implemented on FOC-73. This document is the standard; [`retention.config.json`](../retention.config.json) is the enforced copy of the numbers; [`tools/agent-retention/`](../tools/agent-retention/) is the mechanism that runs.

## What this covers

Every agent run leaves two on-host records, both unencrypted, both holding whatever the agent read or printed:

| Store | Path | What it holds |
|---|---|---|
| **Transcripts** | `~/.paperclip/instances/default/workspaces/<agentId>/.claude/projects/**` | The full session log: every prompt, every tool call, every tool result — including cloned third-party source and any secret value an agent ever printed |
| **Worktrees** | `<checkout>/.paperclip/worktrees/` | A full working copy of the repository per issue, plus whatever the run wrote into it |

Out of scope, deliberately: agent memory under `.claude/memory/`, the primary checkout, and Paperclip's own database. Memory is durable state an agent is meant to keep, not a byproduct of a run.

## The standard

| Store | Retention | Clock starts at |
|---|---|---|
| Transcripts | **30 days** | last write to the transcript file |
| Worktrees | **14 days** | last write anywhere in the tree |
| Deletion log | **400 days** | the deletion it records |

The deletion log outlives the data it describes on purpose: proving that a deletion happened is the whole point of having a retention clock, and a deletion record that expires with the data proves nothing. It records metadata only — path, size, age, reason, timestamp. Never content.

**Changing a number in `retention.config.json` changes what gets deleted on the next sweep.** Legal & Privacy owns the standard; a change to these values is their decision, not a config tidy-up. The numbers above are the CTO's implementation of the FOC-72 requirement and stand until Legal & Privacy ratifies or revises them.

## What expiry will not do

Retention deletes; it does not destroy work. A worktree is only reclaimed when losing it cannot lose anything:

- not locked, and not the tree the sweeper is running in
- no uncommitted or untracked changes
- `HEAD` already merged into `origin/develop` or `develop`
- quiet for longer than both the retention window and the 2-hour activity grace window

Anything failing one of those is held back with a stated reason and reported on every run. A worktree that sits there for months because its branch was never merged is a **finding to act on** — it means unmerged work is rotting on a laptop — not a reason to loosen the rule.

## Secret scrubbing

The scrubber redacts secret-shaped strings out of transcripts in place, replacing the value with `[redacted:<kind>]`. It preserves the file's mtime, so scrubbing never resets a file's retention clock, and it never writes the secret — or a truncated prefix of it — anywhere, including its own output and the deletion log.

It matches by shape (Anthropic, OpenAI, GitHub, AWS, Google, Slack, Stripe keys, JWTs, `Bearer` headers, PEM private-key blocks, and `*_TOKEN=`/`"apiSecret":` style assignments) **and** by exact value for any credential visible in the sweeper's own environment — which is what catches a token whose format we have no rule for, `PAPERCLIP_API_KEY` included.

### The honest limit

This is periodic scrubbing, not on-write scrubbing. A transcript is only rewritten once its session has been quiet for 15 minutes, because rewriting a file a live session still holds open can drop that session's later lines. So a secret printed at 10:00 is on disk unredacted until the scrub pass that follows the session going quiet.

Closing that window needs a write-time hook in the Claude Code settings that Paperclip generates for each agent — **the harness owns those settings, this repository does not**. Until that lands, the guarantee is "a printed token does not become a *permanent* on-disk record", not "a printed token never touches disk".

## Making it run

Documented expiry is not expiry. Two per-user launchd jobs do the work:

| Job | Schedule | Command |
|---|---|---|
| `ai.focx.agent-retention.scrub` | every 15 minutes | `scrub --apply` |
| `ai.focx.agent-retention.sweep` | daily, 03:15 | `sweep --apply` |

```sh
node tools/agent-retention/index.mjs install-schedule
```

Both jobs log to `~/.paperclip/retention/`. Uninstall with `uninstall-schedule`.

This is per-host and per-user, which is the right shape today — the store is on one Mac. When execution moves off this host, the scheduler moves with it and this table changes.

## Verifying it

By running it, not by reading it. See [`tools/agent-retention/verification.md`](../tools/agent-retention/verification.md).

## Why this exists before Connect holds anything

Connect will make deletion promises to users. A deletion path that cannot reach the transcript store is not a deletion path. Today the store holds repository and issue content; the mechanism is cheap to build now and expensive to retrofit once it holds what someone said about the people in their life.
