# Focx Bot mockup — every layout value in use

Extracted mechanically from `source/styles.css` (1,397 declarations parsed) — not read off screenshots.
Counts are the number of declarations each value appears in. Nothing here is rounded or inferred.

**Scope note.** This file is a record of what the mockup *does*, captured as input for tokenisation.
It is not a token source. `design/tokens/` remains the only home for published design values.

---

## 1. Published custom properties (`:root`)

The mockup declares 8 custom properties. Only 4 are ever referenced; the rest are dead.

| Token | Value | `var()` uses | Literal re-uses | Status |
|---|---|---:|---:|---|
| `--bg` | `#101112` | 1 | 0 | live |
| `--panel` | `#141516` | 0 | 2 | **bypassed — value hard-coded instead** |
| `--surface` | `#1b1c1e` | 0 | 0 | **dead — value never used** |
| `--border` | `#ffffff10` | 18 | 3 | live |
| `--muted` | `#85878c` | 0 | 0 | **dead — value never used** |
| `--orange` | `#ff945b` | 3 | 1 | live |
| `--green` | `#a4c99c` | 0 | 0 | **dead — value never used** |
| `--font-display` | `'Space Grotesk','DM Sans',sans-serif` | 8 | — | live |

Runtime-injected properties (set per element from `app.js`, not in the stylesheet):

| Property | Set by | Values |
|---|---|---|
| `--bot-color` | `botStyle()` | one of the 6 bot accents (below) |
| `--delay` | `botStyle()` | `-0s -0.7s -1.4s -2.1s -2.8s -3.5s` (avatar float stagger) |
| `--avatar-x` | `avatar()` | `0% 50% 100%` (sprite column) |
| `--avatar-y` | `avatar()` | `0% 100%` (sprite row) |

## 2. Colour

**198 distinct colour literals** appear in the stylesheet. Grouped by hue and lightness below.
Alpha is expressed as the 8-digit hex the source actually uses.

### 2.1 Bot accent ramp (`app.js`, fed into `--bot-color`)

| Bot | Hex | H | S% | L% |
|---|---|---:|---:|---:|
| Focx | `#e5a876` | 27 | 68 | 68 |
| Byte | `#8ab6da` | 207 | 52 | 70 |
| Pixel | `#b8a0d2` | 269 | 36 | 73 |
| Bloom | `#b5c790` | 80 | 33 | 67 |
| Patch | `#c7b599` | 37 | 29 | 69 |
| Scout | `#d6a0b5` | 337 | 40 | 73 |

A deliberate 6-hue set, all at L 62–74% / S 30–46%. This is a ramp: one saturation-lightness
band sampled at six hues. It is the single most token-ready colour group in the file.

### 2.2 Confetti palette (`celebrate()`, `app.js`)

`#e6a471` `#b9c79b` `#b7a5cf` `#97b8cd` — four values, cycled `i%4`. Near-misses of the bot accents but *not equal to any of them*.

### 2.3 White-alpha overlay ramp

Used for borders, hairlines and raised surfaces. This *is* a ramp — but an unquantised one, stepping through nearly every 8-bit alpha value from 02 to 1c.

| Hex | Uses | H | S% | L% | A% | First use |
|---|---:|---:|---:|---:|---:|---|
| `#ffffff07` | 3 | 0 | 0 | 100 | 3 | `.composer-target {border}` |
| `#ffffff14` | 2 | 0 | 0 | 100 | 8 | `.subtle-button {border}` |
| `#ffffff16` | 1 | 0 | 0 | 100 | 9 | `.desktop {border}` |
| `#ffffff05` | 2 | 0 | 0 | 100 | 2 | `.bot-nav:hover {background}` |
| `#ffffff08` | 4 | 0 | 0 | 100 | 3 | `.computer-chrome {border-bottom}` |
| `#ffffff03` | 1 | 0 | 0 | 100 | 1 | `.subtle-button {background}` |
| `#ffffff09` | 1 | 0 | 0 | 100 | 4 | `.subtle-button:hover {background}` |
| `#ffffff0f` | 1 | 0 | 0 | 100 | 6 | `.den {border}` |
| `#ffffff12` | 4 | 0 | 0 | 100 | 7 | `.den {background-image}` |
| `#ffffff0d` | 1 | 0 | 0 | 100 | 5 | `.bot-card {border}` |
| `#ffffff0e` | 1 | 0 | 0 | 100 | 5 | `.team-summary {border}` |
| `#ffffff19` | 1 | 0 | 0 | 100 | 10 | `.composer {border}` |
| `#ffffff0b` | 1 | 0 | 0 | 100 | 4 | `.activity-list:before {background}` |
| `#ffffff10` | 3 | 0 | 0 | 100 | 6 | `.activity-chip {border}` |
| `#ffffff02` | 1 | 0 | 0 | 100 | 1 | `.activity-chip {background}` |
| `#ffffff13` | 1 | 0 | 0 | 100 | 7 | `.computer {border}` |
| `#ffffff0a` | 1 | 0 | 0 | 100 | 4 | `.computer-controls {border-top}` |
| `#ffffff1c` | 1 | 0 | 0 | 100 | 11 | `dialog {border}` |

### 2.4 Black-alpha (shadows / scrims)

