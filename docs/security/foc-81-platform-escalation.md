# FOC-81 — Platform escalation packet

**Status:** evidence gathered, asks ready to transmit. Target for an answer: **2026-09-11**.
**Scope:** the half of the FOC-68 remediation no Focx engineer can implement.
**Evidence gathered:** 2026-09-04, on the live host, from inside a normal CTO run.

Every claim below was verified on this host rather than assumed. Reproduction commands are
included so Paperclip and Infrastructure can re-run them.

---

## Summary — what changed versus the original framing

Investigation moved three of the four asks. The escalation is now **smaller and cheaper than
FOC-81 originally assumed**, and one ask is answered outright.

| Original ask | Finding | New ask |
|---|---|---|
| Paperclip: build a broker or run-scoped capability | **The broker already exists and works.** `POST /api/agents/me/secrets/{key}/value` returns real values. Secrets carry `delivery: env\|api\|both`. | Expose `delivery` on the **write** path. It is currently read-only. |
| Paperclip: run credential should be run-scoped | The credential **already carries `run_id`**. Its lifetime is **48 h** against a 1 h run cap. | Bound the token's `exp` to the run, not to 48 h. |
| Paperclip: control the generated allowlist | Confirmed unreachable from this repo. Plus a **new, more severe finding**: `Bash(env:*)`. | Drop `Bash(env:*)`; make the preset→allowlist mapping configurable. |
| Infra: Linux migration *or* find a macOS sandbox | **Answered.** A macOS-native deny-by-default egress boundary works on this host today. | No migration required. Paperclip must apply the profile at spawn. |

---

## 1. Host and confinement — the roster is correct

```
$ uname -a   → Darwin Macmini 27.0.0 … RELEASE_ARM64_T8103 arm64
$ sw_vers    → macOS 27.0 (26A5425a)
$ command -v bwrap → NOT FOUND
```

`pipeline/org/roster.json` → `confinement.availableOnThisHost: false` is accurate. Bubblewrap is
genuinely absent, and the roster comment correctly records why setting `networkScope` /
`filesystemScope` would fail every run.

**New finding:** `networkScope`, `networkAllowlist`, and `filesystemSandboxCommand` appear
**zero times** in Paperclip's OpenAPI spec (`GET /api/openapi.json`, 821 KB). Confinement is not an
API-level concept at all — it is adapter-local configuration. This closes off any possibility of
the org configuring confinement itself through the control plane. It is a platform change by
construction, not by omission.

## 2. `PAPERCLIP_API_KEY` — runtime-injected, and outlives its run by 47 hours

Present in the agent process. It is an **HS256 JWT**, 523 chars, with these claims:

```
claims: adapter_type, aud, company_id, exp, iat, instance_id,
        responsible_user_id, run_id, sub
aud:      "paperclip-api"
run_id:   1fb157e8-…            ← already run-scoped in its claims
iat → exp: 172800s = 48.0h
```

It is **not** in `adapterConfig.env` (verified via `GET /api/agents/me`), which confirms FOC-81's
core claim: it is injected by the runtime, and no change to `roster.json` can remove it.

The important new detail is the **lifetime**. The agent's own `adapterConfig.timeoutSec` is `3600`
— a one-hour run cap. The credential handed to that run is valid for **48 hours**. A token that
leaks at any point in a run stays valid for roughly two days after the run that needed it has
exited. The token is *nominally* run-scoped and *practically* not.

This materially narrows the ask. Focx does not need Paperclip to design a new capability model —
the `run_id` claim is already there. It needs `exp` bounded to the run's lifetime (plus a grace
window), so that the blast radius of a leak is the run rather than two days.

## 3. The permission allowlist — confirmed unreachable, and worse than documented

`.claude/settings.local.json` is untracked and ignored by a **global** gitignore, not a repo one:

```
$ git check-ignore -v .claude/settings.local.json
/Users/ryanthomas/.config/git/ignore:1: **/.claude/settings.local.json
```

The ignore rule lives in the operator's `~/.config/git/ignore`. Nothing in this repository can
influence it, and the file is rewritten per worktree at creation time. Editing it inside a run is
not durable — the next worktree gets a fresh copy. FOC-81's claim holds exactly as written.

Current generated contents:

```json
"allow": [
  "Bash(<worktree>/scripts/paperclip-issue-update.sh:*)",
  "Bash(<worktree>/scripts/paperclip:*)",
  "Bash(curl:*)",
  "Bash(env)",
  "Bash(env:*)"
]
```

