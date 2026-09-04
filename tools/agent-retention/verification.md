# Verifying retention

FOC-72 asked that Security verify expiry **by testing it, not by reading the configuration**. This file is the procedure. None of it depends on trusting `retention.config.json`, this README, or the person who wrote them.

## 1. Prove the mechanism deletes (no real data touched)

```sh
pnpm test:agent-retention
```

The suite builds a real transcript store and a real git repository with real worktrees in a temp directory, ages them with `utimes`, runs the sweep, and asserts what survived. The tests that carry the claim:

| Claim | Test |
|---|---|
| Expired transcripts are deleted; unexpired ones are not | `transcripts expire past the retention window and not before` |
| A sweep actually removes them from disk and logs it | `sweep deletes expired transcripts, keeps the rest, and logs metadata only` |
| An old, clean, merged worktree is really removed and deregistered from git | `sweep --apply removes the reclaimable worktree and deregisters it from git` |
| Unmerged, dirty, recent, and in-use worktrees survive | `worktrees are held back by unmerged work, dirt, recency, and being in use` |
| Dry run deletes nothing | `scrub is dry-run by default`, and the dry-run half of the sweep test |
| The deletion log expires on its own clock | `the deletion log expires on its own clock` |
| Scrubbing does not extend a file's retention | `scrubFile rewrites in place without resetting the retention clock` |
| The redacted value is gone, including any prefix of it | `scrubText leaves the secret value out of the output entirely` |
| The deletion log records metadata, never content | asserted inside the sweep test |
| **Every store the credentials were found in is covered** | `every store the credentials were found in is in scope, and agent memory still is not` |
| **The shipped config names all four stores** | `the shipped config names all four stores, not just the transcripts` |
| **All three exposed credential classes are purged from every store** | `the three credential classes found at rest are purged from every store` |
| A store can carry its own retention clock | `a store can carry its own retention clock` |
| One unreadable file does not abandon the rest of the purge | `one unreadable record does not abandon the rest of the purge` |
| Deleting unwinds emptied date nesting but never the store root | `sweep unwinds the date nesting it empties but never the store root` |
| The scheduled job does not point at a deletable worktree | `the scheduled script is staged outside every checkout` |
| A staged copy that falls behind the repo is reported, not trusted | `a staged copy that has fallen behind the repository is reported as stale` |

A reviewer who does not trust the assertions can invert one — change `retentionDays` in a fixture, or delete the `mergedInto` check — and watch the suite fail.

### A note on the fixtures

`configFor` overrides `dirs` and `roots` unconditionally rather than inheriting them. This is not tidiness: the shipped defaults name this machine's *real* agent store, and several tests call `scrub(…, { apply: true })`. During development an earlier revision inherited the defaults, and the test run rewrote ~124 live session files. No data was lost — the rewrite is the intended redaction, mtimes were preserved, and all 447 files still parsed — but it is exactly the accident this override now prevents. Keep it.

## 2. Prove it is scheduled on the host

```sh
launchctl list | grep agent-retention
ls -l ~/Library/LaunchAgents/ai.focx.agent-retention.*.plist
```

Then force a run and read the log rather than the config:

```sh
launchctl kickstart -p gui/$UID/ai.focx.agent-retention.sweep
tail ~/.paperclip/retention/ai.focx.agent-retention.sweep.log
```

## 3. Prove it reaches real data

```sh
node tools/agent-retention/index.mjs status
node tools/agent-retention/index.mjs sweep --json | jq '.plan | group_by(.reason) | map({reason: .[0].reason, n: length})'
```

`status` must find a non-zero number of records and worktrees, **and it must list every store**. A run reporting zero of either is a **failure of the tool**, not a clean store — it means the directories are misconfigured and the clock is enforcing nothing. Check that specifically; it is the most likely way this control silently does nothing.

`status` prints a line per store precisely so a missing one is visible. The original FOC-73 implementation passed every test and reported success while covering *one* of the four stores that held credentials.

## 3b. Prove the purge, without using the tool that did it

The tool asserting it found nothing is not evidence. Grep the store independently, and split residual hits into files inside the 15-minute write grace window (deferred by design) and quiet files (**must be zero**):

```sh
cd ~/.paperclip/instances/default && node -e '
const {readFileSync,statSync}=require("fs");const {execSync}=require("child_process");
const files=execSync("find workspaces/*/.claude/projects companies/*/acp-engine/agents/*/sessions companies/*/codex-home/sessions data/run-logs -type f",{encoding:"utf8",maxBuffer:1e8}).trim().split("\n");
const classes={OAUTH:/\bsk-ant-oat[0-9A-Za-z_-]{16,}/,GH:/\bgh[pousr]_[A-Za-z0-9]{16,}/,JWT:/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,API:/\bsk-ant-api[0-9A-Za-z_-]{16,}/};
const now=Date.now(),out={};for(const k in classes)out[k]={live:0,quiet:0};
for(const f of files){let t;try{t=readFileSync(f,"utf8")}catch{continue}
 const live=now-statSync(f).mtimeMs<9e5;
 for(const[k,re]of Object.entries(classes))if(re.test(t))live?out[k].live++:out[k].quiet++;}
console.log(files.length,"files:",JSON.stringify(out));'
```