| Hex | Uses | H | S% | L% | A% | First use |
|---|---:|---:|---:|---:|---:|---|
| `#0003` | 2 | 0 | 0 | 0 | 20 | `.bot-card:hover {box-shadow}` |
| `#000d` | 1 | 0 | 0 | 0 | 87 | `.avatar {mask-image}` |
| `#0000000c` | 1 | 0 | 0 | 0 | 5 | `.composer {box-shadow}` |
| `#0008` | 1 | 0 | 0 | 0 | 53 | `dialog {box-shadow}` |
| `#000a` | 1 | 0 | 0 | 0 | 67 | `dialog::backdrop {background}` |
| `#0006` | 1 | 0 | 0 | 0 | 40 | `#toast {box-shadow}` |
| `#000b` | 1 | 0 | 0 | 0 | 73 | `.sidebar {box-shadow}` |

### 2.5 Neutrals (S < 6%)

Surface greys below L 20%, text/icon greys above L 30%. Note the clusters of near-identical values around L 39–41%, 46–49% and 52–57%.

| Hex | Uses | H | S% | L% | A% | First use |
|---|---:|---:|---:|---:|---:|---|
| `#121314` | 2 | 210 | 5 | 7 | 100 | `.activity-item .avatar {border}` |
| `#141516` | 2 | 210 | 5 | 8 | 100 | `.sidebar {background}` |
| `#131415` | 1 | 210 | 5 | 8 | 100 | `.den {background-color}` |
| `#161718` | 2 | 210 | 4 | 9 | 100 | `.statusbar {background}` |
| `#171819` | 1 | 210 | 4 | 9 | 100 | `.bot-row {background}` |
| `#191a1b` | 1 | 210 | 4 | 10 | 100 | `.search-button {background}` |
| `#1a1b1c` | 2 | 210 | 4 | 11 | 100 | `.composer {background}` |
| `#1b1c1ded` | 1 | 210 | 4 | 11 | 93 | `.bot-card {background}` |
| `#1a1b1d` | 1 | 220 | 5 | 11 | 100 | `input {background}` |
| `#282427` | 1 | 315 | 5 | 15 | 100 | `.workspace-monogram {background}` |
| `#2a2b2d` | 1 | 220 | 3 | 17 | 100 | `.segmented button.active {background}` |
| `#505155` | 1 | 228 | 3 | 32 | 100 | `.title-divider {color}` |
| `#565a60` | 1 | 216 | 5 | 36 | 100 | `.composer-hint {color}` |
| `#5f6267` | 1 | 218 | 4 | 39 | 100 | `.den-topline {color}` |
| `#5f6268` | 1 | 220 | 5 | 39 | 100 | `.bot-card .card-corner {color}` |
| `#61656b` | 1 | 216 | 5 | 40 | 100 | `.den-caption {color}` |
| `#60646a` | 1 | 216 | 5 | 40 | 100 | `.activity-copy time {color}` |
| `#62656b` | 1 | 220 | 4 | 40 | 100 | `.sidebar-label {color}` |
| `#61646a` | 1 | 220 | 4 | 40 | 100 | `.chart-axis {color}` |
| `#64696e` | 1 | 210 | 5 | 41 | 100 | `.status-dot.idle {background}` |
| `#656a70` | 1 | 213 | 5 | 42 | 100 | `.panel-note {color}` |
| `#6e7277` | 1 | 213 | 4 | 45 | 100 | `.section-label {color}` |
| `#71767b` | 1 | 210 | 4 | 46 | 100 | `.statusbar {color}` |
| `#70767c` | 1 | 210 | 5 | 46 | 100 | `.statusbar button {color}` |
| `#777` | 1 | 0 | 0 | 47 | 100 | `.workspace-select>svg {color}` |
| `#73797e` | 1 | 207 | 5 | 47 | 100 | `.bot-row>svg {color}` |
| `#73767c` | 1 | 220 | 4 | 47 | 100 | `.breadcrumb {color}` |
| `#74767b` | 1 | 223 | 3 | 47 | 100 | `input::placeholder {color}` |
| `#777a80` | 2 | 220 | 4 | 48 | 100 | `.bot-nav-text small {color}` |
| `#797d82` | 1 | 213 | 4 | 49 | 100 | `.composer-tools {color}` |
| `#777b81` | 1 | 216 | 4 | 49 | 100 | `.workspace-select small {color}` |
| `#808185` | 1 | 228 | 2 | 51 | 100 | `.approval-mini p {color}` |
| `#80858b` | 1 | 213 | 5 | 52 | 100 | `.bot-row small {color}` |
| `#7f8389` | 1 | 216 | 4 | 52 | 100 | `.summary-metric label {color}` |
| `#808389` | 1 | 220 | 4 | 52 | 100 | `.segmented button {color}` |
| `#86898e` | 1 | 218 | 3 | 54 | 100 | `.page-heading p {color}` |
| `#858990` | 1 | 218 | 5 | 54 | 100 | `.chat-header p {color}` |
| `#85888e` | 1 | 220 | 4 | 54 | 100 | `.bot-card .role {color}` |
| `#898c91` | 1 | 217 | 4 | 55 | 100 | `.sidebar-label button {color}` |
| `#878a90` | 1 | 220 | 4 | 55 | 100 | `.activity-copy p {color}` |
| `#8b8e93` | 1 | 217 | 4 | 56 | 100 | `.eyebrow {color}` |
| `#8d9096` | 1 | 220 | 4 | 57 | 100 | `.icon-button {color}` |
| `#929398` | 1 | 230 | 3 | 58 | 100 | `.window-title {color}` |
| `#92959b` | 1 | 220 | 4 | 59 | 100 | `.activity-chip {color}` |
| `#929499` | 1 | 223 | 3 | 59 | 100 | `kbd {color}` |
| `#999ba0` | 1 | 223 | 4 | 61 | 100 | `.nav-item {color}` |
| `#a3a4a7` | 1 | 225 | 2 | 65 | 100 | `.brand-name em {color}` |
| `#abaeb3` | 1 | 217 | 5 | 69 | 100 | `.demo-badge {color}` |
| `#b9bbbf` | 1 | 220 | 4 | 74 | 100 | `.subtle-button {color}` |
| `#c3c5c8` | 1 | 216 | 4 | 77 | 100 | `.breadcrumb strong {color}` |
| `#ccc` | 1 | 0 | 0 | 80 | 100 | `.message-meta {color}` |
| `#e5e5e7` | 1 | 240 | 4 | 90 | 100 | `.segmented button.active {color}` |
| `#e9e9eb` | 1 | 240 | 5 | 92 | 100 | `input {color}` |
| `#fff` | 1 | 0 | 0 | 100 | 100 | `button:hover {color}` |

