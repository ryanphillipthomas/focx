# Sources of truth

The `.focx` control layer establishes the current pilot. Historical records are evidence, not standing instructions.

| Concern | Canonical authority | Consumers and limits |
|---|---|---|
| Locked identity and role separation | [invariants](../.focx/invariants.yaml) | Focx company/platform/brand; Connect only active product; Ryan approves; QA independently verifies |
| Active state and legacy adoption | [baseline](../.focx/baseline.yaml) | Distinguishes active, superseded, retired and unknown claims at source revisions |
| Agent desired state | [agent manifest](../.focx/agents.json) | All 26 identities retained, three paused pilot roles, 23 disabled candidates |
| Agent behavior and methods | [roles](../.focx/roles/) and [versioned skills](../.focx/skills/) | Visible Paperclip instruction files; old prompts are not inherited |
| Agent execution and task coordination | Paperclip company Focx.ai | Ryan deliberately initiates work; no autonomous follow-up tasks |
| Development | This repository, develop | GitHub issues/PRs link to the assigned Paperclip task; human merge approval |
| Design | Figma files in [manifest](../design/figma.manifest.json) | Published values mirrored into design/tokens; drift checks remain required; pilot has no autonomous design-promotion authority |
| Run evidence | pipeline/runs and pipeline/releases | Existing contracts and current-task evidence remain required; retrieve history only for a specific question |
| Credentials | Paperclip secret store and existing host authentication | No credential values in source; synchronization preserves existing adapter credentials, never grants new access |
| Deployment | [render.yaml](../render.yaml) | Existing preview and verification flow; no pilot agent may release production |

[The pilot guide](pilot-operation.md) explains synchronization and the activation gate. [The old organization](org.md), `pipeline/org/roster.json`, its rendered prompts and departmental model/skill assignments are superseded reference material. The legacy reconciler's live apply is disabled.

Design mirrors remain read-only for consumers. Connect extends Focx tokens through explicit deltas and marked overrides. Missing authoritative facts are findings for Ryan. Moving an authority or adopting legacy behavior requires a human-reviewed change to the relevant control/source files.
