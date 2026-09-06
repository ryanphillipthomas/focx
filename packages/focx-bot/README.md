# @focx/bot

Dependency-free Node 22+ provisioner for FB2 rev 2.5, with FB3 rev 2.2's skills fragment preserved verbatim. The two agents remain paused. Claude reviews this build; Ryan controls subsequent live authorization and merges.

## Offline checks

From the repository root:

```sh
node packages/focx-bot/src/index.mjs --validate-contract
node --test packages/focx-bot/test.mjs
node tools/pilot-org/index.mjs --check
node packages/focx-bot/src/index.mjs fresh --fake
```

The schema validator implements every keyword used by `contract.schema.json`. Tests exercise the same schema, native bundle renderer, operations, invariant functions and digest used by the CLI. The fake API is in-process; tests require neither sockets nor Paperclip credentials. `--fake` has ephemeral state and is useful for a fresh plan; the test fixture carries state across all stages.

## Verbs and approval

`verify` is the default and is always read-only. `--verify-only` also forces verification, even alongside `--apply`. Every other verb defaults to a plan. A write invocation needs **both** `--apply` and `--approved-digest <digest-from-the-current-plan>`. The digest binds rendered operations, explicit base URL, company ID and exact contract bytes. Independent permission, model, state and invariant checks still run. Every mutation is printed before execution. An HTTP failure is never retried.

| Verb | Behavior |
| --- | --- |
| `verify` | Reads configuration, effective access, secret references, models, host declarations, plugin metadata, runtime skill directories and injection-failure logs; exits nonzero on unmet checks. |
| `apply` | Reconciles an existing exact two-agent company without changing identity, adapter type, activation or skill registry membership. Keeps stricter live limits and permission policies. |
| `fresh` | Preflights instance-admin access, unique company name and adapter model catalogs, then imports one minimal native package with `pauseAutomations:true`. Performs the permissions stage and stops for hand-entered secrets. |
| `bind-secrets` | Resolves secret names using `secrets/catalog`, patches merged `adapterConfig.env`, verifies readback, then provisions pinned plugins through host management interfaces. Reports apps requiring Ryan's manual sign-in. |
| `snapshot` | Native export of company, agents, projects and skills, with issues excluded. Saves the bundle, native fidelity report, separately detected pruned `false` keys and rendered host declarations in one sidecar record. |
| `restore` | Requires an explicit unique new company name. Overlays invariants 7–8 into the exported bundle before the same three provisioning stages. Compares imported limits against the original export as well as the contract. |

Live examples below are documentation only; none was executed during FB4:

```sh
node packages/focx-bot/src/index.mjs fresh \
  --base-url http://127.0.0.1:3100 \
  --catalog-company-id EXISTING_CATALOG_COMPANY_ID \
  --new-company-name 'RYAN_APPROVED_UNIQUE_NAME'

# Repeat the exact command with --apply --approved-digest DIGEST after review.
# After Ryan enters the listed secrets through Paperclip:
node packages/focx-bot/src/index.mjs bind-secrets --base-url http://127.0.0.1:3100

node packages/focx-bot/src/index.mjs verify --base-url http://127.0.0.1:3100
node packages/focx-bot/src/index.mjs apply --base-url http://127.0.0.1:3100

node packages/focx-bot/src/index.mjs snapshot --base-url http://127.0.0.1:3100 \
  --snapshot-file ~/.paperclip/instances/default/focx-bot/snapshot.json

node packages/focx-bot/src/index.mjs restore --base-url http://127.0.0.1:3100 \
  --catalog-company-id EXISTING_CATALOG_COMPANY_ID \
  --new-company-name 'ANOTHER_RYAN_APPROVED_UNIQUE_NAME' \
  --state-file ~/.paperclip/instances/default/focx-bot/restore-state.json \
  --snapshot-file ~/.paperclip/instances/default/focx-bot/snapshot.json
```

`PAPERCLIP_API_KEY` is supplied by the operator's environment; it is never printed, stored in the contract or forwarded to plugin subprocesses. New-company imports require an instance-admin board token. No credential creation, credential-value lookup, Keychain operation or OAuth flow is implemented. Ryan enters Paperclip secret values by hand. The only secrets listing used is `GET /api/companies/:id/secrets/catalog`; values become `{type:"secret_ref",secretId}` after exact, unique name resolution.