### 2.6 Near-neutrals (S 6–13%, cool-leaning)

A second, slightly bluer grey family running in parallel with 2.5 — the two are not reconciled with each other.

| Hex | Uses | H | S% | L% | A% | First use |
|---|---:|---:|---:|---:|---:|---|
| `#131516` | 1 | 200 | 7 | 8 | 100 | `.board-column {background}` |
| `#151719` | 1 | 210 | 9 | 9 | 100 | `.task-card select {background}` |
| `#161719f2` | 1 | 220 | 6 | 9 | 95 | `.bot-card {background}` |
| `#1a1917` | 1 | 40 | 6 | 10 | 100 | `.approval-mini {background}` |
| `#17191b` | 2 | 210 | 8 | 10 | 100 | `.connection-card {background}` |
| `#1a1d20` | 1 | 210 | 10 | 11 | 100 | `.skill-pill {background}` |
| `#191b1e` | 2 | 216 | 9 | 11 | 100 | `.message-attachment {background}` |
| `#1a1c1f` | 1 | 216 | 9 | 11 | 100 | `.suggestions button {background}` |
| `#1c1e20` | 1 | 210 | 7 | 12 | 100 | `.task-card {background}` |
| `#25211e` | 1 | 26 | 10 | 13 | 100 | `.composer-target {background}` |
| `#1c2024` | 1 | 210 | 12 | 13 | 100 | `.computer-chrome {background}` |
| `#272321` | 1 | 20 | 8 | 14 | 100 | `.message.user {background}` |
| `#303126` | 1 | 65 | 13 | 17 | 100 | `#toast {background}` |
| `#353a40` | 1 | 213 | 9 | 23 | 100 | `.switch {background}` |
| `#494d52` | 1 | 213 | 6 | 30 | 100 | `.statusbar b {color}` |
| `#575d65` | 1 | 214 | 7 | 37 | 100 | `.chat-date {color}` |
| `#54616d` | 1 | 209 | 13 | 38 | 100 | `.computer-chrome i {background}` |
| `#626b75` | 1 | 212 | 9 | 42 | 100 | `.column-heading span:last-child {color}` |
| `#656a71` | 1 | 215 | 6 | 42 | 100 | `.message-meta span {color}` |
| `#666e77` | 1 | 212 | 8 | 43 | 100 | `.empty-column {color}` |
| `#6b7179` | 1 | 214 | 6 | 45 | 100 | `.panel-heading>span {color}` |
| `#6f7883` | 1 | 213 | 8 | 47 | 100 | `.task-card>small {color}` |
| `#707985` | 1 | 214 | 9 | 48 | 100 | `.message-attachment>svg:last-child {color}` |
| `#737983` | 1 | 218 | 7 | 48 | 100 | `.message-attachment span {color}` |
| `#737b85` | 1 | 213 | 7 | 49 | 100 | `.section-note {color}` |
| `#777f89` | 1 | 213 | 7 | 50 | 100 | `.panel-subheading {color}` |
| `#759083` | 1 | 151 | 11 | 51 | 100 | `.terminal-label {color}` |
| `#7a858e` | 1 | 207 | 8 | 52 | 100 | `.computer-controls small {color}` |
| `#798490` | 1 | 211 | 9 | 52 | 100 | `.activity-label {color}` |
| `#788392` | 1 | 215 | 11 | 52 | 100 | `.search-result small {color}` |
| `#7e848d` | 1 | 216 | 6 | 52 | 100 | `.model-chip {color}` |
| `#858d96` | 2 | 212 | 7 | 55 | 100 | `.bot-bio {color}` |
| `#818a95` | 1 | 213 | 9 | 55 | 100 | `.settings-row p {color}` |
| `#858c95` | 1 | 214 | 7 | 55 | 100 | `.routine-card p {color}` |
| `#838e9b` | 1 | 212 | 11 | 56 | 100 | `.empty-state {color}` |
| `#858d97` | 1 | 213 | 8 | 56 | 100 | `.connection-card p {color}` |
| `#8c9098` | 1 | 220 | 6 | 57 | 100 | `.window-title .title-divider {color}` |
| `#939ba5` | 1 | 213 | 9 | 61 | 100 | `.task-card select {color}` |
| `#949aa2` | 1 | 214 | 7 | 61 | 100 | `.switch i {background}` |
| `#939ca8` | 1 | 214 | 11 | 62 | 100 | `.modal-body>p {color}` |
| `#959ca6` | 1 | 215 | 9 | 62 | 100 | `.task-bottom {color}` |
| `#9da3aa` | 1 | 212 | 7 | 64 | 100 | `.suggestions button {color}` |
| `#a1a7ae` | 1 | 212 | 7 | 66 | 100 | `.column-heading {color}` |
| `#b7aaa1` | 1 | 25 | 13 | 67 | 100 | `.computer-controls button {color}` |
| `#a4aab3` | 1 | 216 | 9 | 67 | 100 | `.skill-pill {color}` |
| `#a6adb7` | 1 | 215 | 11 | 68 | 100 | `.code-line {color}` |
| `#a6afb9` | 2 | 212 | 12 | 69 | 100 | `.doc-preview li {color}` |
| `#b0b6c0` | 1 | 218 | 11 | 72 | 100 | `.form-fields label {color}` |
| `#bfc1c6` | 1 | 223 | 6 | 76 | 100 | `.message-content p {color}` |
| `#c7cbd0` | 1 | 213 | 9 | 80 | 100 | `.empty-state h3 {color}` |
| `#d5cec8` | 1 | 28 | 13 | 81 | 100 | `.connection-card>svg {color}` |

