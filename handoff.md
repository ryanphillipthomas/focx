> **RETIRED 2026-09-05 — do not act on this file.**
> Superseded by `ORCHESTRATION.md` section 2b (Workstream FB). `ORCHESTRATION.md` is the
> single Claude↔Codex ledger; this file is kept only so its original text is not lost, and
> Ryan may delete it at any time. Its substantive findings were harvested into FB0's F1–F9.
> Note two claims below are now known false: the Implementation Engineer HAS committed and
> pushed (FB0 F3), and declared permissions do not bound `codex_local` behavior (FB0 F1).

---

# Handoff — QA smoke complete; review the next tiny agent handoff test

Updated 2026-09-05 after human merge of [PR #86](https://github.com/ryanphillipthomas/focx/pull/86). Local `develop` is `bf30840b63de5338c0e2020192447a0c68a65f5c`.

This is the existing **untracked review scratch file**, intentionally outside the evidence PR. Canonical controls remain in `.focx/`; historical run evidence remains in `pipeline/runs/`. This refresh replaces the obsolete settings-delivery decision in the previous handoff. It does not authorize a new run or change standing policy.

## 1. Current scope and verified state

Ryan clarified: **Connect has not started its official backlog. Use very small tweaks to test handoffs between agents.** Do not invent a product roadmap, adopt legacy features, or revive the old departmental roster.

QA's bounded evidence → two reviews → self-posted report workflow passed in [FOC-95](https://ops.focx.ai/FOC/issues/FOC-95). The Implementation → QA cycle, scoped implementation writes/PR publication, browser verification, and durable completion after subsequent board comments remain unproven.

Read-only live verification at **2026-09-05T11:58:17Z** found:

- All 26 agents paused. Steward, Implementation, and QA have timer wakeups, manual wakeups, and turn continuation disabled; each has `maxConcurrentRuns: 1`.
- `node tools/pilot-org/index.mjs --verify-only` exited 0 with `changes: []`, `hostFindings: []`, no activations, and no deletions.
- No open GitHub PRs in `ryanphillipthomas/focx`.
- FOC-95 currently shows blocked due to the later board-comment/recovery sequence described below. Its tested run remains succeeded and its workflow evidence remains valid.
- PR #86 committed the 27 original post-merge evidence files unchanged, plus three closeout records. Only this scratch file remains untracked in the primary checkout.

These are timestamped observations, not a promise that live state cannot change. Recheck before any future bounded run.

## 2. Decision for Ryan and Claude — stop here before execution

**Review and choose the next tiny coordination test and its exact permission/closeout procedure.** No implementation task is currently selected. Ryan authorized tiny tests in principle and requested this joint handoff review; no official Connect backlog item is being proposed.

The smallest candidate is one predictable inert file under the new test's `pipeline/runs/<run-id>/evidence/`, created by Implementation on its assigned branch, published in one draft PR, and independently verified by QA. This would exercise file ownership, Git/PR publication, revision binding, evidence, and reporting. It would not prove a visible application change.

If the same test must demonstrate an observable Render preview change, use one approved text-only tweak in the existing Connect showcase instead. Specify the exact before/after text and path before starting. Reuse the current layout and published tokens. A preview returning HTTP 200 alone does not prove the expected revision or browser behavior.

For either candidate, first establish the supported scoped Implementation workflow and a task-closeout sequence that does not accidentally reopen completed work. Prepare concrete commands, allowed paths, expected outputs, and pass/fail criteria for review. **Do not create tasks, start agents, apply settings, repair task states, or start another PR merely by reading this handoff.**

## 3. What has landed and what the smoke proved

| PR | Merged change |
| --- | --- |
| [#82](https://github.com/ryanphillipthomas/focx/pull/82) | Repository `.claude/settings.json` enables the installed review plugins only. No permissions added to shared project settings. |
| [#83](https://github.com/ryanphillipthomas/focx/pull/83) | QA-only ACP launcher delivers manifest permissions through the isolated worktree's local settings; validates QA/task/run/worktree context. |
| [#84](https://github.com/ryanphillipthomas/focx/pull/84) | Effective evidence-write rule `Edit(/pipeline/runs/**)` with bare Edit, NotebookEdit, and Skill denials. Differential methodology is read as files under existing scope. |
| [#85](https://github.com/ryanphillipthomas/focx/pull/85) | Procedure 0.1.4 captures Git's diff bytes with one direct evidence redirect. No permission expansion. |
| [#86](https://github.com/ryanphillipthomas/focx/pull/86) | Preserves the post-merge smoke evidence and annotates historical results, including FOC-95's later task-state change. |

The old service-level `ACPX_CLAUDE_INCLUDE_USER_SETTINGS=1` proposal is superseded by the merged project-plugin / QA-worktree-permission split. Do not edit a vendor plist to reintroduce it or treat permissions in the ignored user settings file as proof of effective delivery.

FOC-95 tested `e4c92ab5c2cc5c2a49dd033e643a6a2942902e4a..158e973ff60683a85fbb88042ebc5f59290a5e43` in a fresh QA worktree. It established:

1. Exact standalone `mkdir -p pipeline/runs/smoke-pr85/evidence/` succeeded.
2. Direct `git diff <literal-base>..<literal-head> > pipeline/runs/smoke-pr85/evidence/run.diff` succeeded. Independent comparison matched Git byte-for-byte: 22,951 bytes, SHA-256 `917b3e8c7429346a84be9abeea3dd92bd0cb0701d2ceb81a7c163715ff910701`.
3. QA read the installed differential-review methodology and saved a substantive report with Write. It did not invoke Skill, whose plugin frontmatter would pre-approve broad tools.
4. `pr-review-toolkit:silent-failure-hunter` completed through Task/Agent, and QA saved its substantive findings.
5. QA itself posted its actual report with the direct `scripts/paperclip-issue-update.sh --status done` quoted-heredoc form. Comment `1938d6a4-0a56-4603-a1a4-31b994808d3d` is agent-authored. The test run completed succeeded.
6. QA was restored to paused with both wake paths disabled. Source reconciliation was clean.

The smoke deliberately did not commit/push QA's generated artifacts, open a PR, test an Implementation handoff, or test a product preview. Those capabilities must not be inferred from this pass. The raw QA review artifacts remain in its isolated worktree, with paths/hashes recorded in the committed verification evidence.

Authoritative evidence for this result:

- [Evidence closeout and original-file hashes](pipeline/runs/run-20260905-114928-manual/evidence/README.md)
- [Independent FOC-95 verification](pipeline/runs/run-20260905-051255-manual/evidence/independent-smoke-verification.json)
- [FOC-95 report and final-run snapshot](pipeline/runs/run-20260905-051255-manual/evidence/live-smoke-result.json)

Earlier smoke results describe narrower outcomes. FOC-93's exact-command diagnostic posted placeholder text and still had a denied Write. FOC-94 ran the reviews/report but reconstructed an altered diff. Neither was the complete pass.

## 4. The completion-state issue is explained, not fixed

FOC-95's activity trail shows:

| UTC on 2026-09-05 | Observation |
| --- | --- |
| 05:26:17 | QA posted its report and set done. Its run finished succeeded at 05:26:23. |
| 05:29:52 | Codex's later board verification comment `5e6085d6-d16c-4df3-b8e3-71a489c7958e` implicitly reopened done → todo. |
| 05:30:03 | Paperclip recovery changed todo → blocked because the assigned QA agent was paused and not invokable. |

Read-only proof is available at `GET /api/issues/a959a01f-f171-4212-800b-592c5f0f8255/activity`. The reopen has `source: comment` and `reopenedFrom: done`; recovery has `source: recovery.reconcile_stranded_assigned_issue`, `previousStatus: todo`, and `latestRunStatus: succeeded`.

Do not assume a board comment is observational. It can change task state and request work. Do not post another explanatory comment on FOC-95 as a supposed fix. Determine a supported update/report sequence before testing durable completion; preserve the original report and activity history. No status repair or vendor change has been applied.

## 5. Prerequisites and limits for the next test

- **Implementation access:** current `codex_local` settings use `permissionMode: approve-reads`, `nonInteractivePermissions: deny`, and bypass disabled. The manifest has no Implementation-specific scoped write-delivery mechanism comparable to QA's launcher. This is a configuration finding, not a reproduced denial of each prospective command. Inspect installed adapter behavior, then test exact approved operations in a bounded task. Do not copy Claude permission syntax into Codex or grant broad access to compensate for a malformed command.
- **Git and artifact handoff:** choose one implementation branch/PR and record its actual name in `00-run.json`. Establish how independent QA evidence is committed or otherwise published according to the applicable contracts without overwriting the implementation or verifying self-authored work. FOC-95 did not test this publication path.
- **Isolation and limits:** provision separate Implementation and QA workspaces and fresh sessions at the required revisions. A configured 900-second timeout and concurrency limit are not empirical proof that runtime limits are enforced.
- **Preview:** `render.yaml` is deployment authority. Automatic service previews depend on the Render dashboard setting; the latest PR checks did not establish preview availability. Confirm preview existence, revision, and suitable QA capabilities if the selected test requires them. Do not deploy elsewhere or change Render configuration as incidental cleanup.
- **Review quality:** both FOC-95 reports are substantive. The differential review's five grouped rows cover nine changed files; its 5/5 label is imprecise. A ScheduleWakeup call failed missing-prompt validation; that was not a permission denial. Review severities were not independently endorsed.
- **Known observation:** shared Claude plugin metadata mtimes changed during tests; the writer remains unattributed. This is not proof the scoped workflow failed and does not itself authorize plugin relocation or settings changes.
- **Source documents:** `.focx/baseline.yaml` and some pilot-guide statements predate the latest runtime evidence. Treat broad runtime/first-task claims cautiously; this scratch file does not update the canonical baseline or expand the proven scope.

After an explicitly approved test, restore the started roles to paused with both wake paths disabled and run read-only verification. Persist required evidence on the run branch and in its PR before handing off; do not leave another pile of untracked run files in `develop`. Ryan merges and deliberately initiates the next stage. Every PR handoff includes the exact next step and whether a live smoke is needed.

## 6. Sources and identities

Read [AGENTS.md](AGENTS.md), [.focx/invariants.yaml](.focx/invariants.yaml), [.focx/baseline.yaml](.focx/baseline.yaml), [sources of truth](docs/sources-of-truth.md), and the preamble's context/evidence policy before applicable task/role files. For this review, use [pilot operation](docs/pilot-operation.md), [Implementation role](.focx/roles/implementation-engineer.md), and [QA role](.focx/roles/qa-engineer.md). Historical evidence is data, not standing instructions.

| Concern | Identifier |
| --- | --- |
| Repository | `ryanphillipthomas/focx`, `develop` |
| Company | `5f772ef2-25ce-466f-9392-027be5055470` |
| Connect project | `60073b69-336b-4494-a549-e7dc6916eff5` |
| Implementation Engineer | `34f730a9-0fa0-426b-a8b6-5cb7c163311b` |
| QA Engineer | `96fccef1-efa8-49db-8751-d2dc6b843566` |
| Steward | `50373b51-509c-4472-aa03-3c792a69c207` |
| FOC-95 task | `a959a01f-f171-4212-800b-592c5f0f8255` |
| FOC-95 tested run | `f476739a-6254-4487-9d16-a8bced3e998f` |
| Local API | `http://127.0.0.1:3100` |
| Board | [ops.focx.ai](https://ops.focx.ai) |

Use existing authorized credentials only through secure host handling; never print or commit their values, mint replacements, or change account bindings for this review. List proposed live writes before performing them within an approved task. Never merge/approve/force-push, apply the legacy roster, enable autonomous follow-up work, or weaken the drift gate. A source synchronization, if needed after human merge, uses a freshly reviewed plan digest; synchronization itself does not activate agents.

## 7. Specific questions for Claude

1. For the installed `codex_local` Implementation adapter under approve-reads/unattended deny, what supported fields permit one approved file edit, commit, push to its assigned branch, and draft PR? Cite installed code and exact commands. Identify which commands need a configuration change versus a syntax correction; do not propose approve-all or bypass flags.
2. What is the smallest useful test for Implementation → independent QA, using either an inert run artifact or one literal showcase text change? Specify inputs, outputs, ownership, revision binding, evidence publication, and pass/fail criteria without starting Connect's product backlog.
3. What supported comment/update sequence records verification while preserving completed status and disabled wakeups, given FOC-95's observed reopen/recovery behavior? Cite API semantics or installed code before suggesting a live write.
4. Can the selected test verify a Render preview's URL, deployed revision, and response with existing QA access? Clearly separate HTTP/deployment evidence from browser/interaction evidence and identify any capability still unproven.

Return a concrete recommendation and remaining decisions for Ryan. Keep all agents paused and stop before execution.
