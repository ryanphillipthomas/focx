# @focx/bot

Dependency-free Node 22+ provisioner for FB2 rev 2.8, with FB3 rev 2.2's skills fragment preserved verbatim. The two agents remain paused. Claude reviews this build; Ryan controls subsequent live authorization and merges.

## Offline checks

From the repository root:

```sh
node packages/focx-bot/src/index.mjs --validate-contract
node --test packages/focx-bot/test.mjs
node --test tools/qa-claude-agent-acp/*.test.mjs
node packages/focx-bot/src/index.mjs fresh --fake
```

The schema validator implements every keyword used by `contract.schema.json`. Tests exercise the same schema, native bundle renderer, operations, invariant functions and digest used by the CLI. The fake API is in-process; tests require neither sockets nor Paperclip credentials. `--fake` has ephemeral state and is useful for a fresh plan; the test fixture carries state across all stages.

The retired `tools/pilot-org` and `tools/paperclip-org` reconciliation CLIs are superseded by this package. `src/roles.mjs` is the single `.focx` loader and validator (`loadRoleSource`, `buildRoleSource`); `src/contract.mjs` retains its separate `loadSource` for the provisioning contract. The package tests validate the real role source and include all 31 active validation guards as knock-outs. `--validate-contract` checks the provisioning contract only. Root scripts `focx-bot:check`, `focx-bot:plan`, `focx-bot:verify` and `test:focx-bot` wrap existing CLI operations; `focx-bot:plan` invokes `apply` without the write flag.

The QA launcher suites include eight optional native permission tests. Set `FOCX_TEST_CLAUDE_SDK_ROOT` to an installed SDK directory to run them; otherwise they explicitly skip. They use a loopback stub and dummy authentication, while the ordinary launcher tests remain entirely in memory.

## Verbs and approval

`verify` is the default and is always read-only. `--verify-only` also forces verification, even alongside `--apply`. Every other verb defaults to a plan. A write invocation needs **both** `--apply` and `--approved-digest <digest-from-the-current-plan>`. The digest binds rendered operations, explicit base URL, company ID and exact contract bytes. Independent permission, model, state and invariant checks still run. Every mutation is printed before execution. An HTTP failure is never retried.

| Verb | Behavior |
| --- | --- |
| `verify` | Reads configuration, effective access, secret references, models, host declarations, plugin metadata, runtime skill directories and injection-failure logs; exits nonzero on unmet checks. |
| `apply` | Reconciles an existing exact two-agent company without changing identity, adapter type, activation or skill registry membership. Keeps stricter live limits and permission policies. |
| `fresh` | Preflights instance-admin access, unique company name and adapter model catalogs, then imports one minimal native package with `pauseAutomations:true`. Performs the permissions stage and stops for hand-entered secrets. |
| `bind-secrets` | Resolves secret names using `secrets/catalog`, patches merged `adapterConfig.env`, verifies readback, then provisions pinned plugins through host management interfaces. Reports apps requiring Ryan's manual sign-in. |
| `snapshot` | Native export of company, agents, projects and skills, with issues excluded. Saves the bundle, verbatim export warnings, project/workspace summary, source configs, native fidelity report, pruned `false` keys and rendered host declarations. Refuses omitted workspaces. |
| `restore` | Requires an explicit unique new company name. Strips native bundled skills and verified duplicate company copies (F15 below). Overlays invariants 7–8 into the exported bundle before the same three provisioning stages. Verifies invariants 1–9, zero configuration changes, and source config parity; returns a `compare` block. Secrets remain unbound and plugins unprovisioned. |

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

`contract.json` retains the sourced company name `Focx.ai`. That existing name must not be silently suffixed: use a Ryan-approved unique `--new-company-name` for a live fresh import; restore always requires it. The contract renders Connect and its primary focx git_repo workspace into the native bundle. Company, agent, project and workspace IDs, prefix and timezone are outputs. Database name and user-secret identity were not established by the permitted noncredential observations and are explicitly `null`; no credential-bearing connection URI was read. Host verification checks the Homebrew `postgresql@17` listener/executable and the pinned Claude runtime version. It does not install services, PostgreSQL, a tunnel or runtime software.

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

Offline tests prove the nine invariant predicates against adversarial states; native P24/P26 bundle shape; paused import and permission-window handling in the fake; name-to-ID readback; secret-name resolution; digest/state/lock gates; finite-cap preservation; restore recovery from export-pruned falses; pinned-only selection and execution guards; grant rendering; model-evidence separation; and plugin protocol shape/readback guards.

