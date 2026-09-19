# Focx Bot mockup — component inventory

What repeats, what varies, and every state each element actually has.

**States are reported as implemented, not as they ought to be.** Where a state is missing, it is
called out — that absence is the finding. The mockup has **no error state, no loading state, no
active/pressed state and no disabled state anywhere in the product UI.**

145 classes are styled. 3 are styled but never rendered (see §7).

---

## 1. State coverage at a glance

| Component | default | hover | focus | active/pressed | disabled | error | loading | empty |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `.primary-button` | ✓ | ✓ | ✓ (global) | — | — | — | — | n/a |
| `.outline-button` | ✓ | ✓ | ✓ (global) | `.connected` | — | — | — | n/a |
| `.subtle-button` | ✓ | ✓ | ✓ (global) | — | — | — | — | n/a |
| `.icon-button` | ✓ | ✓ | ✓ (global) | — | — | — | — | n/a |
| `.send-button` | ✓ | ✓ | ✓ (global) | — | — | — | — | n/a |
| `.nav-item` | ✓ | ✓ | ✓ (global) | `.active` | — | — | — | n/a |
| `.bot-nav` | ✓ | ✓ | ✓ (global) | `.active` | — | — | — | n/a |
| `.bot-card` | ✓ | ✓ | ✓ (global) | — | — | — | — | n/a |
| `.segmented button` | ✓ | — | ✓ (global) | `.active` | — | — | — | n/a |
| `.suggestions button` | ✓ | ✓ | ✓ (global) | — | — | — | — | n/a |
| `.search-result` | ✓ | ✓ | ✓ (global) | — | — | — | — | ✓ |
| `.avatar-option` | ✓ | — | ✓ (global) | `.selected` | — | — | — | n/a |
| `.switch` | ✓ | — | ✓ (global) | `[aria-checked=true]` | — | — | — | n/a |
| `input` / `textarea` / `select` | ✓ | — | `:focus` | — | — | **—** | — | `::placeholder` |
| `.composer` | ✓ | — | `:focus-within` | — | — | **—** | — | `::placeholder` |
| `.board-column` | ✓ | — | — | — | — | — | — | ✓ |
| `.approval-mini` | ✓ | — | — | — | — | — | — | ✓ |
| `UP NEXT` list | ✓ | — | — | — | — | — | — | ✓ |
| `.typing` | — | — | — | — | — | — | ✓ *(only pending state in the app)* | — |
| `button` (global) | ✓ | ✓ | `:focus-visible` | — | `:disabled` *(never triggered)* | — | — | — |

`:focus-visible` is defined once globally — `outline: 2px solid var(--orange)` with
`outline-offset: 4px` — and inherited by every button and link. No component defines its own focus
ring, which is the most consistent thing in the file.

`button:disabled { cursor: default; opacity: .45 }` exists but **no element in the app is ever
given the `disabled` attribute**, so the style is unreachable.

---

## 2. Repeating components

### 2.1 Avatar — the most-repeated element in the system
One 1536×1024 PNG atlas (`assets/fox-avatar-atlas.png`), 3 columns × 2 rows of 512px cells.
Positioned by two runtime custom properties:
`--avatar-x: {0% | 50% | 100%}` and `--avatar-y: {0% | 100%}`, with `background-size: 300% 200%`.

**Varies by:** size (18 distinct sizes, listed in `design-values.md` §9.1), corner treatment, and
edge treatment.

| Variant | Radius | Mask | Extra |
|---|---|---|---|
| Base `.avatar` | `50%` | radial feather `ellipse at center, black 35%, #000d 49%, transparent 72%` | — |
| `.bot-card .avatar` | `50%` | feathered | `animation: float 5s ease-in-out infinite`, delay `var(--delay)` |
| `.bot-nav` | `11px` | `none` | — |
| `.inbox-card` | `12px` | `none` | — |
| `.activity-item` | `9px` | `none` | `border: 2px solid #121314` (the only 2px border in the file) |
| `.message` | `8px` | `none` | — |
| `.avatar-option` | `8px` | `none` | — |
| `.search-result` | `7px` | `none` | — |
| `.task-bottom` | `6px` | `none` | — |
| `.composer-target` | `4px` | `none` | — |

