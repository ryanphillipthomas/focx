# Connect

Focx’s first skill surface at `focx.ai/skills/connect`.

## This slice

Thinnest **draft-only** vertical slice ported from [focx-legacy](https://github.com/ryanphillipthomas/focx-legacy) Connect:

1. **Relationship memory** — local browser vault (`lib/vault.js`), vault/privacy mindset from `@focx/connect-storage`
2. **Draft in your voice** — deterministic local drafter (`lib/draft.js`), fake-provider mindset from `@focx/connect-model`
3. **Never sends** — no send button, no live send API; copy-only

Static HTML/CSS/JS so `tools/site-compose` still publishes `apps/connect` → `dist/skills/connect/`.

## Verify

```bash
node apps/connect/verify.mjs
node tools/site-compose/index.mjs
node tools/drift-check/index.mjs
```

## Left behind (on purpose)

Full Node vault, Claude provider, CLI, Shortcuts, React shell, auth, reminders, Pipeline, Paperclip, Focx Bot.
