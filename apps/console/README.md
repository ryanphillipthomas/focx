# Focx Console · stage 1

One local Developer detail screen. Run `npm run console`, then open
`http://127.0.0.1:4174`. Set `PORT` to change the port. Run `npm run test:console`
for offline server tests. No dependencies, build, remote fonts or deployment.

The server binds only 127.0.0.1 and accepts that host and same-origin requests.
Identity is read on page load from an already-running Paperclip API at
127.0.0.1:3100. The company id comes from `.focx/agents.json`; the company name
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

- Dark text on light surfaces: no semantic text token exists; use
  `--surface-inverse`, matching Connect's existing treatment.
- General spacing scale: only `--space-3` exists; use it for all panel padding,
  margins and gaps. Control padding and height use their dedicated tokens.
- Content width and responsive structure: no layout-width token; use a fluid
  single column with a relative `60rem` maximum and wrapping text/table cells.
- Neutral status and disabled-state colours: no such tokens; use a bordered
  text chip with the actual status, native disabled semantics and cursor changes.
- Elevation and motion: no tokens; use a border, no shadows or animation.
- Code font and body line-height: no published values; inherit the body family
  and normal browser line-height. Geist uses the existing system fallback when
  unavailable locally; no font files are downloaded.
- Composite typography values are descriptive strings, not CSS font shorthand.
  The endpoint still emits all 36 leaves verbatim. For the four style names with
  slashes, it prefixes `--` and CSS-escapes the name. The screen uses the published
  primitive family/size/weight tokens instead of parsing those descriptions.

Authored CSS contains no colour literals, pixel literals or drift exceptions.
Tokens are read afresh for every `/api/tokens.css` request; their values are not
copied into this app. The drift gate remains an independent required check.