**New finding — `Bash(env:*)` is not an environment-read permission.** FOC-68 and FOC-81 both
describe the exposure as `Bash(env)`, i.e. "the agent may read its own environment". The generated
allowlist also contains `Bash(env:*)`, which is a different and larger grant, because `env` is a
**prefix command**: `env FOO=1 <any-command>` is a well-formed `env` invocation that runs an
arbitrary program.

If the matcher approves on the `env` prefix alone, then `Bash(env:*)` is not one entry in the
allowlist — it is a general bypass of the allowlist, and every `deny` or unlisted command is
reachable through it. That would make the remaining Bash restrictions decorative.

We cannot settle this from outside: the matcher is Paperclip's (and Claude Code's), not ours. It is
stated here as the **highest-priority question in this packet**, because the answer changes the
severity of FOC-68 and of the FOC-71 risk acceptance. Paperclip should confirm whether
`Bash(env:*)` short-circuits on the prefix or re-checks the wrapped command.

Regardless of that answer, `Bash(env:*)` has no legitimate use in these runs and should not be
generated.

## 4. The broker Paperclip is being asked to build already exists

This is the central finding. `GET /api/agents/me/secrets` reports a `delivery` field per secret:

```json
{"key":"claude_subscription_token","delivery":"env","projectionClass":"unclassified", …}
{"key":"github_focx_write_token",  "delivery":"env","projectionClass":"unclassified", …}
```

`delivery` is an enum of `["env", "api", "both"]`, and the API-delivery endpoint is live:

```
POST /api/agents/me/secrets/{key}/value   → 200 {key, value, version}
```

Verified end-to-end from this run: fetching `github_focx_write_token` through the broker returned a
93-character value **identical to the `GH_TOKEN` already in the environment**. The mechanism is not
a stub. It works today.

**The gap is purely on the write path.** `delivery` and `projectionClass` appear only in *response*
schemas. Neither `POST /api/companies/{companyId}/secrets` nor `PATCH /api/secrets/{id}` accepts
either field:

```
PATCH /api/secrets/{id} accepts: name, key, status, providerConfigId,
                                 description, externalRef, providerMetadata
```

So a customer can read that a secret is delivered via `env`, can fetch it via `api` instead, but
**has no supported way to turn `env` delivery off**. The same is true of `projectionClass`, whose
enum contains an unused second mode, `class_3_static_lease`, that we cannot select.

This collapses the Paperclip ask from *"build us a broker or a run-scoped capability"* to
*"expose the `delivery` field you already have on the write path."* That is a substantially cheaper
request, and it is the single highest-leverage change in this packet.

### Caveat — `delivery: api` is necessary but not sufficient

The broker authenticates with `PAPERCLIP_API_KEY`, which is itself in the process environment.
Flipping every secret to `delivery: api` therefore converts *N credentials in the environment* into
*one bearer token in the environment that unlocks all N*. Against an attacker who can read the
environment, that is not obviously an improvement.

`delivery: api` only pays off when combined with the other two asks — a run-bounded `exp` (§2) so a
captured token dies with the run, and an egress boundary (§5) so a captured token cannot be sent
anywhere. The three asks are a set; shipping only the broker toggle would produce a false sense of
containment. This should be stated plainly to Paperclip.

## 5. Infrastructure — answered: macOS *can* enforce deny-by-default egress

FOC-81 asks Infrastructure to choose between migrating to a Linux container host and finding a
macOS-native sandbox. **The second option works on this host today, so the migration is not
required.**

`/usr/bin/sandbox-exec` is present. Measured results:

```
control  — curl https://example.com, unsandboxed                    → HTTP 200
sandbox  — (allow default) (deny network*)  + curl https://example.com → rc=6, blocked
sandbox  — same profile, /bin/echo                                  → rc=0, local exec unaffected
```

Deny-by-default egress holds. And the practical allowlist shape works too — SBPL filters on
`ip:port`, not DNS names, so the workable design is *deny all network, permit only a loopback
broker*, with the broker enforcing the domain allowlist:

```scheme
(version 1)
(allow default)
(deny network*)
(allow network-outbound (remote ip "localhost:18099"))
```

```
sandbox — curl http://127.0.0.1:18099/       → HTTP 200   (broker reachable)
sandbox — curl https://example.com           → rc=6       (blocked)
sandbox — curl https://ops.focx.ai/api/…     → rc=6       (blocked)
```

That last line is the one that matters: **with this profile applied, an agent holding a valid
`PAPERCLIP_API_KEY` cannot reach the Paperclip API, or anywhere else, except through a loopback
broker we control.** The confinement FOC-81 describes as non-existent on this host is achievable.

Three honest caveats:

1. **`sandbox-exec` is deprecated** by Apple — long-deprecated, still shipping and still
   functional in macOS 27.0. It is unsupported API, so it carries a real risk of removal in a
   future macOS. It is a sound 12-month answer, not a permanent one.