The source knock-outs load modified module bytes into isolated child `node:test` processes. Each witness passes with the real guard, fails with the guard removed, then passes with the original module. The restore witness additionally requires explicit failures for **both invariants 7 and 8**. No production bypass switch or modified source copy is left behind. The test output records every knock-out and its restored pass count.

FB7/FB8 logs in ORCHESTRATION.md record the provisioned Codex lane passing on Astra, including a scoped commit/push and delivered reports. FB9 cross-checked the supplied content-addressed Git evidence and local logs; captured API JSON is internally consistent evidence supplied by Claude, not a current live read. The project import added here, native export/restore into a distinct company, QA execution, actual skill injection and tool grants, installed plugin identity/version plus manual app authentication, and real HTTP/filesystem/lock behavior still require separately authorized live evidence. The HTTP fake transport is exercised in-process because this build sandbox disallows listening sockets. The native parser covers the installed portability format; a real export remains necessary evidence of full fidelity. Services, credentials and deployment are outside this offline build.

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
validator is `loadRoleSource` from `src/roles.mjs`, shared with the QA launcher; it reads repository `.focx` role and
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

## FB9 live round trip (operator sequence; not executed by this build)

Use the FB9 contract revision for both commands. An older snapshot lacks source
configuration/project sidecars and must be taken again. Keep the source company's
agents paused. Ryan authorizes each export/import write separately; review the
printed operations and repeat that exact command with `--apply --approved-digest
DIGEST`. Use an unused snapshot path, a unique target company name, and a separate
restore state file. No flag changed in FB9.

```sh
node packages/focx-bot/src/index.mjs snapshot \
  --base-url http://127.0.0.1:3100 \
  --company-id SOURCE_COMPANY_ID \
  --snapshot-file ~/.paperclip/instances/default/focx-bot/fb9-snapshot.json

# After authorizing and applying the snapshot above, preview the restore:
node packages/focx-bot/src/index.mjs restore \
  --base-url http://127.0.0.1:3100 \
  --catalog-company-id SOURCE_COMPANY_ID \
  --new-company-name RYAN_APPROVED_UNIQUE_RESTORE_NAME \
  --state-file ~/.paperclip/instances/default/focx-bot/fb9-restore-state.json \
  --snapshot-file ~/.paperclip/instances/default/focx-bot/fb9-snapshot.json

# After authorizing and applying the restore, use its generated company ID:
node packages/focx-bot/src/index.mjs verify \
  --base-url http://127.0.0.1:3100 \
  --company-id RESTORED_COMPANY_ID \
  --state-file ~/.paperclip/instances/default/focx-bot/fb9-restore-state.json
```

The native bundle has `projects/connect/PROJECT.md` and
`.paperclip.yaml` → `projects.connect.workspaces.focx`, a **keyed object**.
Invariant 9 requires exactly the contract project by url-key and one primary
`git_repo` workspace with the contract repoUrl. Reports contain generated project
and workspace IDs. Invariants 1–8 are unchanged. Restore preserves project files
and extension fields; a missing workspace or native workspace-omission warning
refuses before import, even if another primary workspace remains.

Snapshot records `projects` (slug, workspace name/repoUrl/primary),
`exportWarnings` verbatim, and `source` configuration with secret bindings and
managed instruction locations excluded. It records the rendered source Claude
config directory, never credential or plugin payloads. The native fidelity report
is retained verbatim; its counts describe excluded history and do not cover P25's
pruned false flags or prove project fidelity. Those losses have separate checks.

Restore emits `compare.fidelity`, `compare.prunedFalseKeys`,
`compare.exportWarnings`, per-agent `adapterConfig`/`runtimeConfig` differences,
project/workspace differences, and both Claude directories under `compare.claudeConfigDirs` (source rendered
versus restored rendered). Agents match by slug; generated IDs and managed
instruction locations are excluded. Secret bindings and derived Claude directory
env are compared separately as expected provisioning findings; plain env values
normalize the native string/`plain` representations. Every other config value,
including `false`, participates in the diff. A nonempty `compare.differences`
fails the restore and records `restore-comparison` as the failed step. The overlay
reconstructs contract plain env such as PATH, optional secret-input declarations,
and safety flags; it never invents a missing project workspace.

