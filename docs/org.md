# The operating company

The **source of truth for who executes the pipeline**: which agents exist, who they report to, what model they run, what they may write, what they cost, and what they are scheduled to do.

> **Supersedes** [`pipeline.md`](pipeline.md)'s "Phase 4 (planned) — Paperclip-native execution" section. That section still says the migration is "not started", and [`roles/chief.md`](roles/chief.md) carries the same sentence. Both are stale as of this document. They are left unedited deliberately: they are in the parity `identical` tier and changing them creates a byte-for-byte mirror obligation in `studio-810` that cannot be authored from this machine. Under the one-home rule, [`sources-of-truth.md`](sources-of-truth.md) and this file win. Correcting the two stale paragraphs is tracked as a separate paired-parity PR.

## Where it lives

| Concern | Home |
|---|---|
| Desired state — the org itself | [`pipeline/org/roster.json`](../pipeline/org/roster.json), with [`roster.schema.json`](../pipeline/org/roster.schema.json) |
| Agent instructions | [`pipeline/org/instructions/`](../pipeline/org/instructions/) — 25 per-agent files plus three shared fragments |
| Live state | The Paperclip company `Focx.ai` (`5f772ef2-25ce-466f-9392-027be5055470`) |
| Reconciliation | [`tools/paperclip-org/`](../tools/paperclip-org/index.mjs) |
| Secret **values** | Paperclip's secret store. Never this repo. |

The repo holds desired state; Paperclip holds live state; `tools/paperclip-org/index.mjs --verify-only` is what makes divergence a failing check instead of a discovery months later — the same argument [`tools/pipeline-parity/`](../tools/pipeline-parity/index.mjs) makes for the two-repo pipeline.

Instruction bundles are a **pure function of this repo**. Verification byte-diffs each live bundle against a fresh local render, so a hand-edit in the Paperclip UI surfaces as drift rather than quietly becoming the real org. Edit the source, never the live bundle.

## The organization

Ryan is Founder and Board and sits *above* the company; no agent represents him. 25 agents, every one with exactly one manager.

```
Ryan / Board
└── Focx CEO
    ├── Chief of Staff
    ├── Head of Product
    │   ├── Product Research
    │   ├── Product Designer
    │   ├── Design Steward
    │   ├── AI Experience
    │   └── Product Analytics
    ├── CTO
    │   ├── Web Engineer
    │   ├── Apple Engineer
    │   ├── Backend & AI Engineer
    │   ├── AI Evals Engineer
    │   ├── QA Engineer
    │   ├── Security Engineer
    │   └── Release Engineer
    ├── Head of Growth
    │   ├── Brand & Content
    │   ├── Community & Creators
    │   ├── Lifecycle & Referral
    │   └── Growth Engineer
    ├── Business Operations
    │   ├── Customer Success
    │   └── Finance
    └── Legal & Privacy
```

`tier: "manager"` means *may assign work*, not *has direct reports* — Chief of Staff is a manager with zero reports, because it owns dependency management and task ownership across every team.

## Pipeline stages, mapped

The org **absorbs** the pipeline. Artifact contracts, the drift gate, and the Render deploy target are unchanged.

| Stage | Agent | Artifact |
|---|---|---|
| Chief — opens and closes the run, routes between roles | **Chief of Staff** | `10-brief.json` |
| Product | Head of Product | `20-product-spec.json` |
| Research *(skippable, with a reason)* | Product Research | `30-research.json` |
| Design | **Product Designer**, gated by **Design Steward** | `40-design-spec.json` |
| Engineer | Web / Apple / Backend & AI, assigned by the CTO | `50-build-report.json` |
| QA | QA Engineer | `60-qa-verdict.json` + `evidence/` |
| Deploy | Release Engineer | `pipeline/releases/<deploy-id>.json` |

Chief maps to Chief of Staff, not the CTO: the Chief role opens runs and routes between roles, which is verbatim the Chief of Staff's mission. The CTO routes engineering work inside its own team.

[`roles/`](roles/) remains the home for the seven *pipeline stage* roles. This file plus `pipeline/org/instructions/` is the home for the 25 *org* roles. Neither duplicates the other.

## Two verified chains

Separation of duties is structural, not a slogan. In both chains, no agent occupies two adjacent columns:

