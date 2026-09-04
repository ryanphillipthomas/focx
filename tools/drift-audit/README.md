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

## Why this is not the shipped Action

This harness and `ryanphillipthomas/drift-check@v1` (FOC-27) answer different questions.
The Action answers *"is this repo's own gate green?"* for a repo configured to use it.
This harness answers *"what would a stranger's repo score?"* with no cooperation from
that repo — no config file, no token path, nothing.

The two do **not** agree today, and the gap is large enough that outreach cannot ask a
maintainer to install the Action and expect it to reproduce the number we quoted. See
FOC-51. Measured on 2026-09-04:

| Repo | This harness | `drift-check@v1` |
|---|---:|---:|
| `ClickHouse/click-ui` | 69 | 6,433 |
| `sumup-oss/circuit-ui` | 12 | 731 |

Three structural reasons:

1. **No false-positive filtering in the Action.** It skips only `node_modules`, `dist`,
   `build`. Inlined SVG art, generated reports, and test fixtures all count. ClickHouse's
   top Action finding is `src/components/Assets/Flags/Australia.tsx` — the Australian
   flag's navy is not a design token, and saying so out loud ends the conversation.
2. **The token layer must be one `tokens.json` per namespace.** Real design systems
   publish tokens as TypeScript (`circuit-ui`, `commercetools/ui-kit`), SCSS
   (`swisspost`), or CSS custom properties (`equinor`). The Action cannot read those, so
   every published value becomes unresolvable and counts as a violation.
3. **Check #1 is focx-specific.** Parent/child token-layer override validation encodes a
   convention no third party shares, and fires meaningless
   `silent parent redefinition is drift` errors on their repos.

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
- Values are matched literally. A repo publishing `#FFF` and writing `#FFFFFF` scores a
  violation; the exclusions do not model color equivalence.
- `drift-allow` is honored, but no other repo-local suppression convention is.
