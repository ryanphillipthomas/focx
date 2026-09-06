# Focx Bot desktop mockup — extraction

Source and analysis of the interactive mockup at `https://focx-bot-desktop.rpt4k.chatgpt.site/`,
captured **2026-09-06**.

## Scope note

This directory is a **record of an external mockup**, captured as input for tokenisation. It is
deliberately *not* a design-value source. Per [`AGENTS.md`](../../AGENTS.md), `design/tokens/`
remains the only home for published design values, and values only enter it via the Design role's
Figma sync. Nothing here should be imported by application code, and nothing here should be treated
as authoritative for the drift gate. If a value in `design-values.md` is wanted, it goes to Figma
first and reaches the repo through the normal sync.

## Contents

| File | What it is |
|---|---|
| `source/` | The mockup exactly as served — `index.html`, `styles.css`, `app.js`, `assets/` |
| `copy.md` | Verbatim text of every screen and modal, including empty and placeholder states |
| `components.md` | What repeats, what varies, and the real state coverage of every element |
| `design-values.md` | Every colour, type, spacing, radius, shadow, motion and breakpoint value in use, plus the scale-vs-one-off analysis |

## How this was captured

The site sits behind a ChatGPT sign-in (`HTTP 401` to an unauthenticated client), so the files were
read from an authenticated browser session rather than fetched with `curl`. `styles.css` was then
parsed programmatically — 1,397 declarations across 354 selectors — and every figure in
`design-values.md` is counted from that parse rather than read off a screenshot.

Integrity of the captured sources:

```
ed34f78f253b62d2060e4f6eae1a027c39c02e5aa5dfc65d423ccabd6b7c7b29  source/index.html
c423b16d52ef60d81dfeab370978f5c6d57caec59055a97881b661ab464110aa  source/styles.css
f8b5582133be9c65f6cff34c336daa890e82384ee9895668ead8e8c48dbb4070  source/app.js
d10d3c386df5a0d8dc1642d7622b0f24770068e62d2295a0da79c4eeada9f43d  source/assets/fox-avatar-atlas.png
```

`index.html` is the served markup with one edit: the Cloudflare bot-challenge `<script>` block that
the CDN injects at the end of `<body>` has been removed, since it is infrastructure rather than part
of the mockup. Nothing else was altered. `styles.css` and `app.js` are byte-for-byte as served.

## What the mockup is

A single-page, client-only desktop-shell mockup of an AI teammate workspace: 6 fox "bots", 7 views,
13 modals, no backend. All state lives in memory and resets on reload. Rendering is string-template
`innerHTML` from `app.js`; there is no framework and no build step.

## The short version for tokenisation

Read `design-values.md` §10 first. The summary:

- **Ready to tokenise as-is:** the 6 bot accent colours, the 4 breakpoints, the font weights, the
  two font families, `--orange`, `--border`, the 7px button radius, and the 1px border width.
- **Needs re-deciding, not mapping:** spacing (33 values on a 1px grid, no base unit), font sizes
  (18 values, no modular ratio), and the neutral greys (148 opaque colours that collapse to ~58
  perceptually distinct ones).
- **Fix rather than carry across:** 3 declared-but-unused custom properties, 1 unused font weight,
  3 orphaned components, and the absence of any error, loading, disabled or pressed state.
