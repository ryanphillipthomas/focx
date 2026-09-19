# Paperclip API facts

Facts about the self-hosted control plane (`http://127.0.0.1:3100`, board at `ops.focx.ai`) that are
not obvious from the API surface and that each cost a void, cancelled or failed live run to establish.
Read this before driving an agent, a task or a run by hand.

Every item below was observed against the live instance and, where a line is cited, confirmed in the
installed server source under `~/.paperclip/cli/current/node_modules/@paperclipai/server/dist/`.

## Task assignment

**Assign with `assigneeAgentId`. `assigneeId` is silently ignored.**

A `PATCH /api/issues/:id` carrying `assigneeId` returns HTTP 200 and changes nothing. The task then has
no owner, and any run queued against it is cancelled with `stopReason: "issue_assignee_changed"`. The
field the server reads is `assigneeAgentId` (`routes/issues.js:6909`). Two live runs were lost to this.

**Bind the task to its project and workspace before assigning, then read the assignee back.** A task
created without `projectId` and `projectWorkspaceId` has no worktree to run in, and binding them can
clear an assignee that was set at creation.

## Run status

**A finished run reports `status: "succeeded"`, not `completed`.**

`GET /api/heartbeat-runs/:runId` uses `queued`, `running`, `succeeded`, `failed` and `cancelled`. Code
that polls for `completed` spins past a successful run and looks like a hang. Evidence of the model that
actually ran is `usageJson.model`; `resultJson.requestedModel` is what was asked for.

## The wake window

Waking a paused agent is exactly two writes, and closing it is two more. The heartbeat stays disabled
throughout: this opens a single on-demand window, not a schedule.

```
POST  /api/agents/:id/resume
PATCH /api/agents/:id            runtimeConfig.heartbeat.wakeOnDemand = true   (enabled stays false)
POST  /api/agents/:id/wakeup     {source:"on_demand", triggerDetail:"manual", reason,
                                  payload:{issueId}}
```

**The `payload.issueId` is load-bearing.** The run reads it to find its task; omitting it produces a run
with nothing to do, which is a void run rather than an error.

Close the window by restoring `runtimeConfig` **byte-identically** to what you recorded before opening
it, then `POST /api/agents/:id/pause`. Record the prior value first and read the restored value back.

## Company identity and branch names

**The company record carries `issuePrefix`** — `FOC` for the retained company, `FOCA` and `FOCAAA` for
provisioned ones. Paperclip names each per-issue worktree branch `<issuePrefix>-<issue>-<slug>`.

Anything that matches on a branch name must therefore derive the prefix from the company, never assume
one. A hardcoded `FOC-` meant the QA lane could not run in any company focx-bot provisions
(finding F23), and a permission rule written for `run/` branches means a Paperclip-named branch cannot
be pushed at all (finding F24). The repository's own issue #55 is the same theme.

## Agent permissions

**Claude Code permission rules match a command prefix, not a shell line.** A rule like
`Bash(git add pipeline/runs:*)` does not permit `cd … && git add … && git status`, even though the
underlying command is allowed. Task text should ask for single commands.

A refusal surfaces to the agent as `User refused permission to run tool`, with no further detail. If a
run stops on one, the cause is the rule set, not the agent.

## Where the truth lives

Findings F1–F24, with the evidence behind each and the decisions taken against them, are in
[`ORCHESTRATION.md`](../ORCHESTRATION.md). This file is the short version of the operational facts only.