| Chain | Proposes | Approves | Executes | Verifies |
|---|---|---|---|---|
| **Design** | Product Designer | Design Steward | Product Designer (Figma promotion + token sync) | Design Steward, then the drift gate |
| **Build** | Head of Product (what) | CTO (whether/when) | Web / Apple / Backend | QA Engineer, then the drift gate |

Product Designer appears in both Proposes and Executes. That is permitted — the rule bans one agent holding **all four**, and promotion here is executing a decision someone else made. What is never permitted is the approver also executing, which is why Design Steward holds Figma read only.

### What is actually enforced

Prose in a bundle is a request; a credential is a fact. [`pipeline/runs/run-20260902-022419-manual/evidence/independence-violation.txt`](../pipeline/runs/run-20260902-022419-manual/evidence/independence-violation.txt) records `focx-development[bot]` committing both a build and its own QA verdict on 2026-09-02 — the rule was written down, and it happened anyway.

So these are the parts that hold on their own:

- **Design Steward has no `GH_TOKEN` and only Figma read.** It cannot write the record it approves.
- **QA Engineer works from its own clone** at `focx-qa`, which no other agent shares.
- **`canCreateAgents: false`** on all 25 — the org cannot grow itself past its budget.
- **`canAssignTasks`** only for the six managers.
- **10 agents have no repository on the filesystem at all** — the strongest guarantee a non-technical agent cannot edit application code.
- **`CODEOWNERS` + branch protection** are the merge backstop.

Everything else is prose, and should be judged as prose.

## The design chain

Design is **routed, not linear**. `production` is the default; `discovery` is opt-in and is the only route that uses Claude Design — routine system work has nothing to explore, and sending it through a canvas would spend the org's most expensive pair on questions the design system already answers.

Head of Product declares the mode as a `DESIGN_MODE` token on the Paperclip issue; Design Steward answers with `DESIGN_APPROVAL … mode=`. Both live in Paperclip rather than in an artifact, because `brief.schema.json` and `design-spec.schema.json` are closed (`additionalProperties: false`) and parity-checked — adding a field to either would break the parity gate against `studio-810`.

| | `production` (default) | `discovery` |
|---|---|---|
| Claude Design | no | yes |
| May add components/variables | **no** | yes, if approved |
| Steward's checklist | conformance | system fit |

A candidate whose issue carries no `DESIGN_MODE` token is **not reviewable** — a gate that silently defaults is not a gate. The Designer may not upgrade its own mode; the Steward raises `escalate=mode-change` and Head of Product decides.

Figma stays canonical and `design/tokens/` stays its mirror, exactly as [`sources-of-truth.md`](sources-of-truth.md) already says. Product Designer is the only agent that writes either.

## Models, budget, and run policy

| Model | Count | Roles |
|---|---|---|
| `claude-opus-5` | 8 | CEO, Head of Product, Product Designer, Design Steward, AI Experience, CTO, Head of Growth, Legal & Privacy |
| `claude-sonnet-5` | 8 | Chief of Staff, Product Research, Brand & Content, Community & Creators, Lifecycle & Referral, Business Operations, Customer Success, Finance |
| `gpt-5.6-sol` | 9 | Product Analytics and the six engineers, plus QA and Release |

`gpt-5.6-sol`, never bare `gpt-5.6` — the bare slug is silently aliased but leaves the Codex CLI with generic context limits.

**Budget:** every agent 200 cents ($2.00); 25 × 200 = **$50.00** against a **$60.00** company ceiling. Agents cannot raise their own budgets, and the tool refuses to write one above the roster value. Agent policies **warn** at 80%; only the company policy hard-stops — `claude_local` and `codex_local` run against subscriptions rather than metered APIs, and all nine codex agents share one credential, so per-agent spend may be an estimate or unattributed. A hard stop on estimated cents would pause an agent that cost nothing real.

**Run policy:** heartbeat disabled everywhere, `wakeOnDemand: true`. Agents wake from assigned work, mentions, routines, and manual wake — never idle polling. Concurrency is 2 for the six managers and 1 for everyone else, so the ceiling is 31 concurrent CLI processes. Nothing caps that company-wide; the staggered routine schedule is the practical throttle.

## Routines

Ten, all `America/New_York`, staggered so no two weeklies land together.