Anchor the leading `\b` but **not** a trailing one. A trailing boundary was tried during verification and produced a false positive — `gho_` occurring mid-blob inside a long base64 value — which is worth knowing before someone reports it as a miss.

## 4. Prove deletions leave evidence

```sh
cat ~/.paperclip/retention/deletions.jsonl | tail
```

Each line: timestamp, kind, path, bytes, age, reason. If a line ever contains file content, that is a bug worth an issue.

## First run — 2026-09-04

Recorded by the CTO on implementation. This is a baseline, not an independent verification; Security's sign-off is tracked separately.

- Test suite: 26 tests, 26 pass.
- `status`: 20 transcript files (5.6 MB), 36 worktrees (24 MB).
- Expiring on the first sweep: **none**. Every artifact in the store is younger than its retention window — the company is younger than 30 days. The clock is armed, not idle; the first transcript deletions fall due 30 days after the oldest session, and the first worktrees 14 days after their last write. Re-check `status` in two weeks, and treat "still zero" as suspicious.
- Schedule: both launchd jobs loaded; `launchctl kickstart` of the sweep produced a real run and a real log. Note the install warned that the script path is still inside the FOC-73 worktree — **`install-schedule` must be re-run from the primary checkout once this branch merges**, or the schedule breaks when the worktree is reclaimed.
- `scrub` dry run: 104 secret-shaped matches across 9 transcript files, including **6 high-entropy 40-character GitHub-token matches** that are not test fixtures. That is the FOC-72 concern found in the live store rather than hypothesised.
- `scrub --apply`: 131 matches redacted across 10 files; 4 files deferred because their sessions were still live.
- No match on any exact value from the sweeper's environment, i.e. no verbatim `PAPERCLIP_API_KEY` was found on disk at scrub time.

### Incident on the first apply — read this before trusting a new pattern

The first `scrub --apply` **corrupted 6 transcript lines**. The `generic-secret` value class allowed `\`, so inside a JSON string it consumed the backslash of an escaped `\"`, left a bare quote, and made the line unparseable. Found by parsing every line after the run; repaired by restoring the backslash and re-verifying (2,501 lines, 0 unparseable); fixed at the root by excluding `\` from the value class, with `scrubbing a JSON transcript line leaves it parseable` added to the suite as the regression test.

The lesson generalises: records are JSON, so any new pattern must be checked against escaped content, not just against a bare secret. Post-run integrity is part of verifying a scrubber:

```sh
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { loadConfig, listTranscripts } from "./tools/agent-retention/index.mjs";
let bad = 0, lines = 0;
for (const p of listTranscripts(loadConfig()))
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue; lines++;
    try { JSON.parse(line); } catch { bad++; }
  }
console.log(lines + " lines, " + bad + " unparseable");
'
```

## Second run — 2026-09-04, after the FOC-73 re-scope

Legal & Privacy re-scoped this issue from prevention to remediation: 135 files were found holding resolved credentials, in three directories the original coverage did not name. Recorded by the CTO; still a baseline, not Security's independent sign-off.

**The coverage gap, measured.** Before: 25 files, 5.6 MB, one store. After: **500 files, 142 MB, 30 store directories across four shapes.** The original implementation covered the store with the *fewest* credentials in it.

**The exposure, re-measured at purge time.** 156 files, not 135 — 148 under `acp-engine/agents/*/sessions` and 8 under `codex-home/sessions`. The count grew because runs kept happening. `data/run-logs` was in the re-scope and is now covered, but held no hits of the three named classes.

**The purge.** `scrub --apply` across all stores. Redaction counts on the pass are in `~/.paperclip/retention/ai.focx.agent-retention.scrub.log`. Post-purge independent audit (procedure in §3b, run without the tool):

| Class | Live / deferred | Quiet — must be 0 |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | 9 | **0** |
| `GH_TOKEN` | 10 | **0** |
| `PAPERCLIP_API_KEY` (JWT) | 25 | **0** |
| `sk-ant-api…` | 5 | **0** |

**Integrity after the purge.** 447 files parsed line-by-line: **0 parse failures**, 180 files carrying `[redacted:…]`. The JSON-escaping fix from the first run held at 121 MB scale.

**On the live column.** Those files are inside the 15-minute write grace window and are redacted by the next scrub pass after their session goes quiet — verified by re-running the purge and watching the quiet count return to 0 as files aged out. It never reaches zero on a busy host, and *should not be expected to*: this is the periodic-scrubbing limit documented in `docs/data-retention.md`, and it is why credential rotation must be sequenced against FOC-81 (the platform-side write path) rather than against this control.

**Schedule.** Re-installed as a staged copy at `~/.paperclip/retention/bin/`. Both jobs kickstarted and produced real logs; the staged copy independently resolved all 30 record directories *and* the real worktrees, which is what proves the absolute-path pinning works. This replaces the first run's open caveat — the schedule no longer points into the FOC-73 worktree, so it does not need re-installing when this branch merges.

**Still open for Security.** Independent verification of the purge, per the re-scope. §3b is written to be run by someone who does not trust this tool or this file.