A successful restore saves its configuration-parity status in the target state
file. While that matching state is `awaiting-secret-entry`, `verify` reports
`scope: restored-configuration`, requires invariants 1–9 and `changes: []`, and
checks the restored settings against their rendered content. Unbound secret links
and unprovisioned plugins are explicit `expectedFindings`, so this configuration
check exits zero without claiming operational readiness. Normal verification
retains its existing credential, grant and plugin exit checks; a different company,
contract or failed restore cannot inherit the parity scope. Do not run
`bind-secrets`, install plugins, log in or wake an agent as part of this round-trip
check. Those are separate authorizations and are not needed to prove config parity.

FB9's fake round trips cover sources with bound and unbound secrets. Source
knock-outs prove invariant 9, project rendering and missing-workspace refusal;
removing project rendering yields no fake project and invariant 9 fails. Offline
results do not establish a successful live native import or a working credential,
plugin, agent execution, or deployment.

## F15 — restore native bundled and company skills

FB9's real snapshot contains five files under
`skills/paperclipai/paperclip/`: `paperclip`, `paperclip-board`,
`paperclip-converting-plans-to-tasks`, `paperclip-create-agent`, and
`para-memory-files`. Each has `metadata.sources[0].commit: null`; each manifest
entry has `sourceType: github`, `sourceRef: null`, and
`metadata.sourceKind: paperclip_bundled`. The snapshot contains zero
`secret_ref` occurrences. This was checked read-only against the FB9 snapshot;
no credential file was opened.

Installed Paperclip 2026.831.1 explains why preview passed but apply returned 422:
`server/dist/services/company-skills.js:24–41` rejects external GitHub skills
without a 40-hex commit. At `:4948–4960`, apply refreshes inventory, then runs the
reserved-key and source assertions even on conflicts. The bundled source kind
passes the key assertion (`:42–48`) but does not bypass the source assertion.
`company-portability.js:4207–4228` only checks skill references in preview;
`:4516–4518` returns that preview without importing skills. A fabricated commit
would pass the format check (`company-skills.js:21–22`); inventing provenance is
forbidden.

Restore clones the snapshot bundle, removes every reserved skill file (including
support files) and reserved manifest entry, then computes the inline import's
`expectedFileCount` from the remaining files. It removes affected unreferenced
embedded assets from both the manifest and YAML extension, retaining shared blobs
and other references. The dry-run result, emitted report and successful restore
state record `strippedReservedSkills` (canonical keys) and
`deduplicatedCompanySkills` (removed company directories). The source snapshot
and retained agent instruction files stay unchanged.

This uses the same P26 assumption as fresh: `ensureSkillInventoryCurrent`
(`company-skills.js:4949`) calls `ensureBundledSkills` (`:2487`, definition at
`:2271`). The target instance seeds its own bundled skills. Restore therefore
accepts only fresh's exact per-agent preview warning:

> Agent <slug> references skill paperclipai/paperclip/paperclip, but that skill is not present in the package.

Any other preview warning still fails closed. Unmapped agent skill references
remain unchanged (`company-portability.js:4849`) and are written into
`paperclipSkillSync` (`:3096`). At completion, restore reads the agents again
and asserts invariant 5's exact singleton, independently of configuration parity,
and asserts that the submitted bundle contains no reserved skill files/entries.

The native export also lists each Focx instruction skill twice: its bare
`focx-*` key under `agents/<slug>/skills/<name>/SKILL.md`, and a
`company/<source-id>/focx-*` key under
`skills/company/<PREFIX>/<name>/SKILL.md`. The importer scans every SKILL.md
(`company-skills.js:649–686`), preserves explicit keys (`:275–277`), otherwise
uses `company/<target-id>/<slug>` (`:309`), and can rename collisions
(`:5022–5023`). Restore drops the company copies and their manifest entries;
the retained agent copies supply the target inventory. It first compares complete
file inventories, skill bodies and metadata, ignoring only native export identity
fields. Divergent or unmatched company skills are refused rather than silently
lost. No extra instruction files are created, preserving invariant 4.

The fake now exports the null-commit bundled skills and duplicate company copies,
seeds target inventory, and rejects the raw export on apply with a 422-style error
after creating the company row. It records package skill imports for inspection.
F15 tests cover asset sharing, immutable stripping, exact warnings, generated
company keys and singleton readback. Three source knock-outs separately remove
the reserved strip, company de-duplication and final singleton assertion; each
witness fails with the change removed and passes again with the original source.
The existing overlay knock-out keeps stripping enabled so it still independently
proves both safety invariants 7 and 8. A new live round trip remains Claude's
verification task after review and Ryan's merge.
