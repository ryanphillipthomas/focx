# Focx credential broker v1

This package builds the macOS credential broker used by Focx agents. The active
broker is a compiled, root-owned LaunchDaemon under
`/Library/Application Support/Focx/CredentialBroker`; the repository copy is
source and is never the runtime trust boundary.

The installed binary exposes two fixed clients:

- `/usr/local/bin/paperclip METHOD /api/...` sends a JSON request over the
  broker's Unix socket. It accepts no URL, header, redirect, proxy, or config
  override. The broker derives the current task/run/company and short-lived API
  credential from the immutable ancestor run context, attaches authentication,
  and permits only current-task routes plus scoped child creation/approval.
- `/usr/local/bin/git-credential-focx` is called only by Git's trusted HTTPS
  transport. The broker checks the peer process tree, exact `github.com` host,
  HTTPS protocol, and exact `ryanphillipthomas/focx` path before reading the
  GitHub token from the macOS system Keychain.

Requests are capped at 64 KiB and responses at 2 MiB. Paperclip upstream is an
exact `https://host:port`; redirects, cookies, caches, and proxies are disabled.
Only `GET`, `POST`, `PATCH`, and `PUT` exist in v1.

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

`store-github-token` reads from standard input and never accepts the credential
in argv. `doctor` returns only readiness metadata; it never returns a secret.

The org reconciler refuses a production `--apply` unless `doctor` confirms the
daemon, configured origin, version, and Keychain credential. That makes the
required sequence mechanical:

1. Build, independently review, and install the broker outside agent-writable paths.
2. Seed Keychain and confirm `paperclip doctor`.
3. Exercise current-task Paperclip and repository-scoped Git canaries.
4. Apply `pipeline/org/roster.json`, removing `GH_TOKEN` from every agent process.
5. Have the Paperclip platform owner remove raw `env` and `curl` grants in every
   Claude and Codex lane. The harness generates those grants; this repository
   cannot revoke them.

`CLAUDE_CODE_OAUTH_TOKEN` remains an adapter credential until Paperclip provides
an authenticated launch/projection mechanism that keeps it out of agent session
logs and tool children. `PAPERCLIP_API_KEY` likewise remains runtime-injected.
Those platform dependencies are not papered over here.