### 2.7 Warm / orange family

The brand accent `--orange: #ff945b` plus a long tail of tints, shades and alpha washes.

| Hex | Uses | H | S% | L% | A% | First use |
|---|---:|---:|---:|---:|---:|---|
| `#1e1711` | 2 | 28 | 28 | 9 | 100 | `.primary-button {color}` |
| `#211710` | 1 | 25 | 35 | 10 | 100 | `.brand-mark {color}` |
| `#261b14` | 2 | 23 | 31 | 11 | 100 | `.send-button {color}` |
| `#554333` | 1 | 28 | 25 | 27 | 100 | `.workspace-monogram {border}` |
| `#af8058` | 1 | 28 | 35 | 52 | 100 | `.switch[aria-checked=true] {background}` |
| `#bb84501a` | 1 | 29 | 44 | 52 | 10 | `.avatar-option.selected {background}` |
| `#a8896d35` | 1 | 28 | 25 | 54 | 21 | `.bar-chart i {background}` |
| `#ad8a6920` | 1 | 29 | 29 | 55 | 13 | `.routine-icon {background}` |
| `#d7904110` | 1 | 32 | 65 | 55 | 6 | `.den:before {background}` |
| `#b2926420` | 1 | 35 | 34 | 55 | 13 | `.task-card .priority {background}` |
| `#ba8e6520` | 1 | 29 | 38 | 56 | 13 | `.routine-icon {border}` |
| `#a58e77` | 1 | 30 | 20 | 56 | 100 | `.empty-state>svg {color}` |
| `#af987b50` | 3 | 33 | 25 | 58 | 31 | `.org-connectors {border}` |
| `#bc9470` | 1 | 28 | 36 | 59 | 100 | `.typing i {background}` |
| `#b0977d` | 1 | 31 | 24 | 59 | 100 | `.routine-card small {color}` |
| `#ffbd2e` | 1 | 41 | 100 | 59 | 100 | `.window-lights i:nth-child(2) {background}` |
| `#b59d80` | 1 | 33 | 26 | 61 | 100 | `.approval-mini .approval-label {color}` |
| `#ba9e84` | 1 | 29 | 28 | 62 | 100 | `.typing {color}` |
| `#bea07c` | 1 | 33 | 34 | 62 | 100 | `.task-card .priority {color}` |
| `#e88c5712` | 1 | 22 | 76 | 63 | 7 | `.nav-item.active {background}` |
| `#d69f71` | 1 | 27 | 55 | 64 | 100 | `.code-line .cursor {background}` |
| `#dea06709` | 1 | 29 | 64 | 64 | 4 | `.approval-mini {background}` |
| `#f28f5720` | 1 | 22 | 86 | 65 | 13 | `.nav-item.active .nav-count {background}` |
| `#d3a07b15` | 1 | 25 | 50 | 65 | 8 | `.bar-chart i {border}` |
| `#e4a56724` | 1 | 30 | 70 | 65 | 14 | `.approval-mini {border}` |
| `#f09563` | 1 | 21 | 82 | 66 | 100 | `.brand-mark {background}` |
| `#dca77b85` | 1 | 27 | 58 | 67 | 52 | `.bar-chart i:nth-last-child(-n+4) {background}` |
| `#e7b16e` | 1 | 33 | 72 | 67 | 100 | `.status-dot.waiting {background}` |
| `#ff945b80` | 1 | 21 | 100 | 68 | 50 | `input:focus {outline}` |
| `#bcaaa0` | 1 | 21 | 17 | 68 | 100 | `.composer-target {color}` |
| `#ff9a5d55` | 1 | 23 | 100 | 68 | 33 | `.composer:focus-within {border-color}` |
| `#daa782` | 1 | 25 | 54 | 68 | 100 | `.approval-mini button {color}` |
| `#f5a16510` | 1 | 25 | 88 | 68 | 6 | `.message.user {border}` |
| `#d4ab89` | 1 | 27 | 47 | 68 | 100 | `.message-attachment>svg {color}` |
| `#d2aa87` | 1 | 28 | 45 | 68 | 100 | `.routine-icon {color}` |
| `#eda074` | 1 | 22 | 77 | 69 | 100 | `.send-button {background}` |
| `#efa16f` | 1 | 23 | 80 | 69 | 100 | `.primary-button {background}` |
| `#ffa46f` | 2 | 22 | 100 | 72 | 100 | `.nav-item.active .nav-count {color}` |
| `#ffb07790` | 1 | 25 | 100 | 73 | 56 | `.avatar-option.selected {border-color}` |
| `#ffb17f` | 1 | 23 | 100 | 75 | 100 | `.primary-button {border}` |
| `#ffb37e` | 1 | 25 | 100 | 75 | 100 | `.primary-button:hover {background}` |
| `#ffb185` | 1 | 22 | 100 | 76 | 100 | `.workspace-monogram {color}` |
| `#ffb384` | 1 | 23 | 100 | 76 | 100 | `.send-button:hover {background}` |
| `#ffc28a50` | 1 | 29 | 100 | 77 | 31 | `.suggestions button:hover {border-color}` |
| `#ffd3af` | 1 | 27 | 100 | 84 | 100 | `.suggestions button:hover {color}` |
| `#e5d9cf` | 1 | 27 | 30 | 85 | 100 | `.message.user p {color}` |
| `#ffe5d0` | 1 | 27 | 100 | 91 | 100 | `.switch[aria-checked=true] i {background}` |