## Three provisioning stages

1. One native import, with agents born paused and all heartbeat wake paths closed. The preview's per-agent warning `Agent <slug> references skill paperclipai/paperclip/paperclip, but that skill is not present in the package.` is expected. No reserved-key `SKILL.md` is fabricated. The imported `desiredSkills` must equal the singleton exactly. Generated IDs are read back by normalized name/slug and stored outside Git.
2. A permissions PATCH per agent sends all three `false` flags. Import unconditionally grants `tasks:assign`; that explicit grant exists between stages 1 and 2. Readback checks its revocation. Effective `canAssignTasks:true` with `taskAssignSource:simple_default` is reported, not treated as an invariant failure.
3. Stop and print all `kind:"secret"` inputs. A later `bind-secrets` invocation resolves names and merges `adapterConfig:{env}` without `replaceAdapterConfig`. It checks both adapters' bypass flags after writing. Host plugin work follows secret-reference checks and has separately listed operations.

Host settings and instance-local state writes are additional, explicitly listed filesystem operations. The single-writer lock is instance-wide. Default state is `~/.paperclip/instances/default/focx-bot/state.json`; generated company and agent IDs never enter the contract. A failed import records the failed step, returned job ID and observed created IDs. A lost response triggers read-only observation by the unique requested name, never resubmission or adoption. Failed state cannot be retried. A failed state save is not attempted again. Recovery requires a separately reviewed action.

## Host and skill prerequisites

`contract.json` retains the sourced company name `Focx.ai`. That existing name must not be silently suffixed: use a Ryan-approved unique `--new-company-name` for a live fresh import; restore always requires it. Project identity remains sourced metadata. Company/agent IDs, prefix and timezone are outputs. Database name and user-secret identity were not established by the permitted noncredential observations and are explicitly `null`; no credential-bearing connection URI was read. Host verification checks the Homebrew `postgresql@17` listener/executable and the pinned Claude runtime version. It does not install services, PostgreSQL, a tunnel or runtime software.

Snapshot renders two launchd plists from `service`/`network` with secret paths redacted. These are review artifacts, not installable recovery credentials. Restoring the host's database and service authentication remains Ryan's prerequisite. The tunnel's dashboard management is recorded as an inference from FB1, not a newly verified fact.

Claude `workspaces/<generated-id>/.claude/settings.json` and `adapterLocal.claudeCodePlugins` derive from per-agent grants. The full pinned host catalog and the agent's enabled subset are distinct. Codex plugins use the per-company `codex-home`; its pinned set is company-wide. Entries with `pinned:false` are retained and reported as available, never installed. Full remote source identity distinguishes duplicate catalog names, including the two `webmcp` entries. Pin mismatches stop installation; there is no upgrade-to-latest fallback.

Ryan must complete `codex login` for the intended company home before an authorized native plugin operation or Codex run. The provisioner checks auth-file presence/symlink metadata only. It never opens auth bytes. Plugin sign-in and app access remain manual. Claude plugin installation uses its management CLI; native Codex uses only initialize, plugin/read, plugin/install and app/installed. Execution, approval and OAuth requests are rejected. Native reads check source identity/version before installation and installed metadata afterward. Local cached manifests that lack a source ID are reported as unverified identity, not proof of remote provenance.

`native-schema/` keeps the 7 JSON schemas the native plugin calls rely on — `ClientRequest.json` (method names `initialize`, `plugin/read`, `plugin/install`, `app/installed`) and the v2 `PluginRead*`, `PluginInstall*` and `AppsInstalled*` params/responses — out of the 302 that `codex app-server generate-json-schema` produced from the installed native 0.152.1 binary during the FB4 build; the full set is preserved in that build's first commit (`c852f77`) and was trimmed in review. They are protocol evidence: only `PluginInstallParams.json` is read, by one test; nothing at runtime. Schema generation did not start a model run or management session. The isolated schema-home path was not created; a PATH-alias setup warning did not prevent schema generation. Native management interfaces still require live validation; OpenAI documents them in the [app-server reference](https://learn.chatgpt.com/docs/app-server).