| Routine | Owner | Cron |
|---|---|---|
| Morning Brief | Chief of Staff | `0 7 * * 1-5` |
| Daily Company Priorities | Focx CEO | `30 7 * * 1-5` |
| Blocked Work Review | Chief of Staff | `0 13 * * 1-5` |
| Nightly Research Scan | Product Research | `0 21 * * *` |
| Nightly Opportunity Review | Chief of Staff | `45 21 * * 0-4` |
| Weekly Product Review | Head of Product | `0 10 * * 2` |
| Weekly Growth Review | Head of Growth | `0 10 * * 3` |
| Weekly Finance Review | Finance | `0 10 * * 4` |
| Weekly Security & Privacy Review | Legal & Privacy | `0 10 * * 5` |
| Weekly Company Review | Focx CEO | `0 16 * * 5` |

The Nightly Opportunity Review is gated on external activity, so a quiet week does not manufacture work.

> **Note:** [`.github/workflows/nightly-research.yml`](../.github/workflows/nightly-research.yml)'s cron is currently parked. The Nightly Research Scan routine supersedes it. If anyone uncomments that workflow, research fires twice nightly.

## Ryan's approval, always

Production releases · major product-direction changes · pricing · contracts · external recurring spend · material paid marketing · public legal policies · public privacy or security claims · destructive data operations · sensitive production-data access · budget increases.

Rendered identically into all 25 bundles from `_preamble.md`.

## Operating it

```bash
node tools/paperclip-org/index.mjs                 # dry run (default) — mutates nothing
node tools/paperclip-org/index.mjs --render-only   # render 25 bundles offline, no credential
node tools/paperclip-org/index.mjs --verify-only   # the 12 success conditions, read-only
node tools/paperclip-org/index.mjs --apply --confirm-terminate=N
```

Applying needs a board token Ryan mints himself (`paperclipai auth login` → `paperclipai token board create`) and the two secrets present in Paperclip's store. The tool never fetches, prints, or persists a secret value — it reads names only.

## Two different skill systems

`desiredSkills` in the roster addresses **Paperclip's own skill registry** — keys shaped `vendor/pack/skill`, of which this company has five, all `paperclipai/paperclip/*`. None are relevant to these agents, so every agent's `desiredSkills` is empty.

The design chain's tooling — Claude Design and the design review skills — are **Claude Code plugin skills**. They reach a `claude_local` agent through the local Claude Code installation and are never registered in Paperclip. They are recorded per agent as `claudeCodeSkills`, which is documentation for humans and is **never sent to the API**.

Confusing the two fails preflight for a reason nobody would guess, so `validateRoster` rejects a `plugin:skill` name in `desiredSkills` and a `vendor/pack/skill` key in `claudeCodeSkills`. Discovery-mode design depends on Claude Design being present in the local install; if it is absent, that is a local installation blocker, not a Paperclip configuration one.

## Known gaps

- **`pipeline/org/` and `tools/paperclip-org/` are deliberately absent from [`tools/pipeline-parity/manifest.json`](../tools/pipeline-parity/manifest.json).** The manifest is itself parity `identical`, so listing them would create a `studio-810` mirror obligation that cannot be satisfied from this machine. Unlisted files are simply not compared, so parity still passes — the precedent is `pipeline/prompts/paperclip-development-agent.md`, already unlisted. A completeness pass is a future paired PR.
- **[`pipeline/prompts/qa-agent.md`](../pipeline/prompts/qa-agent.md) still says "the standalone Paperclip `QA` agent"** in three places, now that the roster names the agent `QA Engineer`. Left unedited on purpose: that file is parity `branded`, so changing it needs a matching edit in `studio-810`. The references are checked and **not load-bearing** — each is a "when you are running in this mode" condition addressed to the agent itself, not an instruction to look up an agent by name. The load-bearing references, in `paperclip-development-agent.md`, were updated, and `checkCharterCoupling` in the reconciler now fails the build if any charter ever again hands off to an agent the roster does not contain.
- **`--apply` has not been exercised against a live company.** Its offline half is covered by 57 tests against a stub API; the live path is first proven in Phase 2.
- **Figma MCP is unauthorized**, so the design chain cannot promote until Ryan authorizes it.
- **The `git: write` tier is provisional.** Security, AI Evals, and Product Analytics may turn out to report findings into Paperclip rather than commit anything; if so they should drop to `read` at the 30-day review.