### 2.8 Greens

| Hex | Uses | H | S% | L% | A% | First use |
|---|---:|---:|---:|---:|---:|---|
| `#28c840` | 1 | 129 | 67 | 47 | 100 | `.window-lights i:nth-child(3) {background}` |
| `#969c6333` | 1 | 66 | 22 | 50 | 20 | `#toast {border}` |
| `#7d9a75` | 1 | 107 | 15 | 53 | 100 | `.metric-value span {color}` |
| `#819b78` | 1 | 105 | 15 | 54 | 100 | `.pulse-stats span {color}` |
| `#8aac7a` | 1 | 101 | 23 | 58 | 100 | `.pulse-icon i {background}` |
| `#7ea887` | 1 | 133 | 19 | 58 | 100 | `.code-line span {color}` |
| `#8bac8010` | 1 | 105 | 21 | 59 | 6 | `.live-tag {background}` |
| `#92be7780` | 1 | 97 | 35 | 61 | 50 | `.live-tag .status-dot {box-shadow}` |
| `#91b18520` | 1 | 104 | 22 | 61 | 13 | `.live-tag {border}` |
| `#95b491` | 1 | 113 | 19 | 64 | 100 | `.resolved-label {color}` |
| `#a2bf97` | 1 | 104 | 24 | 67 | 100 | `.connected {color}` |
| `#a2bf9730` | 1 | 104 | 24 | 67 | 19 | `.connected {border-color}` |
| `#9fbd97` | 1 | 107 | 22 | 67 | 100 | `.live-tag {color}` |
| `#9ccf97` | 1 | 115 | 37 | 70 | 100 | `.status-dot {background}` |
| `#e8ecd9` | 1 | 73 | 33 | 89 | 100 | `#toast {color}` |

### 2.9 Cool / slate

| Hex | Uses | H | S% | L% | A% | First use |
|---|---:|---:|---:|---:|---:|---|
| `#0c0f11` | 1 | 204 | 17 | 6 | 100 | `.computer {background}` |
| `#121619` | 1 | 206 | 16 | 8 | 100 | `.doc-preview {background}` |
| `#13181c` | 1 | 207 | 19 | 9 | 100 | `.computer-controls {background}` |
| `#525f6d` | 1 | 211 | 14 | 37 | 100 | `.code-line.muted {color}` |
| `#ff6058` | 1 | 3 | 100 | 67 | 100 | `.window-lights i {background}` |
| `#e5e8ec` | 1 | 214 | 16 | 91 | 100 | `dialog {color}` |

### 2.10 Colour keywords

- `transparent` × 9
- `inherit` × 4
- `currentColor` × 1
- `black` × 1

`color-mix(in srgb, var(--bot-color) 10%, transparent)` is used once, in `.bot-card` border.
## 3. Spacing

Every `px` atom appearing in any padding / margin / gap declaration, with frequency:

| px | uses | | px | uses | | px | uses |
|---:|---:|---|---:|---:|---|---:|---:|
| 1 | 1 | | 12 | 21 | | 23 | 4 |
| 2 | 9 | | 13 | 15 | | 24 | 8 |
| 3 | 8 | | 14 | 7 | | 25 | 9 |
| 4 | 14 | | 15 | 16 | | 26 | 4 |
| 5 | 15 | | 16 | 4 | | 27 | 1 |
| 6 | 17 | | 17 | 6 | | 28 | 5 |
| 7 | 21 | | 18 | 11 | | 29 | 1 |
| 8 | 21 | | 19 | 1 | | 30 | 8 |
| 9 | 14 | | 20 | 12 | | 36 | 1 |
| 10 | 22 | | 21 | 4 | | 42 | 3 |
| 11 | 10 | | 22 | 9 | | 50 | 1 |