`verify` reports three separate read-only model facts:

- Contract model membership in Paperclip's adapter catalog.
- Membership in the ACP lane's own `models_cache.json`, including cache mtime.
- Literal occurrence in the bundled native binary, without executing that binary.

These facts are independent. FB6's supplied catalog result is not an execution proof. Missing runtime skill directories before the first run are reported as unmaterialized. Existing directories are also insufficient: verification scans run logs for `Failed to inject`, returning only file/line locations and withholding log content.

## Evidence and remaining live work

Offline tests prove the eight invariant predicates against adversarial states; native P24/P26 bundle shape; paused import and permission-window handling in the fake; name-to-ID readback; secret-name resolution; digest/state/lock gates; finite-cap preservation; restore recovery from export-pruned falses; pinned-only selection and execution guards; grant rendering; model-evidence separation; and plugin protocol shape/readback guards.

The source knock-outs load modified module bytes into isolated child `node:test` processes. Each witness passes with the real guard, fails with the guard removed, then passes with the original module. The restore witness additionally requires explicit failures for **both invariants 7 and 8**. No production bypass switch or modified source copy is left behind. The test output records every knock-out and its restored pass count.

FB7–FB9 still need explicitly authorized live evidence: fresh import and no-change verification against installed Paperclip, model execution in each lane, actual skill injection and tool grants, installed plugin identity/version plus manual app authentication, real HTTP/filesystem/lock behavior, and an export/restore round trip into a distinct company. The HTTP fake transport is exercised in-process because this build sandbox disallows listening sockets. The native parser covers the installed portability format; a real export remains necessary evidence of full fidelity. Services, credentials and deployment are outside this offline build.

No live Paperclip request, agent run, plugin installation, service change, credential-value access, commit, push or PR was performed in FB4. The only edit outside this package adds contract validation and package tests to the existing drift-gate workflow.

## Plugin grants (FB5)

`node packages/focx-bot/src/index.mjs grants --base-url <url> --company-id <id>`
reports declarations, rendered settings and observed metadata for each contract
agent. It is also included in `verify`. `grants` never writes or invokes a CLI;
`--apply` cannot enable writes, and `--verify-only` stays read-only. An explicit
API target and company id (or saved instance state) are required.

Claude mismatches exit nonzero: grant/enablement/installation/pin differences,
launcher command or environment presence, source divergence, launcher role/company/adapter identity,
worktree permission deltas and H7's dead temp rule. Permissions are rendered with
the launcher's `mergeSettings` and its five vendor baseline rules. The source
validator is imported from `tools/pilot-org`; it reads repository `.focx` role and
skill sources as well as the manifest. Runtime host readers inspect settings,
plugin manifests and installation metadata only, refusing symlinked metadata;
they never open auth files, plugin `SKILL.md` or marketplace snapshots. Missing
pin hashes remain unverified; no plugin content is hashed by `grants`.

codex_local: reported only — declared permissions and plugin sets do not bound Codex behavior (F1); the Claude lane is bounded by its settings and permission rules.

Codex reports its company cache and explicit `enabled` booleans from
`[plugins."key@marketplace"]` in `config.toml`; absent or unsupported enablement
is unknown. Cache presence never implies enablement. The grant check references
`verifySkills` for materialization/injection evidence and never asserts a plugin
works. No worktree settings is unobserved until an authorised FB8 run. Directory
mtimes after the matching pin's recorded `installedAt` are labelled unattributed;
when that metadata is absent, the timestamp baseline is unavailable.

F10 resolved (rev 2.7): the launcher resolves QA through Paperclip by url-key and company; no ids in source.

Generated company and agent ids pass when the live QA agent has url-key
`qa-engineer`, adapter `claude_local`, and the live company id. The launcher
resolves that identity through an authenticated, run-bound Paperclip self-read;
HTTP errors (including a denied trust preset) and incomplete restricted views
fail closed. Permission values still come from `.focx/agents.json` by roleKey.
These fixtures prove metadata comparison and read-only behavior offline, not
runtime permission enforcement.
