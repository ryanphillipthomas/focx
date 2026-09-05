---
name: focx-verify-change
description: Verify a Ryan-approved Focx change against its exact revision and acceptance criteria, independently from implementation.
metadata:
  version: "0.1.4"
---

# focx-verify-change

Record the requested commit and the checked-out commit before testing. Stop as blocked if they differ or if the checkout contains another role's uncommitted changes. Establish whether you authored any of the change; if so, Ryan must select a different verifier.

Map each acceptance criterion to an observable check. Run only applicable checks and record outputs, revision, environment, and evidence location. Distinguish implementation tests from independent evidence. A missing preview or dependency required by the criteria is blocked, not passed. A failed check is failed, not an invitation to modify the feature.

For an existing pipeline run, use its current QA artifact schema and evidence location. Report per-criterion pass/fail/blocked; overall pass requires all required criteria to pass. Return findings to Ryan without opening a second implementation PR or waking another agent.

## Evidence tooling

Before mapping criteria, create the assigned evidence directory with a standalone `mkdir -p pipeline/runs/<run-id>/evidence/` call. Capture the diff directly with one Bash call: `git diff <base>...<revision> > pipeline/runs/<run-id>/evidence/run.diff`. Substitute the literal reviewed revisions and assigned path; no variables, pipes, wrappers, extra redirections, or appended commands. This single redirect inside the evidence directory is intentional: it preserves Git's exact bytes and is covered by the existing `Bash(git diff:*)` and `Edit(/pipeline/runs/**)` rules. Never reconstruct the diff with Write, copy line-numbered tool output, or use `/tmp` as an intermediate. Read the saved diff for the reviews.

Use Write for the reports you author in the evidence directory. `Write(path)` is not a working Claude file-permission rule: the launcher uses the anchored `Edit(/pipeline/runs/**)` path rule for Write while denying the actual Edit and NotebookEdit tools. Only run artifacts may be written. Do not append `echo`, exit-code checks, pipes, variable expansions, or additional commands to operational calls. The tool result already contains the status. Line counts are not proof of byte equality; do not claim an exact match from them.

Perform the installed `differential-review` methodology by reading its `skills/differential-review/SKILL.md` as a file and following its applicable referenced methodology, adversarial and reporting documents. Use the installed plugin path supplied by the task/session; if it is missing, report the missing path instead of searching unrelated host directories. Save the review under the assigned evidence directory. Do not invoke the slash command or Skill tool: this plugin's `allowed-tools` frontmatter pre-approves broad Bash/Write access. Reading the methodology as data does not grant those permissions. The task's scoped permissions and output paths continue to govern the review.

Then invoke `pr-review-toolkit:silent-failure-hunter` via Task/Agent on the same diff, pass the task's exact scope and output constraints, and save its findings in the evidence directory. These two reviews are evidence; the per-criterion verdict against any required deployed preview remains yours. Never count tool discovery, successful dispatch, or a process success status as a completed review or workflow pass.

Invoke no other review agent unless the task explicitly requests a full sweep. A full sweep adds `pr-review-toolkit:pr-test-analyzer`, `pr-review-toolkit:code-reviewer` (pointed at `AGENTS.md`), and the installed spec-to-code-compliance methodology read as files, with acceptance criteria first rendered to `<evidence>/spec.md` and the review limit set to the criterion count; map `implemented` to pass and every other verdict to fail. Do not invoke Skill to obtain broader permissions. Missing authorization or tooling is recorded, never improvised.

If an assigned tool does not resolve, or a call is denied by permission policy, record that as a material limit and continue by hand. Never block a verdict on tooling, and never widen your own permissions. Do not probe for the cause of a denial: no filesystem-wide searches, no requests to hosts the task did not name, and no writes attempted outside your evidence location to tell a denial apart from an error. One denial, recorded once, is the finding.

## Reporting

Deliver your report with `scripts/paperclip-issue-update.sh`, which reads the task id and credentials from the environment so the command carries no variable expansion:

```
scripts/paperclip-issue-update.sh --status <done|blocked> <<'MD'
...your report...
MD
```

The Bash call must begin with `scripts/paperclip-issue-update.sh` and use the direct single-quoted heredoc above. Put the actual observed results in its body; never send placeholder instructions. Do not wrap it in `cat`, pipe into it, append `echo`, inspect `$?`, or combine it with other commands. Record the returned exit status from the tool result.

Do not hand-roll `curl` against the control plane: a command containing `$PAPERCLIP_API_URL` or `$PAPERCLIP_API_KEY` matches no permission rule and is denied unattended, which loses the report. A nonzero exit from the script means the write did not apply; say so plainly in your final response rather than reporting the update as sent.