**33 distinct step values across 303 uses.** Every single integer from `1px` to `30px` is used,
with three outliers above that: `36px`, `42px`, `50px`. There is no skipped step anywhere in the
1–30 range — which is the clearest possible evidence that no spacing scale was ever applied.

### 3.1 `gap` alone

`8px`×11 `7px`×11 `5px`×9 `10px`×8 `6px`×7 `15px`×6 `11px`×5 `9px`×4 `4px`×4 `13px`×4 `22px`×2 `26px`×2 `20px`×2 `28px`×1 `12px`×1 `23px`×1 `3px`×1 `2px`×1 `14px`×1 `25px`×1 `17px`×1

### 3.2 Container padding by breakpoint

| Element | ≥1550 | default | ≤1200 | ≤1030 | ≤730 |
|---|---|---|---|---|---|
| `.main-content` | `36px 42px 28px` | `29px 30px 24px` | `25px 22px 20px` | `28px 30px 24px` | `23px 18px 18px` |
| `.composer-zone` | *(l/r 42px)* | `0 30px 20px` | *(l/r 22px)* | `0 30px 20px` | `8px 18px 12px` |
| `.den` | `30px` | `25px 20px 18px` | `24px 13px 15px` | — | `26px 12px 12px` |
| `.toolbar` | — | `0 28px` | `0 22px` | — | `0 17px` |
| `.activity-panel` | `30px 25px` | `25px 21px` | `23px 16px` | *hidden* | *hidden* |

## 4. Border radius

| Value | Uses |
|---|---:|
| `7px` | 8 |
| `10px` | 8 |
| `9px` | 7 |
| `50%` | 7 |
| `8px` | 7 |
| `12px` | 5 |
| `4px` | 4 |
| `5px` | 4 |
| `6px` | 4 |
| `11px` | 1 |
| `inherit` | 1 |
| `3px 3px 0 0` | 1 |
| `11px 11px 2px 11px` | 1 |
| `15px` | 1 |
| `0` | 1 |

Plus per-corner radii: `3px 3px 0 0` (`.bar-chart i`) and `11px 11px 2px 11px` (`.message.user`).

## 5. Typography

### 5.1 Families

- Body / UI: `'DM Sans', sans-serif` — weights loaded: **400, 450, 500, 550, 600, 650, 700**
- Display: `'Space Grotesk', 'DM Sans', sans-serif` (`--font-display`) — weights loaded: **400, 500, 600, 700**
- Mono: bare `monospace` (2 uses: `.code-line`, `.terminal-label`) — no family specified
- Loaded via one Google Fonts `@import` with `display=swap`

### 5.2 Font sizes

| px | Uses | Where it's the defining size |
|---:|---:|---|
| 8 | 5 | `.task-card .priority` |
| 9 | 25 | `.den-topline` |
| 10 | 30 | `.sidebar-label` |
| 11 | 24 | `kbd` |
| 12 | 30 | `small` |
| 13 | 25 | `.search-button` |
| 14 | 12 | `.nav-item` |
| 15 | 2 | `h3` |
| 16 | 2 | `h2` |
| 17 | 2 | `.bot-card strong` |
| 18 | 1 | `.doc-preview h3` |
| 19 | 1 | `.bot-card strong` |
| 21 | 2 | `.modal-head h2` |
| 23 | 3 | `.brand-name` |
| 25 | 2 | `.brand-mark` |
| 27 | 1 | `.page-heading h1` |
| 28 | 1 | `.pulse-stats strong` |
| 30 | 1 | `h1` |

**18 distinct sizes** across 169 declarations. 8–14px carry **151 of 169**; every size 15px and above is a one- or two-off.

### 5.3 Line heights

`1.6`×4 `1.5`×2 `1.8`×2 `1.9`×2 `2`×1 `1.7`×1 `2.1`×1

All unitless. `1.6` is the `p` default. No line-height is paired systematically with a font-size —
the 8–13px UI sizes inherit whatever their container sets.

### 5.4 Weights

`500`×10 `550`×3 `600`×3 `400`×3 `450`×3 `700`×1

`550` is the heading weight (`h1,h2,h3`). `650` is loaded from Google Fonts but never used in CSS.

### 5.5 Letter spacing

- `-1px` × 2 — `h1`
- `1.8px` × 2 — `.sidebar-label`
- `1.7px` × 1 — `.eyebrow`
- `0` × 1 — `.den-topline span:last-child`
- `-.3px` × 1 — `.bot-card strong`
- `1.3px` × 1 — `.panel-subheading`

Two roles: negative tracking on display headings (`-1px`, `-.3px`), positive on uppercase eyebrows/labels (`1.3px`, `1.7px`, `1.8px`).

### 5.6 Text transform / other

`text-transform` is **never used**. Every uppercase label in the UI is typed as a literal uppercase string in `app.js` (e.g. `'YOUR WORKSPACE'`, `'IN THE TOOLBOX'`) — so casing is content, not style, and cannot be re-cased from a token.

## 6. Elevation (box-shadow)

