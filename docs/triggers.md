# Triggers

All three trigger sources converge on **one** GitHub Actions workflow: [`.github/workflows/pipeline.yml`](../.github/workflows/pipeline.yml). GitHub Actions is the trigger spine because every invocation — human or bot — becomes a workflow run with logs, plus committed artifacts on a run branch. Auditability is structural, not aspirational.

> **Decision record.** A standalone orchestrator service on Render was considered as an alternative (webhook listener running role agents as long-lived processes). Rejected for now: it creates a second home for execution logs, adds hosting/secrets surface, and puts infrastructure ahead of proof. The handoff contracts are executor-agnostic, so the executor can move later without changing trigger semantics.

## 1. Tickets — GitHub Issues

1. Open an issue with the **Build request** template (`.github/ISSUE_TEMPLATE/build-request.yml`).
2. The template applies the `pipeline:build` label; the `issues: labeled` event fires the pipeline.
3. The pipeline acknowledges on the issue with the run ID and links the draft PR when it opens.

Applying the `pipeline:build` label to any existing issue also fires a run — the issue body becomes the prompt.

## 2. Manual

```bash
gh workflow run pipeline.yml -f prompt="build me this idea"
```

Or from the Actions tab → *pipeline* → *Run workflow*. The invoking GitHub identity is recorded in the run manifest.

## 3. Grok bots

### On-demand ("build me this idea")

The bot POSTs a `repository_dispatch` event with a fine-grained token scoped to this repository (contents: write):

```bash
curl -X POST \
  -H "Authorization: Bearer $GROK_BOT_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/ryanphillipthomas/focx/dispatches \
  -d '{
    "event_type": "grok-build",
    "client_payload": {
      "prompt": "build me this idea",
      "bot": "grok",
      "requested_by": "ryan"
    }
  }'
```

`client_payload.bot` and `requested_by` are recorded in the run manifest — no anonymous bot runs.

### Scheduled (nightly research)

[`.github/workflows/nightly-research.yml`](../.github/workflows/nightly-research.yml) runs on a cron (nightly, 08:00 UTC). In research mode the pipeline's Research role leads: it surveys, ranks, and briefs the **top 3 prototypes worth building**, and each brief becomes its own build run. Scheduled runs carry `trigger: grok-scheduled` in their manifests.

## What every trigger produces, identically

Regardless of source, intake does the same things:

1. Assigns a run ID and creates branch `run/<run-id>`.
2. Commits `pipeline/runs/<run-id>/00-run.json` (the run manifest — who/what/when/prompt).
3. Opens a **draft PR** from the run branch — the audit surface for the whole run.
4. Acknowledges the originator (issue comment, workflow summary, or dispatch response).

Same Figma in, same pipeline, same gates out — the trigger source only changes who is asking.

## Secrets

| Secret | Used by | Purpose |
|---|---|---|
| `GROK_BOT_TOKEN` | grok bot (external) | Fine-grained PAT to POST `repository_dispatch` |
| (default) `GITHUB_TOKEN` | workflows | Branch, commit, PR, and comment operations |
| `PIPELINE_TOKEN` | pipeline workflows | GitHub limitation: events created with the default `GITHUB_TOKEN` do **not** trigger other workflows, so the drift gate would not fire on pipeline-created PRs. A fine-grained PAT (contents + pull-requests: write) used for checkout and `gh pr create`. |
| `ANTHROPIC_API_KEY` | pipeline workflows | Powers the Phase 3 build and QA agents (Claude, per-run). When absent, runs fall back to the deterministic builder — the rails stay testable at zero agent cost. |
