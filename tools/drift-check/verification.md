# Third-party verification

Verified 2026-09-04 UTC against fresh shallow clones. The Action ran without a repository config. The reference count came from `tools/drift-audit/reverify.mjs` on the FOC-50 branch.

| Repository | Commit | Reference | Action | Delta |
|---|---|---:|---:|---:|
| `pinterest/gestalt` | `22874a7522d1803df992fae2bcb31ef42be29519` | 44 | 44 | 0 |
| `sumup-oss/circuit-ui` | `178e0b6a825ea6949c90fcdfaa20cef9ca6836cd` | 12 | 12 | 0 |
| `commercetools/ui-kit` | `62ca335b629de087f574af71869d68cbd3bd004c` | 16 | 16 | 0 |
| `swisspost/design-system` | `7e8bb2134a259448bffa508a37e487399a27da67` | 142 | 142 | 0 |
| `equinor/design-system` | `a124edbe76ec1ca63cd15f876401bee6ea5af2fb` | 137 | 137 | 0 |
| `tokens-studio/figma-plugin` | `e56bfbd2f757cd0a11f82a05062383e699aefc25` | 55 | 55 | 0 |
| `ClickHouse/click-ui` | `6a691327daa365a4941d53d471e4eb3972e9f7c1` | 69 | 69 | 0 |

All seven match exactly. In particular, `click-ui` falls from the published v1 result of 6,433 to the defensible 69, and `circuit-ui` falls from 731 to 12.
