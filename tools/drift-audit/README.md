# drift-audit — outreach re-verification harness

Recomputes a third-party repo's design-drift violation count against its **current HEAD**,
so an outreach message never carries a stale or indefensible number.

```
git clone --depth 1 https://github.com/<owner>/<repo>.git /tmp/<repo>
node tools/drift-audit/reverify.mjs /tmp/<repo>          # human-readable
node tools/drift-audit/reverify.mjs /tmp/<repo> --json    # machine-readable
```

Calibration: run against this repo it reports **0 violations**, matching the real
`drift-check` gate.

```
node tools/drift-audit/reverify.mjs .
```

## Relationship to the shipped Action

This harness and `drift-check` (FOC-27) answer different questions. The Action answers
*"is this repo's own gate green?"* for a repo configured to use it. This harness answers
*"what would a stranger's repo score?"* with no cooperation from that repo — no config
file, no token path, nothing.

**The scanners now agree. The published tag does not carry that fix yet.**

FOC-51 corrected the Action's scanner, and the two implementations now produce identical
counts on all seven outreach candidates (`tools/drift-check/verification.md`).
Re-confirmed independently on 2026-09-04 for the two live outreach targets, running both
scanners against the same fresh clones:

| Repo | HEAD | This harness | Fixed `drift-check` | Published `@v1` |
|---|---|---:|---:|---:|
| `commercetools/ui-kit` | `62ca335` | 16 | 16 | — |
| `ClickHouse/click-ui` | `6a69132` | 69 | 69 | 6,433 |
| `sumup-oss/circuit-ui` | `178e0b6` | 12 | 12 | 731 |

The fix lives in focx PR #60. The standalone action repo `ryanphillipthomas/drift-check`
has not been updated since it was published, and its `v1` tag still resolves to the
250-line pre-fix scanner — verified by reading
`raw.githubusercontent.com/ryanphillipthomas/drift-check/v1/tools/drift-check/index.mjs`,
which still contains all three original defects:

1. **No false-positive filtering.** `walk()` skips only `node_modules`, `dist`, `build`.
   Inlined SVG art, generated reports, and test fixtures all count. ClickHouse's top v1
   finding is `src/components/Assets/Flags/Australia.tsx` — the Australian flag's navy is
   not a design token, and saying so out loud ends the conversation.
2. **The token layer must be one `tokens.json` per namespace.** `loadTokens()` is
   `JSON.parse` only. Real design systems publish tokens as TypeScript (`circuit-ui`,
   `commercetools/ui-kit`), SCSS (`swisspost`), or CSS custom properties (`equinor`), so
   every correctly-tokenized value becomes unresolvable and counts as a violation.
3. **Check #1 is focx-specific.** Parent/child override validation encodes a convention no
   third party shares, and fires `silent parent redefinition is drift` on their repos.

So outreach still cannot ask a maintainer to run `drift-check@v1` — not because the tool
is wrong, but because the corrected tool is not the one they would get. Until #60 merges
and the standalone repo is re-tagged, this harness remains the source of any number that
appears in an outreach message.

## Detection rules

Check #2 only — a raw literal counts when it does not resolve to a value published in
that repo's **own** token layer. Same regexes and same `drift-allow` escape hatch as
`tools/drift-check/index.mjs`. Check #1 is deliberately not implemented.

The token layer is auto-detected: any file under a `tokens/`, `theme(s)/`, or `palette/`
directory, or whose own name reads as a token/palette/color definition.

Four false-positive classes are excluded, because each one inflates the count to a number
that collapses the moment a maintainer opens the file:

| Class | Why | Evidence |
|---|---|---|
| Generated output | Build/report/coverage artifacts are not authored style | A Playwright report with 1,811 inline hex values (FOC-41) |
| Token definitions | Flagging the source of truth pitches a maintainer on their own tokens | `swisspost` `_color.scss`; `yelbolt/unoff-ui` 792 → 14 (FOC-41) |
| Inlined SVG art | Flag and icon colors are artwork, not design decisions | `ClickHouse` `Assets/Flags/Spain.tsx`, 745 hex in one country flag (FOC-41) |
| Test and story fixtures | A literal asserted in a test is a fixture, not a styling choice | `gestalt` `multiColumnLayout.test.ts`, 247 px layout assertions (FOC-50) |

The first three come from FOC-41. The fourth was found while re-verifying for FOC-50:
without it Gestalt scores 348 rather than 44, and the top "violation" is a masonry layout
unit test.

## Known limits

Read these before quoting a number.

- **A low count is not automatically a good pitch.** Disciplined repos leave a residue of
  *intentional* literals. Gestalt's largest remaining file is a skin-tone swatch table,
  which is supposed to be literal. Always read the hottest file before contact.
- **The "published values" figure is not the repo's token count.** It is the number of
  distinct resolvable values the harness extracted, after deduplication and after
  discarding aliases. `ClickHouse/click-ui` reports 269 published values from 21 token
  files, while its four theme JSONs define 2,735 token entries. Never quote either number
  to a maintainer as "you publish N tokens" — they can count, and the two figures measure
  different things.
- Values are matched literally. A repo publishing `#FFF` and writing `#FFFFFF` scores a
  violation; the exclusions do not model color equivalence.
- `drift-allow` is honored, but no other repo-local suppression convention is.