The radial mask is used **only** at the two largest sizes; every small avatar squares off. That is
a real rule worth carrying into Figma: *feathered circle above ~50px, rounded square below*.

### 2.2 Buttons — 6 treatments over a shared 7px radius

| Class | Fill | Border | Text | Size | Radius | Hover |
|---|---|---|---|---|---|---|
| `.primary-button` | `#efa16f` | `1px #ffb17f` | `#1e1711` | `9px 13px`, 13px/600 | `7px` | fill → `#ffb37e` |
| `.subtle-button` + `.outline-button` | `#ffffff03` | `1px #ffffff14` | `#b9bbbf` | `8px 11px`, 12px | `7px` | fill → `#ffffff09` |
| `.icon-button` | transparent | — | `#8d9096` | `31×31` | `7px` | fill → `#ffffff08` |
| `.send-button` | `#eda074` | — | `#261b14` | `29×29` | `7px` | fill → `#ffb384` |
| `.search-button` | `#191a1b` | `1px var(--border)` | `#777a80` | `9px 10px`, 13px | `7px` | *(none)* |
| `.segmented button` | transparent | — | `#808389` | `6px 10px`, 12px | `5px` | *(none)* — has `.active` instead |
| `.suggestions button` | `#1a1c1f` | `1px #ffffff12` | `#9da3aa` | `6px 9px`, 11px | `6px` | border `#ffc28a50`, text `#ffd3af` |

This is the **most disciplined part of the mockup**, and worth saying plainly: five of the seven
share one `7px` radius, `.subtle-button` and `.outline-button` genuinely share a base rule, and the
two exceptions are justified — `5px` for a control nested inside a `.segmented` container, `6px`
for inline suggestion chips.

`.outline-button` adds one variant, `.connected`, using `!important`:
`color: #a2bf97; border-color: #a2bf9730`. It is the only `!important` in the component layer.

All buttons hover via a single global rule too: `button:hover { color: #fff }`, plus
`transition: background .18s, color .18s, transform .18s` on every `button`.

### 2.3 Status dot — `.status-dot`
Three states, colour-only, 3 sizes by context.

| State | Meaning | Where |
|---|---|---|
| *(default)* | green / healthy | statusbar, task column headings |
| `.working` | active | bot roster, chat header, bot cards |
| `.waiting` | needs the user | bot roster, chat header |
| `.idle` | resting | bot roster, chat header |

Also pausable: `.paused .live-tag .status-dot { animation-play-state: paused }`.

### 2.4 Bot state pill — `.bot-state`
On `.bot-card`. Icon + text; icon is chosen in JS by status
(`working → spark`, `waiting → clock`, `idle → check`). Tinted from `--bot-color` via
`color-mix(in srgb, var(--bot-color) 10%, transparent)`.

### 2.5 Cards — 6 shapes, no common ancestor
`.bot-card` · `.task-card` · `.inbox-card` · `.routine-card` · `.connection-card` · `.activity-item`

Each declares its own padding, radius, background and border. Shared traits: all use
`1px solid var(--border)`, all sit on a dark panel, all have a radius in the 9–12px band. Nothing
enforces that.

### 2.6 Switch — `.switch`
`role="switch"`, driven by `aria-checked`. Track `32×19px`, radius `12px`, `3px` padding; knob
`13×13px` circle. Off: track `#353a40`, knob `#949aa2`. On: track `#af8058`, knob `#ffe5d0`,
`transform: translateX(13px)` over `transition: transform .2s`.

Two states only. No disabled or indeterminate state. Used for routines and both settings toggles.

### 2.7 Pills and tags
- `.live-tag` — status chip; appears in the toolbar, page heading, chat header and settings
- `.skill-pill` — toolbox items and learned skills
- `.priority` — high-priority task badge
- `.activity-chip` — clickable chip in the activity feed
- `.nav-count` — count badge on nav items; has its own `.nav-item.active .nav-count` variant

### 2.8 Layout primitives
`.main-content` (page container) · `.page-heading` (eyebrow + h1 + sub + optional right slot) ·
`.section-note` (the hedging footnote, 13 uses) · `.panel-heading` / `.panel-subheading` ·
`.panel-divider` · `.stack` · `.eyebrow` · `.section-label`

---

