# The ECC evaluation

A read-only evaluation of [`affaan-m/ECC`](https://github.com/affaan-m/ECC) (MIT), carried out
2026-09-06 to decide what, if anything, Focx should take from it. This is a **decision record**, not
an authority: it establishes nothing, and the two rules that survived it already live in the
documents that own their concerns ([the pipeline](pipeline.md), [the Chief](roles/chief.md),
[the pilot guide](pilot-operation.md)).

## Verdict

**Read-and-borrow only.** Install nothing through ECC's installer. One single-skill install on the
host (`config-gc`), which is a machine change and not a repository one. Reimplement three
local-server patterns by hand when the console is built. Two rules adopted into existing docs.
Everything else either duplicates something this repository already enforces more strictly, or
costs context already spent.

## What ECC is

An installer that adds **68 agents, 286 skills and 94 commands** to a coding assistant — Claude
Code, Codex, Cursor and a dozen more. It improves how an assistant works. It is **not** a control
plane: it does not hold tasks, schedule runs, or run an agent company, and it is not an alternative
to Paperclip or to this pipeline. Verified against the GitHub API rather than the page: 251,096
stars, 37,753 forks, MIT, `ecc-universal@2.2.1`, created 2026-01-18, last push 2026-09-05.

## How this was done

Nothing was installed. No ECC code was executed — where the installer's selection logic mattered,
its resolution was reimplemented against ECC's manifests rather than run. The repository was
shallow-cloned to a disposable scratchpad and read. All ECC content was read as **untrusted
instruction text**, per the same rule the preamble already applies to retrieved content.

## Prior art for the console

The genuine prior art is one directory: `scripts/lib/control-pane/` — 9 files, ~82 KB, small enough
to read entirely. Three patterns are worth reimplementing in our own code, with attribution:

1. **`scripts/lib/loopback-guard.js`** (57 lines). Every request is rejected before any work unless
   its `Host` header resolves to an allowlisted hostname (`421`), and any `Origin` present resolves
   to one (`403`). Its comment names the threat: DNS rebinding can point an attacker-controlled
   hostname at 127.0.0.1, so binding to loopback alone does not protect a local server from a page
   the operator has open in another tab. A companion rule from `dashboard-web.js`: a non-loopback
   host configuration **throws at startup** rather than binding.
2. **The action allowlist shape** (`scripts/lib/control-pane/actions.js`). The browser sends an
   action **id**, never a command; unknown ids throw; each definition builds its own argv array and
   is `spawn`ed without a shell, so nothing from the browser can be read as shell syntax. Inputs are
   clamped. An action may be marked non-executable so the console displays a command for the
   operator to copy but refuses to run it — for Focx that should be the **default**, promoted per
   action with a stated reason, because a console that can trigger a run is a console that can
   bypass the brief.
3. **One versioned snapshot endpoint.** A single `GET /api/snapshot` returning one versioned
   document, which builds a complete object with empty collections first and overlays live data only
   if the source opens — so an unreachable source yields a valid, renderable snapshot rather than an
   error page.

**What to do differently.** ECC's control pane reads two local SQLite databases, which is right for
a per-developer tool and wrong here: run state lives in `pipeline/runs/` and Paperclip, and a local
cache of it would be a second home for the concern. Copy the snapshot *shape*, never the substrate.
Do not copy its work-item mutation endpoints for the same reason.

Three claims in the originating brief did not survive reading the source, and are recorded because
they would have sent console work at the wrong files: `scripts/dashboard-web.js` is a catalogue
browser for ECC's own items, not an operator dashboard; `scripts/operator-readiness-dashboard.js` is
a CLI report on ECC's own repository hygiene with no HTTP server at all; and `sql.js` is production
code, not an unused dependency — the control pane reads real SQLite databases, though its *memory
vault* is markdown as described.

## Selective install

ECC's selective install is real and better than most, but has a trap. Components are an index, not a
unit of installation: `install-manifests.js:458` expands a requested component to its **modules**.
A separate mechanism fabricates a single-skill module for any skill lacking a curated component —
but it skips skills that already have one, so **the more prominently a skill is featured, the
coarser its install granularity**. Requesting `skill:tdd-workflow` installs 47 skills;
`skill:coding-standards` installs 69; an unfeatured skill installs 1. The smallest profile
(`minimal`) still installs all 68 agents, all 94 commands, 122 rule files and 47 skills, at user
scope.

**Measured cost of a full install:** ~33,500 tokens always-on (frontmatter for 286 skills, 68 agents,
94 commands), ~649,000 tokens of skill bodies on demand, 285,850 bytes of rules that are not
progressively disclosed, and 23 hook commands — four firing on every `Bash` call, seven after every
response, each a ~1 KB inline `node -e` that walks the filesystem before doing any work.

**One item cleared the bar: `config-gc`** — a single self-contained file with no `allowed-tools`
frontmatter, installed to the host and not to this repository. It is the only thing in ECC that
addresses a problem this project actually measured: an accumulated `~/.claude` of installed plugins,
MCP servers that fail to connect, orphaned hooks and stale permission entries. Its design is sound —
soft-delete first, per-item confirmation with no bulk approval, capped batches, an undo log. One
caveat: it proposes editing `permissions.allow` with `jq`, and [the QA launcher](../tools/qa-claude-agent-acp/index.mjs)
deliberately refuses unknown or stale allow rules; keep it away from that file.

Everything else was declined. The recurring reasons: it manages an ECC installation and only pays
off if ECC is installed; it is a domain pack unrelated to anything here; or it duplicates a concern
this repository already owns.

## Comparison against what already exists

**Where ECC is ahead.** Harness hygiene — the [context and evidence policy](../pipeline/org/instructions/_preamble.md#context-and-evidence-policy)
governs what an *agent* loads but says nothing about what accumulates on the host, and there was no
tool for that. Local-server security engineering, as above; `path-safety.js` cites the CVE that
taught them to canonicalize a not-yet-existing path and re-check the inode after opening. Multi-harness
portability, with 17 install-target adapters. And breadth, though almost none of it is adjacent to
this work.

**Where it is behind.** Its gates are advice where ours are enforced: `santa-method`'s verdict gate
is Python pseudocode inside a markdown file, while [`qa-verdict.schema.json`](../pipeline/contracts/qa-verdict.schema.json)
makes `verdict: "pass"` structurally invalid when the drift gate is red, validated in CI. It has no
separation of duties as an invariant. Its skill permission model runs the wrong way: skills declare
their own `allowed-tools`, pre-approving broad access on invocation — the exact pattern
[the pilot guide](pilot-operation.md) already refuses by denying QA's Skill tool and reading
methodology as data instead.

**What it duplicates.** `santa-method` against the build/QA split with fresh context, plus the two
independent reviews `focx-verify-change` already runs. `verification-loop` against the drift gate and
contract validation. `delivery-gate` against a QA charter that already treats anything unproven as a
fail. `council` against a rule that escalates to Ryan. `architecture-decision-records` against
[the baseline](../.focx/baseline.yaml), which additionally records what is explicitly *unknown*.
`unified-memory` against Paperclip and `pipeline/runs/`. And its memory server's stance that
retrieved content is data and never executable policy — already in the preamble, in stronger terms.

The honest summary: ECC and Focx sit at different layers. A general-purpose pack for a dozen
assistants cannot enforce anything — it has no CI, no contracts, no control plane and no human
approver — so it ships advice, because advice is all its position allows.

## What was adopted

- **Fresh context on a looped stage** — [the pipeline](pipeline.md) and [the Chief](roles/chief.md).
  The loop cap already existed; how the re-run starts did not. The GitHub Actions path satisfies this
  by construction today, so it is recorded as a rule before a Paperclip-native run keeps one session
  across a loop.
- **Budget a plugin before adding it** — [the pilot guide](pilot-operation.md). Roughly 500 tokens
  per MCP tool schema; skill frontmatter always-on and body on invocation; agent descriptions present
  in every Task invocation. The failing-server point is ours, measured here.

Nothing was vendored. Both additions are written in our own words against our own files, and no
guardrail was relaxed to accommodate either.
