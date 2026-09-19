# Connect extract + site cutover

Connect lives in its own product repo:

**https://github.com/ryanphillipthomas/focx-connect** (default branch `main`)

## Site compose

`tools/site-compose/site-map.json` mounts `skills/connect` from that repo at build time (GitHub tarball of `main`). There is no in-tree `apps/connect` anymore.

```bash
node tools/site-compose/index.mjs
# → dist/skills/connect/ from ryanphillipthomas/focx-connect@main
```

## Design packages

`packages/design-connect` shipped with focx-connect. Parent `@focx/design-focx` remains in this umbrella when needed by other apps.
