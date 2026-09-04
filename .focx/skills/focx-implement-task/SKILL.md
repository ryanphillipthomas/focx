---
name: focx-implement-task
description: Implement one approved Connect task in an isolated worktree, with a single reviewable PR and independent QA handoff.
metadata:
  version: "0.1.0"
---

# focx-implement-task

Check the task's approval, criteria, base revision, and linked PR before editing. Search the open queue for the same issue; use its implementation branch when appropriate. If another implementation task is active, report the conflict to Ryan before starting a second.

Confirm an isolated worktree and record its base and working branch. Change only what satisfies the task, using existing design tokens and interfaces. Do not import a legacy feature merely because it exists; adoption must appear in the approved criteria.

Run checks appropriate to the change, preserve required evidence artifacts, and prepare one PR with exact revision, behavior change, checks, and limitations. Do not author QA's independent verdict, merge, deploy, or launch follow-up work. Report newly found issues in the task outcome and stop.
