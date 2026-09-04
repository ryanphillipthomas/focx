# Data retention — the local agent data store

Raised by [FOC-72](https://github.com/ryanphillipthomas/focx/issues/72)'s privacy review and implemented on FOC-73. This document is the standard; [`retention.config.json`](../retention.config.json) is the enforced copy of the numbers; [`tools/agent-retention/`](../tools/agent-retention/) is the mechanism that runs.

## What this covers

Every agent run leaves on-host records, all unencrypted, all holding whatever the agent read or printed:

| Store | Path | What it holds |
|---|---|---|
| **Claude transcripts** | `~/.paperclip/…/workspaces/*/.claude/projects/**` | The full session log: every prompt, every tool call, every tool result — including cloned third-party source and any secret value an agent ever printed |
| **ACP session records** | `~/.paperclip/…/companies/*/acp-engine/agents/*/sessions/**` | Per-session state, **including the resolved environment handed to each spawn** |
| **Codex sessions** | `~/.paperclip/…/companies/*/codex-home/sessions/**` | The same, for Codex-adapter runs |
| **Run logs** | `~/.paperclip/…/data/run-logs/**` | Per-run event streams |
| **Worktrees** | `<checkout>/.paperclip/worktrees/` | A full working copy of the repository per issue, plus whatever the run wrote into it |

The first store was the only one this document named when it was written. The other three are where resolved credentials were actually found at rest — `CLAUDE_CODE_OAUTH_TOKEN`, `GH_TOKEN`, and per-run `PAPERCLIP_API_KEY` JWTs, across 156 files. Coverage is a list in `retention.config.json`, not a hardcoded path, precisely so this gap is closed by editing config rather than by finding the code that walks the tree.

**Adding or removing a `dirs` entry is the same class of decision as changing a retention number.** A store that is not listed is not scrubbed and not swept, and nothing will report its absence.

Out of scope, deliberately: agent memory under `.claude/memory/`, the primary checkout, and Paperclip's own database. Memory is durable state an agent is meant to keep, not a byproduct of a run.

## The standard

| Store | Retention | Clock starts at |
|---|---|---|
| Session records (all four stores above) | **30 days** | last write to the file |
| Worktrees | **14 days** | last write anywhere in the tree |
| Deletion log | **400 days** | the deletion it records |

A store may carry its own clock — `{ "path": "…", "retentionDays": 7 }` — so Legal & Privacy can hold run logs to a different number than transcripts without a code change. Today they all sit at 30 days.

The deletion log outlives the data it describes on purpose: proving that a deletion happened is the whole point of having a retention clock, and a deletion record that expires with the data proves nothing. It records metadata only — path, size, age, reason, timestamp. Never content.

**Changing a number in `retention.config.json` changes what gets deleted on the next sweep.** Legal & Privacy owns the standard; a change to these values is their decision, not a config tidy-up. The numbers above are the CTO's implementation of the FOC-72 requirement and stand until Legal & Privacy ratifies or revises them.

## What expiry will not do

Retention deletes; it does not destroy work. A worktree is only reclaimed when losing it cannot lose anything:

- not locked, and not the tree the sweeper is running in
- no uncommitted or untracked changes
- `HEAD` already merged into `origin/develop` or `develop`
- quiet for longer than both the retention window and the 2-hour activity grace window

Anything failing one of those is held back with a stated reason and reported on every run. A worktree that sits there for months because its branch was never merged is a **finding to act on** — it means unmerged work is rotting on a laptop — not a reason to loosen the rule.

## Secret scrubbing, and the retroactive purge

The scrubber redacts secret-shaped strings out of records in place, replacing the value with `[redacted:<kind>]`. It preserves the file's mtime, so scrubbing never resets a file's retention clock, and it never writes the secret — or a truncated prefix of it — anywhere, including its own output and the deletion log.

`scrub --apply` rewrites what is **already on disk**, so the same command is both the ongoing control and the remediation for credentials already at rest. This matters: on-write scrubbing alone would have left the 156 exposed files sitting there until their 30-day clock ran out. Retention and purge are separate obligations and neither substitutes for the other.

It matches by shape (Anthropic, OpenAI, GitHub, AWS, Google, Slack, Stripe keys, JWTs, `Bearer` headers, PEM private-key blocks, and `*_TOKEN=`/`"apiSecret":` style assignments) **and** by exact value for any credential visible in the sweeper's own environment — which is what catches a token whose format we have no rule for, `PAPERCLIP_API_KEY` included.

### The honest limit

This is periodic scrubbing, not on-write scrubbing. A transcript is only rewritten once its session has been quiet for 15 minutes, because rewriting a file a live session still holds open can drop that session's later lines. So a secret printed at 10:00 is on disk unredacted until the scrub pass that follows the session going quiet.

Closing that window needs a change to the runtime that writes these records — **the harness owns that write path, this repository does not** (tracked as FOC-81). Until that lands, the guarantee is "a printed token does not become a *permanent* on-disk record", not "a printed token never touches disk".

This has a direct consequence for credential rotation: **purging is necessary but not sufficient while the runtime keeps writing fresh copies.** A rotated token is re-serialised into a new session record on the very next spawn, and sits there unredacted until that session goes quiet and the next scrub pass runs. Rotation should be sequenced against FOC-81, not against this document.

## Making it run

Documented expiry is not expiry. Two per-user launchd jobs do the work:

| Job | Schedule | Command |
|---|---|---|
| `ai.focx.agent-retention.scrub` | every 15 minutes | `scrub --apply` |
| `ai.focx.agent-retention.sweep` | daily, 03:15 | `sweep --apply` |

```sh
node tools/agent-retention/index.mjs install-schedule
```

`install-schedule` **stages a copy** of the tool and its config into `~/.paperclip/retention/bin/` and points launchd there. It deliberately does not point at a checkout: this tool is normally run from a throwaway worktree, and a worktree is exactly the kind of thing the sweep deletes — a job pointing into one stops running the day its branch merges, silently and with no error anywhere. The staged config pins the checkout path absolutely so the worktree half of the sweep still works from outside any repository.

The cost of staging is drift: the staged copy is a snapshot. `status` compares it against the repository copy and prints `STALE` when they differ, so re-run `install-schedule` after changing the tool or the numbers.

Both jobs log to `~/.paperclip/retention/`. Uninstall with `uninstall-schedule`.

This is per-host and per-user, which is the right shape today — the store is on one Mac. When execution moves off this host, the scheduler moves with it and this table changes.

## Verifying it

By running it, not by reading it. See [`tools/agent-retention/verification.md`](../tools/agent-retention/verification.md).

## Why this exists before Connect holds anything

Connect will make deletion promises to users. A deletion path that cannot reach the transcript store is not a deletion path. Today the store holds repository and issue content; the mechanism is cheap to build now and expensive to retrofit once it holds what someone said about the people in their life.