2. **It must be applied by the spawner.** A sandbox the agent may choose to enter is not a
   boundary. This needs a macOS analogue of the adapter's Linux-only `filesystemSandboxCommand` —
   i.e. Paperclip wrapping the agent process in `sandbox-exec -f <profile>` at spawn. **So this
   remains a Paperclip ask, not an Infrastructure one.**
3. **Loopback broker required.** Because SBPL cannot express DNS-name allowlists, `ops.focx.ai`
   and `github.com` access must be proxied through a local process that enforces the allowlist.

**Recommendation to Infrastructure:** do not migrate to a Linux container host on the strength of
this requirement. The egress boundary is available natively. Reconsider migration only if Paperclip
declines to add a spawn-level sandbox hook for macOS, or if `sandbox-exec` is withdrawn.

---

## The asks, restated

**To Paperclip** — in priority order:

1. **Confirm the `Bash(env:*)` matcher semantics** (§3). Does it short-circuit on the `env` prefix?
   If yes, this is an allowlist bypass and is the most urgent item here. Either way, stop
   generating `Bash(env:*)`, and drop `Bash(env)` and `Bash(curl:*)` from the default preset.
2. **Expose `delivery` on the secret write path** (§4) — `POST /api/companies/{companyId}/secrets`
   and `PATCH /api/secrets/{id}`. The read path and the broker already exist; only the toggle is
   missing. Also document `projectionClass: class_3_static_lease`, which is unreachable today.
3. **Bound `PAPERCLIP_API_KEY`'s `exp` to the run** (§2), rather than 48 h against a 1 h run cap.
   The `run_id` claim is already present; only the lifetime needs to change.
4. **Add a spawn-level sandbox hook for macOS** (§5) — the `sandbox-exec` analogue of the Linux-only
   `filesystemSandboxCommand`. Profile and measurements above; the work is integration, not design.
5. Note the coupling: items 2–4 are a set. Item 2 alone does not reduce exposure (§4 caveat).

**To Infrastructure:**

- **No Linux migration required** for FOC-79 requirement 2. Adopt the `sandbox-exec` profile above,
  contingent on Paperclip ask 4. Track `sandbox-exec` deprecation as a standing risk.

## Consequence if unanswered — unchanged, but better bounded

FOC-79 cannot fully close without Paperclip asks 1–4. The interim containment described on FOC-71
still stands and is still time-boxed to **2026-10-09**. Nothing found here removes the need to
re-decide at that date rather than silently extend.

Two findings sharpen it: the credential outlives its run by 47 hours (§2), and `Bash(env:*)` may be
a general allowlist bypass rather than a single grant (§3). If Paperclip confirms the latter, the
FOC-71 risk acceptance was made against an understated exposure and should be revisited
immediately rather than at the time-box.

## Implication for FOC-68 (delegatable half)

The broker verification in §4 has a direct consequence for the two credentials that *are* ours to
remove. `GH_TOKEN` is consumed by a git credential helper defined in `roster.json`
(`env.gitWrite.GIT_CONFIG_VALUE_0`), which does `echo "password=$GH_TOKEN"` — it reads the
environment variable. Since the broker returns a working, identical token, that helper could
instead fetch the value from `POST /api/agents/me/secrets/github_focx_write_token/value` at git
time, allowing `GH_TOKEN` to leave the environment **without waiting on Paperclip**.

That is viable *only* once `delivery` is settable (ask 2) — otherwise env delivery cannot be turned
off and the variable stays present regardless. Recorded here so FOC-68 does not re-derive it.

---

## Reproducing

All checks are read-only except the sandbox tests, which spawn a local listener on `127.0.0.1:18099`.
No secret value is printed by any command; presence and length only.

```bash
# host + confinement
uname -a; sw_vers; command -v bwrap; command -v sandbox-exec

# credential shape (claims only, never the token)
python3 -c 'import os,json,base64;t=os.environ["PAPERCLIP_API_KEY"].split(".")[1];
t+="="*(-len(t)%4);p=json.loads(base64.urlsafe_b64decode(t));
print(sorted(p),p["exp"]-p["iat"],"seconds")'

# allowlist
git check-ignore -v .claude/settings.local.json; cat .claude/settings.local.json

# broker + delivery mode
curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_URL/api/agents/me/secrets"

# egress boundary
printf '(version 1)\n(allow default)\n(deny network*)\n' > /tmp/deny-net.sb
sandbox-exec -f /tmp/deny-net.sb /usr/bin/curl -s --max-time 8 https://example.com; echo "rc=$?"
```
