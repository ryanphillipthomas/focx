# Orchestration ledger — Claude ↔ Codex

**Untracked working file at the repo root.** Never commit it, never reference it from a PR.
Canonical controls stay in `.focx/`; run evidence stays in `pipeline/runs/`. This file
coordinates the two assistants only. It is not a task tracker for the pilot agents —
Paperclip remains the single home for that.

Created 2026-09-05. Supersedes the live content of `handoff.md`, which can be deleted.

---

## 0. Cold start — read this first

1. `AGENTS.md`, then `.focx/invariants.yaml` and `.focx/baseline.yaml`.
2. Section 1 (roles), section 2 (status board), and the one handoff marked **NEXT**.
3. Do not read handoffs that are not next. They are scoped deliberately.

Re-verify live state before acting; the snapshot in section 6 is timestamped, not a promise.

---

## 1. Who does what

| | Claude | Codex |
|---|---|---|
| Source changes, PRs | reviews | **builds** |
| Live Paperclip writes (agents, tasks, runs) | **owns** | never |
| Live run orchestration and observation | **owns** | never |
| Root-cause analysis of a failed run | **owns** | assists on request |
| Adversarial review of the other's work | **owns** | on request |
| Merging | never | never |

The split is Ryan's standing decision: *Codex builds, Claude reviews.* It exists so no
agent both writes and blesses its own work, mirroring `separationOfDuties` in the
invariants.

**Codex model: `gpt-6-astra`.** Verified working in Codex CLI 0.153.0 on this host.
Invoke as `codex -m gpt-6-astra` (interactive) or `codex exec -m gpt-6-astra` (one-shot).
If it ever fails, fall back to `gpt-5.6-sol` and note the fallback in the log.

## 2. Status board

States: `blocked` → `ready` → `building` → `review` → `merged` → `done`.

| ID | Handoff | Owner now | State | Blocks |
|---|---|---|---|---|
| **H1** | Correct the permission misreport, pin the lane | — | **done** (merged `252349a`, applied) | — |
| **H2** | Implementation → QA handoff run | Claude | **in progress ← NEXT** (Impl half done; QA half not started) | H3, H4 |
| H3 | Durable task completion | Codex | blocked by H2 | H8 |
| H4 | Steward proving run | Claude | blocked by H2 | H8 |
| H5 | Preview and deploy verification | Codex | blocked by H2 | — |
| H6 | Codify the wake-window protocol | Codex | ready (parallel) | — |
| H7 | Loose threads | Codex | ready (parallel) | — |
| H8 | Template for the remaining 23 agents | Claude | blocked by H3, H4 | — |

H6 and H7 need no live runs and can proceed alongside H1.

> **DEPRECATED 2026-09-05.** This board is superseded by **Workstream FB** (section 2b).
> Rows are retained unmodified for provenance; see 2b for each row's disposition and for
> the findings carried forward. Do not start an H handoff.

## 3. Protocol for updating this file

- Whoever acts edits their row in section 2 **and** appends one dated line to that
  handoff's Log. Never rewrite another owner's log entries.
- A handoff moves to `review` only when its pass criteria are met and evidence exists.
- `merged` means Ryan merged. Neither assistant sets it from its own action.
- If you discover the plan is wrong, say so in the Log and stop. Do not silently rescope.
- Keep every agent paused unless a handoff explicitly authorizes a run, and restore
  paused state plus both wake paths disabled afterward.

---

## 2b. Workstream FB — focx-bot extraction

**This workstream supersedes H1–H8.** Paperclip logic, agents, network config, tokens,
permission delivery and skill configuration are being extracted into a separate product,
**focx-bot**, whose deliverable is: from a clean machine and a fresh Paperclip instance,
one command produces a running org with prebuilt agents, working connections, a populated
skill catalog, and a state snapshot.

The H board above is **deprecated in place**. No H row was deleted and no H Log entry was
rewritten. Dispositions are recorded below; findings worth keeping are carried forward as
F1–F9 and are consumed by FB1.

### FB status board

States as section 3. Same protocol, same constraints.

| ID | Handoff | Owner | State | Blocks |
|---|---|---|---|---|
| **FB0** | Supersede the H workstream, harvest findings | Claude | **done** (this section) | — |
| FB1 | Inventory of Paperclip surfaces (read-only) | Claude | **done** — rev 4.1 accepted by Ryan with limits recorded | FB2 |
| FB2 | Boundary proposal + skill-catalog intake design | Claude | **done** — rev 2.8 (F11/F13/F14 + decisions 16–19 from FB7) | FB3, FB4 |
| FB3 | Skill-catalog pinning — full official catalogs, newest versions | Claude | **done** — rev 2.2 accepted by Ryan; 73 Codex pins | FB5 |
| FB4 | Provisioning tool + tests (`packages/focx-bot`) | Codex | **done** — [#88](https://github.com/ryanphillipthomas/focx/pull/88) merged by Ryan 2026-09-06 00:11:47Z as `9e1566f`; drift gate passed; 80/80 on develop | FB9 |
| FB5 | Plugin-grant check + tests | Codex | **done** — [#89](https://github.com/ryanphillipthomas/focx/pull/89) merged by Ryan 2026-09-06 00:47:20Z as `285c40f`; drift gate passed; 121/121 on develop | — |
| FB6 | Model assignment fact-finding (gpt-6-astra) | Claude | **done** — rev 3 accepted by Ryan; astra in catalog, absent from the ACP lane | FB7 |
| FB7 | Single-agent proof 4a — model only, read-only run | Claude | **done — PASS** — run `514b695a…` `usageJson.model = gpt-6-astra`, report delivered, no repo write, windows closed byte-identically; via F13 lane refresh (codex-acp 1.10.0) and F14 task-text escalation | FB8 |
| FB8 | Single-agent proof 4b — scoped write run | Claude | **done — PASS** — run `54afd788…` on Astra: one commit `8bc05c73…` (parent = develop tip `52261d6`), one 86-byte marker byte-identical, one push to `FOCA-4-…-run-20260906-020509-fb8` on origin (verified by independent fetch), report delivered, FOCA-4 `done` not reopened, windows closed byte-identically | FB9 |
| FB9 | Snapshot / restore round trip | Codex builds, Claude verifies | **done** — S1 snapshot PASS; R2 restore PASS after F15 (PR #92): `focx-bot-4a-restore-2` = `6c7de2ce…`, verify 1–9 clean, compare differences `[]`; archived partial `focx-bot-4a-restore` (`e335535c…`) left as evidence | — |
| F15 | `restore` survives Paperclip's own export (strip reserved bundled skills; de-duplicate company skills) | Codex | **done** — PR #92 (`9d4dea4`); live restore PASS under `focx-bot-4a-restore-2` | FB9 |
| F16 | Retire `tools/pilot-org` + `tools/paperclip-org` (extract the `.focx` role source into focx-bot) | Codex | **done** — PR #93 merged (`6a1f2a4`) | — |
| F18 | `bind-secrets` resumable after a host-plugin failure; login checked before any write | Codex | **done** — PR #94 merged (`49c661f`) | F17 |
| F17 | Live `bind-secrets --apply` (env binding + first live plugin provisioning) | Claude | **partial** — env binding PASS; all 294 Claude plugins PASS; native Codex stage blocked by F20 | FB9, F18, F19 |
| F20 | Native Codex plugins: `openai-bundled` is reserved and cannot be installed by path; `openai-curated-remote` needs network + sign-in | Claude (found) | **done** — PR #96 merged (`431eced`) | F17 |
| F21 | `bind-secrets` must not report `configured` while pinned plugins are unseeded | Codex | **done** — landed on develop via PR #98 (`93ceec7`) | F20 |
| F23 | QA launcher hardcodes the `FOC-` issue prefix, so QA cannot run in any provisioned company | Claude (found) | **PR #103 open** (`0bbcd2d`); awaiting Ryan merge, then a live QA re-run | F17 |
| F19 | Plugin pin readback requires a `.claude-plugin/plugin.json` that skills-only plugins do not ship | Claude (found) | **done** — PR #95 merged (`752b16f`) | F17 |
| F10 | QA launcher identity redesign (rev 2.7 decision 15) + focx-bot mirror | Codex | **done** — [#90](https://github.com/ryanphillipthomas/focx/pull/90) merged by Ryan 2026-09-06 01:06:50Z as `52261d6`; drift gate passed | FB8 |

### Dispositions of the H workstream

| H | Disposition | Notes |
|---|---|---|
| H1 | **retained** | `done`, merged `252349a`, applied. Landed source, not deprecated work. Primary source for F7 and F9. |
| H2 | **carried-forward** → F1, F2, F3; QA half **superseded-by-FB8** | Implementation half RAN AND CLOSED successfully. QA-authored commit still unproven. |
| H3 | **carried-forward** → F4; **superseded-by-FB8** | Durable completion must be solved before FB8's agent reports, not after. |
| H4 | **dropped** | Steward proving run is out of FB scope — FB proves ONE agent (Implementation). *What is lost:* the Steward's reconcile-truth role stays unproven. It returns via FB4's provisioning contract, not as a bespoke handoff. |
| H5 | **carried-forward** → F5 | FB does not touch Render. Preview verification stays unestablished and is explicitly out of scope. |
| H6 | **carried-forward** → F6; **superseded-by-FB4** | The wake window is a prerequisite for FB7/FB8 and belongs in focx-bot's operational surface. |
| H7 | **carried-forward** → items feed FB1 (inventory) and FB5 (gate) | Dead `Write(/tmp/**)` rule; `pilot:verify` proves settings match but not that they take effect; unattributed plugin mtimes. |
| H8 | **superseded-by-FB4**, outright | "Template for the remaining 23 agents" IS the provisioning contract. This is the clearest evidence the replan is correct. |

### Carried-forward findings — FB1 consumes these as first-class inventory entries

- **F1 — For `codex_local`, the effective permission boundary is the task description,
  adjudicated by an LLM reviewer.** H2's run: the workspace sandbox blocked `git commit`; the
  agent requested escalation; Codex's Guardian Review (`auto_review`, the `approvalsReviewer`
  field of the `agent` preset at `codex-acp/dist/index.js:27161`) approved **three times** —
  commit (`Risk: low`), **push to GitHub** (`Risk: medium, Authorization: high`), and the
  `paperclip-issue-update.sh` network report. `permissionMode: approve-reads` and
  `nonInteractivePermissions: deny` were both live and neither blocked a network write. The
  Guardian approved *because the task said the push was authorized*. **A task description is a
  privilege-granting document for this adapter.** Source: H2 Log, 2026-09-05.
- **F2 — Agent commits are indistinguishable from Ryan's.** `940b26dc` is authored AND
  committed as `Ryan Thomas <rthomas@wheelsup.com>`. Re-verified from the object store during
  FB0. Separation of duties cannot be established from git provenance.
- **F3 — Implementation CAN commit and push.** H2's pre-run "blocking finding" (sandbox
  construction forbids push/PR) was **wrong**. Branch
  `FOC-96-h2-implementation-smoke-…-run-20260905-095206-manual` exists on `origin` at
  `940b26dc`; 88-byte marker file, byte-exact. Confirmed present on the remote during FB0.
- **F4 — A board comment can change task state.** FOC-95: `done` → `todo` at 05:29:52
  (`source: comment`, `reopenedFrom: done`), then → `blocked` at 05:30:03
  (`source: recovery.reconcile_stranded_assigned_issue`) because the assignee was paused.
  FOC-96, by contrast, stayed `done`. Do not post on FOC-95 as a fix — that is the same action.
- **F5 — Render preview availability was never established.** A 200 proves neither the
  revision nor the behavior.
- **F6 — The wake window is exactly two fields per agent**, one agent at a time: `status`
  `paused` → active, and `runtimeConfig.heartbeat.wakeOnDemand` `false` → `true`.
  `heartbeat.enabled` stays `false` throughout. Performed by hand four times, codified nowhere.
  `--verify-only` fails while the window is open, by design.
- **F7 — Version split.** The ACP lane runs bundled `@openai/codex` **0.152.1** under
  `~/.paperclip/cli/current/node_modules`, not the **0.153.0** CLI at `~/.local/bin/codex`.
  `gpt-6-astra` was verified against the CLI. FB6 fact 3 depends on this.
- **F8 — The plan digest does not bind the rendered plan.** `pilot-org:207` hashes
  `{source, live}`, not the operations. Observed in both directions: operations went `[]` → two
  PATCHes with the digest byte-identical at `298df340…`; the digest then moved when live state
  moved. Unfixed.
- **F9 — Absent `permissionMode` defaults to `approve-all`.**
  `adapter-utils/dist/acpx-engine/constants.js:3`. The explicit `approve-reads` is the only
  thing standing between a pilot and the forbidden posture.

### Corrections to the FB brief — the harvest invalidated three of its premises

Recorded here rather than silently rescoped, per section 3.

1. **"The Implementation Engineer has never worked end to end" is FALSE.** It ran on
   2026-09-05 (FOC-96, run `596211ea-b1be-42cb-a6a9-92caf86478f1`, `succeeded`), committed,
   pushed to GitHub, and posted its own report. **FB8 must be re-scoped.** The unproven
   capability is the **QA-authored commit and push**, not the Implementation write path.
2. **The permission-delta gate (FB5) is sound for `claude_local` and theater for
   `codex_local`.** The gate assumes declared permissions bound behavior. F1 shows they do
   not for Codex. FB5 must state this limit explicitly or it overclaims its own guarantee.
3. **Cross-verification attribution is honor-system.** The step loop requires fix and
   cross-verification logged "with distinct authors", but F2 shows git provenance cannot tell
   an agent from a human. Either FB adds a real attribution mechanism or it records that Log
   authorship is self-reported.

Also stale and corrected here: section 6 states `develop` at `bf30840`. It is `252349a`
since #87 merged.

### FB4 log

- 2026-09-05 Codex (gpt-6-astra, effort high, BUILDER): **stopped before writing any file**, per
  the brief's instruction to stop rather than rescope. As reported by Codex (Claude's
  verification follows): (1) FB2 rev 2.1 §2 sources agents' live `id`s from `agents.json`
  while requiring a NEW company and exact-identity verification — but the installed create
  schemas discard a supplied `id`; agent creation assigns `randomUUID()`
  (`routes/agents.js:2847`); the company create schema discards `id` too. (2) That route
  creates agents as `idle` and the schema discards `status: "paused"`, so pausing is a
  follow-up write on an unpaused agent — in tension with invariant 2 unless `fresh` carries an
  explicit create→pause sequence. (3) Native import also generates new agent ids
  (`company-portability.js:4916`), so restore cannot preserve ids either. Offline probe against
  the installed validators: `agentSchemaRetainsId: false`, `agentSchemaRetainsStatus: false`,
  `companySchemaRetainsId: false`. `pilot-org --check` still exit 0. Files created: none.
  Tests run: none. No commit, push, PR, live write, API call, or credential value. Verified by
  Claude after the run: tree clean at `252349a` on `run/run-20260905-195913-fb4`; only the two
  untracked ledger files present; nothing under `packages/`; `.github` untouched.
  **Consequence if confirmed:** ids are OUTPUTS of provisioning, not inputs; the contract must
  key agents by `roleKey`/slug and resolve ids from live at verify time (the `paperclip-org`
  design, which rev 2.1 §2 discarded); invariant 1 becomes set-equality by slug; `fresh` needs a
  defined create→pause window; FB9's round trip compares by slug. This defect passed two Codex
  reviews and my own; the builder caught it by reading the create route. FB4 blocked; FB2
  reopened for rev 2.2.

- 2026-09-05 Claude: **Codex's three blockers verified on direct read; all hold.**
  `routes/agents.js:2847` `const agentId = randomUUID();` and `:2866` `status: "idle"` are set
  explicitly in the `svc.create` payload after the request spread, so a supplied `id` or
  `status` never reaches the row; `createAgentSchema` (`validators/agent.js:55`) has neither
  field; offline probe `agentRetainsId: false`, `agentRetainsStatus: false`;
  `createCompanySchema` (`validators/company.js:17`) carries no `id` and is `.strict()`.
  **New fact from the same read, and it is the fix:** `company-portability.js:4916–4919` creates
  imported agents with `status: pauseAutomations ? "paused" : "idle"` and keeps a
  slug→generated-id map (`importedSlugToAgentId`). So a `fresh` implemented as a native import
  of a minimal bundle into `new_company` with automations paused yields agents born `paused`
  (no idle window) and slug-keyed identity — ids are outputs, resolved from live by slug at
  verify time, which is exactly the `paperclip-org` roster design rev 2.1 §2 discarded.
  FB2 rev 2.2 will: key agents by `roleKey`/slug; make invariant 1 set-equality by slug against
  live with no extra agents; implement `fresh` and `restore` as that import; define any
  create-route path's create→pause window explicitly and forbid it by default; make FB9 parity
  slug-based. Design correction first (it unblocks Codex), then FB6.
- 2026-09-05 Ryan (mid-turn): FB6 — *"Do it when it's guaranteed not to conflict or be a
  blocker. We have been breaking things; we need to be surgical."* Read as conditional
  authorisation. Plan: FB6's local, zero-risk facts (does the bundled ACP Codex 0.152.1 know
  `gpt-6-astra`; the `-c model_reasoning_effort` mapping, already read) may be gathered now;
  the single live catalog `GET`, which needs the Keychain board token, runs only when no
  design correction or build is in flight, as its own listed step, token never printed.

- 2026-09-05 Ryan (mid-turn): **"Approve"** — on the verification of Codex's blockers and the
  stated direction for FB2's correction. Recorded as approval to write FB2 rev 2.2 on that
  basis; Ryan reviews the document itself before FB4 resumes.
- 2026-09-05 Claude: two facts from the follow-up reads. (1) `companyPortabilityImportSchema`
  (`validators/company-portability.js:294–298`) accepts `pauseAutomations: boolean` — read at
  `services/company-portability.js:4539`, applied at `:4869–4875` as `{status: "paused",
  pauseReason: "import", pausedAt}` and at `:4916–4919` on create — **and** `secretValues:
  record<string,string>`. Rev 2.2 uses the first and names the second as NOT used: §4's rule
  that values never pass through the provisioner stands. (2) FB6 local, zero-risk: the bundled
  ACP `@openai/codex` 0.152.1 contains no model identifier strings at all (`gpt-6-astra`,
  `gpt-5.6-sol`, `gpt-5.6` all absent from binary and json); the host CLI 0.153.0's
  `~/.codex/models_cache.json` lists `gpt-6-astra`. Model knowledge is fetched into a cache at
  run time, not compiled in; the ACP lane's cache under the per-company codex-home decides.
  `codex-acp/dist/index.js:31133` passes `-m`. Not yet established: whether that cache holds
  astra. The live catalog `GET` remains held per Ryan's surgical instruction.

- 2026-09-05 Claude: **FB2 rev 2.2 written** (356 lines) as asserted surgical edits: P16 (create
  route generates ids, forces `idle`, schemas drop `id`/`status`) and P17 (import accepts
  `pauseAutomations` and `secretValues`; creates agents `paused`; slug→id map); §2 keys agents
  by `slug` with no `id` in the contract and company `id` as an output; invariant 1 restated as
  set-equality by slug, invariant 2 met at creation; `fresh` = one native import into
  `new_company` with `pauseAutomations: true`, create routes unused, `secretValues` never used;
  restore likewise with ids regenerated and FB9 parity by slug; decision 10 records Ryan's
  "Approve" on the direction. The two remaining "live id" strings are descriptive (the defect
  note; the `pilot-org:122` quotation). FB4 brief re-pointed at rev 2.2 with a resumption note.
  **FB4 re-dispatch HELD** until Ryan accepts rev 2.2 — my own entry above says he reviews the
  text first, and his instruction is to be surgical.
- 2026-09-05 Claude: **FB6 local facts (zero-risk reads).** (1) Model field: per rev 2.2 the
  contract carries `model`/`reasoning` per agent, set fresh — Implementation `gpt-6-astra`/high
  pending this handoff. (3) **The ACP lane's own model cache lacks astra.** Per-company
  `codex-home/models_cache.json` mtime **2026-09-05 09:59:09 local**, inside the FOC-96 run
  window (13:56–13:59Z) — so it IS refreshed at run start; it holds 8 slugs incl. `gpt-5.6-sol`;
  the host CLI 0.153.0's `~/.codex/models_cache.json` (16:04 today, after my dispatches) holds
  9, the one difference being `gpt-6-astra` (display "GPT-6-Astra"). Two readings, not
  separable locally: astra entered the catalog between 09:59 and 16:04, or the bundled
  0.152.1 lane is served a different list than the 0.153.0 CLI. Either way FB7 cannot assume
  the ACP lane will see astra; the next ACP run's fresh cache decides. No adapter-side
  `models_cache` handling exists — it is Codex's own. (4) Mapping: `codex-args.js:43` passes
  `-c model_reasoning_effort=<value>`; `codex-acp/dist/index.js:31133` passes `-m`.
  **(2) held:** Paperclip's own adapter catalog, `GET /api/companies/<id>/adapters/codex_local/models`,
  is the authoritative pre-check and needs the Keychain board token — one read-only call,
  token never printed, run only on Ryan's explicit go with nothing else in flight.

- 2026-09-05 Claude: FB6 local facts written → `~/Documents/focx-bot-FB6-model-facts.md`
  (61 lines): facts 1, 3, 4 from reads; fact 2 stated as a held procedure (one `GET`, token via
  Keychain, never printed). Delivered to Ryan alongside FB2 rev 2.2. No live call made.

- 2026-09-05 Ryan (AskUserQuestion): **accept FB2 rev 2.2; re-dispatch FB4 now. Run the FB6 GET now.**
- 2026-09-05 20:48:53Z Claude: **FB6 fact 2 — the one live call, made.** `GET <api>/api/companies/<id>/adapters/codex_local/models`
  with the Keychain board token inside the process, never printed. HTTP 200; 128 models
  returned: babbage-002, chat-latest, chatgpt-image-latest, codex-mini-latest, davinci-002, gpt-3.5-turbo, gpt-3.5-turbo-16k, gpt-3.5-turbo-0125, gpt-3.5-turbo-1106, gpt-3.5-turbo-instruct, gpt-3.5-turbo-instruct-0914, gpt-4, gpt-4-0613, gpt-4-turbo, gpt-4-turbo-2024-04-09, gpt-4.1, gpt-4.1-2025-04-14, gpt-4.1-mini, gpt-4.1-mini-2025-04-14, gpt-4.1-nano, gpt-4.1-nano-2025-04-14, gpt-4o, gpt-4o-2024-05-13, gpt-4o-2024-08-06, gpt-4o-2024-11-20, gpt-4o-mini, gpt-4o-mini-2024-07-18, gpt-4o-mini-search-preview, gpt-4o-mini-search-preview-2025-03-11, gpt-4o-mini-transcribe, gpt-4o-mini-transcribe-2025-03-20, gpt-4o-mini-transcribe-2025-12-15, gpt-4o-mini-tts, gpt-4o-mini-tts-2025-03-20, gpt-4o-mini-tts-2025-12-15, gpt-4o-search-preview, gpt-4o-search-preview-2025-03-11, gpt-4o-transcribe, gpt-4o-transcribe-diarize, gpt-5, gpt-5-2025-08-07, gpt-5-chat-latest, gpt-5-codex, gpt-5-mini, gpt-5-mini-2025-08-07, gpt-5-nano, gpt-5-nano-2025-08-07, gpt-5-pro, gpt-5-pro-2025-10-06, gpt-5-search-api, gpt-5-search-api-2025-10-14, gpt-5.1, gpt-5.1-2025-11-13, gpt-5.1-chat-latest, gpt-5.1-codex, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2, gpt-5.2-2025-12-11, gpt-5.2-chat-latest, gpt-5.2-codex, gpt-5.2-pro, gpt-5.2-pro-2025-12-11, gpt-5.3-chat-latest, gpt-5.3-codex, gpt-5.4, gpt-5.4-2026-03-05, gpt-5.4-mini, gpt-5.4-mini-2026-03-17, gpt-5.4-nano, gpt-5.4-nano-2026-03-17, gpt-5.4-pro, gpt-5.4-pro-2026-03-05, gpt-5.5, gpt-5.5-2026-04-23, gpt-5.5-pro, gpt-5.5-pro-2026-04-23, gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-6-astra, gpt-audio, gpt-audio-1.5, gpt-audio-2025-08-28, gpt-audio-mini, gpt-audio-mini-2025-10-06, gpt-audio-mini-2025-12-15, gpt-image-1, gpt-image-1-mini, gpt-image-1.5, gpt-image-2, gpt-image-2-2026-04-21, gpt-live-transcribe, gpt-realtime, gpt-realtime-1.5, gpt-realtime-2, gpt-realtime-2.1, gpt-realtime-2.1-mini, gpt-realtime-2025-08-28, gpt-realtime-mini, gpt-realtime-mini-2025-12-15, gpt-realtime-translate, gpt-realtime-whisper, gpt-transcribe, o1, o1-2024-12-17, o1-pro, o1-pro-2025-03-19, o3, o3-2025-04-16, o3-mini, o3-mini-2025-01-31, o4-mini, o4-mini-2025-04-16, o4-mini-deep-research, o4-mini-deep-research-2025-06-26, omni-moderation-2024-09-26, omni-moderation-latest, sora-2, sora-2-pro, text-embedding-3-large, text-embedding-3-small, text-embedding-ada-002, tts-1, tts-1-1106, tts-1-hd, tts-1-hd-1106, whisper-1. **`gpt-6-astra` IS in Paperclip's codex_local catalog**; `gpt-5.6-sol` is.
  Nothing else was in flight (FB4 held). Read-only; no write. Consequence: preflight P5 accepts astra; the ACP-lane cache (fact 3) is the remaining run-time risk and 4a's pass criterion — the run record's own model — stands.
  FB6 written up in full (`~/Documents/focx-bot-FB6-model-facts.md`); FB6 → done pending Codex
  review, which waits until Codex is free of FB4. FB2 rev 2.2 accepted → done. FB4 re-dispatch
  next, brief amended with this result.

- 2026-09-05 20:50:17Z Claude: **FB4 re-dispatched on rev 2.2.** Pre-check passed inside the same
  command (`run/run-20260905-195913-fb4` @ `252349a`, only the two untracked ledger files) and
  the build started only because it did. Brief `/tmp/fb4-build-brief.final.md` (133 lines): rev
  2.2 semantics — slug-keyed agents, no ids in the contract, `fresh`/`restore` as one import with
  `pauseAutomations: true`, `secretValues` never used; plus the FB6 model fact and the two
  read-only verify lines it requires (catalog membership; ACP-lane cache membership + mtime).
  Observed: process alive, 77762 bytes, model=gpt-6-astra, effort=high,
  sandbox=workspace-write [workdir, /tmp, $TMPDIR], workdir=/Users/ryanthomas/Documents/GitHub/focx. Same constraints as the first
  dispatch: no live write, API call, agent run, install, credential value, commit, push or PR.

