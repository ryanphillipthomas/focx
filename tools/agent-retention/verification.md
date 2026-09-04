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

A reviewer who does not trust the assertions can invert one — change `retentionDays` in a fixture, or delete the `mergedInto` check — and watch the suite fail.

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

`status` must find a non-zero number of transcripts and worktrees. A run reporting zero of either is a **failure of the tool**, not a clean store — it means the roots are misconfigured and the clock is enforcing nothing. Check that specifically; it is the most likely way this control silently does nothing.

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

The lesson generalises: transcripts are JSON, so any new pattern must be checked against escaped content, not just against a bare secret. Post-run integrity is part of verifying a scrubber:

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
