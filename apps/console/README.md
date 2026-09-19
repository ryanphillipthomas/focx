# Focx Console · stage 2

Tickets are read from `/api/companies/:id/issues` and trimmed server-side to the
six fields the table renders — the control plane returns roughly sixty fields per
issue and 264KB for this company, against 16KB after trimming. Assignees arrive as
agent ids and are resolved to names from the same agents call; an id the call does
not know stays blank rather than showing a raw uuid.

One card per pilot role the contract declares. A role added to `.focx/agents.json` appears here with no console change; a role declared but absent from the company is shown as unresolved rather than hidden. Run `npm run console`, then open
`http://127.0.0.1:4174`. Set `PORT` to change the port. Run `npm run test:console`
for offline server tests. No dependencies, build, remote fonts or deployment.

The server binds only 127.0.0.1 and accepts that host and same-origin requests.
Identities are read on page load from an already-running Paperclip API at
127.0.0.1:3100, one per declared pilot role. The company id comes from `.focx/agents.json`; the company name
and issue prefix come from the API. The board token is read from the Mac Keychain
service `paperclip-board-token`, account `$USER`, and used only in the server's
Authorization header. Missing credentials/API/identity produce an unavailable
state. The console never starts Paperclip or changes the existing Developer.

Plan, review, check the confirmation box, apply, inspect the result. Stage 1
always invokes `fresh --fake`, with validated company names and no extra input
arguments. A plan is held only in this server process and consumed by one apply
attempt; a subsequent plan or invalid operation attempt invalidates it. Concurrent
subprocess requests are refused. Commands have a 30-second timeout and bounded
output. Errors omit subprocess and upstream exception text; credentials are never
passed into the focx-bot child environment. No operation is retried automatically.

The balanced-object stdout parser preserves the first preview without combining
lists or recomputing a digest. Its four operations omit a state write covered by
the five-operation digest; the UI explicitly states that gap. The digest is a
deterministic review artifact, not a credential or signature.

“Verified” means the fake fresh command exited successfully after its own import,
invariant and readback checks. The complete result is shown verbatim. Today's
contract returns `complete: false`, phase `awaiting-secret-entry`; this is not
completed provisioning. Fake API, host files and state are in memory and disappear
with the subprocess. No separate verify process could inspect that expired state.
Although this is one Developer screen, the mandated fresh verb provisions the
whole contract, including QA, inside the fake runtime. No QA delivery lane runs.
Teach a skill is a visible placeholder that must be returned to.

## Token gaps and treatment

The console now consumes the dark `focx-bot` namespace. The endpoint publishes
both namespaces in one `:root` block, focx first: 36 + 133 = 169 properties,
with disk values verbatim. Names come from the full token path, lowercased with
runs of non-alphanumeric characters replaced by one hyphen and edge hyphens
trimmed (for example, `--focx-bot-style-display-page-title`). Metadata keys
beginning `_` are skipped. Colliding normalized names refuse generation.

- Closed: semantic text colours on dark app/panel/surface backgrounds replace
  the dark-on-light `surface-inverse` workaround. Secondary and muted text,
  disabled text, border strengths and a separate focus offset are published.
- Closed: the spacing scale supplies panel padding, section separation, gaps
  and control padding. Radii and card elevation are used on existing elements.
- Closed: body line-height now uses `type.line-base`; typography uses published
  family, size and weight tokens. DM Sans uses the system fallback when absent
  locally; no font files are downloaded.
- Motion durations are available, deliberately unused at this stage. There were
  no existing transitions; none or other animations have been added. An easing
  token remains an open design decision in the source metadata.
- Content width remains un-tokenized: the existing fluid single column, `60rem`
  maximum and text/table wrapping remain. Breakpoints are available but unused.
- No dedicated focx-bot control-height token exists; retain the published
  `--focx-control-h-md`. No code-font token exists; code continues to inherit
  the body family.
- Status colours now exist for working/waiting/idle, but no generic neutral
  status semantic exists. The actual status remains a bordered, muted text chip;
  no new status mapping is inferred.
- Composite typography values remain descriptive strings, not CSS font shorthand.
  They are emitted verbatim; the screen consumes individual type tokens.

Calculated contrast from the published colours: primary text on app/panel is
15.59:1 / 15.08:1; muted text on surface is 5.07:1; action text on its fill is
8.43:1. Disabled text on the sunken button background is 3.47:1, below the 4.5:1
normal-text AA threshold (inactive controls are exempt). The strong input border,
alpha-composited over app, is only 1.21:1, below the 3:1 non-text threshold when
needed to identify a control. Subtle/default separators also have low contrast.
These are source-token findings, not a claim of full accessibility conformance.

Authored CSS contains no colour literals, pixel literals or drift exceptions.
Structural values such as `0`, `100%`, `auto` and `60rem` remain unchanged.
Tokens are read afresh for every `/api/tokens.css` request; their values are not
copied into this app. The drift gate remains an independent required check.

## Always running

`npm run console:install` registers a per-user launchd agent (`ai.focx.console`)
that starts the console at login and restarts it if it exits, so the bookmark is
simply there. `console:status` reports it; `console:uninstall` removes it. The
plist is generated from this checkout at install time rather than committed,
because a plist naming one machine's paths is not shared configuration.

Installing it changes nothing about reachability by itself: the server still
binds 127.0.0.1 and still refuses any request whose Host is not loopback. It
survives a closed terminal. Reachability is a separate decision, below.

## Reachable at console.focx.ai

The console is published at `https://console.focx.ai` without being hosted: the
same Cloudflare Tunnel that already serves `ops.focx.ai` carries a second route
to `127.0.0.1:4174` on this Mac. Nothing is deployed, and `render.yaml` is not
involved. If this machine is off, the hostname is down.

Three settings make that work, and each is load-bearing:

- **Cloudflare Access** guards the hostname — policy `Allow → emails ending in
  jaqlinmedlock.com`. The console has no authentication of its own, so Access is
  the whole of it. Never publish a route to this server without it. Access is
  created before the route, so a half-finished setup is closed, not open.
- **HTTP Host Header `127.0.0.1:4174`** on the tunnel route. The server refuses
  any other Host as a DNS-rebinding defence. Rewriting at the proxy keeps that
  assertion truthful; widening the check in code would weaken it for every
  caller, permanently, and must not be the fix.
- **Path left empty.** A path would scope the route to a subset of URLs, and the
  asset paths here are root-absolute.

Reads work through this route. `plan` and `apply` do not: a browser sends an
`Origin` of `https://console.focx.ai`, which the server refuses and cannot be
forged by the proxy. That is deliberate — provisioning requires being at the
machine — and the refusal names the local URL so the cause is obvious.

`ops.focx.ai` is untouched by any of this, and Paperclip keeps its own login.
