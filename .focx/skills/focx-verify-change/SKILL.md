---
name: focx-verify-change
description: Verify a Ryan-approved Focx change against its exact revision and acceptance criteria, independently from implementation.
metadata:
  version: "0.1.2"
---

# focx-verify-change

Record the requested commit and the checked-out commit before testing. Stop as blocked if they differ or if the checkout contains another role's uncommitted changes. Establish whether you authored any of the change; if so, Ryan must select a different verifier.

Map each acceptance criterion to an observable check. Run only applicable checks and record outputs, revision, environment, and evidence location. Distinguish implementation tests from independent evidence. A missing preview or dependency required by the criteria is blocked, not passed. A failed check is failed, not an invitation to modify the feature.

For an existing pipeline run, use its current QA artifact schema and evidence location. Report per-criterion pass/fail/blocked; overall pass requires all required criteria to pass. Return findings to Ryan without opening a second implementation PR or waking another agent.

## Evidence tooling

Before mapping criteria, write the change under test to a diff file (`git diff <base>...<revision>` into the evidence location as `run.diff`) and run the assigned `differential-review` procedure on it: `/differential-review:diff-review <evidence>/run.diff` if that command resolves, otherwise by reading the plugin's SKILL.md. Save its report under the evidence location. Then run `pr-review-toolkit:silent-failure-hunter` via Task on the same diff and record its findings. Both are evidence; the per-criterion verdict against the deployed preview remains yours.

Invoke no other review agent unless the task explicitly requests a full sweep. A full sweep adds `pr-review-toolkit:pr-test-analyzer`, `pr-review-toolkit:code-reviewer` (pointed at `AGENTS.md`), and `/spec-to-code-compliance:spec-compliance <worktree>` with the acceptance criteria first rendered to `<evidence>/spec.md` and `limit` set to the criterion count; map `implemented` to pass and every other verdict to fail.

If an assigned tool does not resolve, or a call is denied by permission policy, record that as a material limit and continue by hand. Never block a verdict on tooling, and never widen your own permissions. Do not probe for the cause of a denial: no filesystem-wide searches, no requests to hosts the task did not name, and no writes attempted outside your evidence location to tell a denial apart from an error. One denial, recorded once, is the finding.

## Reporting

Deliver your report with `scripts/paperclip-issue-update.sh`, which reads the task id and credentials from the environment so the command carries no variable expansion:

```
scripts/paperclip-issue-update.sh --status <done|blocked> <<'MD'
...your report...
MD
```

Do not hand-roll `curl` against the control plane: a command containing `$PAPERCLIP_API_URL` or `$PAPERCLIP_API_KEY` matches no permission rule and is denied unattended, which loses the report. A nonzero exit from the script means the write did not apply; say so plainly in your final response rather than reporting the update as sent.
