# Feature and verification map

User-point-of-view map for reproduction. Discover current code paths at runtime. Keep selectors stable (roles, labels, ids) — never generated CSS classes.

Environment is **configured**: local compose → `dist/` (never production focx.ai). App-control adapter is **Playwright MCP**. Use Playwright for UI baseline/patched checks per the surfaces below; fall back to documented CLI/non-UI checks when Playwright cannot exercise the path.

## Build / serve (focx-site) — configured

```bash
node tools/site-compose/index.mjs
# → dist/  (landing at / , Connect at /skills/connect/)
```

Serve `dist/` with a **local** static server for UI checks. Never use production `focx.ai`. Do not write production data or deploy.

Connect product source for mount bugs: `https://github.com/ryanphillipthomas/focx-connect` (draft-PR write scope only; merge out of scope).

---

### Landing — Focx hero

Marketing landing for focx.ai.

#### How a user gets there

- Open `/` on the composed site.

#### How the control adapter drives it

- Navigate to `/`. Confirm wordmark `Focx`, CTA `Explore Connect`.
- Reset: reload `/`.

#### Stable selectors

- `main.hero`, heading text `Focx`, link `Explore Connect` → `/skills/connect/`

#### States to exercise

- Default desktop and narrow viewport.

#### Preconditions and setup

- Composed `dist/` available. No auth.

#### Evidence and cross-check

- Screenshot of hero with CTA visible.
- Confirm CTA href is `/skills/connect/`.

#### Gotchas

- Source files are under `apps/site/`; production HTML is composed into `dist/`.

#### Non-UI equivalent

- Diff / read `apps/site/index.html` and composed `dist/index.html` after `site-compose`.

---

### Connect — Relationship memory

Local vault for per-person notes used by drafting.

#### How a user gets there

- `/` → `Explore Connect` → `/skills/connect/` → section **Relationship memory**.

#### How the control adapter drives it

- Fill Person / Notes / Do / Avoid; click `Save to local vault`; confirm status text.
- Reset: clear site storage for the origin, reload.

#### Stable selectors

- `#person-name`, `#person-notes`, `#person-do`, `#person-avoid`, `#save-person`, `#person-status`

#### States to exercise

- Empty form, saved success, reload persistence.

#### Preconditions and setup

- Browser local storage writable. Draft-only product — no network send.

#### Evidence and cross-check

- Screenshot of status after save; reload shows person in `#person-select`.

#### Gotchas

- Mounted from `focx-connect`; edits may belong in that repo if write scope allows.

#### Non-UI equivalent

- Unit / script checks against `lib/vault.js` when present in checkout or sibling clone.

---

### Connect — Your voice

Local voice profile for draft phrasing.

#### How a user gets there

- `/skills/connect/` → section **Your voice**.

#### How the control adapter drives it

- Fill phrases / avoid / warmth; click `Save voice`; confirm `#voice-status`.
- Reset: clear storage, reload.

#### Stable selectors

- `#voice-phrases`, `#voice-avoid`, `#voice-warmth`, `#save-voice`, `#voice-status`

#### States to exercise

- Empty, saved, reload.

#### Non-UI equivalent

- Inspect `lib/vault.js` / voice persistence helpers.

---

### Connect — Draft a reply

Deterministic local draft; never sends.

#### How a user gets there

- `/skills/connect/` → **Draft a reply**.

#### How the control adapter drives it

- Ensure a saved person exists; choose `#person-select`; fill `#incoming-message`; click `Draft reply`; confirm `#draft-output` and that copy works via `Copy draft`.
- Reset: clear draft fields / reload; never expect a send control.

#### Stable selectors

- `#person-select`, `#incoming-message`, `#draft-button`, `#copy-draft`, `#draft-output`, `#draft-meta`, `[data-never-send-banner]`

#### States to exercise

- No person selected / empty incoming (error or guidance).
- Successful draft.
- Copy draft enabled only after output exists.
- Banner asserts drafts never send.

#### Evidence and cross-check

- Screenshot of draft output + never-send banner.
- Confirm no Messages/SMS/send API calls in network log when adapter supports it.

#### Non-UI equivalent

- Run `node verify.mjs` in `focx-connect` when that repo is available; exercise `lib/draft.js`.

#### Gotchas

- Reporter screenshots alone do not prove reproduction. Capture baseline vs patched with the same steps.
