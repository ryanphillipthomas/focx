# Post-merge QA smoke evidence closeout

Ryan authorized a dedicated branch and PR to preserve the 27 untracked smoke-test evidence files left in the primary checkout after PRs #82–85. This manual run starts from develop revision `158e973ff60683a85fbb88042ebc5f59290a5e43` and records branch `run/run-20260905-114928-manual`.

The original files remain byte-for-byte unchanged at their original run paths. Their run IDs, branches, timestamps, failures, and agent statements describe the historical tests; they are not current instructions or claims of current live state. The SHA-256 inventory below was captured before packaging. The pre-existing untracked root `handoff.md` is excluded and unchanged.

## How to read the results

| Evidence group | Recorded task | What the test established |
| --- | --- | --- |
| `run-20260905-041451-manual/evidence/` | [FOC-92](https://ops.focx.ai/FOC/issues/FOC-92), after PR #82 | Plugin loading passed. Evidence writes and reporting did not pass. |
| `run-20260905-043119-manual/evidence/` | [FOC-93](https://ops.focx.ai/FOC/issues/FOC-93), after PR #83 | The initial smoke failed. Several commands included unapproved wrappers, expansions, or scratch paths; their denials did not isolate the prescribed commands. |
| `run-20260905-043119-manual/evidence/exact-commands/` | FOC-93, subsequent exact-command diagnostic | Standalone mkdir and the direct reporting heredoc succeeded; Write was denied. The posted body was placeholder text. This proves transport execution, not a complete substantive review/report workflow. |
| `run-20260905-045445-manual/evidence/` | [FOC-94](https://ops.focx.ai/FOC/issues/FOC-94), after PR #84 | Reviews, evidence writes, and a substantive self-posted report succeeded, but the reconstructed diff differed from Git. The full smoke did not pass the byte-equality criterion. The detailed diagnosis was already committed in the following PR's evidence. |
| `run-20260905-051255-manual/evidence/` | [FOC-95](https://ops.focx.ai/FOC/issues/FOC-95), after PR #85 | Full bounded workflow passed: a 22,951-byte exact Git diff, both substantive review reports, and QA's own substantive posted report. |

`smoke-state.json` process status `succeeded` is not itself a workflow verdict. Likewise, an agent's reported PASS is qualified by the board's independent verification. Earlier denials and paused/configuration snapshots apply only to their recorded runs. Shared plugin metadata mtime changes remain an unattributed observation.

## FOC-95 status correction

The saved `live-smoke-result.json` and `independent-smoke-verification.json` accurately record the task as done when verified. A later read-only inspection of `/api/issues/a959a01f-f171-4212-800b-592c5f0f8255/activity` established this subsequent sequence on 2026-09-05:

1. At 05:26:17 UTC, QA set the task to done and attached substantive report `1938d6a4-0a56-4603-a1a4-31b994808d3d`. Run `f476739a-6254-4487-9d16-a8bced3e998f` finished succeeded at 05:26:23 UTC.
2. At 05:29:52 UTC, the operator's verification comment `5e6085d6-d16c-4df3-b8e3-71a489c7958e` implicitly reopened the assigned task from done to todo. The activity records `source: comment`, `reopened: true`, and `reopenedFrom: done`.
3. At 05:30:03 UTC, Paperclip recovery changed todo to blocked because QA was paused and could not be invoked. The activity records `source: recovery.reconcile_stranded_assigned_issue`, `previousStatus: todo`, `latestRunStatus: succeeded`, and recovery action `0984819a-c6ce-4af8-adae-a14a1f5c636a`.

The later blocked task status does not invalidate the completed smoke evidence. It also does not prove durable task completion across later board comments. The original snapshots are preserved rather than rewritten. This closeout does not change the task state or start an agent.

FOC-95's scope was QA tooling only: it does not establish the Implementation-to-QA handoff, product/browser behavior, or a deployed PR preview. The differential report groups nine changed files into five rows and labels them 5/5; its review remains substantive, but the file count is imprecise. The failed ScheduleWakeup call was a missing-prompt validation error, not a permission denial; no additional wake was scheduled by that call. Review severity labels were not independently endorsed.

## Original-file integrity inventory

All 27 files below were captured before packaging and retained unchanged. All 19 JSON files parsed successfully, and a scoped credential-content review found no credential values or private-key material. Local paths and agent/task identifiers are retained as historical provenance. The raw exact-command transcript retains its streamed line fragments and one trailing space at line 35; normalizing it would break byte preservation. The new closeout records have no whitespace-check findings.

| Original repository path | Bytes | SHA-256 |
| --- | ---: | --- |
| `pipeline/runs/run-20260905-041451-manual/evidence/plugin-mtimes-after.json` | 256 | `0ecd1616e5fbdff51bd2bd22fdc701108866264763983055d1e311147978b28f` |
| `pipeline/runs/run-20260905-041451-manual/evidence/plugin-mtimes-before.json` | 256 | `85683488f7a3a8eb7df9bc62d2b58dc2e47e04248594b5965c21b6143c432b00` |
| `pipeline/runs/run-20260905-041451-manual/evidence/post-smoke-verify.txt` | 160 | `6ca03c7bc9573628e251773ad2bf4592faf808fafc5287c0ca69af27f1f7c74c` |
| `pipeline/runs/run-20260905-041451-manual/evidence/smoke-report.md` | 4775 | `8d0d487ebc6f20e84ff389ff2e78e08a4f3dc9ff914006e15ae60281cefd30d8` |
| `pipeline/runs/run-20260905-041451-manual/evidence/smoke-state.json` | 245 | `601b06950b3a7448155aba0026c891e63cf9f980ee48b79255f964ab3ecff5a2` |
| `pipeline/runs/run-20260905-043119-manual/evidence/exact-commands/agent-result.txt` | 2162 | `23ae9804eed7ff0c05ee1761c49c64c19bb245b0acf39ee9c47189989db88c56` |
| `pipeline/runs/run-20260905-043119-manual/evidence/exact-commands/plugin-mtimes-after.json` | 256 | `35e80718069d2e951e3ce725f0a531c9d8009858fd4a621b872bfb800e4d41df` |
| `pipeline/runs/run-20260905-043119-manual/evidence/exact-commands/plugin-mtimes-before.json` | 256 | `35e80718069d2e951e3ce725f0a531c9d8009858fd4a621b872bfb800e4d41df` |
| `pipeline/runs/run-20260905-043119-manual/evidence/exact-commands/post-smoke-verify.txt` | 160 | `32d2bfd21790351d04c9486f3dffc09def79da89d2beba8c0524c8be2cc67d1a` |
| `pipeline/runs/run-20260905-043119-manual/evidence/exact-commands/smoke-state.json` | 246 | `2b929556ef350285f72573150149fad8f23ccaabf275f76a91b273715b3cd759` |
| `pipeline/runs/run-20260905-043119-manual/evidence/plugin-mtimes-after.json` | 256 | `35e80718069d2e951e3ce725f0a531c9d8009858fd4a621b872bfb800e4d41df` |
| `pipeline/runs/run-20260905-043119-manual/evidence/plugin-mtimes-before.json` | 256 | `0ecd1616e5fbdff51bd2bd22fdc701108866264763983055d1e311147978b28f` |
| `pipeline/runs/run-20260905-043119-manual/evidence/post-smoke-verify.txt` | 160 | `07ef9d48062bbd880ff346795dc482587c7f8138eb497626c67d78f1a24067ec` |
| `pipeline/runs/run-20260905-043119-manual/evidence/smoke-report.md` | 15644 | `b7f38743cf702472ceda45e2db337710a00d972ba563418a16284266759a3c01` |
| `pipeline/runs/run-20260905-043119-manual/evidence/smoke-state.json` | 245 | `5d99edb1e494d0576dd2e15ff4357015d9c53c799721c39f6a9e74c9ce106979` |
| `pipeline/runs/run-20260905-045445-manual/evidence/plugin-mtimes-after.json` | 256 | `07a76913991d4daaf16bc1501a20d36e072426ca47f7aff1a297d53a6f27041f` |
| `pipeline/runs/run-20260905-045445-manual/evidence/plugin-mtimes-before.json` | 256 | `35e80718069d2e951e3ce725f0a531c9d8009858fd4a621b872bfb800e4d41df` |
| `pipeline/runs/run-20260905-045445-manual/evidence/post-smoke-verify.txt` | 160 | `a918ec075a8a66dfe1695917c1bf3f21dae828bdb3b9bf42e0dbdbfdfa9b4a84` |
| `pipeline/runs/run-20260905-045445-manual/evidence/smoke-state.json` | 245 | `433a3924a869ce022d6ebea6b6ecd3b6d7754c0811bad45b510f70269489dee7` |
| `pipeline/runs/run-20260905-051255-manual/evidence/board-verification-receipt.json` | 147 | `bb9755137acbaa30833c4cdeb2b18992bfa23eed9b4e33be1393acf21cbe9453` |
| `pipeline/runs/run-20260905-051255-manual/evidence/independent-smoke-verification.json` | 2146 | `0ec9f2bbbe67a607c8bf8b32c47fc101f47dc9bcd16b782afe33b35090237267` |
| `pipeline/runs/run-20260905-051255-manual/evidence/live-smoke-result.json` | 5870 | `ed63d9bcf0afc9b578268602407eff6360ed28fb0fdca06633a81aa45974cf43` |
| `pipeline/runs/run-20260905-051255-manual/evidence/plugin-mtimes-after.json` | 256 | `871d685363be1d2c7f3c412898c914d7c956fad1dbdba19a090bcd6814dadf33` |
| `pipeline/runs/run-20260905-051255-manual/evidence/plugin-mtimes-before.json` | 256 | `07a76913991d4daaf16bc1501a20d36e072426ca47f7aff1a297d53a6f27041f` |
| `pipeline/runs/run-20260905-051255-manual/evidence/post-smoke-agent-statuses.json` | 2976 | `e56f9ac4b5125a46070dab3993a422df76fca69fd06e0ebee53ecfb795c4f013` |
| `pipeline/runs/run-20260905-051255-manual/evidence/post-smoke-verify.txt` | 160 | `2d1504fd891e6373ad22c80b212cf35ecb0337e0fc83cb96cb5cad2c18ee068f` |
| `pipeline/runs/run-20260905-051255-manual/evidence/smoke-state.json` | 245 | `fbc6438311ff6d499ae5f03a12fc8da8322f3fbe57a304fbeab9e66eefc43f9e` |