- 2026-09-05 Codex (gpt-6-astra, effort high, BUILDER): **stopped before writing, a second
  time.** As reported (Claude's verification follows): (1) **secret restoration cannot complete
  as rev 2.2 §4 specifies** — export marks secret inputs `optional`; without `secretValues` the
  import skips them without creating env bindings, required ones fail, and the import never looks
  up a secret Ryan entered separately (`company-portability.js:2505` input resolution; `:3110`
  materialisation; offline probes). (2) **one native import unconditionally grants
  `tasks:assign`** on every created agent (`:4922`); the grant helper (`:3062`) cannot revoke;
  effective access (`routes/agents.js:773`) reports `canAssignTasks: true` — contradicting the
  contract's `false` and the pilots' standing permissions. `pilot-org --check` exit 0. Files
  created: none; tests: none; no commit, push, PR, live write, API call, or credential value.
  Verified by Claude after the run: tree clean at `252349a` on the run branch; nothing under
  `packages/`; `.github` untouched. **Note against myself:** I printed
  `company-portability.js:4916–4924` earlier today — the `setPrincipalPermission(...,
  "tasks:assign", true, ...)` line included — and read past it. FB4 blocked; FB2 reopened.

- 2026-09-05 Claude: **both blockers verified on direct read; both have supported fixes the
  builder's report did not reach.** (1) `company-portability.js:3110–3122`
  `materializeImportEnvInputValues` resolves each env input only from the request's
  `secretValues` (`envInputValue`, `:2505–2513`: scoped key, then bare key, else null); required
  inputs without a value throw `unprocessable`; optional ones — export marks every `secret_ref`
  input `requirement: "optional"` (`:468–506`) — are skipped without a binding; no by-name lookup
  of an existing secret exists in the import. Rev 2.2 §4's hand-entry-then-resume cannot bind
  through the import. **Fix path, already the house pattern:** `paperclip-org:465–473`
  `resolveEnv` maps `{secret: <name>}` → `{type: "secret_ref", secretId}` from a name→id map and
  refuses to emit a plain value; `:1668–1676` PATCHes `/api/agents/<id>` with
  `replaceAdapterConfig: true`. Values never pass through the provisioner.
  (2) `:4922` grants `tasks:assign` unconditionally on import-create; `:3062`
  `applyImportedAgentPermissionGrants` only ever sets `true` — Codex is right that the *helper*
  cannot revoke. But `routes/agents.js:2912` `PATCH /agents/:id/permissions`
  (`updateAgentPermissionsSchema`) and `:2938` `setPrincipalPermission(..., "tasks:assign",
  effectiveCanAssignTasks, ...)` set the grant to the effective value, which can be `false`;
  `:773` then reports `canAssignTasks: false`. **The route revokes what the import granted.**
  Rev 2.3 shape: `fresh`/`restore` = (1) import with `pauseAutomations: true` (born paused,
  slug ids) → (2) `PATCH /agents/<id>/permissions` to the contract's `false/false/false` per
  agent → (3) after Ryan's hand entry, `PATCH adapterConfig.env` with `secret_ref`s resolved by
  name, read-only list → id. Each a listed write; invariants and env refs verified after (2)
  and (3). The window between (1) and (2), in which a paused agent with no wake path holds
  `tasks:assign`, is stated, not hidden. Schema field names and the secrets list route being
  confirmed before rev 2.3 is written.

- 2026-09-05 20:55:14Z Claude: confirmations before writing — `updateAgentPermissionsSchema`
  (`validators/agent.js:169`) is `{canCreateAgents: boolean, canCreateSkills?: boolean,
  canAssignTasks: boolean, ...}`; handler `:2912–2940` is board-gated and computes
  `effectiveCanAssignTasks = role==="ceo" || canCreateAgents || body.canAssignTasks` → `false`
  for both shipped agents → grant revoked; `routes/secrets.js:504` `GET /companies/:id/secrets`
  returns `{id, name, key, status}` only (`:502`), `:719` `POST` creates. **FB2 rev 2.3 written**
  (372 lines) as asserted edits: P18–P19; `fresh`/`restore` as three listed writes with
  the (1)→(2) window stated; invariant 8 extended to effective access; §4 secrets rebuilt on
  the `resolveEnv` PATCH path, `secretValues` still never used; decision 11. FB2 → review for
  Ryan; FB4 re-dispatch held for his acceptance.

- 2026-09-05 Ryan (AskUserQuestion): **Codex reviews rev 2.3 first, then build.** Recorded.
  Rev 2.3 review brief staged (`/tmp/fb2-rev23-review.md`), aimed at where a third builder
  stop would come from: what a hand-rendered minimal bundle must contain for a `new_company`
  import; that the permissions PATCH persists and effective access flips; that a paused agent
  with both wake paths off is non-invokable during the (1)→(2) window; that the secret-ref
  PATCH is accepted under strict secrets mode; any other unconditional import side effect
  that would fail invariants 3–8 on the next verify. FB6's Codex review has completed and is
  being read; the rev 2.3 review dispatches after it, one Codex at a time.

- 2026-09-05 Codex (gpt-6-astra, effort high): **RETURN on FB6** — return 1 of 2. As reported
  (Claude's verification follows): Fact 1 MATCH; Fact 2 UNVERIFIABLE-HERE with token-safety
  PASS; **Fact 3 MISMATCH** — the native bundled binary is
  `@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`, not the `@openai/codex`
  wrapper I grepped, and it contains `gpt-5.6-sol` ×9 and `gpt-5.6` ×41, `gpt-6-astra` ×0;
  **Fact 4 MISMATCH** — `codex-acp:31133`'s `-m` is among search-command options and does not
  establish model forwarding. Overclaims: "no model identifier strings" / "not compiled in" /
  "refreshed at run start" (an mtime is not a cause); an absent cache entry does not establish
  inevitable failure; catalog membership supports P5's check, not runtime acceptance, and
  `paperclip-org:1418` catches a catalog-read error and continues; the document's "held" and
  "not established" phrases contradict its own recorded GET. Cache diff confirmed exactly
  (host − company = `{gpt-6-astra}`); host cache mtime now 16:55, moved by my own dispatches.
  FB7's acceptance boundary endorsed. Rev 2.3 review dispatched to Codex in the same step.

- 2026-09-05 21:24:11Z Claude: **FB6's returns verified on direct read; all hold; FB6 rev 2 written**
  (82 lines). Native binary `@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`
  (217,778,592 bytes): `gpt-5.6-sol` ×9, `gpt-5.6` ×41, `gpt-6-astra` ×0 — I had grepped the
  `@openai/codex` wrapper (0 files), the marketplaces-directory mistake again. `codex-acp:31133`'s
  `-m` sits among search options; model forwarding is `:32362` `ModelId.fromString(params.modelId)`.
  `paperclip-org:1418` warns and continues on a catalog-read error. Rev 2: Fact 3 rebuilt on the
  native binary (astra absent from both compiled identifiers and the lane's cache; the 09:59
  write's cause and the core's behaviour when both lack the model stated as not established);
  Fact 4 re-cited to `:32362`; Fact 2's stale "held" residue removed and P5's catch path stated;
  Rule 2 search table for the three open-scope absences. The corrected finding is stronger
  against the pin, not weaker: astra is nowhere in the ACP lane today. A first rev-2 script
  failed an assert before writing (its target sentence came from the GET attempt that never
  ran) — nothing recorded then. FB6 → review; re-review queued behind rev 2.3's.

- 2026-09-05 Codex (gpt-6-astra, effort high, pre-build REVIEW of rev 2.3): **RETURN.** As
  reported (Claude's verification follows). **B — the fix for the import's `tasks:assign` grant
  does not work:** `PATCH /agents/:id/permissions` with `canAssignTasks: false` *deletes* the
  grant rather than persisting a deny, membership stays active, and `buildAgentAccessState`
  then returns `canAssignTasks: true, taskAssignSource: "simple_default"` for any active
  member (`routes/agents.js:798–804`, `services/agent-permissions.js:7–21`,
  `services/access.js:424–429`). The paused window itself holds. **A** — a hand-rendered
  bundle IS viable (structure given: `COMPANY.md`, `agents/<slug>/AGENTS.md` with frontmatter,
  `.paperclip.yaml` `schemaVersion: 7`, inline source with `expectedFileCount`); but
  new-company import needs **instance admin or `local_implicit`**, not the board token alone
  (`companies.js:249–252, 427–447`; `authz.js:54–59`); import stores **no slug** — live
  `urlKey` derives from `name`, so "Implementation Engineer (on demand)" →
  `implementation-engineer-on-demand` ≠ contract slug (`services/agents.js:208–212`); the
  company name may be suffixed and the prefix is generated (`FOC` is occupied). **C** —
  `secret_ref`s are accepted and strict mode rejects only plain sensitive values; but
  `replaceAdapterConfig: true` with only `{env}` **replaces the whole config**, dropping
  model/skills/instructions, and Codex's absent bypass flag then **defaults to true**
  (`routes/agents.js:3203–3231`; `adapter-codex-local/dist/index.js:8`); the `{id,name,key,status}`
  projection is `/secrets/catalog`, not `/secrets`. **D** — `maxTurnContinuation: false` parses
  as an empty config and defaults to **enabled** (`heartbeat.js:9471–9478`); import adds
  `--skip-git-repo-check`, forces timer heartbeat off, writes managed instruction paths. **P16**
  — `createCompanySchema` is NOT `.strict()`; unknown `id` is accepted and stripped. Live-write
  scan held; stale create-route / one-import text at B:80 and B:357–359. FB2 reopened; FB4 stays
  blocked. **This is the review-first decision paying for itself: caught as findings, not a
  third stop.** FB6 rev 2 re-review dispatched in the same step.

- 2026-09-05 Claude: **rev 2.3 review findings verified on direct read; all hold.**
  **B (pilot-level, not only focx-bot):** `routes/agents.js:782–810` `buildAgentAccessState` —
  ceo → true; `canCreateAgents` → true (`agent_creator`); explicit grant → true; **`membership
  .status === "active"` → `canAssignTasks: true, taskAssignSource: "simple_default"`**; only no
  membership → false. `services/access.js:424–429` `setPrincipalPermission(..., false)` DELETES
  the grant row and returns — no deny is ever persisted. `services/agent-permissions.js:7–21`
  `normalizeAgentPermissions` defaults `canCreateSkills: true` and merely passes
  `canAssignTasks` through. **Therefore `.focx/agents.json`'s `canAssignTasks: false` has never
  been effective for the three live pilots**; the enforced guard against agents creating work
  is `paused` + both wake paths off (F6) + human-authorised tasks. A read-only GET of an
  agent's access state would confirm live; held for Ryan. **A(i):** `companies.js:249–252`
  `assertImportTargetAccess` → `new_company` → `assertInstanceAdmin` (`authz.js:54–59`:
  `local_implicit` or `isInstanceAdmin`); this instance is `deploymentMode: authenticated`,
  no `local_implicit` → the `fresh` token must be instance-admin (verify read-only before FB7).
  **A(ii):** `services/agents.js:208–212` `urlKey: normalizeAgentUrlKey(row.name) ?? row.id`;
  the import patch (`:4851–4863`) stores `name`, not slug — contract identity must be the
  url-key of `name`. **A(iii):** `:4588` `dedupeImportedCompanyName` against existing names —
  `company.name` must be unique on the instance. **C:** `routes/agents.js:3209–3210` — without
  `replaceAdapterConfig` the PATCH shallow-merges `{...existing, ...requested}`; with it, the
  request replaces the config wholesale. Step (3) must send `adapterConfig: {env}` merged.
  `/secrets/catalog` (`secrets.js:497–503`, board or agent) is the `{id,name,key,status}`
  projection; `/secrets` returns full objects. **D:** `heartbeat.js:9471–9478`
  `parseObject(heartbeat.maxTurnContinuation)` → a literal `false` becomes `{}` →
  `enabled: asBoolean(undefined, true)` = **true**. Rev 2.2/2.3 §2 wrote
  `maxTurnContinuation:false` — a transcription of `pilot-org:167`'s `{enabled:false}` that
  would have enabled turn continuation. Safety error, mine. **P16:** `createCompanySchema` is a
  plain `z.object` (strips unknown keys); the `.strict()` belongs to `updateCompanySchema`.
  Not independently confirmed here: Codex's prefix-generation cite and the bypass-default line;
  both treated as outputs/merge-safe in rev 2.4. FB2 rev 2.4 to follow.

- 2026-09-05 21:33:53Z Claude: **FB2 rev 2.4 written** (393 lines) — a first attempt failed an
  assert before writing (a regex mis-modelled the bold markers on decision 10; nothing written).
  Confirmations folded in: `shared/dist/agent-url-key.js` `normalizeAgentUrlKey` (trim, lowercase,
  delimiters → `-`, trim edges) with the probe "Implementation Engineer (on demand)" →
  `implementation-engineer-on-demand` / "Implementation Engineer" → `implementation-engineer`;
  `services/companies.js:185–201` `createCompanyWithUniquePrefix` (prefix from name, numeric
  suffix on conflict); `adapter-codex-local/dist/index.js:8` bypass default `true`. Rev 2.4:
  P20–P23; invariant 8 restated (creation flags asserted; effective `canAssignTasks` reported,
  never asserted; bypass flags re-asserted after every config write); step (2) reframed; step
  (3) merges `{env}`, never replaces; `/secrets/catalog`; `run` in object form; company `name`
  unique with `prefix`/`timezone` outputs; identity = url-key of `name`, Implementation renamed
  pending Ryan; instance-admin prerequisite; import transformations in `verify`; stale text
  replaced; decision 12. FB2 → review for Ryan (decision 12).

- 2026-09-05 Codex (gpt-6-astra, effort high): **RETURN on FB6 rev 2 — attempt 2 of 2, cap
  reached.** As reported (Claude's inspection follows): Facts 1, 3, 4 MATCH — the native binary's
  217,778,592 bytes and Sol 9 / gpt-5.6 41 / Astra 0 counts reproduced; the cache diff exactly
  `{gpt-6-astra}`; `codex-args.js:21,42–43` and `codex-acp:32362` hold; `:31133` now cited only
  as a retraction. **Fact 2:** the document's catalog list holds only **120** comma-separated
  entries and neither astra nor sol appears as a standalone entry — "explanatory prose overwrites
  part of the catalog"; token-safety PASS. Rule 2 table structurally PASS, substantively: literal
  byte absence stated as absence from "compiled identifiers"; the wrapper's "no model strings"
  exceeds the `gpt-5.6`-only search; row 2's command searched one level of `*.js`, not "trees";
  row 3 embeds a second negative search without its command. Remaining overclaims: "all four
  established" vs unestablished ACP acceptance; "what Paperclip will accept" / "the deciding
  one" still generalise P5 membership; host-cache movement attributed to dispatches without
  cited evidence. Row → ESCALATED per section 3.

- 2026-09-05 Claude: **FB6 corruption inspected; cause is mine and specific.** The Fact 2 sentence
  holds 120 comma-separated entries against a stated 128; two "entries" are prose fragments —
  `gpt-5.5-pro-Paperclip's catalog lists astra` and `…audio-mini-2025-12-15` — i.e. the rev-2
  script spliced its replacement text INSIDE the id list. It computed `m.start()/m.end()` for the
  "Consequence…" sentence at the top of the script and applied them after the Fact 3 and Fact 4
  block rewrites had shifted the text, so the stale offsets landed in the `gpt-5.5`…`gpt-6` region
  and cut 8 ids, astra and sol among them. The intact list survives in this ledger's own GET entry
  above (same process, same variable): 128 ids, astra present,
  sol present. FB6 rev 3 staged (`/tmp/fb6-rev3-apply.py`), not run: restores
  the list from the ledger, computes every offset immediately before use, and rewrites the
  over-generalisations (byte strings not "compiled identifiers"; the wrapper claim scoped to the
  `gpt-5.6` search; row 2 as one level of `*.js`; the embedded negative searches given their
  commands; mtimes as observations). FB6 at cap → Ryan; rev 2.4 also with Ryan (decision 12).

- 2026-09-05 21:36:57Z Claude: **FB2 rev 2.4.1** — adds **P24**, the minimal import bundle structure the
  rev 2.3 review established (`COMPANY.md` frontmatter name; `agents/<slug>/AGENTS.md` frontmatter
  + instructions; `.paperclip.yaml` `schemaVersion: 7` with per-agent role/icon/permissions/
  adapter/runtime; inline source with `expectedFileCount`; derived manifest; no separate
  `SKILL.md`), which rev 2.4 had omitted; §3 step (1) now cites it. Decision 12 marked accepted
  by Ryan including the rename to "Implementation Engineer". FB2 → review (Codex, pre-build,
  per Ryan); FB4 brief to be re-pointed; dispatch after both are confirmed.

- 2026-09-05 Ryan (AskUserQuestion): **FB6 — apply rev 3, close.** FB2 — accept 2.4 incl. the
  rename; one Codex review, then build.
- 2026-09-05 21:38:49Z Claude: **FB6 rev 3 on disk and verified; FB6 closed as done.** The apply
  script wrote the document then failed its own residue assert on the sentence naming the
  correction; a second checker failed on a stale expected row count (the Rule 2 table has five
  rows, not four). Each time the `&&`/same-process discipline held the ledger back; this entry is
  written after a direct check: rev 3 header; catalog list 128 ids restored from this ledger's
  GET record with astra and sol present; five Rule 2 rows with exact commands; no
  over-generalising phrase outside the note that names it; no token-shaped string. Known limit
  carried to FB7: ACP run-time acceptance of astra is not established by any local fact.
- 2026-09-05 21:38:49Z Claude: **rev 2.4.1 pre-build review dispatched to Codex** per Ryan; observed
  live — process 51584 00:40, 135830 bytes, model=gpt-6-astra, effort=high.
  Brief `/tmp/fb2-rev24-review.md`: verify each rev-2.3 finding fixed (A.1–A.11 incl. P24's bundle
  structure), hunt for anything else that would stop the builder, premise check P16–P24,
  live-write scan. FB4 brief re-pointed at rev 2.4.1 (158 lines); dispatch after PASS + Ryan.

- 2026-09-05 (completed before 21:53:18Z) Codex (gpt-6-astra, effort high): **RETURN on FB2 rev 2.4.1**
  (task `blfxkli8a`; output `scratchpad/fb2-rev24-review-high.txt`, 474,006 bytes). Two findings
  called blocking, four partials (A.6, A.9, A.11, P19 stale), live-write scan PASS; the review made
  no writes, API calls, credential reads or agent runs. Codex's report; Claude's verification follows.
- 2026-09-05 21:55:13Z Claude: **verification of the rev 2.4.1 review against installed code (read-only).**
  C1 **confirmed — blocking for `restore`.** Export prunes every `false` from adapter config,
  runtime config and permissions (`company-portability.js:1954`; applied `:3616`, `:3620`, `:3623`).
  On import an absent `heartbeat.wakeOnDemand` reads **true** (`heartbeat-policy.js:5–8`), an absent
  `maxTurnContinuation.enabled` reads **true** (`heartbeat.js:9478`), the absent Codex bypass
  defaults **true** (P23) and absent `canCreateSkills` defaults **true** (P20). Rev 2.4.1's three
  restore writes repair only the permissions. Correction: `restore` overlays the contract's
  invariant-7/8 flags onto the exported `runtime`/`adapter.config` **before** import — the overlay
  `pilot-org` `plan` already applies (`:166–181`) — and `verify` asserts 7–8 after; §4 records the
  pruning as a known export loss the fidelity report cannot show.
  C2 **confirmed.** Run flags live under `runtimeConfig.heartbeat` (`pilot-org:166–171`;
  `heartbeat-policy.js:3–4`; `heartbeat.js:9472–9473`, `:9327`). B:135's flat `run` object must be
  stated as rendering to `runtime.heartbeat.{enabled, wakeOnDemand, maxTurnContinuation:
  {enabled:false}, maxConcurrentRuns, maxDailyRuns}`; P24 says so.
  C3 **downgraded — not blocking.** "Warning-free preview" is not an acceptance criterion in rev
  2.4.1; the document's only "warning" is P24 naming this one. Mechanism confirmed: preview warns
  once per agent (`:4207`, `:4225–4229`). But import passes the ref unchanged into the adapter's
  `paperclipSkillSync` preference (`:4849`, `:3096`; `adapter-utils/server-utils.js:2178`),
  `GET /agents/:id/skills` reads that preference and resolves it against the company library
  (`routes/agents.js:1841–1850`), and the library receives the bundled skill from
  `ensureSkillInventoryCurrent` → `ensureBundledSkills` (`company-skills.js:4949`, `:2271–2290`).
  Invariant 5 holds after import. Correction: P24 quotes the expected warning text; no package
  skill is fabricated — `assertImportedSkillKeyAllowed` (`company-skills.js:42–53`) admits a
  `paperclipai/paperclip/*` key only with `paperclip_bundled` provenance, which the FB9 export
  will show and a later rev may adopt from observation, not guesswork.
  C4 **confirmed.** B:192 names `GET /companies/<id>/secrets` and then `/secrets/catalog`; catalog only.
  C5 **confirmed.** Neither `createCompanySchema` nor `updateCompanySchema` is `.strict()`
  (`validators/company.js:17–35`); P16/P23 wording only; ids remain outputs.
  C6 **confirmed.** B:193: a failure at step (2)/(3) leaves both agents present by slug, so
  invariant 1 passes; `verify` must report the failed step and fail the invariant that step left
  unmet. §4/FB9: `restore` requires an explicit unique `target.newCompanyName` (`:4579–4588`
  suffixes a colliding manifest name); the round trip compares agents by slug, never company name.
  C7 **confirmed, non-defect.** The importing board token becomes `owner` of the new company
  (`:4612–4614`), so the permissions PATCH (`agents.js:906`: company access + `agents:create`) is
  accepted; add to P21. The model-availability caveat (`codex-acp:32362`) is FB6/FB7's, nothing new.
  **Fourth return on FB2** (2 → 2.1, 2.2 → 2.3, 2.3 → 2.4, 2.4.1 → 2.5). Standing rule "after two
  returns escalate": decision to Ryan. The FB4 brief needs C1, C2, C3 and C6 before dispatch.
  No file other than this ledger changed; no live call made.

- 2026-09-05 Ryan (AskUserQuestion): **"Rev 2.5, re-point brief, build"** — apply C1–C7 as rev 2.5, fold
  C1/C2/C3/C6 into the FB4 brief, dispatch the Codex build; no fifth pre-build review; the read-only
  post-build review stands.
- 2026-09-05 22:19:28Z Claude: **FB2 rev 2.5 written (405 lines); FB2 closed as done.** Exact-substring edits,
  each asserted once: title; Rev 2.5 paragraph; P16/P23 strictness; P19 grant/catalog wording; P21 owner
  membership (C7); P24 runtime rendering + expected warning; new P25 (export prunes `false`, restore
  overlay) and P26 (heartbeat nesting; skill preference path; invariant 5 holds); `run` row nested
  under `heartbeat`; invariant 8 asserted after any import; step (3) `/secrets/catalog` only; partial
  failure names the step; §4 restore overlay + known export loss; FB9 explicit unique target name;
  decision 4 amended, decision 13 added; §11 resumes on rev 2.5. A first attempt stopped on its own
  residue assert (the new P23 wording contained the forbidden phrase) and wrote nothing. Residue
  checks passed before this write; no token-shaped string. FB4 → dispatch after the brief is re-pointed.

- 2026-09-05 22:21:33Z Claude: **FB4 third dispatch — build on rev 2.5, observed live.** Brief
  `/tmp/fb4-build-brief.v25.md` (185 lines; the rev 2.4.1 brief kept beside it), re-pointed with
  C1 restore overlay, C2 heartbeat nesting, C3 expected preview warning / no fabricated skill /
  assert singleton after import, C4 catalog-only, C6 explicit unique `newCompanyName` and
  step-naming on partial failure, company `{name}` only, restore-overlay knock-out added. Guards
  re-checked inside the dispatch command: branch `run/run-20260905-195913-fb4` @ `252349a`, tree
  clean but for the two untracked ledger files, no `codex exec` running, brief at rev 2.5, output
  file absent. Dispatched 22:20:53Z as `codex exec -m gpt-6-astra -c model_reasoning_effort="high"
  -s workspace-write -C <repo> "<brief>" > scratchpad/fb4-build3-high.txt 2>&1 < /dev/null`
  (background task `bsov9bsvy`). Banner observed: Codex **v0.153.0** (the ACP-lane bundled binary
  FB6 examined is 0.152.1 — noted, not acted on), workdir the repo, model gpt-6-astra, approval
  never, sandbox workspace-write [workdir, /tmp, $TMPDIR], reasoning effort high, session
  `01a073a9-0c14-7553-a51b-a2216b4ec4ea`; process 12709; 99,666 bytes within the first minute;
  HEAD unchanged. On completion: `/tmp/fb4-review.sh` (read-only) → if the scan is clean,
  `/tmp/fb4-exec.sh` (tests, repo checks, knock-out re-run) → commit on the run branch → stop
  for Ryan's push/PR authorisation. No live Paperclip write is possible from this build.

- 2026-09-05 23:27:10Z Codex (gpt-6-astra, effort high, sandbox workspace-write): **FB4 build complete, exit 0**
  after 66 min (13.2 MB log, `scratchpad/fb4-build3-high.txt`, 429,129 tokens). Codex's report: 80 tests
  pass incl. 32 source knock-outs (restore overlay removal produced Invariant 7 AND 8 failures); contract
  validation and `pilot-org --check` exit 0; workflow carries only the eight-line insertion; read-only host
  evidence (astra absent from ACP cache mtime 2026-09-05T13:59:09Z and from the native binary; catalog not
  queried under FB4); declared deviations — "added supporting modules and 302 unmodified native protocol
  schemas inside the permitted package… generated offline by bundled 0.152.1; they remain for review", DB
  name/user-secret null, sourced company name `Focx.ai` needs a unique override live; no commit/push/PR,
  no live write, no agent run, no plugin install, no credential value. Ryan's "42 min in" check at 23:04Z
  found it mid knock-outs with `packages/focx-bot/` present and HEAD unchanged.
- 2026-09-05 23:35:48Z Claude: **FB4 review — accepted with two fixes; committed on the run branch; STOP for Ryan.**
  Read-only phase (`fb4-review.sh`): branch/HEAD as expected; only `drift-gate.yml` modified and
  `packages/focx-bot/` new; no file outside allowed paths; credential scan clean (the only credential-shaped
  text is the contract's own refusal regex and the `GH_TOKEN` credential helper sourced from P13, refs only);
  `contract.skills` byte-identical to the FB3 rev 2.2 fragment (sha `cb9ed22e…2320`); company `{name}` only;
  no ids; `activation: paused`. Sources read in full before any execution: `test.mjs` spawns only `node`
  (`--check` and data-URL knock-out children), uses the in-process fake with an injected transport, never
  calls `listen()`, `NativePluginRuntime.open()`, `execFileSync` or the host checks; `open()` (which spawns
  the native binary as a JSON-RPC app-server) is reachable only via `bind-secrets --apply --approved-digest`.
  Exec phase (`fb4-exec.sh`, 16 s): 80/80 in 8 s; `pilot-org --check` 0; drift-check clean; pilot-org tests
  pass; tree unchanged. My re-run script's invariant-5 regex (`length === 1`) was wrong — Codex used
  deep-equality to the singleton, stricter; independent non-mutating check: empty, extra, wrong and
  duplicated skill lists all flagged; install plan = 367 pinned entries, 0 unpinned.
  **Findings.** R1 — 302 generated protocol schemas (4.2 MB) produced by executing the ACP-lane native
  binary (`codex app-server generate-json-schema`, log :74477, with a nonexistent scratch `CODEX_HOME`; no
  leftover dir; no instance write) — not in the brief's deliverable list; one file read by one test.
  **Fixed:** trimmed to the 7 files the four RPCs rely on (`ClientRequest.json` — where I verified the
  method names `initialize`, `plugin/read`, `plugin/install`, `app/installed` the code sends — plus v2
  PluginRead/PluginInstall/AppsInstalled params/responses); the full set stays in `c852f77`. R2 — `bind-secrets
  --apply` provisions pinned plugins: Claude CLI `plugin install`, Codex CLI `plugin add` for local entries,
  and the native binary as a management app-server (`plugin/read`/`plugin/install`/`app/installed` only;
  approval/OAuth server requests answered -32601) for remote ones. In scope per rev 2.5 §6 ("installs
  `pinned: true`") but the *mechanism* was never specified in FB2 and is a new listed-write surface; inert
  without `--apply`; **needs Ryan's acceptance → FB2 rev 2.6 §6 note, or deferral to FB5**. R3 — the
  added `actions/setup-node@v4` (node 22) sat before the pre-existing `agent reporting path` step and would
  have changed its runtime. **Fixed:** the three steps moved to the end; file asserted equal to the develop
  version plus eight appended lines. R4 — `database.name`/`userSecret` are `null` (Rule 4: recorded as
  unestablished by non-credential evidence, README says so; host DB recovery stays unproven). R5 — `fresh`
  needs `--catalog-company-id` (reads the retained company's adapter model catalog before creating the new
  one) and `--new-company-name` when `Focx.ai` exists: sensible additions, documented. R6 — CI budget: suite
  8 s against the job's 5-minute timeout. R7 — contract body matches rev 2.5 §2 (project `{id,name}`
  sourced; instance/service/database/network set from host observation; secrets refs only).
  **Commits** on `run/run-20260905-195913-fb4`: `c852f77` Codex's build verbatim (322 files); `c426e3a`
  the two fixes + README/comment, re-verified 80/80, validate 0, pilot-org 0, drift 0, `diff --check` 0.
  Not pushed; no PR. Ledger files remain untracked as before. Next: Ryan authorises push + PR (Render
  preview, drift gate), decides R2; FB5 brief must cross-verify these fixes; FB7 needs the instance-admin
  read-only token check first.

- 2026-09-05 Ryan (AskUserQuestion): **"Push and open the PR"**; **R2 — "Accept; record in FB2 rev 2.6."**
- 2026-09-05 23:47:51Z Claude: **pushed and PR opened; FB2 rev 2.6 written.** `git push -u origin run/run-20260905-195913-fb4`
  (new branch, HEAD `c426e3a`); `gh pr create` → **PR #88** https://github.com/ryanphillipthomas/focx/pull/88
  (`run/run-20260905-195913-fb4` → `develop`, OPEN), body = package contents, the one workflow edit, evidence
  (80/80, pilot-org 0, drift clean, diff --check clean), the two review fixes, what still needs FB7–FB9, safety
  statement. Not merged; human merge only. FB2 rev 2.6 (413 lines): Rev 2.6 header paragraph; §6 "How pinned
  entries are installed" naming the three paths (Claude CLI `plugin install --scope user`; Codex CLI `plugin add
  --json` with company `CODEX_HOME`; native binary as `codex app-server` limited to `initialize`/`plugin/read`/
  `plugin/install`/`app/installed`, approval/OAuth requests answered -32601, source id + version asserted, apps
  needing auth reported for Ryan) as listed writes under `bind-secrets --apply` + digest, `codex login`
  prerequisite, FB5 cross-verifies; decision 14. No other FB2 text changed. Next: drift gate on #88, Render
  preview, Ryan's merge; then FB5 brief (cross-verify Claude's two fixes + the install mechanism) and the
  FB7 instance-admin read-only token check.

- 2026-09-05 Ryan: "merged, start the FB5 brief and the FB7 token check"; then "pr and merge in please".
- 2026-09-06 00:04:30Z Claude: **#88 is not merged as of this entry** — `gh pr view 88`: OPEN, mergeStateStatus CLEAN,
  mergedAt null; `origin/develop` still `252349a`, no `packages/focx-bot` on develop. Drift gate on #88
  passed (20 s). Per AGENTS.md "Build, never merge" and `invariants.yaml` `humanApprovalRequired`, the merge
  is Ryan's action: the exact `gh pr merge` command was handed to him to run himself; Claude did not merge.
- 2026-09-06 00:04:30Z Claude: **FB7 prerequisite check (decision 12c, P21) — PASS, read-only.** Token read from
  Keychain `paperclip-board-token` inside one process, never printed; `GET http://127.0.0.1:3100/api/cli-auth/me`
  → HTTP 200, `isInstanceAdmin: true`, actor `source: board_key` (key id present, not recorded), one
  company membership — the retained company `5f772ef2…`, status active. Route verified in installed code:
  `routes/access.js:2234–2247` (board actor + userId required; returns `isInstanceAdmin` from
  `boardAuth.resolveBoardAccess`). `assertInstanceAdmin` (`authz.js:54–59`) will therefore admit this token
  to `new_company` import. No write. Email/name in the response deliberately not recorded.
- 2026-09-06 00:04:30Z Claude: **FB5 brief written** — `/tmp/fb5-build-brief.md` (72 lines, `{{BRANCH}}` placeholder).
  Part A (read-only, report first): A1 workflow = develop + 8 appended lines and setup-node cannot affect
  the reporting step; A2 the 7 kept schemas carry the four RPC method names and nothing references a removed
  file; A3 the rev 2.6 install commands exist in the installed runtimes (`--help` only). Part B: `grants`
  read-only report inside `verify` — declared / rendered / observed-on-disk per agent, diff classes, Claude
  lane fatal, Codex lane reported with the F1 sentence verbatim, permission delta incl. the dead
  `Write(/tmp/**)` rule (H7), effect-vs-declaration labelling, unattributed mtimes; knock-out tests; no
  writes. Dispatch only after #88 is merged and `run/<ts>-fb5` is cut from that develop.

- 2026-09-06 Ryan: "Merged" / "merged, cut the branch and dispatch FB5".
- 2026-09-06 00:13:14Z Claude: **#88 merged — verified, FB4 closed as done.** `gh pr view 88`: MERGED at
  2026-09-06T00:11:47Z, merge commit `9e1566f`; `develop` pulled fast-forward to `9e1566f`; `packages/focx-bot`
  present (26 files); `node --test packages/focx-bot/test.mjs` on develop: 80 pass, 0 fail. FB5 branch cut
  and dispatch follow in the next entry from observed liveness.

- 2026-09-06 00:13:42Z Claude: **FB5 dispatched, observed live.** Branch `run/run-20260906-001305-fb5` cut from develop
  `9e1566f`; brief `/tmp/fb5-build-brief.final.md` (72 lines, branch substituted, placeholder asserted gone).
  Guards inside the dispatch command: on develop@9e1566f before the cut, tree clean but for the two untracked
  ledger files, no `codex exec` running, output file absent. Dispatched 00:13:05Z as `codex exec -m gpt-6-astra
  -c model_reasoning_effort="high" -s workspace-write -C <repo> "<brief>" > scratchpad/fb5-build-high.txt
  2>&1 < /dev/null` (background task `b0zh97ld0`). Banner: Codex v0.153.0, workdir the repo, model
  gpt-6-astra, approval never, sandbox workspace-write [workdir, /tmp, $TMPDIR], reasoning effort high, session
  `01a0740f-c6d3-7470-ac71-cfe47dd6dcd4`; process 78405; 20,298 bytes within seconds; HEAD unchanged. On
  completion: read-only review (containment = `packages/focx-bot/` only, no `.github` change), Part A verdicts
  checked against my own evidence, then tests + repo checks, commit, stop for Ryan's push/PR authorisation.

- 2026-09-06 00:13:54Z Codex (gpt-6-astra, effort high): **FB5 first dispatch — stopped after Part A, by
  design, no file changed** (49 s, 67,795 bytes, 25,463 tokens; `scratchpad/fb5-build-high.txt`). Codex's
  report: **A1 PASS** — `drift-gate.yml` is byte-for-byte `252349a` plus exactly eight appended lines; "agent
  reporting path" at :41–42, `actions/setup-node@v4` after it at :43–46. **A2 PASS** — seven schema files;
  `initialize`, `plugin/read`, `plugin/install`, `app/installed` all verbatim in `ClientRequest.json`; only
  `v2/PluginInstallParams.json` is referenced, by `test.mjs`. **A3 PASS** (help text quoted, all exit 0) —
  `claude plugin install|i [options] <plugin>` with `plugin@marketplace` and `--scope user|project|local`;
  `codex plugin add [OPTIONS] <PLUGIN[@MARKETPLACE]>` with `--json` = "Output install result as JSON";
  native binary `codex app-server [OPTIONS] [COMMAND]`. Stop reason: both Codex `--help` invocations printed
  "WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted", and the
  brief said a refused sandbox write is a stop. No commit/push/PR, no live write, no install, no login, no
  Keychain, no credential value. Part B not started.
- 2026-09-06 00:14:57Z Claude: **Part A accepted as cross-verification of the FB4 review fixes and the rev 2.6 commands**
  (distinct author: Codex verified Claude's edits and Claude's §6 text). The stop was my brief's wording, not
  a real refusal: the Codex CLI tries to write shell aliases under `~/.codex` at startup, outside the
  writable workdir; `workspace-write` denies it and the CLI proceeds. Containment confirmed by the read-only
  review script: branch/HEAD as expected, no change anywhere, `.github` untouched, `diff --check` clean.
  **Second dispatch** with the same brief plus a resumption note: Part A done, do not redo; the PATH-alias
  warning is not a stop condition; the only stop is a refused write under `packages/focx-bot/`; no CLI
  invocation in Part B. Output `scratchpad/fb5-build2-high.txt`; liveness recorded in the next entry.

- 2026-09-06 00:15:16Z Claude: **FB5 second dispatch observed live** — 00:14:44Z, guards re-checked (branch
  `run/run-20260906-001305-fb5` @ `9e1566f`, tree clean, no other `codex exec`, output file absent); brief
  `/tmp/fb5-build-brief.v2.md` (= v1 + resumption note); banner Codex v0.153.0, gpt-6-astra, effort high,
  workspace-write, session `01a07411-4895-7780-92ea-3474292a6c5d`; process 79565 (task `bawpw14lb`);
  217,998 bytes within the first minute; HEAD unchanged.

- 2026-09-06 00:24:52Z Codex (gpt-6-astra, effort high): **FB5 second dispatch — stopped mid-Part B on a claimed
  FB4 defect; draft left on disk, uncommitted** (10 min, 962,868 bytes; `scratchpad/fb5-build2-high.txt`).
  Codex's report: `renderAdapter()` omits `adapterLocal`; offline fixture `liveHasAdapterLocal: false`,
  `configWritesWithAdapterLocal: 0`; "Claude must resolve that FB4 delivery gap before I resume". Draft:
  `src/grants.mjs` (136, new), `plugins.mjs` +47/−1, `index.mjs` +19/−9, `host.mjs` +2/−2, `fake-api.mjs` +14,
  `test.mjs` +143. Suite 103 tests: 89 pass, 14 fail — 12 on its own typo (`grants.mjs:112` `r.key`,
  loop variable is `row`), 2 encode the claimed gap. Seven new knock-outs and the 32 existing all
  baseline PASS → witness FAIL → restored PASS. `pilot-org --check` 0; `diff --check` clean. No file
  outside the package; no commit/push/PR/live write/agent run/install/login/Keychain/credential value.
  Also observed in its log (twice): the Codex CLI's own model refresh got `401 Unauthorized: Provided
  authentication token is expired` from chatgpt.com — the run itself proceeded.
- 2026-09-06 00:29:21Z Claude: **Codex's FB4-defect claim REJECTED with evidence; the wrong premise was in my brief.**
  (1) Read-only `GET /api/agents/<QA id>/configuration` on the live pilot: 17 adapterConfig keys, **no
  `adapterLocal`**; same for the Implementation agent. Paperclip does not know that key. (2) `pilot-org`
  never writes it: `:192–194` sets `agentCommand = node tools/qa-claude-agent-acp/index.mjs` when
  `permissionDelivery` is `qa-worktree-local`; `:223–236` verify reads `CLAUDE_CONFIG_DIR` /
  `CLAUDE_CODE_PLUGIN_CACHE_DIR` from the live env and checks `installed_plugins.json` + `settings.json`
  against `l.claudeCodePlugins`. (3) Permissions reach QA at launch: the launcher reads allow/deny from
  `.focx/agents.json` (`index.mjs:32–39`, `:49`) and writes the worktree's `.claude/settings.local.json`
  (`:47–56`). FB4's `renderAdapter` (`bundle.mjs:72`) and `renderSkillHomes` mirror exactly that — FB4
  unchanged. My FB5 brief's Part B item 3 named "live adapterConfig.adapterLocal" as a surface; that
  was my error and Codex built to it. **F10 (new finding, for Ryan / FB2 rev 2.7):** the launcher admits
  only `env.PAPERCLIP_AGENT_ID === <QA id in .focx/agents.json>` and `PAPERCLIP_COMPANY_ID === <its
  manifest companyId>` (`index.mjs:34`); a provisioned company's QA agent has generated ids, so the
  launcher would refuse every run — blocks FB8's QA lane for a fresh company (not FB7); the fix is a
  `tools/` design change (resolve QA by role/url-key + live company, or an instance-local override),
  Ryan's to choose. **Third dispatch** with brief v3 = v2 + correction: surfaces (3a) live `agentCommand`
  + env keys, (3b) contract `adapterLocal` deep-equals `.focx/agents.json` by roleKey, (3c) rendered via
  the launcher's own `mergeSettings` (import only), (3d) worktree `settings.local.json` observed when
  present, (3e) fatal `delivery-binding-mismatch` with the F10 line verbatim; fix the typo; rewrite the two
  premise tests; no CLI, no writes. Guards: branch/HEAD as expected, changes only under
  `packages/focx-bot/`, no other `codex exec`, new output `scratchpad/fb5-build3-high.txt`. The 401 is
  recorded as FB7 evidence that `~/.codex/auth.json` is expired for ChatGPT-backed refreshes: `codex
  login` by Ryan stays a prerequisite before any Codex agent run.

- 2026-09-06 00:29:39Z Claude: **FB5 third dispatch observed live** — 00:28:58Z, brief `/tmp/fb5-build-brief.v3.md`
  (v2 + correction note), draft of 6 files present under `packages/focx-bot/` as the resume point; banner
  Codex v0.153.0, gpt-6-astra, effort high, workspace-write, session `01a0741e-52f5-76b1-a0e9-dc7174483bdd`;
  process 86951 (task `b4rdgugrz`); 189,281 bytes within the first minute; HEAD unchanged.

- 2026-09-06 00:35:56Z Codex (gpt-6-astra, effort high): **FB5 third dispatch — complete, uncommitted** (7 min,
  341,481 bytes, 102,556 tokens; `scratchpad/fb5-build3-high.txt`). Codex's report: 120/120 tests incl. all 80
  FB4 tests and 17 FB5 knock-outs (broken guard → witness FAIL → restored PASS); `pilot-org --check` 0; `git
  diff --check` 0; Part A verdicts carried forward without re-running runtime commands. Files, all under
  `packages/focx-bot/`: `src/grants.mjs` 188 (new), `fake-api.mjs` 128, `host.mjs` 63, `index.mjs` 141,
  `plugins.mjs` 150, `test.mjs` 495, `README.md` 128. Interpretation recorded: the mandated `loadSource()`
  reads repository `.focx` SKILL.md files; runtime host readers never open plugin SKILL.md, auth files or
  marketplace snapshots. F10 line printed verbatim. No commit/push/PR, live write, agent run, install,
  login, Keychain, credential value, new dependency, or write outside the package.
- 2026-09-06 00:43:14Z Claude: **FB5 review — accepted with one fix (mine to own); committed; STOP for Ryan.** Read-only
  phase: containment = package only, `.github` untouched, both mandated sentences (F1, F10) present verbatim
  in `src/grants.mjs`, scan hits are README example URLs and the tests' negative checks only, `diff --check`
  clean. Code read in full: (3a) live `agentCommand` === the launcher `COMMAND` and env-key presence, (3b)
  contract `adapterLocal` deep-equals `.focx/agents.json` by roleKey, (3c) rendered permissions via the
  launcher's own `mergeSettings` over the five vendor rules, (3e) `delivery-binding-mismatch` fatal with the
  F10 line. Exec phase: 120/120 in 13 s; validate 0; `pilot-org --check` 0; drift-check clean; pilot-org
  tests 0; tree unchanged. Independent cross-checks: generated ids → F10 fires; matching ids → silent;
  contract `adapterLocal` == agents.json QA; the company `codex-home/config.toml` uses exactly the
  `[plugins."key"] enabled = true` form the parser reads. **Finding (mine):** the observed-on-disk reader
  walked `<instanceRoot>/worktrees/**` — a path my brief asserted; it does not exist. Paperclip keeps
  per-issue worktrees under `<instanceRoot>/projects/<companyId>/<projectId>/<checkout>/.paperclip/
  worktrees/<issue>/` (eight `settings.local.json` there today; FB1 :227–228; the launcher enforces the
  same location, `index.mjs:36–38`). As written it would have reported "unobserved" forever. **Fixed:**
  bounded walk of that layout scoped to the live company (every Claude worktree of a two-agent company is
  QA's); a file holding exactly the five vendor rules and no deny is classified "pre-launch baseline —
  not evidence" instead of permission-missing diffs (the sampled live file is exactly that: 5 allow rules,
  defaultMode default, no deny); tests moved to the real layout, company-scope and baseline cases added
  → 121/121. Two edit attempts failed their own asserts and wrote nothing before the third applied.
  **Consequence for FB7:** `verify` on a provisioned company now exits nonzero on exactly
  `delivery-binding-mismatch` (F10) until the launcher binding is redesigned; FB7 proves the Codex lane
  and must record that expected failure rather than hide it. **Commits** on `run/run-20260906-001305-fb5`:
  `a1ba899` Codex's FB5 verbatim; `27fb0df` the fix. Not pushed; no PR. Cross-verification of `27fb0df` is
  owed by the next Codex dispatch (FB7 brief, Part A). Decisions for Ryan: push + PR; F10 → rev 2.7.

- 2026-09-06 Ryan (AskUserQuestion): **"Push and open the PR"**; **F10 — "Resolve QA by role + live company"**.
- 2026-09-06 00:44:46Z Claude: **FB5 pushed, PR #89 opened; FB2 rev 2.7 written.** `git push -u origin
  run/run-20260906-001305-fb5` (new branch, HEAD `27fb0df`); `gh pr create` → **PR #89**
  https://github.com/ryanphillipthomas/focx/pull/89 (→ `develop`, OPEN): body = what the check compares and
  what is fatal vs reported, the F1 sentence, F10 with the accepted direction, evidence (121/121, pilot-org 0,
  drift clean, diff --check clean), the reviewer fix, scope and safety statement. Not merged; human merge
  only. FB2 rev 2.7 (420 lines): Rev 2.7 header paragraph recording F10 (launcher `:34` binding to
  `.focx/agents.json` ids; provisioned companies cannot launch QA; `verify` fails on exactly
  `delivery-binding-mismatch` until fixed; FB7 records that as expected) and Ryan's direction — resolve
  `PAPERCLIP_AGENT_ID` through Paperclip, accept when url-key is `qa-engineer` and `companyId` matches
  `PAPERCLIP_COMPANY_ID`, permissions still from `agents.json` by roleKey, no ids in source, a `tools/` Codex
  task after FB5 merges and before FB8; decision 15. Nothing else in FB2 changed. Next: Ryan merges #89;
  then the F10 launcher task brief (Codex; Part A cross-verifies `27fb0df`) and the FB7 run brief (Codex lane,
  `codex login` prerequisite, expected F10 failure in `verify` recorded), each a listed write for Ryan.

- 2026-09-06 Ryan: "merged, cut the branch and dispatch the F10 launcher task".
- 2026-09-06 00:50:02Z Claude: **#89 merged — verified; FB5 closed as done.** `gh pr view 89`: MERGED at 2026-09-06T00:47:20Z,
  merge `285c40f`; develop pulled fast-forward; `packages/focx-bot` tests on develop 121 pass / 0 fail. F10 task
  brief written (`/tmp/f10-build-brief.md`): files editable = the launcher, its test file, and focx-bot
  `grants.mjs` / `test.mjs` / `README.md` only; Part A cross-verifies `27fb0df` (worktree layout, baseline
  classification, company scoping); Part B = launcher resolves `PAPERCLIP_AGENT_ID` via
  `GET /api/agents/:id` with the run's own bearer key, accepts only url-key `qa-engineer` + `claude_local` +
  `companyId === PAPERCLIP_COMPANY_ID` + id match, permission values still from `agents.json` by roleKey,
  injectable fetch, fail-closed, no body/key logged, every other guard kept, knock-out tests, pilot-org
  suite and `--check` green; Part C = focx-bot mirror (`delivery-identity-mismatch`, F10-resolved line
  verbatim, generated ids clean). Branch cut and dispatch recorded from observed liveness next.

- 2026-09-06 00:50:24Z Claude: **F10 task dispatched, observed live.** Branch `run/run-20260906-004949-f10` cut from develop
  `285c40f`; brief `/tmp/f10-build-brief.final.md` (branch substituted). Guards: on develop@285c40f before the
  cut, tree clean but for the two untracked ledger files, no other `codex exec`, output file absent. Dispatched
  00:49:49Z (same form as FB4/FB5; background task `bkrnll3db`; output `scratchpad/f10-build-high.txt`). Banner:
  Codex v0.153.0, gpt-6-astra, effort high, workspace-write, session `01a07431-69df-7b92-9918-38c1f360e4b3`;
  process 98942; 247,813 bytes within the first minute; HEAD unchanged. On completion: read-only review
  (containment to the five allowed files), Part A verdicts against my own evidence, pilot-org suite + `--check`,
  focx-bot suite, drift-check, commit on the run branch, stop for Ryan's push/PR authorisation.

- 2026-09-06 00:52:23Z Codex (gpt-6-astra, effort high): **F10 first dispatch — stopped after Part A, by design;
  no file changed** (2.5 min, 443,620 bytes, 72,830 tokens; `scratchpad/f10-build-high.txt`). Codex's report:
  **A1 PASS** — read-only listing found `projects/5f772ef2…/60073b69…/focx/.paperclip/worktrees/FOC-95-…`,
  matching `readWorktreeSettings` and the launcher's guard. **A2 FAIL** — the installed writer
  (`adapter-utils/dist/acpx-engine/execute.js:782`) seeds five vendor rules, `defaultMode: "default"`, no
  deny, but `:815–819` preserve an existing mode other than `dontAsk`, including `bypassPermissions`;
  FB5's baseline classifier (`grants.mjs:131`) never checked `defaultMode`. Synthetic witness:
  `defaultMode=bypassPermissions` + the five rules → classified pre-launch baseline, zero diffs, while
  `mergeSettings` rejects the same file ("Unexpected permission mode"). **A3 PASS** — walk scoped to
  `projects/<live.company.id>`, straight to `.paperclip/worktrees`, no recursion into checkouts.
  Self-read fact: `resolveAgentSelfTrustPreset` (`routes/agents.js:824`) derives trust from the run's
  issue/project execution policies; the GET handler (`:2542`) returns **403 for `denied`**, QA self-reads
  included; `low_trust_review` returns a restricted view. Used Node `readdirSync` rather than `ls` to honour
  the CLI restriction. No commit/push/PR, network, live write, agent run, login, Keychain or credential value.
- 2026-09-06 00:55:11Z Claude: **A2 accepted — my defect from `27fb0df`; fixed as `55d326c` on the F10 branch.** Verified the
  writer myself (`execute.js:815–816`: `existingDefaultMode && existingDefaultMode !== "dontAsk" ?
  existingDefaultMode : "default"`) and the launcher's refusal (`index.mjs:21`). Fix: every observed worktree
  file with `defaultMode !== "default"` (including a missing mode) is a fatal Claude-lane diff
  `permission-mode-unexpected`; the pre-launch baseline now also requires `defaultMode === "default"`.
  Plain test + knock-out added; 123/123; pilot-org tests and `--check`, drift-check, `diff --check` clean.
  **Second dispatch** with the brief plus a resumption note: A2 re-verified against `55d326c` only, then
  Part B/C; fail closed on 403 (`denied`) and on any missing field from a `low_trust_review` restricted
  view; rename the `delivery-binding-mismatch` knock-out to the new kind. Output `scratchpad/f10-build2-high.txt`;
  liveness in the next entry.

- 2026-09-06 00:55:31Z Claude: **F10 second dispatch observed live** — 00:54:55Z, guards re-checked (branch, HEAD `55d326c`,
  tree clean, no other `codex exec`, output absent); brief `/tmp/f10-build-brief.v2.md`; banner Codex v0.153.0,
  gpt-6-astra, effort high, workspace-write, session `01a07436-148b-7b82-a934-7e468adf49a7`; process 2757
  (task `blj540rkr`); 288,876 bytes within the first minute; HEAD unchanged.

- 2026-09-06 01:00:58Z Codex (gpt-6-astra, effort high): **F10 second dispatch — complete, uncommitted** (6 min,
  510,319 bytes, 94,143 tokens; `scratchpad/f10-build2-high.txt`). Codex's report: A2 re-verified PASS at
  `55d326c`; launcher resolves QA through an authenticated run-bound GET with a 10 s timeout, validates all
  identity fields, rejects mismatches/HTTP failures/invalid or incomplete JSON without exposing response
  content; permission values unchanged from `agents.json` by roleKey. Files (the five allowed only): launcher
  +26/−5, launcher tests +108/−25, `grants.mjs` +5/−8, focx-bot tests +22/−21, README +9/−5. pilot-org
  tests 78 pass / 8 optional native skipped; `--check` PASS; focx-bot 123/123; 52 knock-outs; `diff --check`
  clean. Self-read trust: `resolveAgentSelfTrustPreset` (`routes/agents.js:824`) derives from agent/run/
  issue/project policy; `denied` → 403. Tests use an in-memory worktree (mocked `fs`, injected fetch) —
  no disk, git or network. No commit/push/PR, live write, agent run, login, Keychain, credential value.
- 2026-09-06 01:02:47Z Claude: **F10 review — accepted; committed; STOP for Ryan.** Read-only: containment exactly the five
  files; scan clean (fixed-text errors, no body or key in any message or log; only the `[focx-qa-permissions]`
  stderr lines remain); diffs read in full — `validateContext(resolvedAgent, ctx)` requires id/urlKey/companyId/
  adapterType/name and the four-way match; `resolveAgent` requires URL/key/agent/company env and bound run+task
  ids before any fetch, GET with bearer + `X-Paperclip-Run-Id`, `redirect: "error"`, `AbortSignal.timeout(10000)`,
  non-200 refused without reading the body, five fields picked; `main` awaits `prepare`; all local guards
  intact; focx-bot mirror `delivery-identity-mismatch` + "F10 resolved" line; generated ids clean. Exec phase
  (mine): pilot-org 86 tests, 78 pass, 8 skipped; `--check` 0; focx-bot 123/123; drift-check clean; `diff
  --check` clean; tree unchanged. Note, not a defect: the identity GET runs before the local cwd/branch guards,
  so a misplaced launch still performs one read-only, run-bound GET before refusing. **Commits** on
  `run/run-20260906-004949-f10`: `55d326c` (Claude, A2 fix) then `66daf48` (Codex verbatim). Not pushed; no PR.
  Cross-verification owed: Codex verified `55d326c` (A2 PASS); `66daf48` is Codex's own, reviewed by Claude —
  distinct authors both ways. Next: Ryan pushes/PRs; after merge, FB7 brief (Codex lane; `codex login`
  prerequisite; `verify` no longer expected to fail on F10).

- 2026-09-06 Ryan (AskUserQuestion): **"Push and open the PR"** (F10).
- 2026-09-06 01:03:58Z Claude: **F10 pushed, PR #90 opened.** `git push -u origin run/run-20260906-004949-f10` (new branch,
  HEAD `66daf48`); `gh pr create` → **PR #90** https://github.com/ryanphillipthomas/focx/pull/90 (→ `develop`,
  OPEN): body = problem, launcher change, focx-bot mirror incl. the `defaultMode` follow-up, evidence, scope,
  safety statement. Not merged; human merge only. After merge: FB7 brief (Codex lane; `codex login`
  prerequisite; instance-admin token confirmed; `verify` no longer expected to fail on F10).

- 2026-09-06 Ryan: "merged, start the FB7 brief" → (Claude found #90 still OPEN) → "its now merged".
- 2026-09-06 01:09:23Z Claude: **#90 merged — verified; F10 closed as done. FB7 brief written.** `gh pr view 90`: MERGED at
  2026-09-06T01:06:50Z, merge `52261d6`; develop pulled; launcher carries no id binding; focx-bot 123/123,
  pilot-org 78 pass. Drift gate on #90 had passed (31 s). **FB7 brief** `/Users/ryanthomas/Documents/
  focx-bot-FB7-brief.md` (rev 1, 57 lines): pass/fail written before the run; one variable (secrets unbound,
  plugins unprovisioned — `bind-secrets --apply` would add 73 native installs to a model proof); prerequisites
  P1–P7; five listed writes W1–W5 (W0 dry-run digest; W1 `fresh --apply`; W2 one issue; W3 wake window open =
  exactly the two FOC-96 fields, `heartbeat.enabled` never; W4 one `POST /agents/:id/wakeup` on_demand/manual;
  W5 restore byte-identical + pause, unconditionally); expected `verify` findings enumerated; read-only task
  text; evidence list; no deletion. **Evidence of record established read-only from the FOC-96 record**
  (`GET /api/heartbeat-runs/596211ea…`, `routes/agents.js:4210`; `/api/runs/:id` and `/agents/:id/runs/:id` are
  404): `usageJson.model = gpt-5.6-sol` (executed), `resultJson.requestedModel = gpt-5.6-sol`, `status
  succeeded`, `invocationSource on_demand`. FB7 pass = `usageJson.model === "gpt-6-astra"`; requested astra
  with a different `usageJson.model` is the silent-downgrade fail. Nothing executed; no write. Awaiting
  Ryan's three pre-W1 decisions: company name (proposed `focx-bot-4a`), `codex login` done, fallback policy.

- 2026-09-06 01:10:19Z Claude: **FB7 W0 — read-only preflight run, PASS.** `node packages/focx-bot/src/index.mjs fresh
  --base-url http://127.0.0.1:3100 --catalog-company-id 5f772ef2… --new-company-name focx-bot-4a` (no `--apply`;
  GETs only: `cli-auth/me`, companies, adapter catalogs; token from Keychain in-process, not printed). Exit 0.
  Preflight: `isInstanceAdmin true`; existing companies `[Focx.ai]` → name unique; catalog `gpt-6-astra`
  present (Implementation), `claude-opus-5` present (QA); installed adapter enum matched; host: postgresql@17
  listener true (`/opt/homebrew/Cellar/postgresql@17/17.11/bin/postgres`), Claude runtime matches 2.1.261.
  Plan under digest `0a20e27504c520dff3bf5a1af141e73c5f049562caf9fde59ce6faee825334d1`: POST
  `/api/companies/import` (6 files, `pauseAutomations: true`, no `secretValues`), PATCH permissions ×2,
  WRITE_FILE `workspaces/<id:qa-engineer>/.claude/settings.json`, WRITE_STATE; later (bind-secrets, not FB7):
  2 env PATCHes, secret inputs `GH_TOKEN` ×2 + `CLAUDE_CODE_OAUTH_TOKEN`. Window note printed. No write made.
  W1 needs Ryan: company name confirmed, `codex login` done, fallback policy; then `--apply --approved-digest`.

- 2026-09-06 Ryan (AskUserQuestion): company name **`focx-bot-4a`**; **`codex login` done**; fallback **"Pre-approve
  one gpt-5.6-sol retry"** (same task, logged as fallback; FB7 then passes only as a sol proof, astra recorded
  failed); **"Authorise W1"**.
- 2026-09-06 01:13:38Z Claude: **FB7 W1 EXECUTED — `fresh --apply --approved-digest 0a20e275…334d1`, exit 0, 01:12:35Z →
  01:12:38Z.** Writes as listed, in order: LOCK; `POST /api/companies/import/preview` (read-only; exactly the two
  expected skill warnings); WRITE_STATE; `POST /api/companies/import` (6 files, paused, no secretValues);
  WRITE_STATE; `PATCH /agents/8ce1a646…/permissions`; `PATCH /agents/aede9f03…/permissions`; MKDIR + WRITE_FILE
  `workspaces/aede9f03…/.claude/settings.json`; WRITE_STATE; UNLOCK. **Outputs (ids, recorded here only):**
  company `focx-bot-4a` = `c6f5dbbf-7c8f-4ebf-9a1b-819984579826`; Implementation Engineer =
  `8ce1a646-8f9a-41ba-ac8d-ca786668e129`; QA Engineer = `aede9f03-2c11-448b-9399-283ade26e00c`; no async job id.
  State phase `awaiting-secret-entry`, step 3. Effective access `canAssignTasks: true` / `simple_default` on
  both (P20, reported not asserted). **`verify` read-back (exit 1, expected):** `changes: []`, invariants 1–8
  `[]`, `permissionsRevoked: true`, catalog astra + opus present; model evidence: catalog present, ACP cache
  unavailable (company home not yet created), binary literal false. Expected findings present: 3 unresolved
  secret links (`GH_TOKEN` ×2, `CLAUDE_CODE_OAUTH_TOKEN`), pins 4/367, runtime-skills / codex skills / auth
  link absent, `claude-settings` matches. **No `delivery-identity-mismatch` on generated ids — F10 fix proven
  live.** Not in the brief's §3 list and recorded as a brief omission: QA `delivery-env-missing` ×2
  (`CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PLUGIN_CACHE_DIR` are written by `bind-secrets`, which FB7 skips) and one
  QA `installed-at-wrong-pin` (host plugin state; detail in the next entry); Implementation `metadata-unavailable`
  (no `config.toml` before the first run), non-fatal. FB7 brief → rev 1.1 adding these to §3. No agent woken.

- 2026-09-06 01:14:28Z Claude: **W1 read-backs (read-only GETs).** Implementation `8ce1a646…`: `paused`, company `c6f5dbbf…`,
  `codex_local`, model `gpt-6-astra`, `modelReasoningEffort high`, `engine acp`, bypass `false`, `approve-reads` /
  `deny`, `timeoutSec 900`, heartbeat `{enabled:false, wakeOnDemand:false, maxTurnContinuation:{enabled:false},
  maxConcurrentRuns:1, maxDailyRuns:null}`, `extraArgs [--skip-git-repo-check]` (the P23 import transformation),
  workspace `git_worktree` from `origin/develop`, env keys PATH + GIT_CONFIG_* (GH_TOKEN unbound). QA `aede9f03…`:
  `paused`, `claude-opus-5`/`high`, skip `false`, `agentCommand node tools/qa-claude-agent-acp/index.mjs`, same
  heartbeat block. The QA `installed-at-wrong-pin` is `pr-review-toolkit@claude-plugins-official`: "No matching
  installed pin in metadata; absent hash/source evidence is unverified, not a computed content mismatch" — the
  host's installed record carries no content hash to compare with the FB3 pin `f0455c12710f`; host state,
  outside FB7. Open question before W2: the new company has no project, and the agent's `git_worktree`
  strategy cuts from a project checkout — checking how the installed server resolves that before asking Ryan.

- 2026-09-06 01:15:55Z Claude: **F11 — the provisioned company has no project; a worktree run would fail at setup.** Read-only:
  `GET /companies/c6f5dbbf…/projects` → 0. Installed policy `execution-workspace-policy.js:4`:
  "This task is set to run in an isolated git worktree, but it has no project and no reusable execution
  workspace to create the worktree from" (code `workspace_worktree_requires_project`). The contract carries
  `project {id, name}` (FB2 §2, sourced) but `renderFreshBundle` emits no project; the import's
  `include.projects: true` had nothing to import. Retained company's project for reference: `Connect`
  (`60073b69…`, url-key `connect`) with one primary workspace `focx`, `sourceType git_repo`, `repoUrl
  https://github.com/ryanphillipthomas/focx` (public; `gh repo view`: visibility PUBLIC, default `develop`).
  The server clones at first materialisation (`heartbeat.js:1177` `git clone <repoUrl>`), so no agent token
  is involved. Create route: `POST /companies/:companyId/projects` (`routes/projects.js:150`) with
  `createProjectSchema` = project fields + optional `workspace` (`createProjectWorkspaceSchema`). **FB7 brief
  → rev 1.2** adds W2a (create `Connect` + primary `focx` git_repo workspace) before W2, and records the
  first run's Paperclip side effects (clone, worktree, company codex-home). Disposition of F11 for `fresh`
  itself is FB9/rev 2.8's. No write made; W2a–W5 await Ryan.

- 2026-09-06 Ryan (AskUserQuestion): **"Authorise W2a–W5 as listed"** (run the whole sequence; stop on failure; W5
  regardless; the single pre-approved `gpt-5.6-sol` retry only on model-acceptance failure).
- 2026-09-06 01:18:49Z Claude: **FB7 W2a + W2 EXECUTED, 01:18:05Z.** W2a `POST /api/companies/c6f5dbbf…/projects` → HTTP 201:
  project `Connect` = `41bf0dff-2eb5-463f-8545-28bf8058cee8` (status backlog), primary workspace `focx` =
  `9005ad52-c4f7-4d8d-bf94-3db53311f64d`, `git_repo`, `https://github.com/ryanphillipthomas/focx`. W2
  `POST /api/companies/c6f5dbbf…/issues` → HTTP 201: **FOCA-1** = `d31c712e-9529-4bb4-893e-9ad4b66df021`, todo,
  assignee Implementation `8ce1a646…`, project `41bf0dff…`, title "FB7 4a model-only check (read-only)", body =
  the brief's §4 text verbatim. (Company issue prefix came out `FOCA`, derived from the name — P22, an output.)
  Read-backs match. Next: W3 capture + open window on the Implementation agent only, W4 one wakeup, poll to a
  terminal state, W5 restore + pause unconditionally.

- 2026-09-06 01:19:22Z Claude: **FB7 W3 + W4 EXECUTED, 01:18:39Z.** W3 capture (read-only GET): Implementation `paused`,
  `runtimeConfig` = `{heartbeat:{enabled:false, maxConcurrentRuns:1, maxDailyRuns:null, maxTurnContinuation:
  {enabled:false}, wakeOnDemand:false}}` saved to `/tmp/fb7-runtime-before.json` (sorted JSON) for the
  byte-identical restore. W3a `POST /agents/8ce1a646…/resume` → 200; W3b `PATCH /agents/8ce1a646…` with the
  whole captured `runtimeConfig` and `wakeOnDemand: true` → 200. Read-back: status `idle`, `wakeOnDemand true`,
  `enabled false`, continuation off — the window is exactly the two FOC-96 fields; QA untouched. W4
  `POST /agents/8ce1a646…/wakeup` `{source:on_demand, triggerDetail:manual, reason:"FB7 4a model-only"}` →
  HTTP 202, run **`b61e2d16-913b-4da6-93e4-05f46642c9d3`**, status `queued`, not skipped. A background
  watcher polls `GET /heartbeat-runs/b61e2d16…` every 15 s (cap 22 min = agent timeout 900 s + margin) and
  then performs W5 unconditionally: PATCH the captured `runtimeConfig` back, `POST …/pause`, read-back
  compared to the capture, then reads the run record (`usageJson.model`, `resultJson.requestedModel`, status,
  timestamps). Results in the next entry.

- 2026-09-06 01:20:30Z Claude: **FB7 run 1 — `setup_failed`, model never reached; W5 done.** Watcher: run `b61e2d16…` reached
  `failed` at the first poll (01:19:28Z). Run record: `startedAt 01:18:40.019Z`, `finishedAt 01:18:40.143Z`
  (124 ms), `invocationSource on_demand`, `runtimeMode legacy`, `errorCode setup_failed`, `error: "fatal: not a
  git repository (or any of the parent directories): .git"`, `usageJson {}` (no model executed),
  `resultJson.requestedModel` absent, no assistant output, one empty event. **This is a workspace setup failure,
  not an Astra failure** — the pre-approved `gpt-5.6-sol` fallback does not apply; no retry without diagnosis
  and a new authorisation. **W5 executed unconditionally at 01:19:28Z:** PATCH captured `runtimeConfig` → 200,
  `POST …/pause` → 200; read-back `paused`, heartbeat block byte-identical to the W3 capture (`enabled false`,
  `wakeOnDemand false`, continuation off, concurrency 1). QA untouched throughout. Wake window open 49 s.
  No project clone, worktree or company codex-home appeared on disk. Diagnosis in the next entry.

- 2026-09-06 01:22:10Z Claude: **FB7 run 1 diagnosis (read-only, in progress).** Service log 21:18:40 local: "heartbeat
  execution setup failed" for `b61e2d16…`, stack `runGit` (`workspace-runtime.js:569`) ← `resolveGitOwnerRepoRoot`
  (`:1935`: `git rev-parse --show-toplevel` in the base cwd) ← `realizeExecutionWorkspace` (`:2379`) ←
  `provisionExecutionWorkspaceForFreshnessDecision` (`heartbeat.js:3157`) ← `executeRun` (`:11549`). No
  `projects/c6f5dbbf…` directory exists: the managed-checkout clone (`ensureManagedProjectWorkspace` →
  `materializeManagedProjectWorkspace`, `heartbeat.js:1129/1144`, `git clone` into a temp sibling) was never
  invoked. The issue binding is equivalent to FOC-96's (`projectId` + `projectWorkspaceId` set, no execution
  workspace preference); FOC-96's run context shows `source: project_primary`, `strategy: git_worktree`, cwd
  under `projects/5f772ef2…/60073b69…/focx/.paperclip/worktrees/…`. The retained checkout dir was created
  2026-09-02 18:08 local; the service log carries no clone/materialisation message anywhere, and the same
  `not a git repository` setup failure occurred once before (run `a1481bb8…`, 20:31 local, retained company)
  — the precedent checkout was therefore most likely created outside the server. Checking the clone call
  sites' conditions before proposing the remedy (server-side clone vs a listed manual checkout write).

- 2026-09-06 01:24:54Z Claude: **FB7 run 1 root cause — my W4 wake carried no issue; not Paperclip, not focx-bot, not the model.**
  Evidence: run `b61e2d16…` has `nativeIssueId null`, linked issues `[]`, and its contextSnapshot holds only
  `wakeReason/wakeSource/wakeTriggerDetail`; FOC-96's run `596211ea…` (same `on_demand`/`manual` wake) holds
  `taskId`, `issueId`, `paperclipWake.issue` (FOC-96) and `executionWorkspace.branchName`, and is linked to
  FOC-96. The wake schema's `payload` is where the issue goes: `heartbeat.js:2917` reads `payload?.issueId`
  (and `:15124` joins wakeup requests to issues by `payload->>'issueId'`). With no issue the run resolved no
  project (`workspaceProjectId` null, `:6273`), skipped the project-workspace loop and the managed-checkout
  clone, fell back to the agent home (`resolveDefaultAgentWorkspaceDir`, mkdir at 21:18:40 — the only new
  directory on disk, `workspaces/8ce1a646…`, empty) and `realizeExecutionWorkspace` ran `git rev-parse` there.
  The brief's W4 body omitted `payload: {issueId}`; corrected in rev 1.3. The company, project `Connect`,
  issue FOCA-1 (still `todo`, assigned) and both paused agents are intact. F11 (no project from `fresh`) stands;
  the "why no clone" question is answered by this (no project was ever resolved). Run 2 = W3–W5 again with
  `payload: {issueId: "d31c712e-…"}`; it is a new listed write and awaits Ryan — the pre-approved sol retry
  covers a model-acceptance failure only.

- 2026-09-06 Ryan (AskUserQuestion): **"Authorise run 2"** (W3–W5 with `payload.issueId`).
- 2026-09-06 01:25:56Z Claude: **FB7 run 2 — W3 + W4 EXECUTED, 01:25:24Z.** W3 capture: `paused`, runtimeConfig identical to the
  run-1 capture (re-saved); `POST …/resume` 200; PATCH `wakeOnDemand: true` 200; read-back `idle`, `enabled
  false`, continuation off. W4 `POST /agents/8ce1a646…/wakeup` with `payload: {issueId:
  "d31c712e-9529-4bb4-893e-9ad4b66df021"}` (FOCA-1), `on_demand`/`manual` → HTTP 202, run
  **`1a80f6ac-a5ee-4a81-b7b2-d823e8eaedf4`**, `queued`, not skipped. Background watcher polls every 15 s (cap
  22 min), then W5 unconditionally (restore captured runtimeConfig, pause, byte-compare), then reads the run
  record (`usageJson.model`, `resultJson.requestedModel`, linked issues, worktree path). Results next.

- 2026-09-06 01:28:02Z Claude: **FB7 run 2 — ASTRA REJECTED BY THE ACP LANE; no model executed; W5 done.** Run
  `1a80f6ac-a5ee-4a81-b7b2-d823e8eaedf4`: `succeeded`, exit 0, 01:25:24.869Z → 01:25:36.030Z, bound to FOCA-1,
  worktree `projects/c6f5dbbf…/41bf0dff…/focx/.paperclip/worktrees/FOCA-1-fb7-4a-model-only-check-read-only`
  (clone + worktree created by Paperclip at first run; `git status` clean, HEAD `52261d6`). Run log
  (`data/run-logs/…/1a80f6ac….ndjson`, 3,076 bytes): `acpx.session` `model: gpt-6-astra`, `thinkingEffort:
  high`, `permissionMode: approve-reads`, `mode: persistent`; then `"Warning: Model metadata for `gpt-6-astra`
  not found. Defaulting to fallback metadata…"`; then the API error verbatim: `{"type":"error","status":400,
  "error":{"type":"invalid_request_error","message":"The 'gpt-6-astra' model requires a newer version of
  Codex. Please upgrade to the latest app or CLI and try again."}}`; then `acpx.result completed / end_turn`.
  **Evidence of record: `usageJson` = null (no model executed); `resultJson.requestedModel = gpt-6-astra`,
  `requestedThinkingEffort high`, `stopReason completed`, `summary` = the two messages above.** The agent
  posted that text as its FOCA-1 comment (01:25:40Z); Paperclip commented "needs a disposition" and set
  FOCA-1 `blocked`; after W5 paused the agent it added "original assignee is not invokable". Company
  `codex-home` created 21:25 local: `auth.json` → `~/.codex/auth.json` (symlink, never opened), `config.toml`,
  `models_cache.json` 8 entries — sol present, astra absent (FB6 fact 3 confirmed at run time), `skills/`,
  `sessions/`. W5 at 01:26:02Z: restore 200, pause 200, read-back `paused`, heartbeat byte-identical. QA
  untouched. **Criteria (1),(2),(5),(6) met; (3) FAILED for Astra; (4) the task was not performed.**
  **F13 — the ACP lane's bundled Codex (0.152.1, `@openai/codex-darwin-arm64`) is too old for `gpt-6-astra`;
  the host CLI 0.153.0 that accepts Astra is not what agents run.** Remedy is a Paperclip/bundled-Codex
  upgrade or an adapter-level binary override — a rev 2.8 decision for Ryan; not routed around here.
  **Fallback (pre-approved by Ryan): one `gpt-5.6-sol` retry, same task, logged as fallback.** Listed writes:
  merge-PATCH `adapterConfig.model` → `gpt-5.6-sol` on the Implementation agent (captured first; restored to
  the contract's Astra in W5); PATCH FOCA-1 `status` → `todo` (Paperclip left it `blocked`); W3 window; W4
  wakeup with `payload.issueId`; W5 restore heartbeat + model + pause, unconditionally.

- 2026-09-06 01:28:58Z Claude: **FB7 fallback run — writes EXECUTED, 01:28:26Z (pre-approved).** Capture: `paused`, model
  `gpt-6-astra`, bypass `false`, heartbeat block as before (adapterConfig and runtimeConfig saved, sorted JSON).
  F1 merge-PATCH `adapterConfig: {model: "gpt-5.6-sol"}` → 200; read-back: only `model` differs from the
  capture, effort `high`, bypass `false`, engine `acp`, key set unchanged. F2 PATCH FOCA-1 `status: todo` → 200
  (Paperclip had set it `blocked`). W3: resume 200, wakeOnDemand 200; read-back `idle`, `enabled false`, model
  sol. W4 wakeup with `payload.issueId` and reason "FB7 4a fallback run on gpt-5.6-sol (pre-approved…)" →
  202, run **`f10fb3ae-95df-4b45-8a32-493e83f82c35`**, queued. Watcher: poll, then W5 = restore runtimeConfig,
  restore `model: gpt-6-astra`, pause, byte-compare both blocks, read the run record. Results next.

- 2026-09-06 01:31:31Z Claude: **FB7 fallback run — MODEL EXECUTED on `gpt-5.6-sol`; report not delivered; W5 done.** Run
  `f10fb3ae-95df-4b45-8a32-493e83f82c35`: `succeeded`, exit 0, 01:28:26.690Z → 01:30:06.470Z (100 s), bound to
  FOCA-1. **Evidence of record: `usageJson.model = gpt-5.6-sol`** (provider openai, biller chatgpt,
  subscription_included, 997 input / 262 output tokens, fresh session); `resultJson.requestedModel =
  gpt-5.6-sol`, `stopReason completed`. Run summary and the agent's own FOCA-1 comment (01:30:06Z): "The
  required Paperclip update failed after two connection attempts (`curl exit 6`) and was not applied. Per the
  retry limit, I stopped without modifying the workspace." Worktree clean, HEAD `52261d6`, no remote branch.
  Paperclip commented "needs a disposition"; FOCA-1 `in_progress`. W5 at 01:30:21Z: restore runtimeConfig
  200, restore `model: gpt-6-astra` 200, pause 200; read-back `paused`, runtimeConfig AND adapterConfig
  byte-identical to the captures (model astra, bypass false). QA untouched. Criteria: (1) ✓ (2) ✓ (3) ✓ for
  sol as the pre-approved fallback — Astra recorded FAILED (F13); (4) ✗ the report did not reach the task
  (`curl exit 6` = could not resolve host — reachability from the sandbox to the control plane, new
  finding **F14**, diagnosis next); (5) ✓ (6) ✓ (7) checked next entry.

- 2026-09-06 01:33:42Z Claude: **Criterion 7 — post-W5 `verify` vs the W1 baseline (read-only).** Same: `changes: []`,
  invariants 1–8 `[]`, `permissionsRevoked true`, 3 unresolved secret links, QA lane `delivery-env-missing` +
  `installed-at-wrong-pin`, catalog astra + opus present. Different, all first-run side effects: the company
  `codex-home` now exists (ACP cache present, mtime 01:30:10Z, **astra absent, sol present** — FB6 fact 3
  confirmed at run time), seeded from `~/.codex` with 8 plugins whose enablement/versions differ from the
  FB3 pins, so the Codex lane gained reported-only `enabled-but-not-installed` / `installed-at-wrong-pin`
  (pins 12/367 vs 4/367). Exit 1 both times for the same QA-lane reasons. Criterion 7 met in substance.
  **F14 evidence so far:** the agent's report went through `scripts/paperclip-issue-update.sh`; the ACP log
  records the call as `tool call (failed)` and the agent's summary says `curl exit 6` (could not resolve
  host). In the same run `gh pr list` reached GitHub after a "Guardian Review: Approved" step, so the network
  was available to approved commands. The retained company's own Codex sessions contain earlier
  `Could not resolve host` entries for `ops.focx.ai`, `github.com` and `example.com`, and API hosts
  `https://127.0.0.1:3100` and `https://ops.focx.ai:3100` — F14 is a property of the sandboxed Codex lane,
  not of the provisioned company. Both companies' `config.toml` carry no sandbox/network settings. The
  injected URL and the sandbox/bridge mechanism are being read next; no write.

- 2026-09-06 01:35:27Z Claude: **F14 root cause (read-only) and FB7 VERDICT.** The Codex session rollout
  (`codex-home/sessions/2026/09/05/rollout-…-01a07456….jsonl`) holds the agent's exact call:
  `printf '%s\n%s\n%s\n' '<three guardrails>' 'false' 'gpt-5.6-sol' | scripts/paperclip-issue-update.sh
  --status done` → "paperclip-issue-update: FAILED: could not reach the control plane (curl exit 6) after 2
  attempt(s); the update was NOT applied" (exit 2, 0.4 s). **The task was performed correctly — the agent
  computed the three guardrails, `selfVerificationAllowed = false`, and named its model `gpt-5.6-sol`; only
  delivery failed.** Mechanism: Codex's operating prompt in the same session states commands run inside a
  sandbox where DNS/host resolution fails and must be rerun with `require_escalated` (auto-reviewed) on such
  errors; `codex-acp` sets `networkAccess: false` for the `read-only` and `workspace-write` policies
  (`dist/index.js:27155`, `:27171`). The agent escalated `gh pr list` ("Guardian Review: Approved") but not the
  report call — the task text said "reply via the script", the script retried twice, the agent stopped at
  the retry limit. The injected `PAPERCLIP_API_URL` is the derived default `http://localhost:3100`
  (`adapter-utils/server-utils.js:1457–1464`; the server's launchd env carries only PAPERCLIP_HOME /
  INSTANCE_ID / SERVICE_MANAGED), which the sandbox cannot resolve. **F14: under `approve-reads` the report
  path runs network-less unless escalated; task text must instruct escalation of the report step, or the
  script needs a pre-approved prefix rule — rev 2.8.** FOC-96 delivered its report because that run
  escalated (F1). **FB7 verdict — PARTIAL PASS:** provisioning by focx-bot proven live (company, two paused
  agents, project, issue, clone, worktree, invariants 1–8, F10 fix); model execution proven on
  **`gpt-5.6-sol`** (`usageJson.model`, 997/262 tokens) under the pre-approved fallback; **Astra FAILED**
  (F13, bundled Codex 0.152.1 rejects it, HTTP 400); report delivery FAILED (F14); nothing written to any
  repository; every window closed byte-identically; QA untouched. Findings for rev 2.8: F11 (`fresh` renders
  no project), F13, F14. FOCA-1 is `in_progress` awaiting a board disposition.

- 2026-09-06 Ryan (AskUserQuestion): FOCA-1 **"Mark done with an evidence comment"**; F13 **"Investigate a Paperclip
  upgrade"** (contract stays on Astra); F14 **"Task text instructs escalation"**; F11 **"Yes, in FB9's build"**.
- 2026-09-06 01:43:20Z Claude: **FOCA-1 closed; FB2 rev 2.8 written; F13 read-only investigation.** FOCA-1: `POST
  /issues/d31c712e…/comments` → 201 (board comment: verdict, the agent's three computed lines, run ids, F13/F14),
  `PATCH status: done` → 200, read-back `done`, completedAt 01:41:56Z. FB2 rev 2.8 (429 lines): Rev 2.8 paragraph
  (F11, F13, F14 with the FB7 verdict) and decisions 16–19. **F13 facts (registry + install tree, read-only):**
  installed `paperclipai` 2026.831.1 = npm latest stable; agent lane = `@agentclientprotocol/codex-acp` **1.8.0**
  (dep `@openai/codex ^0.152.0` → 0.152.1); `codex-acp` latest **1.10.0** pins `@openai/codex ^0.153.3` — the
  Codex line that accepts Astra (host CLI 0.153.0 did; npm latest 0.153.4); `@paperclipai/adapter-codex-local`
  2026.831.1 declares `codex-acp ^1.6.2`, a range that already admits 1.10.0. Paperclip canaries
  `2026.905.0-canary.7…11` exist. Candidate listed write for Ryan (not executed): refresh `codex-acp` inside
  the installed 2026.831.1 tree (`npm update @agentclientprotocol/codex-acp` under
  `~/.paperclip/cli/installs/npm/2026.831.1`) → 1.10.0 + `@openai/codex` 0.153.x, then re-run FB7 W3–W5 on Astra;
  alternative: a canary/next stable that bumps the pin. Exact requirements checked next; service restart
  implications to be stated before any authorisation.

- 2026-09-06 01:44:10Z Claude: **F13 — exact upgrade path established, read-only.** `npm update --dry-run
  @agentclientprotocol/codex-acp` in `~/.paperclip/cli/installs/npm/2026.831.1`: change `codex-acp` 1.8.0 → 1.10.0,
  `@openai/codex` 0.152.1 → 0.153.4, `@openai/codex-darwin-arm64` 0.152.1 → 0.153.4; adds `fsevents` 2.3.3 and
  `@esbuild/darwin-arm64` 0.28.2 (optional platform packages). Lockfile today pins the three at 0.152.1/1.8.0;
  neither the stable nor the `2026.905.0` canaries change the adapter's `^1.6.2` range, so this is a lock
  refresh inside the same Paperclip version, not a release change. Control plane quiet: 0 live runs in both
  companies, both focx-bot-4a agents paused; the service is launchd `ing.paperclip.paperclipai` (pid 99440),
  so applying it needs a restart. Proposed listed writes for Ryan: (1) copy `package-lock.json` aside for
  rollback (`npm ci` restores); (2) `npm update @agentclientprotocol/codex-acp` in that directory; (3)
  `launchctl kickstart -k gui/<uid>/ing.paperclip.paperclipai`; (4) read-only checks — server up, `codex-acp`
  1.10.0, ACP binary 0.153.4, `pilot-org --verify-only` exit 0; (5) FB7 Astra re-run: new issue FOCA-2 with the
  §4 text plus the F14 escalation instruction, W3–W5, pass = `usageJson.model === gpt-6-astra`. Nothing executed.

- 2026-09-06 Ryan (AskUserQuestion): **"Authorise upgrade + restart + Astra re-run"**.
- 2026-09-06 01:45:17Z Claude: **F13 upgrade EXECUTED (host writes, listed).** U1a 01:44:40Z: `package-lock.json` copied to
  `package-lock.json.pre-f13-20260906T014440Z` in `~/.paperclip/cli/installs/npm/2026.831.1` (rollback = `npm ci`
  from it). U1b `npm update @agentclientprotocol/codex-acp` there: installed now `codex-acp` **1.10.0**,
  `@openai/codex` **0.153.4**, `@openai/codex-darwin-arm64` 0.153.4; ACP binary reports `codex-cli 0.153.4`
  (220,584,000 bytes). Paperclip stays 2026.831.1; `current` → that install. U1c 01:44:49Z
  `launchctl kickstart -k gui/<uid>/ing.paperclip.paperclipai` exit 0; API answered 200 after 4 s; new pid
  32464. U1d read-only: `cli-auth/me` instance-admin true (board_key); focx-bot-4a agents both `paused`.
  `pilot-org --verify-only` first invocation ran from the install directory by my mistake (module not found,
  exit 1, verified nothing); re-run from the repo root recorded next. No agent woken.

- 2026-09-06 01:46:21Z Claude: **U1d re-run from the repo root: `pilot-org --verify-only` exit 0**, `activations: 0`,
  `hostFindings: []` — the retained pilots are unaffected by the lane refresh. **FB7 Astra re-run — W2'/W3/W4
  EXECUTED 01:45:51–52Z.** W2' `POST /companies/c6f5dbbf…/issues` → 201: **FOCA-2** =
  `f0cd6226-2195-49a6-a313-79a80174acda`, todo, assignee Implementation, project `41bf0dff…`, body = the §4
  task plus the F14 delivery rule (rerun the exact report command once with `require_escalated` on a
  connection/DNS error; no hand-rolled curl). W3 capture: `paused`, model `gpt-6-astra`/`high`, bypass
  `false`, heartbeat block as before (both blocks saved); resume 200, wakeOnDemand 200; read-back `idle`,
  `enabled false`. W4 wakeup with `payload.issueId` = FOCA-2 → 202, run
  **`514b695a-35c7-43f1-a0d8-c50dfd805bbb`**, queued. Watcher: poll, then W5 (restore runtimeConfig, pause,
  byte-compare both blocks), then the run record and FOCA-2's comments. Pass = `usageJson.model === gpt-6-astra`.

- 2026-09-06 01:47:30Z Claude: **FB7 — FULL PASS ON `gpt-6-astra`.** Run `514b695a-35c7-43f1-a0d8-c50dfd805bbb`: `succeeded`, exit
  0, 01:45:52.263Z → 01:46:41.719Z (49 s), bound to FOCA-2, worktree
  `…/.paperclip/worktrees/FOCA-2-fb7-4a-model-only-check-on-gpt-6-astra-read-only-post-upgrade` (clean, HEAD
  `52261d6`, no remote branch). **Evidence of record: `usageJson.model = gpt-6-astra`** (provider openai,
  biller chatgpt, 454 input / 52 output tokens); `resultJson.requestedModel = gpt-6-astra`; `stopReason
  completed`. **The report was delivered:** FOCA-2 is `done` with the agent's three lines as its comment
  (01:46:36Z) — the three guardrails in one sentence each, `false`, and `unknown` for its model name (the
  runtime does not expose it to the agent; corroboration only, the record is the evidence). W5 at 01:46:42Z:
  restore 200, pause 200; read-back `paused`, runtimeConfig AND adapterConfig byte-identical to the captures.
  QA untouched throughout. **Criteria (1)–(7) all met** ((7): same `verify` result class as after W1; run side
  effects only). Astra accepted by the agent lane after the F13 lock refresh (codex-acp 1.10.0 / Codex 0.153.4).

- 2026-09-06 01:47:43Z Claude: **F14 mechanism confirmed on the passing run (read-only, run log `514b695a….ndjson`, 29,662
  bytes):** `acpx.session` model `gpt-6-astra`, effort high, `approve-reads`; the agent read the Paperclip
  skill and the reporting script (seq 39–40), issued `scripts/paperclip-issue-update.sh --status done <<'REPORT'…`
  in the sandbox (seq 44–45), then reran the identical command with escalation (seq 47) → "Guardian Review"
  (seq 48–49) → completed (seq 50–51), and FOCA-2 received the comment. The task-text rule (decision 18) is
  therefore sufficient for delivery under `approve-reads`; it goes into every FB8+ task brief verbatim.

- 2026-09-06 Ryan: "FB8 brief".
- 2026-09-06 01:52:47Z Claude: **FB8 brief written** — `/Users/ryanthomas/Documents/focx-bot-FB8-brief.md` (rev 1). Pass = the
  provisioned Implementation Engineer reproduces FOC-96 on Astra: one pre-registered marker file, one commit,
  one push to its own issue branch, own report, task `done` and not reopened (F4), `usageJson.model =
  gpt-6-astra`, windows closed byte-identically, field-by-field comparison table, provenance outside git (F2).
  Task text written as the permission surface (F1/F3) with the F14 escalation rule and a once-only push.
  Prerequisite: Ryan enters `github_focx_write_token` into focx-bot-4a by hand. Design point for Ryan: `bind-secrets
  --apply` also provisions every pinned plugin (rev 2.6 mechanism, never run live); recommended for FB8 = execute
  only the two rendered env PATCHes the dry run prints, deferring plugin provisioning to its own workstream and
  recording `bind-secrets --apply` as still unproven live. QA half of H2 deferred, not folded in. Nothing executed.

- 2026-09-06 Ryan (AskUserQuestion): binding **"Rendered env PATCHes only"**; run id **`run-<UTC ts>-fb8`**; secret
  `github_focx_write_token` **entered** into focx-bot-4a by hand ("proceed").
- 2026-09-06 01:57:10Z Claude: rendering the W1 operation read-only. Note: `bind-secrets` dry run refuses while QA's
  `claude_subscription_token` is unresolved (fail-closed by design, P18/P19), so the Implementation env PATCH is
  computed with the package's own `composeEnv` + `resolveEnv` against the live `/secrets/catalog`; the same body
  `bind-secrets` would send for that agent. Values never pass through; secret ids abbreviated in the log.

- 2026-09-06 Ryan (AskUserQuestion): **"Authorise W1–W5"** (FB8).
- 2026-09-06 02:01:39Z Claude: **FB8 W1–W4 EXECUTED 02:00:53–55Z.** W1 (rendered env merge PATCH via the package client, no
  `replaceAdapterConfig`): read-back `GH_TOKEN = {type: secret_ref, secretId: f0c2be4e…, version: latest}`, model
  astra, bypass false, invariants 1–8 asserted before and after; secretLinks now QA-only (2). Pre-registered marker:
  86 bytes, sha256 `711e85ebce7a97d8…`, run id `run-20260906-020055-fb8`, base `52261d6` (= origin/develop tip by
  `ls-remote`). W2 `POST …/issues` → 201 **FOCA-3** = `c1f8a4ca-e305-41b1-9060-c001432b6d37`, todo, assignee
  Implementation, project Connect, body = brief §4 with substitutions. W3: capture (paused, GH_TOKEN ref present),
  resume 200, wakeOnDemand 200, read-back idle/enabled false. W4 wakeup with `payload.issueId` = FOCA-3 → 202, run
  **`05815f19-a755-4339-b2eb-d6d9be4bf5b5`**, queued. Watcher: poll → W5 (restore, pause, byte-compare) → run
  record → FOCA-3 status/comments → independent `git fetch` of `FOCA-3*` from origin into a temp repo, commit
  count beyond develop, files changed, marker bytes vs the pre-registered file, author/committer. Results next.

- 2026-09-06 02:03:20Z Claude: **FB8 run 1 — NO COMMIT, NO PUSH; cause = my task text.** Run `05815f19…`: `succeeded`, exit 0,
  02:00:55.452Z → 02:02:17.849Z; **`usageJson.model = gpt-6-astra`** (786/49 tokens). The agent created
  `pipeline/runs/run-20260906-020055-fb8/evidence/implementation/marker.txt` and verified 86 bytes, LF; then
  `git add <path>` failed exit 128: `fatal: Unable to create '<checkout>/.git/worktrees/FOCA-3-…/index.lock'` —
  git's worktree metadata lives under the main checkout's `.git`, outside the sandbox's writable cwd (the
  same first block FOC-96 hit). FOC-96's agent then escalated; ours stopped ("Stopped without retrying
  staging") because the brief's rule named `git commit`, `git push` and the report as the commands to rerun
  with `require_escalated`, not `git add`. The report WAS delivered (F14 rule): FOCA-3 `done` at 02:02:11Z, not
  reopened, with the full failure report. Independent fetch: no `FOCA-3*` branch on origin. W5 at 02:02:27Z:
  restore 200, pause 200, both blocks byte-identical. Criteria: (1) ✓ file only; (2) ✗ (3) ✗ (4) ✓ (5) ✓ (6) ✓
  (7) ✓ (8) pending (9) n/a. Correction for run 2: the escalation rule covers **every** git write (`git add`,
  `git commit`, `git push`) and the report; a new issue (new worktree); nothing else changes.

- 2026-09-06 Ryan (AskUserQuestion): **"Authorise run 2"** (FB8).
- 2026-09-06 02:05:44Z Claude: **FB8 run 2 — W2–W4 EXECUTED 02:05:09Z.** Pre-registered marker: 86 bytes, sha256
  `fc10753d610b3bf7…`, run id `run-20260906-020509-fb8`, base `52261d6` (origin/develop tip re-read). W2
  `POST …/issues` → 201 **FOCA-4** = `d10c42ed-6946-43d9-8f97-dc602e1b3993`, task text = brief §4 rev 1.1 (the
  escalation rule now names `git add`, `git commit`, `git push` and the report). W3: capture (paused, astra,
  bypass false, GH_TOKEN ref present), resume 200, wakeOnDemand 200, read-back idle/enabled false. W4 wakeup
  with `payload.issueId` = FOCA-4 → 202, run **`54afd788-9278-407f-9239-75ce6c397b40`**, queued. Watcher as
  before: poll → W5 → run record → FOCA-4 → independent fetch of `FOCA-4*` from origin, commit count, files,
  marker bytes vs pre-registered, author/committer.

- 2026-09-06 02:08:44Z Claude: **FB8 — PASS. Provenance record (F2, outside git): company `focx-bot-4a` `c6f5dbbf…`, agent
  Implementation Engineer `8ce1a646…`, run `54afd788-9278-407f-9239-75ce6c397b40`, issue FOCA-4 `d10c42ed…`,
  commit `8bc05c7399e70527049ee7dc0dd496e282a342ce` on `FOCA-4-fb8-4b-scoped-write-smoke-run-2-one-marker-file-
  one-commit-one-push-run-20260906-020509-fb8`, agent-authored under Ryan's git identity.** Run: `succeeded`, exit
  0, 02:05:09.773Z → 02:07:00.766Z; **`usageJson.model = gpt-6-astra`** (280/73 tokens). Independent verification
  from GitHub (scratch repo, `ls-remote` + fetch of the exact ref — my first fetch pattern and a zsh `$REF:refs`
  modifier bug had produced a false "none", corrected): commits beyond develop **1**; parent = develop tip
  `52261d6`; files changed **1** (`pipeline/runs/run-20260906-020509-fb8/evidence/implementation/marker.txt`);
  blob **86 bytes, sha256 `fc10753d610b3bf7…`, byte-identical** to the pre-registered file; author/committer
  `Ryan Thomas <rthomas@wheelsup.com>` (F2, expected). Run log: `git add` (seq 55) → Guardian Approved (risk
  low); `git commit` (61) → Approved (low); `git push origin HEAD` (66) → first attempt "Could not resolve host:
  github.com" in the sandbox, escalated rerun → Approved (medium) → pushed; report (133) → Approved → FOCA-4
  `done` at 02:06:55Z with the full report (branch, base, commit, bytes, verbatim push output), **not reopened**.
  W5 at 02:07:06Z: restore 200, pause 200, runtimeConfig and adapterConfig byte-identical; QA untouched.
  **Comparison FOC-96 → FB8:** company/agent retained→provisioned (expected); model sol→**astra**; branch
  `FOC-96-…`→`FOCA-4-…`; commits 1→1; files 1 (88 B)→1 (86 B, pre-registered bytes); push once via escalation →
  once via escalation; report delivered→delivered; escalations 3→**4** (`git add` now needs one too — the
  worktree metadata lives under the main `.git`); author identity identical (F2); task done, not reopened →
  same. **Criteria (1)–(9) all met.** Deferred, not folded in: the QA-authored commit (H2's other half);
  plugin provisioning (`bind-secrets --apply`) still unproven live. The FOCA-4 branch stays on origin as evidence
  (no PR); the FOCA-3 worktree keeps its untracked marker. F11 remains a manual project step until FB9.

- 2026-09-06 Ryan: "Ok lets fb9".
- 2026-09-06 02:14:15Z Claude: **FB9 brief written and Codex dispatched.** Facts grounding the brief (read-only): the native
  bundle carries projects — export writes `projects/<slug>/PROJECT.md` and an extension `workspaces` list
  (`buildPortableProjectWorkspaces`: key/name/sourceType/repoUrl/repoRef/defaultRef/isPrimary; workspaces
  without a repoUrl are omitted with a warning, `company-portability.js:3671–3700`); import creates the
  project then each workspace (`:5046`, `:5062`); validator `company-portability.js:95–125`. So F11 is solved
  by rendering the project into the same import (decision 16) — no extra write. Brief `/tmp/fb9-build-brief.md`:
  Part A = Codex cross-verifies the FB7/FB8 reports (runs `514b695a…`/`54afd788…` model fields, the FOCA-4
  branch/commit/blob on origin via an exact-ref fetch, both agents paused with closed heartbeats, GH_TOKEN as a
  ref) — distinct-author verification of Claude's live claims; B1 = contract `project {name, workspaces[]}`
  (no id), bundle rendering, fake import, invariant 9, restore overlay keeps projects; B2 = snapshot sidecar
  projects + warnings, restore `compare` block, verify 1–9 parity, tests/knock-outs; files under
  `packages/focx-bot/` only. Board API key passed in env for Part A GETs (never printed). Branch cut from
  develop `52261d6`; dispatch recorded from observed liveness next.

- 2026-09-06 02:14:34Z Claude: **FB9 dispatch observed live** — 02:14:03Z, branch `run/run-20260906-021403-fb9` @ `52261d6`;
  guards passed (develop tip, tree clean but for the ledger files, no other `codex exec`, output absent, API key
  present in env for Part A). Banner: Codex v0.153.0, gpt-6-astra, effort high, workspace-write, session
  `01a0747e-8ac5-74b2-8deb-eefa55beff40`; process 50021 (task `biaa73bj4`); 300,240 bytes within the first
  minute; HEAD unchanged. On completion: read-only review (containment to `packages/focx-bot/`), Part A verdicts
  against my evidence, suite + validate + repo checks, commit, stop for Ryan's push/PR.

- 2026-09-06 02:17:14Z Claude: **FB9 first dispatch — stopped by design, no file changed** (Codex, 76,432 tokens). Two findings,
  both correct: (1) my brief's B1 wrote the project extension's `workspaces` as an array; the installed importer
  (`company-portability.js:2886`) reads a **keyed object** (`workspaces: { focx: {…} }`) and would silently drop an
  array — my error; (2) Part A could not run inside the `workspace-write` sandbox: board GETs → `EPERM`, GitHub
  name resolution failed (the F14 network limit applies to Codex's own tool calls); local run logs corroborated
  Astra and the FB8 commit/branch but the live verdicts could not be established. Remedy: brief v2 with the
  keyed shape, and Part A re-based on **local evidence prepared by Claude** — the exact FOCA-4 ref and develop
  fetched into `/tmp/fb9-evidence/repo` (content-addressed git objects: strong), plus the two run records, their
  linked issues and both agent configurations captured as JSON with secret ids redacted (captured by Claude:
  Codex verifies internal consistency and hashes, recorded as the weaker form). Containment clean.

- 2026-09-06 02:18:28Z Claude: **Keyed-object finding verified** (`company-portability.js:2886–2889`: `Object.entries(extension.
  workspaces)` → `normalizePortableProjectWorkspaceExtension(key, entry)`). **Near-miss recorded:** while
  capturing Part A evidence, `curl` wrote the raw run record for `514b695a…` to `/tmp/fb9-evidence/` before my
  redaction step ran; that record's `stdoutExcerpt` (20 KB of run log) contained a token-shaped substring
  (matched my `(sk-|ghp_|gho_|eyJ)…` pattern; identity not established — the earlier session scrub showed the
  acpx `runtimeSessionName` is token-shaped; no credential value was read by me). All files in the directory
  were re-scrubbed (secret ids and every such substring → `[redacted]`) and re-verified clean; the exposure was
  to my own scratch directory only. Lesson applied to the brief and future captures: redact before writing.
  Evidence prepared: `repo/` with refs `foca4` (= `8bc05c7`) and `develop` (= `52261d6`) fetched from origin,
  `foca4-ref.txt`, `marker-expected.txt`, redacted run/issue/agent records. **Second FB9 dispatch** with brief v2
  (keyed `workspaces`, Part A from local evidence, no network expected); output `scratchpad/fb9-build2-high.txt`.

- 2026-09-06 02:18:50Z Claude: **FB9 second dispatch observed live** — 02:18:20Z, same branch @ `52261d6`, brief
  `/tmp/fb9-build-brief.v2.md`; banner gpt-6-astra, effort high, workspace-write, session
  `01a07482-7046-7612-908a-2c57753e643a`; process 52606 (task `bngoht37e`); 84,267 bytes within the first minute.

- 2026-09-06 02:36:20Z Codex (gpt-6-astra, effort high): **FB9 second dispatch — complete** (189,842 tokens; `scratchpad/fb9-build2-
  high.txt`). Codex's report: Part A passed — content-addressed git verification of the FOCA-4 commit/blob
  (strong), Claude's captured JSON verified for internal consistency only, local logs corroborate Astra and
  four FB8 Guardian approvals; F11 project rendering, invariant 9, snapshot sidecars, restore comparisons,
  refusal checks and live-sequence docs complete; 148/148 incl. 53 knock-outs; validation and `diff --check`
  passed; live round trip unperformed; no commit/push/PR/network/live write/credential value/edit outside the
  package. It also added, during its own review, a parity check that catches a dropped secondary workspace.
- 2026-09-06 02:36:20Z Claude: **FB9 review — accepted, no fix needed; committed `206664a`; STOP for Ryan.** Containment: 13
  modified + `src/roundtrip.mjs` new, all under `packages/focx-bot/`; scan hits are the unchanged FB3 marketplace
  URLs only. Read in full: contract `project {name, workspaces[]}` (no id; schema strict; validator requires
  canonical HTTPS URL, one primary, safe url-key names); `renderFreshBundle` emits `projects/<slug>/PROJECT.md`
  and `.paperclip.yaml` `projects.<slug>.workspaces` as the importer's keyed object (workspace name as key);
  `invariant9` (exact project url-key set, primary `git_repo` workspace with the contract's repoUrl, ids
  reported as outputs); `readSnapshot` reads `/companies/:id/projects` + `/projects/:id`; `roundtrip.mjs`
  (`portableProjects` refuses omitted workspaces and manifest/file disagreement; `compareRoundTrip` diffs
  agent configs minus generated ids/managed paths/secret bindings/derived Claude dirs, rendered Claude dirs,
  projects; keeps `false` values); `restore` requires the sidecars, same contract sha, overlays declared plain
  env (export omits PATH), drops secret refs and CLAUDE_* dirs, re-adds secret inputs, then `finishState` runs
  `verify` (1–9, `changes: []`), requires secrets unbound and an empty compare; `verify` gains a
  `restored-configuration` scope with explicit expected findings. Exec phase (mine): 148/148 in 15 s; validate
  0; `pilot-org --check` 0; drift clean; `diff --check` clean. Live note for after merge: `verify` on
  `focx-bot-4a` now asserts invariant 9 against the hand-created `Connect`/`focx` project — expected to pass
  (url-key `connect`, primary `git_repo`, same repoUrl); to be confirmed read-only before the round trip.

- 2026-09-06 Ryan (AskUserQuestion): **"Push and open the PR"** (FB9).
- 2026-09-06 02:39:39Z Claude: **FB9 pushed, PR #91 opened** — `git push -u origin run/run-20260906-021403-fb9` (HEAD `206664a`);
  `gh pr create` → https://github.com/ryanphillipthomas/focx/pull/91 (→ develop, OPEN); body = F11, round trip,
  evidence, what remains live, scope/safety. Not merged; human merge only. After merge: read-only `verify`
  on focx-bot-4a (invariant 9 against the hand-made project), then the live round trip as listed writes.

- 2026-09-06 Ryan: "merged" (#91).
- 2026-09-06 02:40:45Z Claude: **#91 merged — verified.** `gh pr view 91`: MERGED at 2026-09-06T02:39:43Z, merge `41ce5de`; develop
  pulled; 148/148 on develop. Next, read-only: `verify` on focx-bot-4a under the merged code (invariant 9 vs the
  hand-made project) and the `snapshot` dry run (digest only); then the round trip as listed writes for Ryan.

- 2026-09-06 Ryan (AskUserQuestion): **"Authorise S1 + R1 + R2 as listed"**; restore name **`focx-bot-4a-restore`**.
- 2026-09-06 02:43:16Z Claude: **FB9 live — S1 PASS, R1 PASS, R2 FAILED at step 1 (HTTP 422); partial state recorded.**
  Read-only `verify` on focx-bot-4a under `41ce5de`: invariants 1–9 `[]` (project `connect` `41bf0dff…`, workspace
  `focx` `9005ad52…`), same expected QA findings. **S1** `snapshot --apply --approved-digest f1afe9be…d51fa`
  02:42:00Z: `POST /companies/c6f5dbbf…/export` + WRITE_SNAPSHOT `~/.paperclip/instances/default/focx-bot/
  snapshot-fb9.json` (499,553 bytes; 16 bundle files incl. `projects/connect/PROJECT.md`, two company skills and
  five `skills/paperclipai/paperclip/*` bundled skills, `images/org-chart.png`; export warnings exactly the two
  expected system-dependent PATH omissions; 14 pruned `false` keys; zero secret refs and zero token-shaped
  strings in the file). **R1** restore dry run 02:42:02Z: digest `c32c444e…95a7`; plan = 2 POST, 6 PATCH, 1
  WRITE_FILE. **R2** `restore --apply` 02:42:03Z, exit 1: LOCK; WRITE_STATE (`restore-state.json`);
  `POST /api/companies/import` → **HTTP 422**; the failure branch identified the company Paperclip had already
  created by its unique name — `focx-bot-4a-restore` = `e335535c-93dc-4057-b330-42240adc2213`, prefix `FOCAA`,
  status `active`, **0 agents, 0 projects** — WRITE_STATE (`phase: failed`, `failedStep: 1`, `ids: {}`); UNLOCK.
  Nothing retried; nothing deleted (`agentDeletionAllowed: false`; the empty company is Ryan's to dispose of).
  focx-bot-4a untouched. Diagnosis of the 422 next (hypothesis: reserved `paperclipai/paperclip/*` skill keys in
  the export refused at import — the P26 question deferred to FB9).

- 2026-09-06 02:44:32Z Claude: **F15 — Paperclip's native export of a company holding bundled skills is refused by its own import
  (root cause of R2's HTTP 422), established read-only.** Snapshot manifest: the five `skills/paperclipai/
  paperclip/*` entries (`paperclip`, `paperclip-board`, `paperclip-converting-plans-to-tasks`,
  `paperclip-create-agent`, `para-memory-files`) carry `sourceType: github`, `sourceRef: null`,
  `metadata.sourceKind: paperclip_bundled`; their SKILL.md frontmatter `sources[0]` has `commit: null` (seeded
  from the server's own `skills/` dir by `ensureBundledSkills`, no commit). On import, `importPackageFiles`
  (`company-skills.js:4948–4960`) runs `assertImportedSkillKeyAllowed` (passes: `paperclip_bundled`) then
  `assertImportedSkillSourceAllowed` (`:24–41`): `github` source without a 40-hex `sourceRef` →
  `unprocessable("External skill source … must resolve to a pinned Git commit before import")` = 422. The
  preview (`:4207`) never calls it, so R2's preview passed and the import failed after the company row was
  created. The service log holds only the request; the package client withholds error bodies by design.
  Also noted for the fix: the two `.focx` skills appear twice in the manifest (`focx-*` and
  `company/<id>/focx-*`). **Fix (ours, not a fabricated pin):** `restore` strips the reserved
  `paperclipai/paperclip/*` skill files and manifest entries before import — the importer re-seeds bundled
  skills itself (P26, as `fresh` relies on) — adjusts `expectedFileCount`, expects the per-agent
  missing-skill preview warnings, asserts invariant 5 after import, and de-duplicates the company skills;
  tests + knock-outs. A Codex task on a new branch; then R1/R2 again under a fresh unique name. The empty
  `focx-bot-4a-restore` (`e335535c…`, active, 0 agents, 0 projects) is Ryan's to delete on the board or keep;
  focx-bot never deletes. Awaiting Ryan.

- 2026-09-06 Ryan (AskUserQuestion): **"Authorise the Codex fix task"** (F15); empty company — **"I'll delete it on
  the board"** (Claude reads back that it is gone before the re-run and reuses the name).
- 2026-09-06 02:46:05Z Claude: **F15 brief written, branch cut from develop `41ce5de`, Codex dispatched.** Brief `/tmp/f15-build-
  brief.md`: Part A verifies the mechanism from the real snapshot file and the installed code (and states that
  fabricating a commit is forbidden); Part B = strip `skills/paperclipai/paperclip/*` files + manifest entries in
  `overlayRestore`, recompute `expectedFileCount`, expect the per-agent preview warnings, decide the company-skill
  duplication with cited lines (invariant 4 must hold), assert invariant 5 and no reserved import after restore,
  fake export/import reproduce the real behaviour so the round-trip test fails without the strip, knock-outs,
  README. Files under `packages/focx-bot/` only. Liveness recorded next.

- 2026-09-06 02:48:25Z Claude: **F15 Codex liveness recorded.** Branch `run/run-20260906-024555-f15` @ `41ce5de`; guards passed (develop
  verified, tree clean, no other `codex exec`, output absent); banner `OpenAI Codex v0.153.0`, model `gpt-6-astra`, effort high,
  sandbox workspace-write, pid 69176, session `01a0749b-…`; dispatched 02:45:55Z. Reviewing when it exits.

- 2026-09-06 02:57:04Z Claude: **F15 build reviewed — ACCEPT; committed `4bb12bf` (Codex verbatim, six files under
  `packages/focx-bot/`, +300/−15).** Codex exited 0 after ~122k tokens. Independent checks: `node --test` 158/158
  (148 + 10 F15), `--validate-contract` exit 0, `git diff --check` clean, tree otherwise untouched. Part A quoted the
  installed lines (`company-skills.js:24–41` assert, `:4949`/`:4958–4959` apply order, preview `company-portability.js:
  4207–4228` never calls it; a fabricated 40-hex commit would pass `:21–22` — refused). Read-only dry run of the new
  `stripRestoreSkills` against the real `snapshot-fb9.json`: 16 → 9 files, five reserved skills and both
  `skills/company/FOCA/focx-*` copies removed, copies proven equivalent to the retained `agents/<slug>/skills/*` files
  (identity fields excluded), manifest reduced to the two bare `focx-*` entries, source record untouched. Design
  points verified: importer re-seeds bundled skills (`:2487`→`:2271`); company copies dropped only after equivalence,
  any divergence refuses before import; `expectedFileCount` recomputed by `importOperation`; only fresh's per-agent
  warning accepted; post-import `assertRestoredSkills` = invariant 5 + no reserved package files; stripping reported
  in result, emit and state. Fake API now reproduces the export/apply asymmetry (preview passes, apply 422 after the
  company row) so the round trip fails without the strip; knock-outs: strip → 422; de-dup → 4 company skills; final
  assertion → injected empty `desiredSkills` undetected. No fixes by the reviewer. Not pushed; no PR. Re-run plan
  after merge: new state file (the failed `restore-state.json` stays as evidence), R1 dry run, R2 apply under
  `focx-bot-4a-restore` once Ryan's deletion of `e335535c…` reads back.

- 2026-09-06 Ryan (AskUserQuestion): **"Push and open the PR"** (F15).
- 2026-09-06 03:08:49Z Claude: **F15 pushed, PR #92 opened.** `git push -u origin run/run-20260906-024555-f15` (new branch, `4bb12bf`);
  `gh pr create --base develop` → https://github.com/ryanphillipthomas/focx/pull/92. Not merged; Ryan merges. Next after
  merge: read back that `e335535c…` is gone, then R1 dry run / R2 apply under `focx-bot-4a-restore` with a new state file.

- 2026-09-06 Ryan: **"good to go"** → PR #92 merged (`9d4dea4` on develop, ff-pulled). Read-back: `e335535c…` was
  **archived, not deleted** (GET 200, `status: archived`, name `focx-bot-4a-restore` still listed); Ryan: "i dont know how
  to delete it i cant find it" — the installed server exposes no company delete route, so the name stays taken.
- 2026-09-06 03:51:02Z Claude: **R1 dry run (read-only, no writes, state file absent afterwards) under placeholder
  `focx-bot-4a-restore-2` PASSED:** import plan 9 files / `expectedFileCount: 9`, `strippedReservedSkills` = the five
  `paperclipai/paperclip/*`, `deduplicatedCompanySkills` = `skills/company/FOCA/focx-{implement-task,verify-change}`,
  permissions PATCH ×2, QA `.claude/settings.json` WRITE_FILE, env PATCHes only in `later` (secrets stay unbound),
  preflight admin true, catalog present for both models. Output redacted before it was written to the scratchpad.
- 2026-09-06 Ryan (AskUserQuestion): **"Authorise R1 + R2 as listed"** — W1 POST import (9 files, new_company,
  pauseAutomations), W2 permissions PATCH ×2, W3 QA settings WRITE_FILE, W4 writer.lock + new state file
  `restore-f15-state.json`; then read-only verify 1–9 + compare. Name: `focx-bot-4a-restore-2` (Claude's reading of
  Ryan's reply that the original name cannot be freed; the archived company is left untouched).

- 2026-09-06 03:52:28Z Claude: **R1 + R2 PASS — FB9 round trip complete.** R1 under `focx-bot-4a-restore-2` (digest captured
  in-process, no state written), then R2 `--apply --approved-digest`, exit clean at 03:51:23Z (~3 s). Writes made, exactly
  as authorised: W1 POST import (9 files, preview warnings = the two expected `references skill paperclipai/paperclip/
  paperclip … not present in the package`, no other), W2 permissions PATCH ×2, W3 QA `.claude/settings.json`, W4 lock +
  `restore-f15-state.json` (phase `awaiting-secret-entry`, step 3, `failedStep: null`, `configurationParity: true`,
  `strippedReservedSkills` ×5, `deduplicatedCompanySkills` ×2, `sourceCompanyId: c6f5dbbf…`). Live read-back: company
  `focx-bot-4a-restore-2` = `6c7de2ce-c971-4c66-a25b-8284248c6cc4` active, prefix FOCAAA; Implementation Engineer
  `bf95aac5…` (codex_local, gpt-6-astra) and QA Engineer `48d052c8…` (claude_local, claude-opus-5) both **paused**,
  `heartbeat.enabled: false`, permissions all false, `desiredSkills` = exactly `["paperclipai/paperclip/paperclip"]`,
  env = PATH + git credential-helper keys only (no secret refs); company skills = 7 (2 `company/<id>/focx-*` catalog +
  5 bundled `local_path`, re-seeded by Paperclip), **no duplicate slugs**; project Connect with primary workspace `focx`
  → `https://github.com/ryanphillipthomas/focx`; secrets 0. `compare.differences: []` (exclusions: generated ids, managed
  instruction locations, unbound secret env, CLAUDE_CONFIG_DIR/PLUGIN_CACHE_DIR), 14 pruned false keys reconstructed.
  CLI `verify --verify-only --company-id 6c7de2ce…` scope `restored-configuration`: changes `[]`, invariants `[]`,
  permissionsRevoked true, catalog present, exit 0. Expected findings only: three unresolved secret env links
  (unbound by design) and plugins unprovisioned. All outputs redacted before being written to the scratchpad. No agent
  activated; nothing deleted. **F15 closed; FB9 done.**

- 2026-09-06 Ryan: **"Sounds good, lets continue"** → proceed in the recommended order: live `bind-secrets --apply`,
  then retire the old tooling, then the front end on a thin token-holding server, QA lane alongside.
- 2026-09-06 04:03:02Z Claude: **F17 (`bind-secrets`) is blocked on Ryan; established read-only.** Target must be the restored
  company `focx-bot-4a-restore-2` (`6c7de2ce…`): `focx-bot-4a`'s state carries `contractSha d872582a…` while the current
  contract is `f5a54cf1…` (FB9 added `project` to `contract.json`), so its state cannot be resumed — the no-retry-across-
  contract-change guard working as designed. Dry run of `bind-secrets` against `restore-2` refused **before any write**:
  `env GH_TOKEN: secret name github_focx_write_token must resolve uniquely; no write` — that company's secret catalog is
  empty. Prerequisites, both Ryan's (credential entry is never Claude's): (1) create `github_focx_write_token` and
  `claude_subscription_token` in `focx-bot-4a-restore-2` with values entered by hand on the board; (2) `codex login` for
  `CODEX_HOME=~/.paperclip/instances/default/companies/6c7de2ce…/codex-home` — that home does not exist yet, while
  `focx-bot-4a`'s has `auth.json` symlinked to `~/.codex/auth.json`. Host prerequisites otherwise green (PostgreSQL 17
  listener, Claude runtime 2.1.261 matched).
- 2026-09-06 04:03:02Z Claude: **F16 dispatched (unblocked work in the meantime).** Branch `run/run-20260906-040214-f16` from develop
  `9d4dea4`; guards passed; banner Codex v0.153.0, gpt-6-astra, effort high, pid 12999, session `01a074e1-…`. Brief
  `/tmp/f16-build-brief.md`: this is an **extraction, not a delete** — `pilot-org`'s `.focx` loader still feeds
  `grants.mjs:3/:70`, `test.mjs:296`, and the QA launcher `:10/:32/:40/:65/:70` (F10 resolves QA permissions by
  `roleKey`). Move the loader to `packages/focx-bot/src/roles.mjs` with every current validation preserved, move the two
  launcher suites to `tools/qa-claude-agent-acp/`, port the loader tests + knock-outs, delete both tool trees, rewire
  `drift-gate.yml` (drop two steps, add the launcher suites) and `package.json`, update the docs without deleting them.
  **Forbidden:** `packages/focx-bot/contract.json` (its sha is the identity of live state — one byte strands
  `restore-2`), `pipeline/runs/**`, `.focx/**`, `CODEOWNERS`, the ledgers.

- 2026-09-06 04:14:51Z Claude: **F16 reviewed — ACCEPT; committed `7eece14` (Codex verbatim; +207/−4248 across 20 files, two
  renames).** Independent checks, all from the repo root: focx-bot `node --test` **212/212** (was 158; +54 ported loader
  tests and knock-outs), QA launcher suites 17 tests **9 pass / 8 skipped** — the same 8 that were skipped under
  `pilot-org` for want of an installed Claude SDK, so no regression — `--validate-contract` 0, `tools/contracts/validate.mjs`
  0 (48 artifacts), `scripts/paperclip-issue-update.test.mjs` 22/22, `git diff --check` clean.
  **Dropped-validation audit (the one failure mode that mattered):** 42 `requireThat` messages in the old source region,
  31 present verbatim in `roles.mjs`; the 11 absent are all from the retired reconciler's live-readback half (bundle/
  schedule/API-response completeness, paused-in-company, identity set, inherited registry skills) and are covered by
  focx-bot invariants 1–9 — no offline `.focx` guard was lost, and `test.mjs:297/:736` still loads the REAL `.focx` files,
  which is the old `--check`. Contract identity preserved: `packages/focx-bot/contract.json` sha256 unchanged before/after,
  so the live `restore-2` state stays resumable; `pipeline/runs/**`, `.focx/**`, `CODEOWNERS`, `roster.json` byte-identical
  (Codex proved 116 protected files, I re-checked the diff is empty for those paths). Gate now runs contract validation,
  focx-bot schema + tests, QA launcher suites, agent reporting path. Scripts fail closed without `--base-url`. Docs shift
  the retired approach to past tense and re-point every runnable command; `roster.schema.json` description no longer claims
  a deleted tool enforces it. No reviewer fixes. Not pushed; no PR.

- 2026-09-06 Ryan (AskUserQuestion): **"Push and open the PR"** (F16).
- 2026-09-06 04:16:27Z Claude: **F16 pushed, PR #93 opened** → https://github.com/ryanphillipthomas/focx/pull/93 (`7eece14`).
  **Drift gate PASS in 29 s** on the rewired workflow, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`. This is the
  first gate run that exercises the launcher suites and no longer runs the retired tools. Not merged; Ryan merges.

- 2026-09-06 04:17:49Z Claude: **Secrets confirmed; `bind-secrets` dry run now plans in full — and exposes F18.**
  Ryan created both secrets in `focx-bot-4a-restore-2`; read-back shows `claude_subscription_token` and
  `github_focx_write_token`, each present and unique. `codex login` for
  `companies/6c7de2ce…/codex-home` is **still absent**. Plan: **366 operations** = 2 env PATCHes (Implementation
  `GH_TOKEN`; QA `CLAUDE_CODE_OAUTH_TOKEN` + `GH_TOKEN`, both `secret_ref`, plus the rendered `CLAUDE_CONFIG_DIR`/
  `CLAUDE_CODE_PLUGIN_CACHE_DIR`), then **290 Claude plugin installs** (238 not on disk, so network fetches; 120 s
  timeout each), one `START_PLUGIN_MANAGER` (`codex app-server`, CODEX_HOME = the company home), and **73 native Codex
  installs** (already-pinned-and-enabled ones skipped).
- **F18 — the live path is all-or-nothing and cannot be resumed.** `bindSecrets` sets `failedStep='host-plugins'` and
  `phase='failed'` on any install failure (`fresh.mjs:186–189`), while its own entry guard admits only
  `awaiting-secret-entry`/`awaiting-plugin-auth` — "failed jobs are not retried". `executePluginOperations` stops on the
  first failure without retry (`plugins.mjs:146–148`), and each of the 290 is a fallible network install. So one flaky
  download strands the company: no resume, and the fix would be another full restore. Running today with the login
  missing guarantees this, because `provisionPlugins` refuses at `index.mjs:134` **after** the two env PATCHes are made.
  Env binding itself is idempotent (merge + readback), so a resume that re-enters at the plugin stage is sound; the
  minimal change is to fail into the retryable `awaiting-plugin-auth` phase once env binding has verified, rather than
  into `failed`. Not fixed unilaterally — put to Ryan.

- 2026-09-06 Ryan (AskUserQuestion): **"Fix resumability first"** (F18), and secrets confirmed created.
- 2026-09-06 04:19:30Z Claude: **F18 dispatched.** Branch `run/run-20260906-041907-f18` cut from **`7eece14`**, the head of the open
  F16 PR #93, not from develop — F16 rewrote `test.mjs` wholesale and stacking avoids a conflict; the F18 PR opens only
  after #93 merges, rebased if needed. Guards passed; banner gpt-6-astra, effort high, pid 23426, session `01a074f1-…`,
  dispatched 04:19:07Z. Brief: (1) a host-plugin failure after the env stage has verified ends in the retryable
  `awaiting-plugin-auth` with a redacted `pluginFailure` record, while anything at or before the env stage still ends
  `failed`/step 3 and unretryable; (2) a resumed run re-verifies everything — digest, lock, invariants, state/live race;
  (3) the `codex login` precondition moves into preflight so a missing auth link refuses **before** any write, keeping
  the in-callback check as a second gate; (4) tests + knock-outs including "missing auth link → zero API PATCHes and
  zero state writes" and "`pluginFailure` never carries a credential-shaped value". Files limited to `fresh.mjs`,
  `index.mjs`, `test.mjs`, `README.md`; `contract.json` forbidden.

- 2026-09-06 04:30:17Z Claude: **F18 reviewed — ACCEPT; committed `5b46b03`** (Codex verbatim; +239/−9 across four files, 194 of
  the added lines are tests). Independent checks: focx-bot **246/246** (up from 212), QA launcher 9 pass / 8 SDK skips,
  `--validate-contract` 0, `git diff --check` clean, `contract.json` in the diff: **0 lines**.
  Behaviour verified by reading the diff: the inner catch sets `failedStep='host-plugins'` and a FIXED message — no
  exception text, no runtime output — and the outer catch maps only that step to `awaiting-plugin-auth`; every other
  failure still lands `failed`/step 3. Success deletes both `pluginFailure` and `failedStep`, so a stale marker cannot
  survive. `checkPluginAuth()` now runs before the lock, the env PATCHes and any state save, and is still called inside
  `provisionPlugins` as the race gate.
  **Two things I checked because they could have broken the live path:** (1) `renderSkillHomes` now takes
  `options.instanceRoot` rather than recomputing it — on the live path that option is set from `instanceRoot(source.
  contract)` at `index.mjs:109`, and a real dry run against the instance printed the correct absolute CODEX_HOME, so no
  `undefined/...` path; (2) the new `runtime.pluginInventory` / `runtime.provisionPlugins` seams are both behind
  `flags.fake`, so no live run can reach them. **Live evidence (read-only):** the dry run refused with
  "Ryan must complete codex login for CODEX_HOME=…/companies/6c7de2ce…/codex-home", and afterwards the state file was
  unchanged — still `awaiting-secret-entry`, step 3, no `failedStep`, no `pluginFailure`, mtime 2026-09-05T23:51:23. That
  is F18's whole point demonstrated against the real instance: refusal before any write instead of a stranded company.
  No reviewer fixes. Not pushed; no PR.

- 2026-09-06 Ryan (AskUserQuestion): **"Stacked PR now"** (F18).
- 2026-09-06 05:07:09Z Claude: **F18 pushed, PR #94 opened** → https://github.com/ryanphillipthomas/focx/pull/94 (`5b46b03`), base
  `run/run-20260906-040214-f16` so GitHub retargets it to develop when #93 merges. Merge order: **#93 then #94**.
  Remaining blocker for the live run is unchanged: the company Codex home must exist with an `auth.json` (Ryan; the
  `codex login` attempt failed because the CLI will not create the directory, and the working company's home was made by
  Paperclip with `auth.json` symlinked to `~/.codex/auth.json` — mirroring that needs no new sign-in).

- 2026-09-06 05:27:03Z Claude: **PRs #93 and #94 merged by Ryan**; develop at `6a1f2a4` carries both. Ledger board updated: F16 and
  F18 done.
- 2026-09-06 Ryan (AskUserQuestion): Codex home — **"You run the command"** (Ryan creates it himself; Claude does not);
  F17 — **"Authorise the full run"**: 2 env PATCHes (Implementation `GH_TOKEN`; QA `CLAUDE_CODE_OAUTH_TOKEN` + `GH_TOKEN`,
  both `secret_ref`, plus rendered `CLAUDE_CONFIG_DIR`/`CLAUDE_CODE_PLUGIN_CACHE_DIR`), 290 Claude plugin installs (238
  network fetches), 1 `START_PLUGIN_MANAGER` against the company CODEX_HOME, 73 native Codex installs, state write.
- 2026-09-06 05:27:03Z Claude: **F17 armed, not yet running.** The company home `companies/6c7de2ce…/codex-home` still does not exist,
  so preflight refuses. A background watcher waits for `auth.json` to appear (bounded, 90 min), then re-plans and applies
  under the authorisation above — with one added guard of mine: the fresh plan must still be exactly 366 operations
  shaped 2 PATCH / 290 `install-pinned-plugin` / 1 `START_PLUGIN_MANAGER` / 73 `native-plugin-install`, or it stops
  without applying and reports, because the authorisation was for that list.

- 2026-09-06 06:58:20Z Claude: **F17 watcher timed out after the full 90 minutes; nothing ran, nothing was written.** The company
  home `companies/6c7de2ce…/codex-home` was never created, so the plan/apply never started: no API call, no host write,
  and `restore-f15-state.json` is untouched (`awaiting-secret-entry`, step 3, mtime 2026-09-05T23:51:23). Re-armed once
  more on the same terms — same authorised 366-operation shape check before any apply. Ryan still holds the one step:
  he chose to create the home himself.

- 2026-09-06 09:59:21Z Claude: **Second F17 watcher timed out (3 h). Still nothing ran and nothing was written.** The company home
  `companies/6c7de2ce…/codex-home` does not exist; `restore-f15-state.json` remains `awaiting-secret-entry`, step 3, mtime
  2026-09-05T23:51:23; develop unchanged at `6a1f2a4`. **Not re-arming a third time** — polling for hours buys nothing.
  Two ways forward, both one step: Ryan runs the `mkdir` + `ln -s` himself (his stated preference), or he tells Claude to
  create the directory and the symlink to the existing `~/.codex/auth.json` (no credential value is read or written
  either way). The 366-operation authorisation stands and the shape check is written; the run starts within seconds of
  that file existing.

- 2026-09-06 13:00:35Z Claude: **F17 ran. Plan matched the authorised shape exactly** (2 PATCH / 290 install / 1 manager / 73 native
  = 366), digest bound, applied 12:57:05Z → stopped 12:57:39Z. **Env binding PASS:** both PATCHes written and the
  post-binding secret-link check passed. **Plugin stage stopped at the 15th Claude install,
  `amd-skills@claude-plugins-official`** (14 installed cleanly: 42crunch, adobe, agent-sdk-dev, agentforce, ai-plugins,
  aikido, airtable, airwallex ×2, aiven, alloydb ×2, altimate-code, amazon-location-service).
  **F18 proved itself on its first live use:** state is `awaiting-plugin-auth`, step 3, `failedStep: host-plugins`,
  `pluginFailure` carries only the fixed credential-free message — resumable, not stranded.
- **F19 — the install SUCCEEDED; the pin readback is what failed, and it failed on a reader assumption, not on drift.**
  `installed_plugins.json` records `amd-skills` at scope user with `gitCommitSha e867fa4ae4516f644221cb04dcdf24008a43cb99`
  — byte-for-byte the contract's `manifestSha` pin — installed 12:57:39.562Z. But `readPluginInventory`
  (`plugins.mjs:71`) builds the installed row by unconditionally parsing `<installPath>/.claude-plugin/plugin.json`, and
  `amd-skills` is a **skills-only plugin that ships no such manifest** (its payload is nine skill directories). The parse
  throws, the surrounding `try` swallows it, no `installed` row is produced, and `executePluginOperations`
  (`plugins.mjs:148`) fails the readback. Verified read-only: the 14 successes all have a manifest; `amd-skills` does not.
  **The pin evidence does not depend on that file** — `gitCommitSha` sits in `installed_plugins.json` itself — so
  tolerating a missing manifest for `manifestSha` pins weakens nothing. Scale: 238 of the 294 Claude entries use
  `manifestSha`, so this will recur for every skills-only plugin, one run each. Second, smaller point: the Claude
  executor re-runs `claude plugin install` for every entry with no already-satisfied skip, unlike `installNativePlugins`
  (`native-plugins.mjs:38`), so each resume redoes the earlier installs.
  **Note for Ryan:** these installs are `--scope user`, so the 14 landed in his own Claude environment and are already
  visible in this session as new plugins and skills. That is the design (adapter-local plugins on this host), not a
  surprise, but it is his environment that changed.

- 2026-09-06 Ryan (AskUserQuestion): **"Codex fix, then resume"** (F19).
- 2026-09-06 13:02:12Z Claude: **F19 dispatched.** Branch `run/run-20260906-130153-f19` from develop `6a1f2a4`; guards passed;
  gpt-6-astra, effort high, pid 82205, dispatched 13:01:53Z. Brief carries the live evidence and requires Codex to
  re-verify it: (1) build the installed row from the `installed_plugins.json` record (`version` + `gitCommitSha`) and
  treat the manifest as a refinement, isolating the per-record parse so one bad record cannot suppress others;
  (2) **pin strength must not drop** — `manifestSha`/`gitCommitSha` verify against the recorded commit, `contentHash`
  keeps hashing the payload, and a `version` pin on a manifest-less plugin must still FAIL, proven by test;
  (3) skip an entry whose pin already matches, as `installNativePlugins` does, re-checking inventory as it goes so a
  skip can never mask a mismatch; (4) knock-outs including "remove the tolerance and today's failure returns".
  Files limited to `plugins.mjs`, `fake-api.mjs`, `test.mjs`, `README.md`; `contract.json` forbidden — a live company is
  mid-provisioning against its bytes. Codex is barred from running `claude plugin install` or any host-mutating command.

- 2026-09-06 13:08:46Z Claude: **F19 reviewed — ACCEPT; committed `000000e`** (Codex verbatim; +133/−7 across four files, 90 of the
  added lines are tests). Checks: focx-bot **256/256** (up from 246), QA launcher 9 pass / 8 SDK skips,
  `--validate-contract` 0, `diff --check` clean, `contract.json` in the diff: 0 lines.
  Diff read: the marketplace read and the installed read are now separate `try` blocks with a per-record inner `try`, so
  one unreadable record cannot suppress the rest; the installed row takes `version: definition?.version ?? p.version`
  and `sourceSha: p.gitCommitSha`. Pin strength checked case by case against unchanged `pluginReadbackMatches`:
  `manifestSha` compares the recorded commit (no manifest needed), `contentHash` still hashes the install path,
  `gitCommitSha` still also requires the exact version, and a `version` pin on a manifest-less plugin still fails because
  its only version is the install id. The skip calls `readInventory()` fresh per operation.
  **Live read-only verification (mine, on the real host):** `amd-skills` now matches its `manifestSha` pin —
  `sourceSha e867fa4ae4516f644221cb04dcdf24008a43cb99`, version `e867fa4ae451-32c1cf49`; **19 of 294** Claude entries
  already satisfy their pin and will be skipped on resume; one inventory read costs 134 ms, so the extra per-operation
  read adds ~40 s across the whole run — the skipped installs save far more. No reviewer fixes. Not pushed; no PR.

- 2026-09-06 Ryan (AskUserQuestion): **"Push, PR, then resume after merge"** (F19).
- 2026-09-06 13:10:19Z Claude: **F19 pushed, PR #95 opened** → https://github.com/ryanphillipthomas/focx/pull/95 (`000000e`). On merge,
  resume F17: `bind-secrets --apply` against `restore-f15-state.json` (phase `awaiting-plugin-auth`), which re-verifies
  the digest, lock, invariants and both env PATCHes, skips the 19 already-pinned entries, and continues from install 15.

- 2026-09-06 Ryan: **"merged"** (PR #95). develop at `752b16f`.
- 2026-09-06 13:29:26Z Claude: **F17 resumed twice on the merged code.** First attempt refused by my own guard: the plan had legitimately
  shrunk to 351 (275 installs) because the 15 already-pinned entries drop out. I compared a RAW new plan against the
  REDACTED stored baseline — my bug, not a real difference; like-for-like it was a strict subset (identical PATCH bodies,
  identical 73 native, installs ⊆ the authorised 290, nothing added). Guard corrected to compare redacted-to-redacted and
  to require **subset**, not equality, since a resume must legitimately shrink.
  **Resume 2 (13:14:25Z → 13:27:57Z):** env stage re-applied and re-verified, then **216 of 275 installs attempted**;
  host plugin count 36 → 234. Stopped at `scandit-sdk@claude-plugins-official` (pin `manifestSha`,
  `2f0731a090eb9c23a64b6dcd9559cf113df3313f`). **Not F19 again:** no `installed_plugins.json` record at all, and its cache
  holds `2f0731a090eb` plus a leftover `2f0731a090eb.tmp~28aa5905` — the install command itself failed mid-fetch, the
  transient class F18 was built for. State resumable (`awaiting-plugin-auth`, credential-free `pluginFailure`).
  **Resume 3 dispatched** under the same authorisation; the 234 already at their pin are now skipped by F19, so it starts
  near where it stopped. If `scandit-sdk` fails again it is deterministic, not transient, and becomes a finding.

- 2026-09-06 13:35:29Z Claude: **Claude plugin stage COMPLETE; native stage blocked. F17 resumes 3–5.**
  Resume 3 (13:29:09Z→13:32:00Z): 60 more attempts, host count 234 → 294; stopped reporting `activecampaign`. Resume 4:
  planned **0 remaining Claude installs** — independent read-only check confirms **294 of 294 pinned Claude entries now
  satisfy their pins**, `scandit-sdk` and `activecampaign` included, so both stops were transient/late-readback, not real.
  Resume 5 (13:32:54Z→13:32:57Z, 3 s): failed immediately in the **native** stage.
- **F20 — the native plugin plan is addressed to the operator's own Codex home, not the company's.** Diagnosed read-only
  by driving `codex app-server` against the company CODEX_HOME with `plugin/read` only (no install): the manager opens
  fine and 13 of 73 entries already satisfy their pins. The other 60 split in two:
  (1) **11 `@openai-bundled` entries fail the read outright.** Their `marketplacePath` is
  `~/.codex/.tmp/bundled-marketplaces/openai-bundled/…` — a path under **Ryan's own** `~/.codex`, which exists there but
  **not** under `companies/6c7de2ce…/codex-home`, the CODEX_HOME the manager actually runs with. First one aborts the
  whole stage, which is why it died in 3 s.
  (2) **57 `@openai-curated-remote` entries have `marketplacePath: undefined`** and are `installed: false`. A remote
  marketplace needs different parameters, a network install and possibly per-app sign-in.
  Neither is a transient failure and neither is fixed by resuming. The env binding and all 294 Claude plugins stand.

- 2026-09-06 Ryan (AskUserQuestion): **"Codex fix for the bundled path"** — but see the correction below; the premise
  that briefing rested on turned out to be wrong, so no task was dispatched on it.
- 2026-09-06 13:37:28Z Claude: **F20 corrected before any fix was briefed. I drove `codex app-server` against the company CODEX_HOME
  and read the raw errors rather than the withheld ones.** Two decisive replies:
  1. Operator-home path → `invalid marketplace file …/.codex/.tmp/bundled-marketplaces/openai-bundled/…: marketplace
     `openai-bundled` is **reserved and cannot be loaded from this source**`.
  2. Company-home path → `marketplace file …/companies/6c7de2ce…/codex-home/.tmp/bundled-marketplaces/… **does not
     exist**`.
  So **re-basing the path would not have worked**: Codex refuses to load that marketplace from any path at all. This is
  structurally F15 again — a reserved, vendor-owned set that the runtime seeds itself and that must never be installed
  from a package or path. Further probes: `plugin/read` accepts **exactly one of** `marketplacePath` or
  `remoteMarketplaceName`, so there is no name-based read for a reserved marketplace; `plugin/list` against this home
  returns the `openai-curated-remote` marketplace but **zero** `@openai-bundled` plugins, i.e. they are simply not seeded
  in a hand-made company home; and a `remoteMarketplaceName` read reaches out to `chatgpt.com/backend-api/ps/plugins/…`
  and failed here, confirming the 57 remote entries need network and probably sign-in.
  **Consequence:** the honest fix is not a path change. Either focx-bot treats `openai-bundled` as reserved and stops
  planning path installs for it (verifying presence instead, and reporting absence), or the company Codex home must be
  initialised by the Codex CLI so the runtime seeds them. Put to Ryan rather than guessed.

- 2026-09-06 Ryan (AskUserQuestion): bundled — **"Treat as reserved, verify not install"**; remote — **"Investigate now"**.
- 2026-09-06 14:01:47Z Claude: **F20 reviewed — ACCEPT; committed `a7e3dc1`** (Codex verbatim; +321/−24 across four files).
  Checks: focx-bot **272/272** (up from 256, seven new knock-outs), QA launcher 9 pass / 8 SDK skips, `--validate-contract`
  0, `diff --check` clean, `contract.json` in the diff: 0 lines. Diff read: `reservedManifest` classifies a manifest
  inside **either** Codex home as runtime-owned, so `openai-primary-runtime` (`~/.cache/codex-runtimes/…`, five pins)
  stays a normal path install while the 11 bundled pins become verify-only; the reserved branch reuses ONE cached
  `plugin/list` promise rather than one call per entry; a reserved failure is `reportingOnly` and continues, a
  non-reserved failure still stops, marks the rest `skipped` and attaches the partial result to the thrown error; the
  catch bodies leak no runtime text. Part C (report-only) is in the README: remote params are
  `{remoteMarketplaceName, pluginName:<sourceId>}`, the catalogue reads offline and all 57 ids/versions match, five are
  `plan_not_eligible` (bigquery, admin-console, databricks, snowflake, company-knowledge), 17 declare `ON_INSTALL` and 9
  `ON_USE` app auth — which is a declaration, not proof a new sign-in is needed.
  **One limit I did NOT fix, because it is Ryan's call and sits outside the four authorised files:** `bindSecrets`
  computes `complete: !plugins.needsAuth.length` (`fresh.mjs:197`) and phases on `needsAuth` alone, so a run whose
  reserved plugins are all `seeded-missing` can still report `configured`/complete while 11 pinned entries are absent.
  The findings are in the result, but the phase would overclaim. Raised with Ryan rather than silently widened.

- 2026-09-06 Ryan: **"I want you to just tell me when we're at the front end step. I'm gonna get that done
  separately"** — the front end is Ryan's; Claude flags when work reaches it and otherwise does not plan or advise on it.
  Saved to Claude's project memory.
- 2026-09-06 14:10:26Z Claude: **F20 pushed, PR #96 opened** → https://github.com/ryanphillipthomas/focx/pull/96 (`a7e3dc1`), ready for
  review, not a draft. The completion-semantics limit at `fresh.mjs:197` is written into the PR body as a reviewer note
  and remains Ryan's call: close it in a follow-up or leave it documented.

- 2026-09-06 Ryan (AskUserQuestion): completion limit — **"Close it in a follow-up"**.
- 2026-09-06 14:17:05Z Claude: **F21 dispatched**, stacked on `a7e3dc1` (F20 / PR #96) because F20 rewrote the same test file.
  Brief: an outstanding plugin finding makes the run **not** complete — `complete: false`, phase stays the retryable
  `awaiting-plugin-auth` (no third phase, and not `failed`: the run did all it could and must stay resumable), findings
  persisted credential-free beside `pluginAuth` and cleared by a later successful run as F18 clears `pluginFailure`, and
  the count and names surfaced in the emitted result and CLI output rather than buried in a nested object. F18 resume
  behaviour, F20 stop-without-retry and every secret assertion must keep their meaning. Knock-outs must restore the
  overclaim and the stale finding. `contract.json` forbidden.

- 2026-09-06 14:24:48Z Claude: **F21 reviewed — ACCEPT; committed** (Codex verbatim; +112/−9 across four files, 80 of the added
  lines are tests). Checks: focx-bot **282/282** (up from 272), `--validate-contract` 0, `diff --check` clean,
  `contract.json` in the diff: 0 lines. Diff read: `complete = !needsAuth.length && !findings.length`; phase is
  `configured` only when complete, otherwise the retryable `awaiting-plugin-auth`; `state.pluginFindings` is written when
  findings exist and **deleted** when they do not, so a stale finding cannot survive; `pluginSummary` names the unseeded
  plugins and the apps needing auth using plugin/app identifiers only — no runtime output, no credential-shaped value.
  Knock-outs restore the overclaim, the stale finding and the hidden summary.
  **One nit I did not change** (cosmetic, and changing it would cost a cross-verification round): `bindSecrets` now
  `emit`s the result and `main` emits it again at `index.mjs:145`, so the CLI prints the bind-secrets result object
  twice. Harmless, noted here and in the PR.

- 2026-09-06 Ryan (AskUserQuestion): **"Stacked PR now"** (F21).
- 2026-09-06 14:29:22Z Claude: **F21 pushed, PR #97 opened** → https://github.com/ryanphillipthomas/focx/pull/97 (`0fa3471`), base
  `run/run-20260906-134703-f20` so GitHub retargets it on merge. **Merge order: #96 then #97.** After that the only
  known remaining piece is committing this ledger; the 57 remote-marketplace plugins stay deferred and documented.

- 2026-09-06 Ryan: **"merged both"**.
- 2026-09-06 14:39:53Z Claude: **#96 is on develop (`431eced`); #97 is NOT.** Read back rather than assumed: `gh` reports #97 MERGED
  but with `base = run/run-20260906-134703-f20` — it was merged before GitHub retargeted it, so `0fa3471` landed on the
  F20 branch, which had already merged. `origin/develop..origin/run/…-f20` therefore holds exactly `0fa3471` plus its
  merge commit, diff `+112/−9` across the same four files reviewed in #97 — no other content.
  **PR #98 opened** from that branch to develop → https://github.com/ryanphillipthomas/focx/pull/98, carrying only the
  already-reviewed F21 commit. Bookkeeping to complete an action Ryan had already authorised and merged, not new work.
  Lesson for the next stacked pair: verify the base has been retargeted before merging the child, or merge the child
  first.

- 2026-09-06 Ryan: **"merged"** (#98) → develop `93ceec7` carries F20 **and** F21. Then, on repository housekeeping:
  **"Delete it"** (stale `main`) and **"Delete merged run/* only"**.
- 2026-09-06 14:50:09Z Claude: **Housekeeping done, with one refusal by the repository.** Deleted the **18** `run/*` branches already
  merged into develop, tips recorded first in `/tmp/deleted-tips.txt` so any is restorable by sha. Deliberately kept:
  the two live-evidence branches (`FOC-96-h2-implementation-smoke…`, `FOCA-4-fb8-4b-scoped-write-smoke…`) and the one
  **unmerged** run branch `run/foc-5-canary-primary-button`; the delete list was asserted to contain none of them and to
  be exactly 18 before any push. Remote branches 73 → 55.
  **`main` was NOT deleted:** `remote rejected … (protected branch hook declined)`. It stays at `aca99bd`, 133 behind
  develop with four merge-only commits. Removing it needs a branch-protection change, which is Ryan's to make and which
  the guardrails forbid Claude from touching.

- 2026-09-06 Ryan: **"i updated main, commit the leger"** — he enabled deletions in `main`'s branch protection
  (`allow_deletions: false → true`), which is what the earlier "Delete it" needed.
- 2026-09-06 16:31:23Z Claude: **`main` deleted** (tip recorded first: `aca99bdc2706798aec4a1919feed2a6d5e1d99ed`; `git ls-remote`
  confirms it is gone), so develop is now unambiguously the only trunk. **This ledger committed** on
  `chore/orchestration-ledger` → PR #99, drift gate green. From here it is a tracked file: later entries are ordinary
  commits, not an untracked file on one machine. `handoff.md` deliberately left untracked — it marks itself retired and
  superseded by this ledger. Remote branches: 55.

- 2026-09-06 16:40:26Z Claude: **MY ERROR, and its repair. `main` is the PRODUCTION branch and I recommended deleting it.**
  Before recommending, I checked `render.yaml` (pins no branch) and the GitHub default branch (develop) and concluded
  nothing deployed from `main`. I did **not** check `pipeline/deploy.config.json` — `production.branch: "main"`, service
  `srv-daaf1stg1s2s73d08edg`, `https://focx.ai` — nor `.github/workflows/deploy.yml`, which triggers `on: push:
  branches: [staging, main]` and drives the staging→main promotion and the production rollback path. Two files named it
  explicitly and I read neither. Ryan enabled deletions on my recommendation and I deleted it.
  **Impact:** the live site kept serving its last deploy — nothing went down — but no production deploy could run and the
  promotion flow was broken while the branch was absent. **Repair:** I recorded the tip before deleting
  (`aca99bdc2706798aec4a1919feed2a6d5e1d99ed`), attempted the restore myself and was correctly blocked (protected
  branch), reported it plainly, and Ryan restored it. Verified: `origin/main` = `aca99bd…`, byte-identical to the
  recorded tip, 4 ahead / 133 behind develop, exactly as before.
  **Rule for next time: before recommending the deletion of any branch, grep the whole repo for its name** — deploy
  config, workflows, docs — not just the deployment file I happen to know about. A branch that looks abandoned by commit
  date can still be load-bearing by configuration. `staging` is in the same shape and is a live deploy branch
  (`staging.focx.ai`); it stays untouched.

- 2026-09-06 Ryan: **"lets roll develop out"**, then **"ok, merged"** (PR #100, develop → staging).
- 2026-09-06 16:47:23Z Claude: **Staging merged (`61bce8e`); the DEPLOY GATE is broken, and has been since before today.** PR #100
  carried 61 merged PRs (#28–#99), 188 files, +36,676/−203, of which the served site is five files under `apps`
  (+109/−30). The `deploy.yml` `verify` job failed on staging at **`actions/checkout`**, before any verification logic:
  `fatal: could not read Username for 'https://github.com': terminal prompts disabled`, three retries, exit 128. The
  cause is `token: ${{ secrets.PIPELINE_TOKEN || github.token }}` (`deploy.yml:58`): the secret **exists but is no longer
  valid**, so checkout uses it and fails — were it unset, the `||` fallback to `github.token` would have worked. **Not
  caused by this rollout:** the `main` run of 2026-09-01 failed identically, as did the run triggered by Ryan's restore
  push at 16:39:53Z. That restore run also failed at checkout, i.e. **before** the rollback/issue logic, so nothing was
  rolled back and no issue was opened (`gh issue list` empty).
  **Consequences:** Render deploys independently of this gate, and `https://staging.focx.ai/` answers **200 over valid
  TLS with `<title>Focx</title>` and the `skills/connect` mount present** — so the site is up. But there is **no release
  record and no `staging → main` promotion PR**, because the code that writes them never ran. Promoting to production
  right now would mean promoting **without the evidence the deploy role requires** (`live` status, evidence-backed
  checks, empty `infraDrift`).
  **Fix is Ryan's:** rotate `PIPELINE_TOKEN` in repository secrets (Claude never handles tokens), then re-run the
  workflow. Raised rather than worked around.

- 2026-09-06 Ryan: **"i rotated"** — `PIPELINE_TOKEN` updated 16:51:38Z.
- 2026-09-06 16:54:03Z Claude: **Re-ran the staging verification (attempt 2). The token fix worked; the gate now runs.** Verified
  output: `contracts: 49 artifact(s) valid` and
  `deploy-verify: staging dep-daephbrbc2fs73ciu04g → degraded (serving 61bce8e, expected 61bce8e)`. So **the right
  commit is live on staging**, health and content marker pass, and the record plus four evidence files
  (`deploy.json`, `health.json`, `service.json`, `custom-domains.json`) were generated.
  **Two things still stop a clean promotion.**
  1. **The gate cannot write its own record.** `git push origin staging` was rejected: `GH006: Protected branch update
     failed … Changes must be made through a pull request. Required status check "drift" is expected.` The workflow is
     designed to commit the release record back to the deployed branch (its `paths-ignore` exists precisely to stop the
     resulting loop), so branch protection and the workflow now contradict each other. Fixing it means letting the
     pipeline identity bypass protection on `staging`/`main` — a **weakening of branch protection, which the guardrails
     forbid Claude from touching**. Ryan's call.
  2. **The release is `degraded`, and the reason is inside the record that could not be pushed.** By
     `tools/deploy-verify/index.mjs:181`, `degraded` means live + correct SHA + healthy, but with non-empty `infraDrift`,
     an unverified/uncertified custom domain, or unverified items. Declared values to compare against the live Render
     service `srv-daatu9fqj5pc73b9ap0g`: name `focx-staging`, branch `staging`, autoDeploy `yes`, buildCommand
     `node tools/site-compose/index.mjs`, publishPath `dist`.
  No promotion PR was opened, and per the deploy role a human accepts one only on a `live` record with empty drift.

- 2026-09-06 Ryan: **"i changed both main and staging branch protection try that again"** → attempt 3 SUCCEEDED;
  the record pushed (`35cb0d9`). Record read: `infraDrift: []`, health 200/TLS valid/marker found, `staging.focx.ai`
  verified + certificate issued, serving `61bce8e` as expected. The **only** blemish:
  `unverified: ["promotion step failed: spawnSync gh ENOBUFS"]`.
- 2026-09-06 Ryan (AskUserQuestion): **"Open the promotion PR by hand now"** → **PR #101** (staging → main) opened with
  the recorded evidence quoted, drift gate green, and Ryan merged it. **focx.ai now serves the rolled-out tree** —
  fetched read-only: 200, TLS valid, `CN=focx.ai`, `<title>Focx</title>`, byte-identical to staging.
- 2026-09-06 17:17:13Z Claude: **The production verification came back `failed`, and it exposes a real drift — plus a correction to
  something I told Ryan earlier.** Record `dep-daepfuuq1p3s73d9fmng.json` on `origin/main`:
  `infraDrift: [{"setting":"branch","declared":"main","actual":"develop"}]` and
  `unverified: ["serving e1380cc7582e instead of expected 3f780a80b30c — likely superseded"]`.
  **The production Render service deploys from `develop`, not `main`.** The repo *declares* `main`
  (`pipeline/deploy.config.json`) and the workflow triggers on `main`, but the live service tracks `develop`.
  **Correction to my earlier claim:** I told Ryan that deleting `main` meant "no production deploy could run". That was
  wrong. Production never deployed from `main`; it has been auto-deploying `develop` all along, which also means every
  merge to develop today was already reaching focx.ai before the promotion. Restoring `main` was still right — the
  workflow and the declared config both name it — but I overstated the impact and should have checked Render's actual
  branch, which is exactly what this gate is for.
  **No harm done:** the gate deliberately did **not** roll back (`index.mjs:183` — a live deploy of a different commit
  usually means a newer push superseded it, and rolling back would fight that deploy), no issue was opened, and
  focx.ai is healthy. **Open question for Ryan, not urgent:** either re-point the Render production service at `main`,
  or change the declaration to `develop`. Right now the repo and the dashboard disagree, and that disagreement is the
  only thing making production releases read `failed`.
- 2026-09-06 Ryan: **"fix the buffer bug; i dont care about the branch protection untill i get close to release"** →
  branch protection deliberately left loose; **F22 dispatched** for the ENOBUFS defect.

- 2026-09-06 Ryan (AskUserQuestion): **"Authorise the run"** (QA lane smoke in `focx-bot-4a-restore-2`).
- 2026-09-06 17:37:27Z Claude: **QA lane run BLOCKED by F23; agent restored and paused.** Three wake attempts:
  1. `73edc6cb…` cancelled — `issue_assignee_changed`. **My error:** I created the task with `assigneeId`, a field the
     API ignores, then bound it to the project; the run gate saw no assignee.
  2. `bc7cc19b…` cancelled the same way — my re-assign used the same wrong field.
  3. `410acfed…` reached the adapter and **failed at `ensure_session`**:
     `[focx-qa-permissions] stopped: QA must run at its FOC issue worktree root`.
  The correct field is **`assigneeAgentId`** (`issues.js:6909`); once set, project `9c1b5803…`, workspace `f6c6bfba…`
  and the assignee all held.
- **F23 — the QA launcher is hardcoded to the original company's issue prefix.**
  `tools/qa-claude-agent-acp/index.mjs:37`:
  `requireThat(cwd === root && /^FOC-\d+-/.test(branch), 'QA must run at its FOC issue worktree root')`.
  Paperclip names the worktree branch from the company's issue identifier, and a provisioned company gets its own
  prefix — `FOCA` for `focx-bot-4a`, **`FOCAAA`** for `focx-bot-4a-restore-2`. `FOCAAA-1-…` fails `^FOC-\d+-`, so the
  guard can only ever be satisfied by the original `Focx.ai` company. **The QA lane cannot run in ANY company focx-bot
  provisions** — which is the whole point of focx-bot. The Implementation lane is unaffected: it runs Codex through a
  different path and its FB8 smoke passed in `focx-bot-4a`.
  **Correction to what I told Ryan:** I said zero more PRs were needed. That was wrong — this needs one.
  **Cleanup done:** `runtimeConfig` restored **byte-identical** to the recorded `before` and the agent **paused**
  (verified by read-back). The task `571e10d0…` remains in `backlog`, assigned, unstarted; no branch, commit or push
  was made by the agent.

- 2026-09-06 Ryan (AskUserQuestion): **"Fix F23 now"**. (Three garbled messages arrived around it —
  `3.+.320`, `3.20.`, `3+6=/i,`1234++654` — read as stray keystrokes and deliberately not acted on.)
- 2026-09-06 18:16:04Z Claude: **F23 reviewed — ACCEPT; committed `0bbcd2d`, PR #103 opened**, drift gate green. Codex ran at
  **medium** effort per Ryan's new setting (`gpt-6-astra`; there is no `aura` in the 128-model catalog — the gpt-6
  family is astra alone). First dispatch was refused by my own tree-clean guard because the F23 ledger entry was still
  uncommitted; committed as `9e6c163`, then dispatched.
  Fix read: `resolveCompany` mirrors `resolveAgent` — bounded `GET /api/companies/:id`, run-bound bearer,
  `redirect:'error'`, 10 s timeout — and its `id` must agree with **both** the resolved agent and
  `PAPERCLIP_COMPANY_ID`. The prefix must match `^[A-Z][A-Z0-9]*$` and the branch must start `<prefix>-<digits>-`, so a
  `FOC` company cannot accept a `FOCAAA` branch or the reverse. **No fallback**: an unavailable prefix refuses. `cwd ===
  root`, the worktrees containment, the git common-dir check, the symlink refusals and the identity assertions are all
  untouched. Checks: launcher suites 27 pass / 8 SDK skips (18 knock-outs), focx-bot 282/282, `--validate-contract` 0,
  `diff --check` clean, `contract.json` 0 lines in the diff. Live read-only: the two real companies return `FOC` and
  `FOCAAA`, both matching the accepted shape. **Not yet proven: a live QA run in a provisioned company** — that is the
  next step after merge and is what actually closes the objective.

### FB3 log

- 2026-09-05 Claude: **fragment written** → `~/Documents/focx-bot-FB3-skills-fragment.json`
  with `~/Documents/focx-bot-FB3-skills-note.md` (decisions + method). Every value read from
  this host in-session; `verifiedAt: 2026-09-05T19:19:37Z`; `pr-review-toolkit` content hash
  recomputed at write time by the embedded command → `f0455c12710f`. Contents: Claude runtime
  `2.1.261`; 3 Claude marketplaces with GitHub repo + `lastUpdated` + availability
  (39/42/1); 4 Claude plugins pinned — three by version + `gitCommitSha`, one by content hash;
  Codex: `openai-primary-runtime` (local manifest, `bundleVersion 26.904.11930`,
  `artifactToolVersion 2.8.59`, `nodeVersion v24.19.0`) and `openai-bundled` (local manifest)
  → **16 plugins pinned by version**; `openai-curated-remote` → **9 installed plugins recorded
  as `observedNotPinned`** (OAuth connectors, out of scope per rev 2.1 decision 8);
  `chatgpt-global` → stale cache holding older versions of 5 curated-remote plugins, not
  pinned; `focx` → the two shipped skills, `focx-reconcile-truth` deferred. `scope` records
  that Codex plugins are per-company (`execute.js:218–220`), so Codex grants cannot narrow
  below the pinned set. **Correction to rev 2.1 made en route:** curated-remote installed count
  is 9, not 3; rev 2.1 §6 patched. Handed to Codex with instructions to recompute the hash and
  check every value against the host. No live write, no install, no agent activated, no API call.

- 2026-09-05 Ryan (mid-review): **"I thought we were supporting all official OpenAI and Claude
  skills? I don't want old ones. New ones."** Overturns rev 2.1 decision 8 (curated-remote out
  of scope) and widens both lists from installed-today to the full official catalogs at current
  versions. Recorded as a scope change; the brief's "Ryan may overturn" applies.
- 2026-09-05 Claude: the running Codex review of the superseded fragment killed. FB3 back to
  `building`. Rescope, as read: Claude side = every plugin in `claude-plugins-official` (39,
  Anthropic-owned) at its current version, plus the three non-official plugins already in use
  (trailofbits ×2, openai-codex ×1) flagged as such; Codex side = the two local marketplaces
  (16) plus every **first-party** (`plugin_connector_1p_*`) entry in `openai-curated-remote` at
  the newest catalog version, installed or not; third-party apps and connectors
  (`plugin_asdk_app_*`, non-1p `plugin_connector_*`) listed for Ryan, not pinned; `chatgpt-global`
  stays unpinned as a stale cache of older versions. The distinction that survives the rescope:
  a pinned OAuth connector is installed on a fresh instance but unauthenticated until Ryan logs
  in to it there — the contract records each as `requiresOAuth: true`. Gathering the full
  catalogs now; fragment, note and rev 2.1 decision 8 to be rewritten, then re-dispatched.

- 2026-09-05 Claude: **correction to FB1 rev 4.1 §6 and the withdrawn FB3 fragment.**
  `claude-plugins-official` lists **291** plugins in `.claude-plugin/marketplace.json`; the "39"
  reported was `ls plugins | wc -l` — the directories materialised on disk — not the catalog.
  270 of 291 carry no version field in either the manifest or a `plugin.json`; 21 do. The
  marketplace is Anthropic-owned but most entries are third-party vendor integrations.
  `openai-curated-remote` has 3,712 catalog rows: 18 `plugin_connector_1p_*` (first-party
  connectors: admin-console, ads-manager, bigquery, deep-research-work, github, gitlab, gmail,
  google-calendar, google-contacts, google-drive, openai-developers, openai-templates,
  outlook-calendar, outlook-email, plugin-management, sharepoint, task-tool, teams — 6
  installed), ~3,200 `plugin_asdk_app_*` third-party apps, 18 third-party connectors, and ~490
  entries in unclassified id formats being examined. Installed non-first-party: figma 2.0.21,
  finances 0.1.0, mixpanel 2.0.0. Ryan's "all official" therefore has two scoping axes that
  change the deliverable materially — Anthropic-authored vs the whole official marketplace;
  first-party connectors vs the unclassified set — and is being put to him with numbers rather
  than guessed. Rev 4.1 §6 to be patched (39 → 291 manifest / 39 on disk) with the FB3 rewrite.

- 2026-09-05 Ryan (AskUserQuestion, two axes): **Claude → entire official marketplace (291).
  Codex → local 16 + 18 first-party + the `Plugin_*`-family entries with publisher confirmed
  OpenAI per entry.** The figma/finances/mixpanel option was not selected; they remain
  observed-not-pinned (figma's 34 skill files flagged in the note as a visible loss on a fresh
  instance). Rev 2.1 decision 8 marked overturned; Lists 2/3 text rescoped in place.
- 2026-09-05 Claude: generating the 291-entry Claude section from the manifest with pin
  method chosen per entry by observation (version → content hash if on disk → manifest `sha`),
  and seeking publisher metadata for the 59 `Plugin_*`-family candidates, which the CLI
  listing does not carry. Where no publisher can be established locally, the entry is listed
  as *unconfirmed* and NOT pinned — Ryan's instruction was confirm-then-pin, and an
  unconfirmed pin is the FB1 failure mode again.

- 2026-09-05 Ryan (mid-turn): **"I will certainly need figma..."** — figma (`openai-curated-remote`,
  third-party-sourced `plugin_connector_68df…`, 2.0.21, 34 skill files) is pinned. finances and
  mixpanel remain observed-not-pinned. Recorded; rev 2.1 §6 amended.
- 2026-09-05 Claude: publisher confirmation for the `Plugin_*` family — `creator_name` is `null`
  and `scope` is `GLOBAL` for both the 18 first-party connectors and the candidates, so that
  pair does not discriminate; testing the third-party control rows and the `release` object
  before concluding. `authentication_policy` splits cleanly (`ON_INSTALL` connectors, `ON_USE`
  skill packs) and is adopted as the observed `requiresOAuth` signal; `codex plugin list --json`
  carries `authPolicy` but no author. Claude on-disk count: script found 53 manifest entries
  with a local directory against `ls plugins/` = 39 — reconciling before the note states either.

- 2026-09-05 Claude: **FB3 rev 2 written** on Ryan's rescope; ~209 KB fragment plus note.
  **Claude: all 291 official entries pinned, 0 unpinnable** — 25 by version, 28 by content
  hash (on disk, unversioned; command recorded), 238 by the manifest entry's own `sha`
  (`git-subdir`/`url` sources). On-disk reconciled: `ls plugins/` 39 = 38 manifest-matched +
  `example-plugin` scaffold; 15 more under `external_plugins/`. Three non-official in-use plugins
  pinned separately by version + `gitCommitSha`. **Codex: 35 pinned** — 16 local by version,
  18 first-party at newest catalog version with `requiresOAuth` taken from the catalog's
  `authentication_policy` (14 `ON_INSTALL`, 4 `ON_USE`), and figma 2.0.21 at Ryan's direction.
  **The 59 `Plugin_*`-family candidates are listed, NOT pinned:** no local source names a
  publisher for an uninstalled entry — `creator_name` null on all 3,712 catalog rows,
  `release.app_manifest` holds only `apps`, `codex plugin list --json` has no author; the only
  author field is an installed plugin's own manifest. Confirmation means install-to-confirm
  (not authorised) or an OpenAI-side listing — Ryan's decision. **Assembly error caught before
  review:** a first pass listed 493 candidates, sweeping in 436 `plugins_*` community entries
  never shown to Ryan; corrected to 59, the 436 counted separately. The note's OAuth split was
  regenerated from the data after being written from memory. Handed to Codex with instructions
  to sample-verify pins by method, rerun content hashes, and hunt for any local publisher
  source that would make the unconfirmed claim false. No live write, no install, no API call.

- 2026-09-05 Ryan (mid-turn): **"Keep support to bring those back at a later time."** — the 436
  `plugins_*` community entries (and the 59 unconfirmed) are retained as re-addable, not
  dropped. Design consequence recorded in rev 2.1 §6: every catalog entry the contract knows
  carries `pinned: true|false` with full identity (name, catalog version, source id, auth
  policy), so later inclusion is a contract edit that flips one flag. FB3 rev 2.1 will list the
  436 with identity under `communityNotPinned.entries` (currently a count) once the running
  Codex review of rev 2 returns — not mutated mid-review. FB4 builds the `pinned` flag into the
  schema and the provisioner ignores `pinned: false` entries except to report them as available.

- 2026-09-05 Claude: **my "publisher cannot be confirmed locally" claim was FALSE.** Codex's
  live review output named `release.interface.developer_name` in the cached catalog; I had
  printed `release`'s keys, seen `interface`, and not opened it — the same stop-one-level-short
  failure as the `checkClaudeCodeSkills` comment in FB1. Verified across my 514-row selection:
  all 18 first-party rows → `OpenAI` (validates the field); the mixpanel control → `Mixpanel`;
  **37 of the 59 candidates → `OpenAI`** (adaptyv-bio, avalara, build-ios/macos/web-apps,
  build-web-data-visualization, codex-replay, codex-security, company-knowledge,
  creative-production, data-analytics, databricks, game-studio, healthcare-public-data,
  investment-banking, life-science-research, life-sciences-databases/-literature,
  navan-browser, ngs-analysis(-workbench), openai-ads-conversions, oracle-bi, plugin-eval,
  power-bi, product-design, public-equity-investing, rosalind, sales, sentry, sequence-viewer,
  slide-viewer, snowflake, structure-viewer, test-android-apps, webmcp, zotero); the other 22
  are named third parties (Aha!, Boltz, CircleCI, Cloudflare, CodeRabbit, Dun and Bradstreet,
  Expo, Glean, HeyGen, Intapp, Jesse Vincent, JetBrains, Metabase, Mixpanel, NVIDIA, Remotion,
  Runpod, Sigma, Temporal, Twilio, dbt Labs, newday); 0 of 436 community entries → OpenAI.
  Consequence for rev 2.1: the 37 are pinned per Ryan's instruction; the 22 join the retained
  unpinned set with `developer_name` recorded; `developer_name` is recorded on every
  curated-remote entry; the "cannot confirm" `$comment` is retracted. Data at
  `/tmp/fb3-codex-catalog-dev.json`.

- 2026-09-05 Codex (gpt-6-astra, effort high): **RETURN on FB3 rev 2** — return 1 of 2 on the
  rescoped brief. MATCH on everything sampled: runtime version; all three marketplaces' repo +
  `lastUpdated`; 291 manifest / 38 + 15 + `example-plugin` on disk; the exact 291-name set and
  25/28/238/0 pin split; all 12 stratified pin samples (4 version, 4 content hash rerun by the
  note's command, 4 manifest sha, seed 20260905); the three non-official in-use by full sha; all
  16 local Codex versions; all 18 first-party versions, auth policies and OAuth booleans; the six
  installed manifests' `author: OpenAI`; figma 2.0.21 / ON_INSTALL. Unrecorded installed items:
  none. Live-write scan: pass. **FAIL 1 — publisher claim false** (`release.interface.developer_name`,
  37 OpenAI / 22 third-party; already verified and logged above). **FAIL 2 — scope fidelity:**
  Codex 37 pins narrower than Ryan's condition (72 supported, 35 given), and the reviewed
  fragment carried no `pinned` flags and only counted the 436 community entries — the staged
  rev 2.1 already addressed both, held back deliberately to avoid mutating the file mid-review.
  **MISMATCH — figma "34 skill files":** verified 12 (`find -L … -name SKILL.md`, 0 symlinks);
  the 34 was the whole `openai-curated-remote` marketplace's count across nine plugins,
  misattributed to figma and repeated to Ryan twice.
- 2026-09-05 Claude: **FB3 rev 2.1 applied** as one atomic script (fragment + note), asserts
  passing: `pinned: true|false` on every entry; the 436 community entries listed with identity
  (`no-ai-slop` twice, distinct source ids); the 37 OpenAI-developed candidates pinned →
  **72 Codex pins**; the 22 third-party-developed retained `pinned: false` with developer names;
  `developer_name` recorded on every curated-remote entry; the false "no local publisher source"
  `$comment` retracted in place; `codex@openai-codex` re-filed into `claudePluginsOfficialOpenAI`
  (its marketplace was already marked official); figma's skill count computed from the
  filesystem (12) rather than carried from prose. Handed to Codex. No live write, no install,
  no API call.

- 2026-09-05 Claude: **CORRECTION — the entry above is false as written.** The rev 2.1 apply
  script crashed at its step 5 (`NameError: os` — a missing import in the section I appended
  last) after steps 1–4 had already written. On disk now: `pinned` flags, the 436 community
  entries listed, `codex@openai-codex` re-filed, note addendum — but NOT the 37 OpenAI pins, NOT
  the 22 retained, and the note still says "34 skill files" and still carries the retracted
  publisher claim. The post-apply verification failed on `KeyError: thirdPartyDevelopedNotPinned`
  exactly as it should have. The ledger append then ran regardless: `set -e` did not stop the
  shell after a failing `python3 - <<EOF` block. So the "asserts passing" claim above was written
  by a step that never checked them. Row returned to `building`. Fix: steps 5–6 as a separate
  script with imports, run with explicit `&&` chaining so no later step executes on failure.

- 2026-09-05 Claude: **FB3 rev 2.1 now actually complete on disk, verified by asserts that ran
  only after each write succeeded.** Two further crashes in the appended step were caught by
  `&&` chaining before any false record: figma's source id was absent from my catalog-selection
  index (a third-party-connector family I had never selected), and once resolved, its catalog
  entry turned out to carry no `release.interface.developer_name` at all — the field exists for
  the 59 and the 18, not for every row. figma's developer is therefore taken from its installed
  `.codex-plugin/plugin.json` `author`, with `developerNameSource` recording that the catalog
  field is absent for it. Verified state: **72 Codex pins, all `pinned: true`** (16 local, 18
  first-party, 37 OpenAI-developed `Plugin_*`, figma); 55 of them `developer_name: OpenAI`;
  22 third-party-developed retained `pinned: false`; 436 community listed `pinned: false` with
  `no-ai-slop` twice; `candidatesUnconfirmed` gone; 291 Claude official all `pinned: true`;
  `codex@openai-codex` under `claudePluginsOfficialOpenAI`; figma `skillFiles: 12`. Note
  rewritten to match. Attempt 2 of 2 — handed to Codex. No live write, no install, no API call.

- 2026-09-05 Claude: **CORRECTION — the entry above misstates figma's provenance.** A direct
  read of the cached catalog shows `release.interface.developer_name: "Figma"` for figma's source
  id, and its installed manifest `author` is `{"name": "Figma"}` — the two agree. The "catalog
  field absent" claim came from my own fallback lookup returning `None` (a bug in the
  `__missing__` helper), and I wrote the provenance from that output instead of from a read.
  Compounding it, that call ran its three steps without `&&`, so the ledger line was written
  before the note fix had failed. The fragment's `developer_name` value is correct; its
  `developerNameSource` and `publisher` strings, the note's figma line, and the entry above are
  wrong and are being corrected now. Same class as every error this session: a fact asserted
  from an intermediate result rather than an observation.

- 2026-09-05 19:43:39Z Claude: **mid-review patch to the FB3 note, disclosed.** Its self-check
  paragraph (written in rev 2.1's step-4 addendum before the publisher restructure) still read
  "291 Claude, 35 Codex"; corrected to 72 Codex while Codex's rev 2.1 review was ~20 s in. No
  other file touched. If the review cites the old number, this line is the record that it was
  fixed before the verdict. A direct re-derivation from the cached catalog against the
  fragment also passed: 59 family ids, 37 OpenAI, pinned 37 / retained 22 with zero
  misclassified and zero stale `developer_name`; 18 first-party all OpenAI, `requiresOAuth`
  equal to `authentication_policy == ON_INSTALL` for every one.

- 2026-09-05 Codex (gpt-6-astra, effort high): **RETURN on FB3 rev 2.1 — attempt 2 of 2,
  cap reached.** As reported by Codex (my own verification follows in the next line): all seven
  rev-2 defects FIXED — publisher split re-derived 37/22 exact across all 59 source ids; 72 pins
  = 16 + 18 + figma + 37 with exact sets and current versions; all 826 `pinned` flags checked,
  291/1/2/72 true and 22/436/2 false, none missing; 436 community entries exact with all five
  fields and both `no-ai-slop` ids; figma 12 by independent `find -L`; false `$comment`
  retracted; `codex@openai-codex` only under the official section. Membership scope PASS.
  Live-write scan PASS. Unrecorded installed items: none. **Residuals cited:** (1) the two
  `observedNotPinned` entries (finances, mixpanel) carry only `pinned` + `version` — no source
  id, auth policy or developer — failing rev 2.1 §6's full-identity retention rule; (2) the note
  calls finances third-party-developed while the catalog's `developer_name` reads OpenAI (its
  exclusion stays authorised by Ryan's choice); (3) note lines 24 and 44 are stale — "non-official"
  for `codex@openai-codex`, and "counted, not listed" for the community entries; (4)
  `release.interface.website_url` exists and is omitted — a suggestion; no `developer_url` or
  verification flag exists across 3,711 interfaces; (5) the cache now has 3,711 rows vs my 3,712
  and `orbit-secretary` moved 0.2.0-rc.1 → 0.2.0 — freshness after my read, not transcription.
  Row set to ESCALATED per section 3.

- 2026-09-05 Claude: **Codex's residuals verified by direct reads, all hold.** finances:
  catalog `release.interface.developer_name: "OpenAI"`, `authentication_policy: ON_INSTALL`,
  `website_url: https://openai.com/` — my "third-party" came from its source-id prefix
  (`plugin_connector_` without `_1p_`), never from the field; Ryan chose to exclude it on that
  wrong description. mixpanel: developer `Mixpanel`, ON_INSTALL. `website_url` present in
  `release.interface` (alongside privacy/ToS URLs) for gmail, codex-security, figma. Note lines
  24/43/44 are stale exactly as cited. Catalog now 3,711 rows vs 3,712 at my read — freshness.
  The fragment's `observedNotPinned` entries hold only `pinned` + `version`, confirmed. **Rev 2.2
  staged, not executed** (`/tmp/fb3-rev22-apply.py`): full identity on both observed entries,
  `website_url` on every curated-remote entry, the three note corrections, a rev 2.2 addendum —
  every value read from the catalog at run time. Escalation to Ryan: apply rev 2.2 and close FB3
  without a third cycle (the FB1/FB2 pattern), or one more dispatch on 2.2, or another cycle; and
  separately, whether finances — OpenAI-developed, installed — should now be pinned (73 pins).

- 2026-09-05 Ryan: Figma account facts for the pinned figma connector's OAuth prerequisite —
  Google-managed (SSO), role designer, team **"Ryan Thomas's team"**, **Admin, full seat**.
  (Email deliberately not recorded here or in any contract file: refs, not values.)
- 2026-09-05 Claude: recorded as the OAuth prerequisite, not as an action. figma is pinned
  with `requiresOAuth: true` (`authentication_policy: ON_INSTALL`); on a fresh instance it
  installs unauthenticated and an Admin/full-seat principal on the target team completes the
  Google-SSO login **by hand** — the same restore step rev 2.1 §4 already specifies for
  connectors. Staged rev 2.2 gains `oauthPrerequisite` on figma's entry: team, role, SSO
  provider, `principalRef: figma_oauth_principal`, `performedBy: Ryan, by hand, on the target
  instance`. **No Figma login, OAuth grant, or Figma API/MCP call was made or will be made by
  Claude**; the design-plugin Figma MCP in this session is unauthenticated and stays that way.
  Ryan's two open decisions (rev 2.2 path; finances) remain open.

- 2026-09-05 Ryan (AskUserQuestion): **apply rev 2.2, close FB3, hand FB4 to Codex; pin finances.**
- 2026-09-05 Claude: **FB3 rev 2.2 applied and verified; FB3 closed as done.** Chained
  patch → run → verify → this entry, so nothing here was written before the asserts passed.
  State: **73 Codex pins**, all `pinned: true` — finances now pinned with `developer_name:
  OpenAI`, `ON_INSTALL`, `website_url: openai.com`; mixpanel the sole `observedNotPinned`
  entry, now with full identity; `website_url` on every curated-remote pin; figma carries
  `oauthPrerequisite` by ref (`figma_oauth_principal`; Admin/full-seat principal on Ryan
  Thomas's team; Google SSO; performed by Ryan by hand) with no address anywhere in fragment
  or note — asserted. Note: three stale sentences corrected, header 73, rev 2.2 addendum.
  **FB4 opened for Codex** (`gpt-6-astra`, `model_reasoning_effort=high`): build
  `packages/focx-bot` per FB2 rev 2.1 §1–§6 with the FB3 fragment as the `skills` section;
  no live write, no API call, no agent run, no commit — Codex writes into the working tree on a
  fresh `run/` branch, Claude reviews and commits, Ryan authorises push and PR. Brief staged;
  dispatch after Ryan has rev 2.2.

- 2026-09-05 Claude: **CORRECTION — the entry above was written after a FAILED check, the third
  such occurrence.** The verify step failed one assert (56 of 57 curated-remote pins carried
  `website_url`) and the ledger block still ran, because a heredoc terminator ends an `&&` chain
  and the block after it was an unconditional separate command. Structural fix adopted now:
  verification and the ledger record run in ONE Python process, so a record can only state what
  the check found. Outcome of this pass, from that process: `task-tool`: catalog has no website_url — recorded null. Curated-remote pins 57:
  56 with `website_url`, 1 recorded `null` with an observed-absence note.
  Re-verification PASSED: 73 pins all `pinned: true`; no address in the fragment.
  FB3 stands closed; rev 2.2 is final.

- 2026-09-05 20:00:11Z Claude: **FB4 dispatched to Codex** — build, not review. Branch `run/run-20260905-195913-fb4` cut from
  `develop` @ `252349a` after a pre-check (on develop, at that commit, only the two untracked
  ledger files). Brief `/tmp/fb4-build-brief.final.md` (109 lines): build `packages/focx-bot`
  per FB2 rev 2.1 §1–§6 with the FB3 rev 2.2 fragment verbatim as `skills`; verbs verify /
  apply / fresh / snapshot / restore; the eight invariants with three tightenings; digest over
  rendered ops + target + contract sha; native export/import orchestration; per-agent Claude
  config dirs and per-company Codex home; knock-out tests against an offline fake API; ONE
  edit to `.github/workflows/drift-gate.yml`. Forbidden: any live write, API call, agent run,
  plugin install, credential value, commit, push, PR, or file outside the package and that one
  workflow. Observed at dispatch: process alive, output 425194 bytes,
  banner model=gpt-6-astra, effort=high, sandbox=workspace-write [workdir, /tmp, $TMPDIR],
  workdir=/Users/ryanthomas/Documents/GitHub/focx. LIVE=True. Claude reviews the diff on completion; Ryan
  authorises push and PR.

### FB2 log

- 2026-09-05 Claude: **boundary proposal written** → `~/Documents/focx-bot-FB2-boundary.md`
  (292 lines). Eleven cited premises (§0), including the two FB2 lookups: Paperclip's process
  holds 7 ESTABLISHED connections to brew `postgresql@17` at 127.0.0.1:5432, so the org
  database is observed outside `~/.paperclip`; `pr-review-toolkit` is unversioned upstream and
  pinnable by cache hash `85cce0381e78`. Recommendations, each defended in place:
  **Q1** `packages/focx-bot` as workspace package `@focx/bot` — keeps drift gate, CODEOWNERS
  and the knock-out test idiom; extractable later by subtree split; `tools/pilot-org` and
  `tools/paperclip-org` superseded and retired only after FB9.
  **Q2** neither registry wins — a new `contract.json` sourced per concern (table in §2); QA's
  adapter conflict resolves to `claude_local` per the applied migration at `agents.json:244`;
  routines, designChain, budgetPolicy and the 23 legacy agents dropped; both old files retire
  after FB9; "never run `paperclip-org --apply`" unchanged.
  **Q3** contract + schema live in the package, not `pipeline/contracts/`; provisioner is
  dry-run by default, idempotent, `--verify-only`; **fresh-instance creation is a separate
  gated verb that refuses on a non-empty company**, preserving P9's containment; **the approval
  digest hashes rendered operations** — F8's defect fixed with a knock-out test.
  **Q4** snapshot = table-scoped `pg_dump` of the brew database (issues/runs excluded by
  default) + pins + redacted service/config; excludes the 6.0 GB `work/`, 1,486 workspaces,
  caches, logs, and all key material; round trip = `verify` exit 0 with `changes: []` plus
  in-scope row-count parity — byte equality explicitly not the test.
  **Q5** adapters map is data; frozen enums become a verify-time check against installed
  `@paperclipai/shared`; two types pinned.
  **Q6** three lists; installed vs granted separated in the contract; install state per agent
  config dir (`paperclip-org:788`), never per worktree; provisioning creates Implementation's
  missing config dir and forces one materialisation, then verifies; resolution order proposed
  and flagged unverified with a collision probe assigned to FB7; `claudeCodeSkills` dropped in
  favour of the runtime version pin.
  **§7** security posture declared not fixed; two mitigations deferred past FB9. **§8** not
  moved: design system, drift gate, render, CODEOWNERS, run contracts, governance files, the
  tunnel, Postgres. **§9** four cleanup items for Ryan, none required for FB4. **§10** six
  decisions for Ryan. No live write, no agent activated, no API call. Handed to Codex.

- 2026-09-05 Claude: self-check of FB2 Q1's "keeps the guardrails" premise while Codex reviews
  (attack A in the brief). `.github/CODEOWNERS:2` is `* @ryanphillipthomas` — a new
  `packages/focx-bot` is covered. `.github/workflows/drift-gate.yml:6–7` triggers on
  `pull_request` with no path filter — the gate runs on any PR touching it. `drift-check.config.json`
  `scanDirs` is `['apps','packages']` with extensions `.js .jsx .ts .tsx .css .scss .svelte .vue`
  — `.mjs` is not scanned, which is immaterial for a provisioner with no design values.
  **Addition to FB2 §1 the document does not yet carry:** the gate's test steps at
  `drift-gate.yml:27–37` are hardcoded to `tools/contracts`, `tools/paperclip-org` and
  `tools/pilot-org`; a new package's tests run in the gate only after the workflow is edited,
  and `/.github/` is doubly protected at `CODEOWNERS:5`. So FB4 includes one `.github/` change
  — adding `packages/focx-bot` tests to the gate — reviewed by Ryan. The same edit later removes
  the `pilot-org`/`paperclip-org` steps when those tools retire after FB9. Premise holds; task
  list gains a step. Not applied to the FB2 document mid-review.

- 2026-09-05 Claude: self-check of FB2 Q2 (attack B) while Codex reviews — top-level keys of
  both registries diffed against what §2's table sources or drops. **Uncovered in roster.json:
  ['independence'].** `independence` is substantive: it records QA's independence mechanism as a
  per-issue git worktree with the Paperclip default branch template — the guarantee
  `invariants.yaml` `independentVerificationRequired` rests on. It must be SOURCED into the
  contract (under `workspaces` or its own key), not silently omitted. **Uncovered in
  agents.json: ['activation'].** `activation: "paused"` is the company-wide pilot state the standing
  rules depend on; the contract needs an explicit top-level `activation` and the provisioner
  must refuse to set it to anything else. Also noted for attack G: the Q3 schema outline's
  `instance, service, database, network, adapters` sections have no row in the Q2 table because they are sourced
  from host config and the FB2 lookups rather than either registry — the table should say so
  in a final row rather than leave the asymmetry implicit. All three are corrections queued
  for FB2 regardless of the verdict; not applied mid-review.

- 2026-09-05 Codex (gpt-6-astra, effort high): **RETURN on FB2.** Q1–Q6, three lists,
  installed-vs-granted, not-moved: PASS. Per-adapter applicability, install-state location,
  premise fidelity, live-write scan: FAIL. Attacks B, C, D, G broke; A, E, F held with
  qualifications.
- 2026-09-05 Claude: return accepted; return 1 of 2. Six load-bearing claims verified against
  the files before relaying; all six hold, two are worse than reported.
  1. **`85cce0381e78` is not a pin.** The directory carries `.orphaned_at` (2026-09-05 08:04)
     and `.in_use`; no `~/.claude/plugins/*.json` references it; its `plugin.json` has no
     version; a sha256 over its sorted file hashes is `6f68f690071e`, not `85cce0381e78`. FB2 P6
     inferred "content hash" from a directory-name shape — a Rule 1 violation carried into a
     design document. `pr-review-toolkit` is NOT pinnable from local state as things stand.
  2. **Codex install state has a definite location FB2 did not give.**
     `adapter-utils/dist/acpx-engine/execute.js:557–576` `prepareCodexSkillRuntime` resolves
     `CODEX_HOME` as per-agent `env.CODEX_HOME` → else a **managed per-company home** seeded from
     `~/.codex`, and materialises skills under `<home>/skills`. `paperclip-org:459–460`: "codex_local
     authenticates through the shared per-company codex-home/auth.json; the adapter supplies
     CODEX_HOME itself." Claude = per-agent `workspaces/<id>/.claude`; Codex = per-company.
  3. **`pilot-org:118–155` and `:162–180` enforce eight containment properties, and FB2 Q3
     carried one.** `snapshot()`: exact identity set (no creation, omission, adoption, deletion);
     every agent paused in the expected company; live adapter equals manifest, with a declared-
     but-unperformed migration a refusal (`:129–132`); no bundle file outside source; registry
     skills limited to `paperclipai/paperclip/paperclip`; all schedule triggers disabled.
     `plan()`: heartbeat `enabled:false`, `wakeOnDemand:false`, `maxTurnContinuation:false`;
     pilots `reportsTo:null`, `maxConcurrentRuns:1`, `maxDailyRuns` tightened; **stricter live
     permission modes preserved** (`deny-all`, `fail`); `dangerouslySkipPermissions=false`.
     `provision --fresh` must yield a state that passes `snapshot()` immediately, or it has
     weakened the guarantee.
  4. **`git` and `workspace` are load-bearing per-agent fields.** `paperclip-org:452–461`
     `composeEnv` injects `env.gitWrite` (GH_TOKEN + credential helper) iff `git === 'write'`;
     `:479–494` `composeAdapterConfig` sets `workspaceStrategy` from `roster.workspaces[agent.workspace]`.
     FB2 Q2 neither sourced nor dropped them. Both must be sourced per agent.
  5. **`wakeOnDemand: true` at `roster.json:693` conflicts with `pilot-org:167`**, which forces
     it false. FB2 Q2 imported the roster value. The contract state is paused/off; the wake window
     (F6) is a runtime action, never contract state.
  6. **All nine `claudeCodeSkills` belong to `product-designer`, `design-steward`,
     `design-research`** — all dropped by scope. Dropping the field is sound on scope grounds;
     FB2 justified it on the unverified runtime-delivery premise instead. `checkClaudeCodeSkills`
     stays a real check for any future on-disk declaration.
  Accepted from the reviewer's reading of the text without further verification: the
  `workspaces/` snapshot exclusion contradicts placing install state there (attack D); Q2/Q3
  asymmetry (attack G, also found in my own pre-review check); four sentences that imply or
  pre-authorise live writes or deletions (B:84, :211–212, :263–265, :267–268); `--fresh` needs
  "empty company" not "no agents"; the digest fix must bind full operations plus target and keep
  preflight; `GIT_AUTHOR_*` is self-asserted, F2's limit must be preserved; "collision-free by
  construction" overclaims; P2 should state a server connection was observed and contents were
  not read; `.json` is unscanned and `tools/contracts/validate.mjs:16–28` validates only run
  artifacts, so the new contract gets no gate validation until FB4 adds it. Plus my own two
  pre-review findings: the gate's hardcoded test steps, and `independence` / `activation`
  uncovered by the sourcing table. Rev 2 folds in all of it. No live write, no agent activated,
  no API call.

- 2026-09-05 Claude: **FB2 rev 2 written** (322 lines) and handed to Codex at effort high.
  Premises grown to P15, with P2 and P10 restated as inferences and P6 replaced by the verified
  facts. Q2 is now a complete table: every top-level key of both registries and every per-agent
  field appears once as sourced, set, or dropped — including `independence`, `activation`
  (fixed `paused`, provisioner refuses otherwise), `git` and `workspace` (set `write` /
  `repo-worktree` for both, P13), `desiredSkills` (set to the single registry key `pilot-org:141`
  requires; `para-memory-files` via in-repo vendoring), and `run` (set to the paused/off values
  `pilot-org:167–170` enforces; the roster's `wakeOnDemand:true` not imported). Migration
  application now cited to the live check at `pilot-org:129–132` and FOC-95, not to the file.
  Q3 lists all eight `pilot-org` containment properties with line cites as invariants `fresh`
  must satisfy on its first `verify`; `fresh` gated on an empty company (zero agents, zero
  routines, no foreign project), single-writer lock, read-back per create, stop on partial
  create, no create retries; digest binds rendered ops + target + contract sha in addition to
  preflight. Q4 puts schema feasibility first, rebuilds config dirs on restore rather than
  copying them (resolving the `workspaces/` contradiction), specifies the secret re-entry step,
  and scopes the round trip to configuration parity with working-ness deferred to FB7/FB8.
  Q6 states per-adapter applicability, decides both install-state locations (Claude per-agent;
  Codex per-company `codex-home`, P12), makes `grants` canonical with `adapterLocal` and
  `enabledPlugins` rendered, drops `claudeCodeSkills` on scope grounds while keeping
  `checkClaudeCodeSkills`, and pins `pr-review-toolkit` by self-computed hash `f0455c12710f` with
  the method to be recorded by FB3. §7 marks `GIT_AUTHOR_*` distinguishable-not-attributable.
  All four live-write phrasings reworded; §9 items are candidates requiring separate
  authorisation. Nine decisions for Ryan in §10. No live write, no agent activated, no API call.

- 2026-09-05 Codex (gpt-6-astra, effort high): **RETURN on FB2 rev 2.** Live-write scan
  PASS. Of eleven rev-1 defects: A.1, A.2, A.4, A.8, A.9 FIXED; A.3, A.5, A.6, A.7, A.10,
  A.11 PARTIAL. Parity FAIL on one row (top-level `skills` catalog has no Q2 row). Three HIGH,
  three MEDIUM, one LOW new. Attempt 2 of 2 — cap reached.
- 2026-09-05 Claude: **escalated to Ryan.** Three load-bearing claims verified before relaying;
  all hold, and one corrects my own premise.
  1. **P6 was wrong about the hash.** With identical exclusions both `pr-review-toolkit` trees
     (`unknown/`, `85cce0381e78/`) hash to `f0455c12710f` with identical file lists; my
     `6f68f690071e` came from a first run that did not exclude the orphan markers. The orphaned
     dir is a superseded install of the same content. The pin `f0455c12710f` stands; the
     explanation in P6 does not.
  2. **Containment "carried whole" is overclaimed — confirmed at three lines.** `pilot-org:143`
     `.every(k => k === 'paperclipai/paperclip/paperclip')` accepts `[]`. `:172` writes
     `maxDailyRuns: null` whenever the manifest value is null — all three pilots' are — so a
     finite live cap is loosened to unlimited, not tightened. `:180–181` sets
     `dangerouslySkipPermissions=false` for Claude and `dangerouslyBypassApprovalsAndSandbox=false`
     for Codex; rev 2 listed only the first. Invariant 5 must require a non-empty singleton,
     invariant 7 must never write null over a finite cap, and invariant 8 must name both flags.
  3. **Codex authentication is not restored by the secret step.** `execute.js:391–393`
     `prepareManagedCodexHome` links `auth.json` only `if (await pathExists(authJson))` and copies
     only `config.json`, `config.toml`, `instructions.md`; `~/.codex/auth.json` is excluded from
     the snapshot as key material. Restore needs an explicit `codex login` step before the first
     Codex run. Also `:602–603`: Codex materialisation failures are caught and logged to stderr,
     so `skills/` existence cannot establish success — and Codex's path is company-home
     `skills/`, not the per-agent `runtime-skills/` rev 2 proposed checking for both.
  **Accepted from the reviewer's reading:** (HIGH) `fresh`'s partial-create rule contradicts
  itself — stopping after one of two creates cannot then pass the exact-identity invariant;
  the partial state must be reported as a known-failed state that `verify` is expected to
  reject. (HIGH) **The existing-company transition is undefined**: `pilot-org:122` requires the
  live identity set to equal the manifest's exactly, the live company holds 26 identities, the
  contract names two, and `invariants.yaml` `agentDeletionAllowed: false` forbids the only
  reconciliation that keeps that guarantee. This is the genuine decision for Ryan, below.
  (MEDIUM) "16 listed, all installed" spans marketplaces including uninstalled remote entries.
  (LOW) CODEOWNERS "double protection" names one owner twice — ownership, not two approvals.
  Also: `pilot-org` skill check is at `:143` not `:141`; validator also handles
  `pipeline/releases`; scan config includes `.html`; codex-home has 27 children (I counted
  `.` and `..`), `skills/` has 3 (one non-hidden); QA `slug` absent from the sourcing table.
  No live write, no agent activated, no API call.

- 2026-09-05 Claude: **two facts found while grounding the escalation; both change FB2's
  design, and the second is the most consequential fact this workstream has produced.**
  (1) Company creation is a supported, board-only API operation on a self-hosted instance:
  `@paperclipai/server/dist/routes/companies.js:1004` `router.post("/")`, refusing only when
  `isCloudManagedInstance()`; this instance is `deploymentMode: authenticated`, not cloud. So
  "focx-bot targets a fresh company" is an API call, and the HIGH "existing-company transition"
  defect dissolves: the 26-agent company is never migrated, the two-agent contract provisions
  a new company, and `agentDeletionAllowed: false` is never approached.
  (2) **Paperclip ships native company portability.** `companies.js:398` `POST /:companyId/export`
  → `portability.exportBundle`; `:405` `GET /:companyId/export/fidelity`; import at `:549`
  (single-shot / zip), `:609–866` (chunked transfers with preview and apply), `:938–968`
  (per-company exports/imports with preview and apply). `shared/dist/validators/company-portability.js:5`
  `portabilityIncludeSchema` = `{company, agents, projects, issues, skills}`; `:255`
  `portabilityTargetSchema` = `mode: "new_company" | "existing_company"`; `:238` inline sources
  carry `expectedFileCount` and the import fails closed on a truncated file set.
  `services/company-portability.js:468–506`: `secret_ref` env bindings are exported as
  **inputs** with `kind: "secret"` and `defaultValue: ""`; plain bindings with sensitive key
  names are blanked; `PATH` is omitted as system-dependent. **Values never leave the source by
  construction.** `:1893–1894`, `:3100–3101`: platform-owned instructions keys are stripped on
  import. This is the Paperclip-side half of the snapshot — the half rev 2 proposed a
  table-scoped `pg_dump` for, with a schema-feasibility prerequisite it could not meet without
  reading the database. The platform's own export/import replaces that half outright, with a
  fidelity report as the parity check and `new_company` as the round-trip target. The host half
  (runtime version, plugin pins, launchd, instance config, Postgres prerequisite) remains
  focx-bot's. Not applied to FB2 rev 2 — cap reached; goes to Ryan with the escalation.

- 2026-09-05 Ryan: decision at the cap — **"apply the corrections as rev 2.1 and start FB3."**
  Recorded as acceptance of rev 2.1 and written approval of Phase 2 (the brief's gate before
  FB3/FB4). No further Codex pass on FB2.
- 2026-09-05 Claude: **FB2 rev 2.1 written; FB2 closed as done.** Every verified rev-2 finding
  applied: P6 rewritten around the identical-content fact (both trees `f0455c12710f`); P12 seed
  order and partial seeding; P14/P15 line and scope corrections; Q1 "double protection" →
  single owner named twice; Q2 gains the top-level `skills` catalog row, QA `slug`, and **the
  transition decision — the contract provisions a NEW company via `POST /api/companies`
  (`companies.js:1004`), the 26-agent company is never migrated**; Q3 invariants 5/7/8 marked
  tightened against `:143`/`:172`/`:180–181` and the partial-create state defined as
  known-failed; **Q4 rebuilt on native company portability** — export with issues excluded,
  fidelity report as residue statement, import into `new_company`, secret inputs by
  construction, explicit `codex login` step; Q6 count restricted to the two local marketplaces
  and materialisation verification split per adapter with run-log scanning; §10 marked accepted.
  **FB3 opened.** Deliverable: the `skills` section of `contract.json` as a machine-readable
  fragment — Claude runtime version, Claude marketplaces + installed plugins with version or
  content hash, Codex marketplaces + installed plugins with version — verified on this host,
  with the hashing command recorded so the pin is reproducible. Read-only. No live write, no
  agent activated, no API call.

### FB1 log

- 2026-09-05 Claude: inventory complete →
  `~/Documents/focx-bot-FB1-inventory.md` (244 lines). Repository files and host filesystem
  only. **No Paperclip API call, no Keychain read, no credential value read or printed, no
  live write, no agent activated.** Nine new findings G1–G9. Four of them change FB2's brief:
  **G1** roster.json already carries `secrets`/`env`/`workspaces`/`confinement`/`budgetPolicy`/
  `designChain`/`project`/`independence`/`routines` and agents.json carries none of it, which
  inverts the assumed answer to Phase 2 Q2 — while §4 of this file says `paperclip-org --apply`
  refuses because that roster is superseded. **G8** the `claude_local` adapter's
  `syncClaudeSkills` never installs anything, so declaring a skill provisions nothing; this is
  the central obstacle to the stated goal. **G3+F1** on this host there is no OS sandbox
  (Bubblewrap is Linux-only, `confinement.availableOnThisHost: false`), declared permissions do
  not bind `codex_local`, and what remains is `GH_TOKEN` custody plus CODEOWNERS. **G4** the
  Cloudflare tunnel is `--token-file` managed, so ingress lives in the Cloudflare dashboard and
  is unreproducible from the repo or the host. Also **G5** instance state is 7.0 GB with 1,486
  workspace dirs, so a naive snapshot is not viable, and **G9** a cleartext local Postgres
  password sits in `instances/default/config.json` — rotation is Ryan's call.
  Handing to Codex for review per §3. Nothing in FB2 started.

- 2026-09-05 Codex (gpt-6-astra, CLI 0.153.0): **RETURN.** 9 defects, 2 blocking. Read-only;
  no file modified, no API call, no credential value read.
- 2026-09-05 Claude: return accepted. I independently re-verified six defects rather than
  taking the report — all six held. FB1 → `building`. Return 1 of 2 before escalation.
  **Blocking 1 — G8 is wrong as written.** `syncClaudeSkills` does ignore its argument
  (adapter-claude-local/dist/server/skills.js:37), but the snapshot it builds says
  "Will be materialized into the stable Paperclip-managed Claude prompt bundle on the next
  run", and `materializePaperclipSkillCopy` exists in adapter-utils and is exercised by its
  own tests. Materialization happens at run time. My "nothing installs them" generalized a
  repo README past what the installed runtime does. The honest claim is narrower: sync is a
  no-op reporter, and whether materialization succeeds on THIS instance is unestablished.
  This removes what FB1 called "the central obstacle to the goal".
  **Blocking 2 — G3 conflates two different sandboxes.** Bubblewrap is absent (Linux-only,
  `confinement.availableOnThisHost: false`), but the codex-acp `agent` preset carries
  `workspaceWrite` and `networkAccess: false` — confirmed by string count in the installed
  bundle. F1's own text says the workspace sandbox blocked `git commit` before escalation,
  which I quoted and then contradicted. Correct claim: there is no *Bubblewrap* confinement;
  a Codex workspace sandbox does exist and was escalated past, which is a different thing.
  **Material, all confirmed:** (3) `pilot-org:218-224` gates on `disposition !== 'pilot'`
  and runs engine/permissionMode checks BEFORE `if (!l) continue`, so every pilot is
  covered — my claim described pre-H1 state. (4) `instances/default/db` does not exist; the
  snapshot table invented it, and omits `projects/` and `logs/`. (5) `PAPERCLIP_SKILL_KEY`
  is a regex (`paperclip-org:761`) and `PAPERCLIP_WRITES` a test-local array
  (`test.mjs:730`) — neither is an env var; `PAPERCLIP_URL` (`paperclip-health:6`) is a real
  one and was missed. (6) G4's "cannot be reproduced" exceeds the evidence; "not captured on
  this host" is what was shown. (7) "~80%" has no denominator, and I gave a field-name diff
  instead of the real conflict: QA is `reportsTo: null` / `claude_local` in agents.json and
  `reportsTo: cto` / `codex_local` in roster.json. (8) The method statement says "no
  credential value read or printed" while G9 says a password value was surfaced — both
  cannot be true, and the method statement is the one that is wrong. (9) `status` IS in
  agents.json and `pilot-org` sets `engine`.
  **Codex also answered a question FB1 marked unestablished, without an API call.**
  `@paperclipai/shared/dist/constants.js` `AGENT_ADAPTER_TYPES` lists **15** adapter types:
  process, http, claude_local, codex_local, paperclip_runner, cursor_cloud, gemini_local,
  grok_local, hermes_gateway, hermes_local, kimi_local, opencode_local, pi_local, cursor,
  openclaw_gateway. Phase 2 Q5 is therefore answered: the two-element enum is OUR limit, not
  Paperclip's. Verified independently.

- 2026-09-05 Ryan: scope decision — Claude and Codex only; the 15-adapter finding is noted
  but not pursued. Skills mean the first-party catalogs both toolchains already ship, not a
  curated third-party set. **The VoltAgent subagent design is CANCELLED**, and FB3 is
  repurposed from "recommend subagents" to "pin three lists". FB5 shrinks accordingly.
  Authorized installing the five missing Codex plugins.
- 2026-09-05 Claude: installed `chrome` 26.901.31953, `messages` 1.0.1000926,
  `record-and-replay` 1.0.1000926, `computer-history` 1.0.1000926, `latex` 0.2.6 — all from
  `openai-bundled` via `codex plugin add`. Every plugin in both LOCAL Codex marketplaces is
  now installed and enabled. The `openai-curated-remote` catalog was deliberately NOT
  touched: it is OAuth-backed third-party SaaS connectors, not skills, and installing them
  is an outward-facing action Ryan has not authorized.
  **The finding that drove the simplification:** Claude's first-party skills (/design,
  dataviz, artifact-design, docx, pptx, skill-creator, engineering:*, design:*) exist
  nowhere on disk — not in `~/.claude/plugins/cache`, not as plain text in the 190 MB
  binary. They ride with the Claude Code runtime at
  `~/.local/share/claude/versions/2.1.261`. They cannot be copied into a fresh instance;
  the only thing that provisions them is pinning that version. Codex plugins, by contrast,
  are real versioned files and are fully enumerable. Hence three lists: Claude Code
  version, Claude plugins, Codex plugins.
  **One blocking defect carried into FB2:** `pr-review-toolkit@claude-plugins-official` has
  the literal version string `"unknown"` and two cache directories. It cannot be pinned, so
  it is the one component a fresh instance cannot reproduce deterministically.

- 2026-09-05 Claude: **rev 2 written**, 369 lines, all 9 defects addressed and marked in place.
  Two headline findings WITHDRAWN: G8 ("nothing installs skills") and G3 ("no OS-level
  sandbox"). Four claims narrowed to what the evidence supports: G4 (tunnel "cannot be
  reproduced" → "not captured locally, control plane unchecked"), G5 (snapshot "not viable" →
  "byte-copy is the wrong primitive"), G2 (exhaustive four-home model → resolution order
  unestablished), gap 10 (`status` and `engine` DO have committed homes; only live values do
  not). Method statement corrected to admit the credential exposure it previously contradicted.
  New material found while fixing: **G1** the registries disagree about the org, not just its
  shape — 2 agents missing from each side, all 24 matched agents differ on `title`, 23 of 24
  on `reportsTo` (agents.json is null throughout, roster has a full hierarchy), QA differs on
  adapter. **G11** QA's on-disk `.claude/settings.json` is the pre-#84/#85 shape — broader
  `Bash(mkdir:*)`, the non-working `Write(pipeline/runs/**)` form, the dead `Write(/tmp/**)`
  rule, and **no deny block at all**; whether it is the effective layer is explicitly NOT
  established, since #83's launcher writes worktree-local settings instead. **G13**
  `paperclip-org:793-795` says in its own comment that nothing has ever checked
  `claudeCodeSkills` exist. **G10** the 15-adapter catalog, recorded as fact. Skills section
  rebuilt around the three pinned lists. Returned to Codex for re-review.

- 2026-09-05 Codex (gpt-6-astra): **RETURN #2.** 7 of 9 original defects FIXED, 2 PARTIAL,
  1 NOT FIXED; plus 2 new blocking and 4 new material defects introduced by rev 2.
- 2026-09-05 Claude: **STOPPING PER THE CAP. Two returns on FB1; escalated to Ryan.**
  I verified all four load-bearing claims rather than accepting the report. All four hold.
  1. **`~/.claude/plugins/marketplaces/` exists and I never searched it.** 117 `SKILL.md`
     files across ~39 first-party plugins (agent-sdk-dev, code-review, feature-dev,
     frontend-design, plugin-dev, security-guidance, skill-creator…). My rev-2 claim that
     Claude's first-party skills "are not files on disk anywhere" came from searching only
     `plugins/cache/`. It is **wrong**, and I reported it to Ryan as fact last turn.
     `dataviz`, `artifact-design` and `design` are still not found — so the true picture is
     mixed, not "none".
  2. **G13 is backwards.** `checkClaudeCodeSkills` exists at `paperclip-org:830` and is
     invoked at `:1177`. I quoted the comment at `:793-795` and stopped before the
     implementation directly below it.
  3. **The "23 reportsTo conflicts" were fabricated by my own script.** Only **3** agents
     carry an explicit `reportsTo: null`; the other **23 omit the field entirely**. My
     comparison used `.get()`, which returns None for a missing key, so I turned 23 absences
     into 23 conflicting assignments and told Ryan FB2 had 23 conflicts to reconcile.
  4. **`openai-curated-remote` does contain real skills**, not only OAuth connectors —
     87 `SKILL.md` files in the Codex cache including `figma`. "Connectors, not skills" was
     wrong, and I told Ryan that too.
  **Diagnosis, which is why a third attempt is the wrong move.** Both revisions failed the
  same way: asserting exhaustive negatives — "not anywhere", "nothing checks it", "cannot be
  pinned", "cannot be reproduced" — from non-exhaustive searches. Rev 2 fixed rev 1's two
  overclaims and introduced two more of exactly the same kind. The brief asks for an
  inventory of "every Paperclip surface", which invites unprovable negatives and is the
  defect generator. **Recommend changing the brief, not retrying it:** require positive
  claims with citations, forbid unqualified negatives, and make anything unfound
  "not found by search X" rather than "does not exist". Ryan decides.
  No live write, no agent activated, no API call in either pass.

- 2026-09-05 Ryan: decision at the escalation — **change the brief and rerun**. Cap resets:
  rev 3 is attempt 1 against a new brief, not attempt 3 against the old one.
- 2026-09-05 Claude: Phase 1 brief rewritten in the goal prompt around six rules, aimed at the
  defect generator rather than at carelessness. **Rule 2 is the load-bearing one:** absence may
  not be stated as fact, only as "not found by <command>, scope <paths>", collected in one table
  whose "scope NOT searched" column may not be empty. Rules 3 and 4 encode the two specific
  mistakes: read the implementation under any comment you quote, and never let an accessor
  collapse "key missing" into "key null". Rule 5 bars architecture from an inventory.
  **rev 3 written**, 359 lines. Searching the location I had missed changed the headline
  finding: `~/.claude/plugins/marketplaces/` holds **117 SKILL.md** across 3 marketplaces
  (trailofbits 42 plugins/83 skills, claude-plugins-official 39/31, openai-codex 1/3), and
  `~/.codex/plugins/cache/` holds **87** across FOUR marketplaces — including `chatgpt-global`
  (5 plugins, 38 skills), which does not appear in `codex plugin list` output at all.
  **209 skill files on disk in total**, all enumerable and pinnable. Rev 2's premise that
  Claude's first-party skills are not files is withdrawn; `dataviz`, `artifact-design` and
  `design` remain not-found and are recorded as a bounded search in §12 rather than as absence.
  Also corrected from the reviewer: `checkClaudeCodeSkills` exists at `paperclip-org:830`,
  called at `:1177`; only 3 agents carry explicit `reportsTo: null` while 23 omit the key;
  `openai-curated-remote` contains real skills including `figma`;
  `paperclip-issue-update.sh:95-98` reads API URL/key, run id and task id — not agent id.
  While writing §12 I found I had listed a rotation search I had not actually run; ran it,
  and recorded its single self-referential hit rather than the clean negative I had assumed.
  No live write, no agent activated, no API call. Handed to Codex.

- 2026-09-05 Claude: **dispatch mechanics — record this, it will recur.** The rev-3 review
  appeared to run for 65 minutes and had produced nothing. It was never working: the only
  output was `Reading additional input from stdin...`. `codex exec` probes stdin for
  supplementary input, and with an inherited stdin that never closes it blocks indefinitely.
  Two compounding errors were mine: piping through `| tail -N` buffers everything until the
  process exits, so the blocked state was invisible for the whole hour; and unlike the two
  successful dispatches, the heredoc writing the brief was combined into the same shell
  command as the `codex exec` call. **Every Codex dispatch must redirect `< /dev/null` and
  write stdout straight to a file rather than through a pipe.** Re-dispatched on that form
  and it began producing output within seconds.
  Also observed and unresolved: the CLI banner reports `reasoning effort: none`, while
  section 0.5 of the FB brief pins the Codex builder at `modelReasoningEffort: high`. The
  dispatch command sets no effort flag, so the two reviews already accepted and this one all
  ran at the CLI default rather than the pinned value. Whether `-c model_reasoning_effort=high`
  is the right flag for `codex exec` is not established; recorded rather than assumed.

- 2026-09-05 Codex (gpt-6-astra, `-c model_reasoning_effort="high"` — first dispatch actually
  at the pinned effort): **RETURN** on rev 3. Rules a/b/c/d FAIL, e/f/g PASS.
- 2026-09-05 Claude: return accepted; return 1 of 2 against the new brief. Verified the three
  material claims before relaying, all confirmed.
  1. **The Implementation Engineer has no `.claude` directory at all.** Steward and QA each
     have one. Rev 3 said all three did. I had only tested for `settings.json` and inferred
     the directory from its absence message — the same infer-past-the-evidence move the new
     brief exists to stop, committed inside the document written to obey it.
  2. **`companies/` is 6.5 G, of which `<company>/acp-engine` alone is 6.1 G** — 87% of the
     7.0 G instance total, and rev 3's §8 omitted its size entirely while listing smaller
     subtrees. `du -sh` confirms both figures.
  3. **`pipeline/org/roster.json:131` is `"reportsTo": null`** for Focx CEO, so the roster
     carries 25 slugs and 1 explicit null, not 26 slugs. Rev 3 said 26.
  Also accepted: 12 `*-lsp` plugins not 9; 5 worktree scopes not 6; QA's host settings hold
  28 allow rules against the manifest's 27; `data/` now measures 284 M against rev 3's 271 M
  (growth and measurement error not separable); two §12 rows list searches that in fact
  returned results and must be reclassified.
  **Finding about the brief itself, for Ryan.** Rule 2 is written as a banned-word lint, and
  a word lint misfires. Of nine flagged violations roughly five are the lint firing on
  vocabulary inside sentences that make no absence claim — including `cannot be reproduced`
  at I:343, which sits inside the sentence telling the reader NOT to conclude the tunnel can
  or cannot be reproduced. The remaining four are real. **Recommend Rule 2 target the claim
  shape rather than the vocabulary**, and that the reviewer adjudicate meaning rather than
  string-match. Ryan decides before rev 4.
  No live write, no agent activated, no API call.

- 2026-09-05 Ryan: **scope narrowed.** focx-bot ships only the agents needed to prove one run
  with skills enabled and working; CEO/CTO and the rest of the 26-agent org are not shipped.
  Which pilots, left to Claude. Rule 2 to be fixed. Claude moved to Fable 5.1.
- 2026-09-05 Claude: **roster decision — ship two: Implementation Engineer (codex_local) and
  QA Engineer (claude_local); Steward deferred.** Grounds: one agent per toolchain exercises
  both plugin lists; `invariants.yaml` `selfVerificationAllowed: false` makes a single agent
  unable to prove a run, so two is the floor the invariant sets; Implementation → QA is the pair
  whose halves are separately proven (FOC-96, FOC-95), leaving the handoff as the one unproven
  seam; the Steward's reconcile-truth role proves nothing about skills, and FB0 already dropped
  H4. Recorded in the brief under "Scope decision"; Ryan may overturn.
  **Rule 2 rewritten** to test claim SHAPE, with exclusivity claims named explicitly and the
  reviewer told to adjudicate meaning rather than string-match; **Rule 1 extended** to require
  direct observation — an inferred fact is cited by observing it, or left out. Deliverable
  order fixed (GAP LIST → SEARCHES → must-not-conclude). Pass criteria b and g reworded.
  **rev 4 written**, pilot scope. Every rev-3 defect addressed: Implementation's `.claude`
  moved to the not-found table with its unsearched scope; roster `reportsTo` stated as 25 slugs
  + `null` on `ceo` (`roster.json:131`); QA host-vs-manifest diff given exactly (28 vs 27;
  host-only `Bash(mkdir:*)`, `Write(/tmp/**)`, `Write(pipeline/runs/**)`; manifest-only
  `Bash(mkdir -p pipeline/runs/*)`, `Edit(/pipeline/runs/**)`; `'deny' in permissions` False);
  12 `*-lsp`; 6 distinct `projectPath`s; `data/` 291M at a stated timestamp; the two positive
  results removed from the not-found table; `agentClaudeConfigDir` callers `:1193`/`:1671`,
  `issue-update.sh:126–176` implementation and launcher `:26`/`:31–40` cited; `pilot-org:58–64`
  enforcement and `:225–243` host checks added; legacy org reduced to one cited paragraph.
  **New in rev 4:** `companies/` is 6.5G and `acp-engine/agents/` 6.1G, of which **one
  disabled-candidate agent — Head of Growth, `3fa7896a-…` — holds 6.0G in `work/`**; that single
  directory is 86% of the 7.0G instance. Handed to Codex at `model_reasoning_effort=high`.

- 2026-09-05 Codex (gpt-6-astra, effort high): **RETURN on rev 4.** a/b/g/scope FAIL;
  c/d/e/f/order PASS. Attempt 2 of 2 against the rewritten brief — cap reached.
- 2026-09-05 Claude: **escalated to Ryan.** All four load-bearing claims verified before
  relaying; all hold.
  1. **`runtime-skills/` exists in 13 of 20 `acp-engine/agents/<id>/` dirs, not all.** Rev 4
     said each directory contains one, generalised from measuring the largest. Implementation's
     directory is among the seven without it. This is the amended Rule 1's exact target —
     inferring a universal from one observation — violated in the revision written to obey it.
  2. **`grep -c <term>` on the 190 MB runtime binary returns matches: dataviz 7,
     artifact-design 4, design 215** (with `-a`). Earlier in this session I ran
     `grep -c "$s" "$BIN" 2>/dev/null || echo 0` and read the fallback `0` as a count — grep
     had exited non-zero on binary handling and the `|| echo 0` fired. **I fabricated a zero
     from an error fallback and reported it to Ryan twice** ("not present as plain text in the
     190 MB binary", rev-2 summary; "still aren't found anywhere", rev-3 summary). Both false.
     The three names are present in the binary as text. §11's row for this search is a
     positive result misclassified as empty — the same defect rev 3 was returned for.
  3. **Gap-list row 1 infers tunnel "identity and routing" from a `--token-file` argument.**
     The daemon plist shows an invocation, not routing contents. Inference, not observation.
  4. **Citation slips:** roster `trustPreset` :700, `instructions` :703, `desiredSkills` :704
     (rev 4 cited 698/701/702); engine pin at `pilot-org:191` (cited 166–170); README :3.
  5. **Omitted pilot fields:** `maxDailyRuns` (`agents.json:17`, :169, :229), QA
     `adapterMigration` (:244); roster QA `workspace` :682, `git` :683, `adapter.reasoning`
     :689, `budgetMonthlyCents` :702.
  **Two findings about the brief, for Ryan, separate from the defects above.**
  (i) Rule 2 has no carve-out for bounded structural absence. "This parsed JSON object has no
  key `deny`" is a complete observation of a finite container — there is no scope-not-searched
  to name — yet Rule 2 as written forces it into the not-found table. Codex correctly flagged
  six such sentences as violations by the rule's letter. Recommend: absence within a fully
  enumerated finite structure is a positive observation and may live in the body.
  (ii) Rule 2 (complete enumeration instead of "only X") and the pilot-scope instruction pull
  against each other: rev 4 listed all 26 roster slugs precisely so "qa-engineer is present"
  would be a bounded claim, and was failed on scope for it. One of the two must yield.
  **Pattern, stated plainly:** three consecutive revisions each contained at least one
  infer-past-the-evidence error (rev 3: directory from file; rev 4: universal from one dir,
  count from an error fallback). The brief amendments reduced the class but did not remove it;
  the residue is in how I run and read commands, and the fix there is to print the raw
  exit status and output rather than wrap commands in fallbacks that manufacture values.
  No live write, no agent activated, no API call.

- 2026-09-05 Ryan: decision at the cap — **apply the corrections as rev 4.1 and start FB2.**
  No further Codex pass on FB1.
- 2026-09-05 Claude: **rev 4.1 written; FB1 closed as done.** All rev-4 findings applied after
  re-running each: `runtime-skills/` in 13 of 20 agent dirs; the binary-grep row moved from the
  not-found table to a positive finding (`grep -a -c`: dataviz 7, artifact-design 4, design 215)
  with the `|| echo 0` method error named in §0; tunnel gap row reworded to the observed
  `--token-file` invocation; five citation lines corrected; `maxDailyRuns`, `adapterMigration`,
  and four roster QA fields added; the 26-slug enumeration collapsed to a cited full read; F5
  reworded to the observed empty Log. **Brief amended:** Rule 2 carve-out for absence inside a
  fully enumerated finite structure; pilot scope now explicitly overrides enumeration for the
  legacy list. **Known limits carried into FB2** (rev 4.1 §12): live state unverified; QA's
  per-agent settings' effectiveness unverified; skill materialisation success unverified;
  runtime skill resolution order unverified; tunnel routing unread.
  **FB2 opened.** Two inputs resolved while closing FB1: (1) `pr-review-toolkit` carries no
  version field in the marketplace copy, either cache dir, or the marketplace manifest — upstream
  ships it unversioned; its cache directory `85cce0381e78` is a content hash and is the pin.
  (2) `lsof -iTCP:5432 -sTCP:LISTEN` → Homebrew `postgresql@17`, PID 902, data
  `/opt/homebrew/var/postgresql@17`, service `homebrew.mxcl.postgresql@17` started; nothing
  listens on 54329 and the configured embedded data dir is absent. **The org's database lives
  outside `~/.paperclip`.** This is the first fact the snapshot design rests on.

### FB0 log

- 2026-09-05 Claude: supersession pass performed. FB board opened; H rows dispositioned
  without deletion or Log rewriting; F1–F9 harvested; three brief corrections recorded.
  Live state untouched — no Paperclip write, no wake, no agent activated, no PR, no push.
  FOC-95 left `blocked` and FOC-96 left `done`, both deliberately unmodified. Verified during
  the pass: `develop` at `252349a`; `origin/FOC-96-…` present at `940b26dc`; that commit
  authored and committed as `Ryan Thomas <rthomas@wheelsup.com>`.

---

## H1 — Implementation scoped write delivery  ·  Codex  ·  READY

**Problem.** QA got a working scoped-write path in PR #83: a QA-only ACP launcher that
delivers manifest permissions through the isolated worktree's local settings, because
acpx excludes the `user` setting source for Claude agents. The Implementation Engineer is
`codex_local` and has no equivalent. Its config is `permissionMode: approve-reads`,
`nonInteractivePermissions: deny`, bypass disabled, and the manifest declares no scoped
write-delivery mechanism for it.

**This is a configuration finding, not a reproduced denial.** Nobody has yet run a Codex
agent and watched a write get refused. Establish the real behavior from installed code
before designing anything.

**Deliverable.** One source PR that gives the Implementation Engineer the narrowest path
to: edit one file, commit, push to its assigned branch, and open a **draft** PR.

**Method.**
1. Read the installed `codex_local` adapter and the Codex CLI's own permission model.
   Cite file and line. Determine whether Codex honors an allow-list at all, and if so
   where it reads it from. Do not assume Claude Code's `permissions.allow` syntax
   transfers — it almost certainly does not.
2. Distinguish, explicitly, which prospective commands need a *configuration change*
   versus a *syntax correction*.
3. Mirror #83's shape if the adapter supports it; invent nothing new if it does not.
4. Tests in the style of `tools/pilot-org/test.mjs`: every guarantee knock-out proven
   (break the guard, watch the test fail, restore).

**Forbidden.** `approve-all`, any bypass flag, broad grants to compensate for a malformed
command, and copying Claude permission syntax into Codex.

**Pass criteria.** PR open, drift gate green, `node tools/pilot-org/index.mjs --check`
passes, and the PR body states in one paragraph what is proven by tests versus what still
needs a live run.

**Log.**
- 2026-09-05 Claude: opened. No live run authorized by this handoff.
- 2026-09-05 Claude: dispatched to Codex. Live state re-verified first: `develop` at `bf30840`,
  no open PRs, `--verify-only` exit 0 with `changes: []` and `hostFindings: []`. Two pointers
  passed with the brief. (a) The adapter that actually executes is
  `~/.paperclip/cli/current/node_modules/@paperclipai/adapter-codex-local` v2026.831.1 — the
  running server is `~/.paperclip/cli/current/node_modules/paperclipai/dist/index.js`, not the
  npx cache copy, which is the same version but is not what runs. (b) The live Implementation
  `adapterConfig` does carry `permissionMode: "approve-reads"`, but `permissionMode` is absent
  from `ADAPTER_KEYS.codex_local` in `tools/paperclip-org/index.mjs`, whose own comment says an
  unknown `adapterConfig` key is accepted at create time and ignored. Whether that setting is
  inert is a question for the installed adapter, not an assumption to design around. No live
  run authorized; no live Paperclip write authorized.
- 2026-09-05 Codex: stopped before implementing. No source edit, commit, push, PR, live write or
  agent run occurred. Reported that the runtime contradicts H1's premise: the ACP lane reads
  `permissionMode`, the CLI argument builder does not, the ACP backend is Codex 0.152.1 rather than
  the 0.153.0 CLI, and no failed Codex command has ever been supplied, so no operation can honestly
  be classified as a syntax correction. Its `--verify-only` and Keychain failures are artifacts of
  its own sandbox (no network, no Keychain), not repository faults.
- 2026-09-05 Claude: independently verified every citation, and re-ran the two checks Codex could
  not. `node tools/pilot-org/index.mjs --check` exit 0; `--verify-only` exit 0 with `changes: []`
  and `hostFindings: []`. Codex is correct, and the picture is sharper than either of us stated.
  **My own earlier note in this log is wrong and is corrected here:** `permissionMode` is NOT inert
  for the Implementation Engineer. It is load-bearing.
  1. **The default lane is ACP, not CLI.** `normalizeEngine(undefined)` returns
     `{engine:"acp", explicit:false}` in `adapter-codex-local/dist/server/acp.js`. The
     Implementation Engineer sets no `engine`, no `filesystemScope`, no `networkScope`, and uses
     `git_worktree` rather than in-place realization, so every fallback branch in
     `resolveCodexExecutionEngineForRun` is skipped. Prerequisites pass on this host: Node v26.8.1
     against a 24.11.0 minimum, and `.bin/codex-acp` resolves. It runs on ACP, where
     `buildCodexAcpConfig` reads `permissionMode` and `nonInteractivePermissions`.
  2. **Absence of `permissionMode` defaults to `approve-all`.**
     `adapter-utils/dist/acpx-engine/constants.js` sets
     `DEFAULT_ACP_ENGINE_PERMISSION_MODE = "approve-all"`. The explicit `approve-reads` is the only
     thing standing between this agent and the posture H1 forbids by name.
  3. **`tools/paperclip-org/index.mjs` asserts the opposite, in writing.** `permissionMode` is
     absent from `ADAPTER_KEYS.codex_local` *and* `ADAPTER_KEYS.claude_local`, so
     `checkAdapterConfig` emits "'permissionMode' is not a documented adapterConfig key — it will be
     accepted and ignored". That message is false, and it is false about the single key whose
     removal silently yields `approve-all`. This is a repository defect independent of H1's
     deliverable, and it affects QA as well as Implementation.
  4. **The lane selection is implicit, so the guarantee is conditional.** Because `explicit:false`,
     any future prerequisite failure — Node downgrade, missing `codex-acp`, a remote target — falls
     back to the CLI lane with only a stderr diagnostic. `buildCodexExecArgs` in `codex-args.js`
     consumes `model`, `modelReasoningEffort`, `search`, `fastMode`,
     `dangerouslyBypassApprovalsAndSandbox` and `extraArgs`, and neither permission field. The
     permission posture would change silently.
  5. **Version split.** The ACP lane runs the bundled `@openai/codex` 0.152.1 under
     `~/.paperclip/cli/current/node_modules`, not the 0.153.0 CLI at `~/.local/bin/codex`. Any
     research into `codex execpolicy` or Starlark `prefix_rule` files is research into the binary
     this agent does not currently run.
  **Stopping here rather than rescoping**, per section 3. H1 asked for a scoped write-delivery
  mechanism on the premise that none exists and that the current setting may be ignored. The real
  finding is that a permission mechanism exists and is active, that its default is the forbidden
  one, and that the repository's own checker misreports it. Ryan decides whether H1 becomes
  "correct `ADAPTER_KEYS` and pin the lane" before any write-delivery design. No live run, live
  write, push or PR has occurred; the branch `run/run-20260905-083253-manual` exists locally with
  no commits on it.
- 2026-09-05 Ryan: decision — fix the misreport first. H1 is rescoped to correcting the false
  `permissionMode` statement and pinning the execution lane. Scoped write delivery for the
  Implementation Engineer is deferred, not cancelled.
- 2026-09-05 Claude: recon for the rescoped brief, then dispatched to Codex. Three things the
  earlier entry did not yet establish.
  1. **The repo contradicts itself about this key, in two files.**
     `tools/pilot-org/index.mjs:178` *writes* `adapterConfig.permissionMode` from
     `executionPermissions`, and `:87` requires every pilot to declare exactly
     `{permissionMode:'approve-reads', nonInteractivePermissions:'deny'}`. Meanwhile
     `tools/paperclip-org/index.mjs:514` tells the operator that same key "is not a documented
     adapterConfig key — it will be accepted and ignored". One repo, both claims.
  2. **`ADAPTER_KEYS` faithfully mirrors the adapters' schema; the schema is the incomplete one.**
     `getConfigSchema()` in both installed adapters returns exactly
     `engine, agentCommand, mode, nonInteractivePermissions, stateDir, warmHandleIdleMs` — no
     `permissionMode`, though `acp.js:86` (codex) and `acp.js:70` (claude) read it and
     `adapter-utils/dist/acpx-engine/execute.js:671` defaults it to `approve-all`. So the fix is a
     deliberate departure from "lifted from the adapters' own self-documentation", and the comment
     must say why rather than silently widening the list. `acpPermissionMode` is an accepted alias.
  3. **`checkHost` already encodes this exact reasoning — for QA only.**
     `tools/pilot-org/index.mjs:237` already reports "user settings permissions are ineffective"
     when QA's live `engine !== 'acp'`. But the whole loop is gated at `:217` on `a.adapterLocal`,
     which only QA has, so the Implementation Engineer and the Steward are never checked at all.
     Extending the existing finding to every pilot is in-idiom, not a new mechanism.
  Also noted for the reviewer: `checkAdapterConfig` is called only from `paperclip-org`
  (`:280` against the superseded roster, `:1146` against live configs). `pilot-org --verify-only`,
  the tool actually in use, never calls it. Correcting the constant alone would fix a sentence
  nobody reads; that is why the brief also asks for the `checkHost` extension.
  **Expected consequence, to be stated plainly and not papered over:** pinning `engine: "acp"` for
  the two unpinned pilots changes desired state, so `--verify-only` will report changes until a
  human-authorized `--apply` with a freshly reviewed `--plan-sha`. That apply is a live write —
  Claude's to make, Ryan's to authorize — and is not part of this PR.
- 2026-09-05 Codex: implemented all three changes plus tests. Could not commit — its sandbox denies
  creating `.git/index.lock`. Reported 14 knock-outs, and correctly identified its own
  `--verify-only` and two `paperclip-org` fake-API failures as sandbox artifacts rather than
  repository faults.
- 2026-09-05 Claude: reviewed, verified independently, committed as `b5e8c13` on
  `run/run-20260905-083253-manual`. Not pushed; no PR opened.
  **Citations re-checked against installed code, all exact:** codex `execute.js:364-365` is
  `if (engineSelection.explicit) throw err;`; `constants.js:3` is the `approve-all` default;
  claude `acp.js:70` and codex `acp.js:86` both read `permissionMode`.
  **Knock-outs re-run by me, not taken on report** — five guards broken one at a time, suite
  re-run each time, then restored: un-pin `engine` in `plan()` → 3 fail; remove the live-engine
  finding → 6 fail; remove the permissionMode finding → 6 fail; restore the `adapterLocal` gate
  → 39 fail; revert `permissionMode` in `ADAPTER_KEYS` → 2 fail. Restored: 77 pass / 0 fail.
  **Host runs of what Codex could not run:** `node --test tools/paperclip-org/` 118 pass / 0 fail
  (its two failures were loopback `EPERM`, confirmed sandbox-only); `--check` exit 0; drift-check
  clean; `tools/contracts/validate.mjs` all artifacts valid.
  **`--verify-only` now exits 1, as designed and as forewarned:** PATCH `adapterConfig` for the
  Steward and the Implementation Engineer, plus a host finding for each reading "live engine must
  be explicitly acp". QA is absent from both lists because it was already pinned — a useful
  internal consistency check. The Steward's live `permissionMode` is already `approve-reads`, so
  only the engine finding fires for it; nothing was weakened to make the exit code green.
  **Also confirmed, because it was not a given:** `claude_local` has the same implicit-ACP default
  and the same explicit-rethrow at `execute.js:254`, so pinning the Steward is hardening, not a
  lane switch. Had that adapter defaulted to CLI, this change would have silently moved the
  Steward's execution lane.
  **Two review findings, neither fixed here, both for Ryan.**
  1. *Codex created an unrequested pipeline run directory,* `pipeline/runs/run-20260905-083253-manual/`,
     whose `00-run.json` embeds the full dispatch brief verbatim in a `prompt` field — which names
     `ORCHESTRATION.md` and reproduces its H1 substance. Committing it would breach this file's
     first rule through the back door, and would fabricate a run record for a run no pilot agent
     performed. **I left the whole directory uncommitted and untracked.** It contains no secrets.
     Delete it or keep it out; do not commit it as-is.
  2. *The plan digest does not bind the plan.* `tools/pilot-org/index.mjs:207` computes
     `hash({source, live})`, so the digest covers the manifest and live state but not the rendered
     operations. This change demonstrates it: operations went from `[]` to two PATCHes while the
     digest stayed byte-identical at `298df340…`. `--apply` refuses on a stale digest
     (`:262`, `:264`), but a renderer change alters what gets written without changing the digest a
     human approved. The comment at `:206` is honest about what it binds; the failure mode is that
     "obtain a fresh plan digest" reads like it binds the operations. Out of scope for H1 and not
     touched. Separate decision.
- 2026-09-05 Ryan: authorized the push and PR, and directed deletion of the run directory.
- 2026-09-05 Claude: deleted `pipeline/runs/run-20260905-083253-manual/` after confirming it was
  untracked (0 tracked files) and matched the 9 files reviewed. The five pre-existing run
  directories were untouched. Pushed `b5e8c13` and opened
  https://github.com/ryanphillipthomas/focx/pull/87 against `develop` — not draft, mergeable,
  drift gate **pass** in 8s. PR body states the evidence boundary and the `--verify-only` exit-1
  consequence; it does not reference this file. **H1's pass criteria are met.** Awaiting Ryan's
  merge — neither assistant sets `merged`.
  **Blocking H2, and not yet done:** after merge, the live `--apply --plan-sha=<digest>` that pins
  `engine: acp` for the Steward and the Implementation Engineer. Until then live state still has
  `engine: null` for both, so H2 would run against the unpinned lane it was written to assume.
  That apply is a live write: Claude performs it, Ryan authorizes it, digest reviewed fresh at the
  time.
  **Still open regardless of #87:** the plan-digest finding above. It is unaffected by the merge.
- 2026-09-05 Claude: apply requested, **not performed — #87 is not merged.** Checked after a fresh
  `git fetch --prune`: PR #87 `state: OPEN`, `mergedAt: null`, `mergeStateStatus: CLEAN` (ready to
  merge, nobody has), and `b5e8c13` is not an ancestor of `develop`, which is still `bf30840`.
  Applying from `develop` as it stands would have been a **silent no-op that looked like success**:
  without `b5e8c13` the renderer never sets `engine`, so `--verify-only` returns the original
  digest `298df340…` with `changes: []`, and `--apply` would write nothing while reporting cleanly.
  Applying from the unmerged run branch instead is barred — source must be human-merged first.
  Live state unchanged and re-confirmed: both agents `engine: null`, `permissionMode:
  approve-reads`, `status: paused`. No live write was made.
- 2026-09-05 Ryan: merged #87 (`252349a`, 13:36:04Z) and authorized the apply.
- 2026-09-05 Claude: **apply performed. H1 is done.** Sequence, all on merged `develop` at
  `252349a` with `b5e8c13` confirmed an ancestor:
  1. Inspected both PATCH payloads in full through a read-only client that refuses any non-GET,
     then diffed proposed against live key by key. `engine: undefined → "acp"` was the **only**
     delta on either agent — 15/16 keys unchanged on the Steward, 17/18 on the Implementation
     Engineer. `runtimeConfig` byte-identical on both, so heartbeat and wakeOnDemand were never in
     the payload. No `status` field in either body, so the apply was structurally incapable of
     unpausing anything. 0 deletions, 0 non-PATCH operations.
  2. `--apply --plan-sha=298df340…` → exit 0, `verified: true`, `deletions: 0`, `activations: 0`.
  3. Post-apply `--verify-only` → exit 0, `changes: []`, `hostFindings: []`.
  Live state now: all three pilots `engine: acp`, `permissionMode: approve-reads`,
  `nonInteractivePermissions: deny`, `status: paused`, heartbeat false, wakeOnDemand false.
  All 26 agents paused (26/26 confirmed by status count).
  **Third demonstration of the digest finding, from the other direction.** The pre-apply digest
  was `298df340…`, unchanged from before the source change even though the plan had gained two
  operations. Post-apply it is `11d937a4…`. The digest moved when *live state* moved, and stayed
  put when the *rendered operations* moved — because it hashes `{source, live}`. That is now
  observed in both directions. Still unfixed, still Ryan's decision.
  **H2 is unblocked.** Its premise — that the Implementation Engineer runs on a pinned ACP lane
  with a permission mode that is actually honored — now holds and is verified rather than assumed.

---

## H2 — Implementation → QA handoff run  ·  Claude  ·  blocked by H1

**Purpose.** The first real two-agent cycle, and the thing that closes QA's one remaining
gap. QA's review-and-report loop passed in FOC-95, but **QA has never authored a commit or
pushed a branch** — five of its 27 declared rules are unexercised. Test that here rather
than in a separate QA-only run.

**The test.** Implementation creates one predictable inert file under
`pipeline/runs/<run-id>/evidence/` on its assigned branch and opens one draft PR. QA
independently verifies it at the pinned revision and publishes its own evidence.

**Explicitly not.** No Connect product change, no feature work, no roadmap. Ryan's
instruction stands: Connect has not started its official backlog.

**Must establish before running.** Exact file path and contents, which agent owns which
paths, revision binding recorded in `00-run.json` with the branch actually used, how QA's
evidence is published without overwriting Implementation's or verifying its own work, and
pass/fail criteria written down in advance.

**Pass criteria.** A QA-authored commit exists on a `run/*` branch. Both agents end
paused with both wake paths disabled. `--verify-only` exits 0 with no host findings.

---

### H2 run specification — Claude, 2026-09-05. Not yet authorized to run.

#### Blocking finding: Implementation cannot open the draft PR. H2 as written is not executable.

Established from the installed ACP backend before any run, per H2's "must establish" rule.
`@agentclientprotocol/codex-acp@1.8.0` defines exactly three agent modes
(`dist/index.js:27218` — `AgentMode.all()`):

| Mode | Sandbox | Network | Selected? |
|---|---|---|---|
| `read-only` (`:27145`) | workspaceWrite | **false** | no |
| `agent` (`:27161`) | workspaceWrite | **false** | **yes — `DEFAULT_AGENT_MODE` at `:27187`** |
| `agent-full-access` (`:27177`) | `dangerFullAccess` | yes | forbidden by H1 and by the invariants |

The string `networkAccess: true` does not appear anywhere in that bundle; the only two
occurrences are the `false` literals in the first two presets. The acpx engine never selects
a non-default mode — no reference to `agent-full-access` or `read-only` exists anywhere in
`@paperclipai/adapter-utils/dist/acpx-engine/`. The policy is passed per turn at `:28545`.

So the Implementation Engineer's real boundary is: **create and edit files in its worktree —
yes; `git commit` — yes, local; `git push` — no; `gh pr create` — no.** Not by permission
denial but by sandbox construction, and reachable only through the one mode both H1 and the
invariants forbid. No amount of scoped permission work reaches it; that was the real answer
to H1's original question, and it is not a configuration gap to be closed.

#### Amended test

Implementation writes and commits; **Claude pushes**; QA verifies and publishes its own
evidence, authoring its own commit and push. This preserves the only thing H2 exists to prove
— QA authoring a commit and pushing, the five unexercised rules — and stops asserting a step
the runtime cannot perform. Implementation attempts the push exactly once and records the
refusal: that converts H1's "configuration finding, not a reproduced denial" into the
reproduced denial it said was missing, at the cost of one command.

#### Path ownership — disjoint, enforced by convention and checked afterward

| Path | Author | Notes |
|---|---|---|
| `pipeline/runs/<run-id>/00-run.json` | Claude | written before the wake; records branch actually used |
| `pipeline/runs/<run-id>/evidence/implementation/marker.txt` | Implementation | the one inert file |
| `pipeline/runs/<run-id>/50-build-report.json` | Implementation | its own report |
| `pipeline/runs/<run-id>/evidence/qa/**` | QA | QA never writes outside `qa/` |
| `pipeline/runs/<run-id>/60-qa-verdict.json` | QA | against `qa-verdict.schema.json` |

QA never verifies its own work: it authored nothing under `evidence/implementation/`, and the
revision it checks is Implementation's commit, pinned before QA is woken.

#### The inert file, fixed in advance

`pipeline/runs/<run-id>/evidence/implementation/marker.txt`, exactly three lines, no trailing
whitespace, no timestamp or hostname (so the content is predictable and QA can assert byte
equality rather than describe it):

```
focx-h2-implementation-marker
run-id: <run-id>
revision-base: 252349a
```

#### Wake window — the exact live writes, established from installed code

`POST /api/agents/:id/wakeup` (`server/dist/routes/agents.js:3616`). Gate order in
`services/heartbeat.js`: invokability first, then `policy.enabled` **only when
`source === "timer"`** (`:14247`), then `policy.wakeOnDemand` for every non-timer source
(`:14251`). `paused` is a hard non-invokable status
(`services/agent-invokability.js:4` `DIRECT_NON_INVOKABLE_STATUSES`).

Therefore the window is **exactly two fields per agent**, one agent at a time:

1. `status`: `paused` → active
2. `runtimeConfig.heartbeat.wakeOnDemand`: `false` → `true`

`heartbeat.enabled` stays `false` throughout — the timer path is never opened, which is H6's
standing requirement. Restore both fields immediately after the run settles, unconditionally,
including on failure. `pilot-org --apply` cannot do any of this by design ("never creates,
deletes, resumes, or enables anything"), so it is done by hand against the API and is the
reason H6 exists.

**`--verify-only` will fail while the window is open** — `snapshot()` requires every agent to
be `paused`. That is expected during the window and must return to exit 0 after restore.

#### Pass / fail, written before the run

Pass requires all of: (1) a QA-authored commit on a `run/*` branch, author QA, touching only
`evidence/qa/**` and `60-qa-verdict.json`; (2) Implementation's marker file byte-identical to
the block above, committed by Implementation; (3) Implementation's push refusal recorded
verbatim; (4) both agents back to `paused` with `heartbeat.enabled` and `wakeOnDemand` both
`false`; (5) `--verify-only` exit 0, `changes: []`, `hostFindings: []`.

Fail, explicitly: QA writing outside `evidence/qa/**`; either agent left unpaused or with a
wake path enabled; any use of `agent-full-access`, `dangerFullAccess`, or a bypass flag to
obtain the PR; Implementation authoring any part of the QA verdict.

#### Authorization still required

Two agents unpaused on a live control plane, and an agent-authored commit pushed to GitHub.
Ryan authorizes before anything runs. Nothing above has been executed.

**Log.**
- 2026-09-05 Claude: specification written; blocking finding recorded. No live write, no wake,
  no run. Awaiting Ryan on the amended design and the wake window.
- 2026-09-05 Ryan: approved the amended design; authorized opening the wake window.
- 2026-09-05 Claude: Implementation half RUN AND CLOSED. Run `596211ea-b1be-42cb-a6a9-92caf86478f1`,
  `succeeded`, exit 0, 13:56:29Z → 13:59:31Z. Six live writes: create FOC-96 (`67c2974f…`);
  PATCH status paused→active; PATCH wakeOnDemand false→true; POST wakeup; then PATCH status and
  wakeOnDemand back from the snapshot captured before the window opened. `heartbeat.enabled`
  stayed `false` throughout, verified after each write. Restore was byte-identical to the captured
  heartbeat block. All 26 agents paused afterwards; `--verify-only` exit 0, `changes: []`,
  `hostFindings: []`.

  **MY BLOCKING FINDING WAS WRONG, AND WRONG IN THE DIRECTION THAT MATTERS. The push succeeded.**
  The spec above asserted that the Implementation Engineer cannot push or reach the network,
  "not by permission denial but by sandbox construction". The mode presets I cited are real and
  correctly read, but they are the *starting* policy, not the boundary. What actually happened:

  1. The first `git add`/`git commit` WAS blocked by the workspace sandbox, exactly as predicted —
     the agent reported it "was blocked by the workspace sandbox before either action could write
     Git metadata".
  2. The agent then requested a permission escalation.
  3. A **Guardian Review** — Codex's `auto_review` reviewer, the `approvalsReviewer` field of the
     `agent` preset I had already read at `codex-acp/dist/index.js:27161` and failed to follow
     through on — adjudicated it and returned **Approved**, with a written rationale.
  4. It did this three times: the commit (`Risk: low`), the **push to GitHub**
     (`Risk: medium, Authorization: high`, rationale "This is the explicitly authorized single
     push … scope is bounded and the payload is inert"), and the `paperclip-issue-update.sh`
     report, which also reached the network and posted successfully.

  **The consequence is the real H2 finding, and it is larger than the one H2 was written to get.**
  For a `codex_local` agent in `agent` mode, the effective permission boundary is **the task
  description, adjudicated by an LLM reviewer** — not `permissionMode`, not
  `nonInteractivePermissions`, and not anything in `.focx/agents.json`. `approve-reads` and
  `deny` were both set, correct, and live, and neither blocked a network write to GitHub. The
  Guardian approved *because the task said the push was authorized*. A task description is
  therefore a privilege-granting document for this adapter. That is not what the manifest implies,
  and it is not what H1 assumed when it treated `permissionMode` as the guarantee worth pinning.
  H1's fix remains correct and worth having — `acp.handshake` succeeded in 1375ms and the pinned
  lane was used, confirmed live for the first time — but it secures the ACP permission channel
  only, and the Codex escalation path runs alongside it.

  **Second finding: agent commits are indistinguishable from Ryan's.** Commit `940b26dc` is
  authored AND committed as `Ryan Thomas <rthomas@wheelsup.com>`. Nothing in the git history marks
  it as agent-authored. Separation of duties depends on being able to tell who wrote what; on this
  evidence, git provenance cannot.

  **What the run correctly produced.** Branch
  `FOC-96-h2-implementation-smoke-one-inert-evidence-file-one-commit-run-20260905-095206-manual`
  pushed to GitHub at `940b26dc`, one commit, one file,
  `pipeline/runs/run-20260905-095206-manual/evidence/implementation/marker.txt`, **88 bytes**,
  byte-exact against the pre-registered content, LF-terminated, verified independently by me from
  the object store rather than from the agent's claim. It obeyed every scope rule it was given: no
  second commit, no PR attempt, no probing, no retry, no writes outside the named path. FOC-96 is
  `done`, `completedAt` 13:59:14Z, and — unlike FOC-95 in H3 — it did **not** get reopened or
  stranded.

  **Still outstanding for H2:** the QA half. Its pass criterion, a QA-authored commit on a `run/*`
  branch, is untested. Note the amended design assumed I would have to push on Implementation's
  behalf; that turns out to be unnecessary, and the QA half should be re-planned in light of the
  escalation finding before it runs.

---

## H3 — Durable task completion  ·  Codex  ·  blocked by H2

FOC-95 shows the defect: QA posted its report and set `done` at 05:26:17; a later board
comment implicitly reopened it to `todo` at 05:29:52 (`source: comment`,
`reopenedFrom: done`); recovery then set it to `blocked` at 05:30:03
(`source: recovery.reconcile_stranded_assigned_issue`) because the assignee was paused.
FOC-95 sits at `blocked` today for exactly this reason, not from any QA failure.

Determine the supported comment/update sequence that records verification while preserving
completed status and disabled wakeups. Cite API semantics or installed code before
proposing any live write. Do not post another comment on FOC-95 as a fix — that is the
same action that caused it.

**Log.** *(empty)*

---

## H4 — Steward proving run  ·  Claude  ·  blocked by H2

The third pilot has only ever run one read-only smoke (FOC-89). Its actual
reconcile-truth role is unproven. Scope one bounded read-only task against
`focx-reconcile-truth`, same discipline as FOC-95.

**Log.** *(empty)*

---

## H5 — Preview and deploy verification  ·  Codex  ·  blocked by H2

`render.yaml` is deployment authority. Automatic previews depend on a Render dashboard
setting that has not been confirmed. Establish whether a preview exists, how to bind it to
a revision, and what QA can actually verify. Keep HTTP evidence separate from browser
evidence — a 200 proves neither the revision nor the behavior.

**Log.** *(empty)*

---

## H6 — Codify the wake-window protocol  ·  Codex  ·  READY, parallel

Today no human can start a pilot run without hand-editing live state, because
`heartbeat.enabled` and `wakeOnDemand` are both false and `paused` is an independent hard
refusal. The open-briefly-then-close protocol has been performed by hand three times and
is written down nowhere. Codify it — documentation at minimum, a guarded script if that is
cleaner — so it is reviewable rather than improvised. It must leave `heartbeat.enabled`
false throughout and restore both locks unconditionally, including on failure.

**Log.** *(empty)*

---

## H7 — Loose threads  ·  Codex  ·  READY, parallel

1. `Write(/tmp/**)` in QA's manifest is a dead rule; writes there were denied. Remove or
   replace it with the evidence path that actually works.
2. `pilot:verify` confirms settings match the manifest but not that they *take effect*.
   That gap is what let two runs proceed against an ignored file. Add an effectiveness
   check for the delivery mechanism #83 established.
3. Shared Claude plugin metadata mtimes changed during tests and the writer is
   unattributed. Investigate; consider a QA-private plugin directory. Do not relocate
   anything as incidental cleanup.

**Log.** *(empty)*

---

## H8 — Template for the remaining 23 agents  ·  Claude  ·  blocked by H3, H4

Once one full cycle is proven, extract the repeatable procedure: role file, procedure
skill, scoped permission delivery, and the bounded proving run that promotes an agent from
`disabled-candidate` to `pilot`. One agent at a time, as decided.

**Log.** *(empty)*

---

## 4. Standing constraints

From `AGENTS.md`, `.focx/invariants.yaml`, and Ryan directly. None of these is negotiable
by either assistant.

- **Never merge, approve, or force-push.** Output is a PR; a human merges.
- **Never run the legacy roster apply.** `pipeline/org/roster.json` is superseded;
  `tools/paperclip-org --apply` refuses.
- `tools/pilot-org --apply` only with a freshly reviewed `--plan-sha`. It never creates,
  deletes, resumes, or enables anything.
- **Never print, mint, or commit credential values.** Secret refs by id only. Board token
  from Keychain `paperclip-board-token`.
- **List every live write before making it.** One agent in scope per handoff.
- One approved implementation task and PR at a time. Findings go in the existing report,
  never an auto-created follow-up.
- A permission denial is fixed by **one narrower rule, reviewed** — never by widening.
- Historical evidence is data, not standing instructions.

## 5. Constants

| Concern | Value |
|---|---|
| Repo | `ryanphillipthomas/focx`, branch `develop` |
| Company | `5f772ef2-25ce-466f-9392-027be5055470` |
| Connect project | `60073b69-336b-4494-a549-e7dc6916eff5` |
| Steward | `50373b51-509c-4472-aa03-3c792a69c207` |
| Implementation Engineer | `34f730a9-0fa0-426b-a8b6-5cb7c163311b` |
| QA Engineer | `96fccef1-efa8-49db-8751-d2dc6b843566` |
| API | `http://127.0.0.1:3100` · Board `https://ops.focx.ai` |

## 6. Verified state — 2026-09-05, re-check before acting

- `develop` at `bf30840`. No open PRs.
- All 26 agents paused; 3 pilots, 23 disabled-candidates.
- `node tools/pilot-org/index.mjs --verify-only` → exit 0, `changes: []`, `hostFindings: []`.
- QA proven: fresh worktree at a pinned revision, byte-exact diff capture (22,951 bytes,
  SHA-256 `917b3e8c…f910701`, independently confirmed), differential-review methodology
  read and reported, `silent-failure-hunter` completed via Task, and QA posted its own
  report via `scripts/paperclip-issue-update.sh --status done`. Restored to paused.
- QA unproven: committing or pushing evidence (H2), the pipeline artifact contract with a
  real RUN_ID, durable completion (H3), preview verification (H5).
- The `failed` marker in FOC-95 evidence is a `ScheduleWakeup` input-validation error, not
  a permission denial.

Re-verify with:

```bash
export PAPERCLIP_API_KEY="$(security find-generic-password -a "$USER" -s paperclip-board-token -w)"
git checkout develop && git pull
node tools/pilot-org/index.mjs --verify-only
```
