# Focx credential broker v2

This package builds the macOS credential broker used by Focx agents. The active
broker is a compiled, root-owned LaunchDaemon under
`/Library/Application Support/Focx/CredentialBroker`; the repository copy is
source and is never the runtime trust boundary.

The installed binary exposes two fixed clients:

- `/usr/local/bin/paperclip METHOD /api/...` sends a JSON request over the
  broker's Unix socket. It accepts no URL, header, redirect, proxy, or config
  override. A privileged process spawner registers the run PID, task/company
  context, Git write bit, and at-most-70-minute Paperclip JWT directly with the
  daemon. The agent environment contains none of that data. The broker binds the
  in-memory grant to the registered PID's kernel start time, attaches auth, and
  permits only current-task routes plus scoped child creation/approval.
- `/usr/local/bin/git-credential-focx` is called only by Git's trusted HTTPS
  transport. The broker checks the peer process tree, exact `github.com` host,
  HTTPS protocol, and exact `ryanphillipthomas/focx` path before reading the
  GitHub token from the macOS system Keychain.

Run grants expire with the JWT and can be explicitly revoked at run teardown.
Registration and revocation require a root peer on the Unix socket; an agent-UID
peer cannot create or widen its own grant. Requests are capped at 64 KiB and
responses at 2 MiB. Paperclip upstream is an
exact `https://host:port`; redirects, cookies, caches, and proxies are disabled.
Only `GET`, `POST`, `PATCH`, and `PUT` exist in v2.

## Build and test

```sh
sh packages/credential-broker/build.sh
node --test packages/credential-broker/test.mjs
```

The test compiles the same Objective-C source used by the installer and runs its
canary-only policy suite. It never reads a real credential or contacts a network.

## Controlled host installation

Installation is deliberately impossible from an agent-owned worktree. A trusted
operator stages the reviewed commit in a root-owned directory with no
group/other write bit, then runs:

```sh
sudo packages/credential-broker/install.sh --agent-user ryanthomas \
  --origin https://ops.focx.ai:443
sudo '/Library/Application Support/Focx/CredentialBroker/focx-credential-broker' \
  store-github-token
/usr/local/bin/paperclip doctor
```

`store-github-token` and `register-run` read credentials from standard input and
never accept them in argv. `doctor` returns only readiness metadata; it never
returns a secret.

## Required process-spawner integration

Broker installation alone is not containment. Before releasing an agent process,
the root-owned spawner must register its PID and run context through
`focx-credential-broker register-run --pid PID`, pass `githubWrite` according to
the roster, and omit every credential from the agent environment. At teardown it
must call `revoke-run RUN_ID`. The registration JSON is accepted only on stdin.

The spawner must also enforce deny-by-default egress with the broker socket as
the only allowed destination, scrub secret variables from every tool child, and
write the root-owned attestation described by `roster.durableContainment`.
`paperclip-org --apply` and `--verify-only` refuse to run without that attestation.
The broker installer intentionally cannot create it because installing a daemon
does not prove how agent and tool-child processes are spawned.

The spawner-owned attestation has this semantic shape (the reconciler
rejects weaker values and extra outbound sockets):

```json
{
  "version": 1,
  "brokerVersion": 2,
  "platform": "macos-sandbox-exec",
  "egress": {
    "enforcedAtSpawn": true,
    "defaultPolicy": "deny",
    "allowUnixSockets": ["/var/run/focx-credential-broker.sock"]
  },
  "credentials": {
    "paperclip": "privileged-broker-registration",
    "github": "broker-keychain"
  },
  "toolChildEnvironment": { "secretVariables": "scrubbed" },
  "generatedSettings": {
    "rawEnvironmentGrants": false,
    "genericNetworkGrants": false
  }
}
```

`platform` may instead be `linux-bubblewrap` if the CTO selects Linux.

The org reconciler refuses a production `--apply` unless `doctor` confirms the
daemon, configured origin, version, and Keychain credential. That makes the
required sequence mechanical:

1. Build, independently review, and install the broker outside agent-writable paths.
2. Seed Keychain and confirm `paperclip doctor`.
3. Integrate privileged run registration, teardown revocation, tool-child
   scrubbing, and the CTO-selected spawn-level egress boundary.
4. Produce the root-owned containment attestation and exercise current-task
   Paperclip and repository-scoped Git canaries.
5. Apply `pipeline/org/roster.json`, removing `GH_TOKEN` from every agent process.
6. Have the Paperclip platform owner remove raw `env` and generic network grants
   in every Claude and Codex lane. The harness generates those settings; this
   repository cannot change them.

`CLAUDE_CODE_OAUTH_TOKEN` remains an adapter credential until Paperclip provides
an authenticated launch/projection mechanism that keeps it out of agent session
logs. The durable contract requires the spawner to scrub it from tool children.
`PAPERCLIP_API_KEY` must no longer be runtime-injected into the agent; it is
registered directly with this daemon. Those platform dependencies are enforced
by the attestation gate rather than papered over here.