| Shadow | Uses | Applied to |
|---|---:|---|
| `0 0 8px #92be7780` | 1 | `.live-tag .status-dot` |
| `0 1px 2px #0003` | 1 | `.segmented button.active` |
| `0 9px 25px #0003` | 1 | `.bot-card:hover` |
| `0 3px 15px #0000000c` | 1 | `.composer` |
| `0 30px 100px #0008` | 1 | `dialog` |
| `0 8px 30px #0006` | 1 | `#toast` |
| `20px 0 80px #000b` | 1 | `.sidebar` |

Seven shadows, every one unique. No repeated elevation step anywhere in the file.

Related: `backdrop-filter: blur(6px)` (1 use, `dialog::backdrop`).

## 7. Motion

### 7.1 Transitions

- `background .18s,color .18s,transform .18s` — `button`
- `transform .2s,border-color .2s,box-shadow .2s` — `.bot-card`
- `transform .2s` — `.switch i`
- `.25s` — `#toast`
- `none!important` — `*`

**Durations in use: `.18s`, `.2s`, `.25s`.** No easing function is ever specified on a transition —
all four transition declarations fall back to the CSS default `ease`.

### 7.2 Animations

- `breath 1s infinite` — `.typing i`
- `none!important` — `.no-motion *`
- `breath 2s infinite` — `.live-tag .status-dot`
- `float 5s ease-in-out infinite` — `.bot-card .avatar`
- `spin 5s linear infinite` — `.bot-card .working svg`
- `equalize 1.8s ease-in-out infinite` — `.pulse-icon i`
- `fall 2.5s linear forwards` — `.confetti`

### 7.3 Keyframes (verbatim)

```css
@keyframes float{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-5px) rotate(2deg)}}
@keyframes breath{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes equalize{50%{transform:scaleY(.45)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes fall{to{transform:translateY(110vh) rotate(720deg);opacity:0}}
```

### 7.4 All time values and easings

Durations: `.2s`×4, `.18s`×3, `5s`×2, `1s`×2, `2s`×1, `1.8s`×1, `.3s`×1, `.6s`×1, `.25s`×1, `2.5s`×1

Easings: `linear`×4, `ease-in-out`×2 — **no `cubic-bezier` anywhere.**

Motion is disabled two ways: `@media(prefers-reduced-motion:reduce) * { animation/transition: none !important }`,
and a user setting that adds `.no-motion` to `<body>` (`.no-motion * { animation: none !important }`).
A third state, `.paused`, sets `animation-play-state: paused` on avatars, pulse dots and status dots.

## 8. Breakpoints

| Query | Role |
|---|---|
| `@media(min-width:1550px)` | wide desktop — larger avatars, 1400px max content width |
| *(none)* | base / default desktop |
| `@media(max-width:1200px)` | narrow desktop — panel and sidebar shrink |
| `@media(max-width:1030px)` | activity panel hidden entirely |
| `@media(max-width:730px)` | mobile — sidebar becomes an overlay drawer |
| `@media(min-width:731px)` | the mobile query's complement, used to raise type sizes |
| `@media(prefers-reduced-motion:reduce)` | kills all animation and transition |

Note `730` / `731` are a matched pair, so the real breakpoint set is **1550 / 1200 / 1030 / 730**.

## 9. Key layout dimensions

| Element | Value | Notes |
|---|---|---|
| `.main-content` max-width | `1400px` (≥1550 only) | centred with `margin:auto` |
| `.desktop` | `height:100dvh`, `min-height:650px`, `border-radius:12px` | app shell |
| `.sidebar` width | `224px` base · `235px` ≥1550 · `200px` ≤1200 · `210px` ≤1030 · `230px` drawer ≤730 | |
| `.activity-panel` width | `286px` base · `315px` ≥1550 · `245px` ≤1200 · hidden ≤1030 | |
| `.titlebar` height | `43px` base · `35px` ≤730 | |
| `.toolbar` height | `65px` base · `55px` ≤730 | |
| `.statusbar` height | `28px` | |
| `.window-lights` width | `181px` base · `156px` ≤1200 · `auto` ≤730 | |
| `dialog` width | `min(510px, calc(100vw - 30px))` | `.computer-expanded`: `min(800px,90vw)` |
| `.bot-grid` | `repeat(3,minmax(0,1fr))` → `repeat(2,…)` ≤730 | |
| `.task-board` | `repeat(3,minmax(0,1fr))` → `1fr` ≤730 | |
| `.connection-grid` | `repeat(2,minmax(0,1fr))` → `1fr` ≤730 | |
| `.avatar` base | `86px` square, `border-radius:50%` | atlas `background-size:300% 200%`; radial `mask-image` feather |
| `.message-attachment` max-width | `330px` | |
| `.den` min-height | `399px` base · `470px` ≥1550 · `390px` ≤1030 · `0` ≤730 | |

### 9.1 Avatar sizes (same sprite, 13 different sizes)

| Context | Size |
|---|---|
| `.bot-card` ≥1550 | `107px` |
| `.bot-card` ≤1030 | `90px` |
| `.bot-card` | `88px` |
| `.avatar` base | `86px` |
| `.bot-card` ≤730 | `82px` |
| `.bot-card` ≤1200 | `75px` |
| `.den.is-org .bot-card` | `64px` |
| `.chat-header` | `62px` |
| `.den.is-org` ≤730 | `54px` |
| `.bot-row` | `51px` |
| `.chat-header` ≤730 | `50px` |
| `.avatar-option` | `48px` |
| `.inbox-card` | `44px` |
| `.avatar-option` ≤730 | `37px` |
| `.bot-nav` / `.inbox-card` ≤730 | `35px` |
| `.activity-item` / `.message` / `.search-result` | `29px` |
| `.task-bottom` | `22px` |
| `.composer-target` | `18px` |

