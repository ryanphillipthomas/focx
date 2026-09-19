# Connect extract

Connect now has its own product repo:

**https://github.com/ryanphillipthomas/focx-connect** (default branch `main`)

## What moved

- `apps/connect` → repo root in `focx-connect`
- `packages/design-connect` → `packages/design-connect` in `focx-connect`
- History for those paths was preserved via `git filter-repo` from `focx` `develop`

## What stays here (for now)

- `apps/connect` remains in this monorepo so `tools/site-compose` can keep publishing `focx.ai/skills/connect` (`site-map.json` mount unchanged).
- `@focx/design-focx` remains the parent design system in this umbrella.
- Cutover (submodule, package publish, or compose from the external repo) is a follow-up — do not delete `apps/connect` until that lands.

## Verify in focx-connect

```bash
node verify.mjs
```