## 3. Screens (7 views, one shell)

The shell is static in `index.html`; every view renders into `#main`, `#toolbar`, `#sidebar` and
`#activity`.

| View | `#main` | `#activity` |
|---|---|---|
| `den` | segmented control, bot grid/org/list, summary strip, team composer | Happening now |
| `chat` | chat header, message list, composer | Bot detail + simulated computer |
| `tasks` | 3-column board | Happening now |
| `inbox` | approval card stack | Happening now |
| `routines` | routine card stack | Happening now |
| `connections` | 2-column tool grid | Happening now |
| `settings` | settings rows | Happening now |

**The den has three sub-modes** driven by `denMode`, which is the largest single source of
variant styling in the file (13 `.den.is-org` rules):
- `grid` — 3-up bot cards, 88px avatars
- `org` — org chart, 64px avatars, `:before`/`:after` connector lines, `nth-child` positioning
- `list` — `.bot-row`, 51px avatars

---

## 4. Modals — one container, 13 bodies

`<dialog id="modal">` with `.modal-head` (title + close) and `.modal-body`. One size variant:
`.computer-expanded` widens from `min(510px, calc(100vw - 30px))` to `min(800px, 90vw)`.

Bodies: search · new bot · new task · new routine · review draft · send feedback · teach a skill ·
learned-skill detail · choose target · bot's computer · workspace · about · reset.
(`bot's computer` has two call sites — expand and take-control — sharing one body.)

Dismissal: close button, `Escape` (native `<dialog>`), or a click outside the dialog rect.
Backdrop is `backdrop-filter: blur(6px)` — the only blur in the file.

**Forms have no validation styling.** Fields use `required` and `maxlength`, so the browser's
native bubble is the entire error experience. There is no `:invalid`, no `aria-invalid`, no error
text slot, and no styling for a rejected submit.

---

## 5. Empty states — 4 exist, 1 is orphaned

| Where | Copy | Class |
|---|---|---|
| Task board column | `A clear little corner.` / `Ready for what’s next.` | `.empty-column` |
| Approvals panel | `You’re all caught up` / `The team has what it needs. Nice.` | `.approval-mini` (reused) |
| Bot's UP NEXT list | `A little breathing room. Send a new task.` | `.section-note` (reused) |
| Search results | `No matches yet. Try a teammate’s name or a task.` | `.section-note` (reused) |

Only one of the four has a dedicated class. The other three borrow a text style. `.empty-state` —
the one properly designed empty state, with an icon slot, an `h3` and a `p` — is fully styled and
**never rendered**.

## 6. Placeholder states

All 11 input placeholders are listed verbatim in `copy.md`. Styling is a single shared rule:
`input::placeholder, textarea::placeholder`. Every placeholder is an *example* (`e.g. Ember`) or a
prompt (`Try: status, help, or ls`) — none is a restatement of the label.

---

## 7. Styled but never rendered

Carry these into Figma only if you intend to build them properly:

| Class | Styled with | Status |
|---|---|---|
| `.empty-state` | 4 rules — icon 32px, `h3` 17px, `p` 13px, 50px padding | **orphaned** |
| `.model-chip` | `font-size: 9px; color: #7e848d` | **orphaned** — the model name is rendered inline in the chat header instead |
| `.activity-label` | `font-size: 10px; color: #798490; margin-bottom: 15px` | **orphaned** |

---

## 8. Motion inventory

| Animation | Applied to | Definition |
|---|---|---|
| `float` | `.bot-card .avatar` | 5s ease-in-out infinite, per-bot delay `-0s…-3.5s` |
| `breath` | typing dots, pulse icon | 1s and 2s infinite |
| `equalize` | `.bar-chart i` (last 4 bars) | 1.8s ease-in-out infinite |
| `spin` | `.bot-card .working svg` — the spark icon on a working bot | 5s linear infinite |
| `fall` | `.confetti` | 2.5s linear forwards |

Three independent motion kill-switches: `prefers-reduced-motion`, the user's `.no-motion` setting,
and `.paused` (which pauses rather than removes). Any Figma prototype should mirror at least the
first.

**Confetti** fires on approval, on adding a bot, and on completing a task — 30 elements, 4 colours
cycled, random `left` and up to 0.4s random delay.