### 9.2 z-index

`1` (`.den.is-org .bot-card`) · `20` (`.sidebar`) · `50` (`#toast`) · `100` (`.confetti`)

### 9.3 Icon sizing

Global `svg { width:19px; height:19px; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; fill:none }`,
overridden per-component to 11, 12, 13, 14, 15, 16, 17, 22 and 29px. All icons are 24×24 viewBox line icons.
## 10. Scale or one-off?

This is the section that decides how much of the mockup can become tokens cleanly.
Every claim below is measured, not estimated.

### 10.1 Verdict table

| Group | Distinct values | Verdict | Evidence |
|---|---:|---|---|
| Bot accent colours | 6 | **Genuine ramp** | one S/L band (S 30–46%, L 62–74%) sampled at 6 hues |
| Breakpoints | 4 | **Genuine scale** | 730 / 1030 / 1200 / 1550, each with a distinct layout job |
| Font weights | 6 | **Genuine scale** | 400/450/500/550/600/700 — DM Sans's own 50-step axis |
| White-alpha overlays | 24 | **Ramp, unquantised** | monotonic 02→1c, but ~every 8-bit step is used |
| Border radius | 10 | **Near-scale, over-sampled** | 4,5,6,7,8,9,10,11,12,15 — a 1px continuum over a 9px span |
| Neutral greys | 79 | **Intended ramp, badly quantised** | collapses to ~20 steps at an invisible ΔRGB ≤ 10 |
| Font sizes | 18 | **Continuum, not a scale** | consecutive ratios 1.037–1.125, no constant; 8–14px are every integer |
| Spacing | 33 | **Continuum, not a scale** | every integer 2–30; 42% of uses are odd numbers |
| Line heights | 7 | **One-offs** | 1.5–2.1, unpaired with any font size |
| Letter spacing | 6 | **Two intents, 6 values** | display tightening vs. eyebrow tracking |
| Shadows | 7 | **All one-offs** | no two shadows share a value |
| Transition durations | 3 | **Effectively one** | .18s/.2s/.25s; no easing ever specified |
| Warm / green / cool colours | 63 | **One-offs** | tints and washes derived ad hoc per component |

### 10.2 The three that will actually cost you

**Spacing — 33 values, no base unit.**
Only 58% of spacing uses are even numbers, and 28% are divisible by 4. There is no 4px or 8px
grid here; there is a 1px grid. `padding:7px 9px`, `gap:11px`, `padding:23px 18px 18px` are
typical. A published spacing ramp will not match this mockup at any granularity coarser than 1px,
so every spacing value has to be *re-decided*, not mapped.

**Colour — 198 literals, ~58 perceptually distinct.**
The 148 opaque colours collapse to **58 clusters** at an RGB distance of 10 (a difference you
cannot see on a calibrated display) and to **33** at a distance of 20. The largest clusters are
16, 13, 13, 9 and 8 near-identical greys. These are not deliberate steps; they are the same
intended grey re-picked by eye in different components.

**Type — 18 sizes, no modular scale.**
Consecutive size ratios run 1.037 to 1.125 with no constant, because 8–14px uses every single
integer. 151 of 169 font-size declarations fall in that 8–14px band, and every size ≥15px is used
once or twice. The display sizes (21, 23, 25, 27, 28, 30px) are all breakpoint variants of two
headings, not six type styles.

### 10.3 What maps to tokens with no argument

- The **6 bot accents** — already a ramp, already semantic, already driven through one custom property.
- The **4 breakpoints** — clean, purposeful, no redundancy.
- **`--orange: #ff945b`** — the one accent used consistently through `var()`.
- **`--border: #ffffff10`** — 18 `var()` uses; the single most disciplined value in the file.
- **Font weights** and the **two families**.
- **`1px`** as the universal border width (every border in the file is 1px except one 2px avatar ring).

### 10.4 Values that are already broken in the source

Worth fixing during tokenisation rather than carrying across:

1. `--surface: #1b1c1e`, `--muted: #85878c`, `--green: #a4c99c` are declared in `:root` and
   **used nowhere at all** — not via `var()`, not as literals.
2. `--panel: #141516` is never used via `var()`; its value is hard-coded twice instead.
3. `--border`'s value `#ffffff10` is *also* hard-coded 3 times alongside its 18 `var()` uses.
4. Font weight **650** is downloaded from Google Fonts and never used.
5. `.empty-state` is fully styled in CSS (4 rules) and never rendered by `app.js` — the only
   empty state the app can actually reach is `.empty-column`.
6. The confetti palette (`#e6a471 #b9c79b #b7a5cf #97b8cd`) is four near-misses of the bot
   accents rather than the accents themselves.
7. `text-transform` is never used — every uppercase label is a literal uppercase string in the
   JS, so casing cannot be controlled from a token.
8. No transition specifies an easing, so all motion uses the browser default `ease`. There is no
   easing value to tokenise; there is a decision to make.
