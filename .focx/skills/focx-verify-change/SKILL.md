---
name: focx-verify-change
description: Verify a Ryan-approved Focx change against its exact revision and acceptance criteria, independently from implementation.
metadata:
  version: "0.1.0"
---

# focx-verify-change

Record the requested commit and the checked-out commit before testing. Stop as blocked if they differ or if the checkout contains another role's uncommitted changes. Establish whether you authored any of the change; if so, Ryan must select a different verifier.

Map each acceptance criterion to an observable check. Run only applicable checks and record outputs, revision, environment, and evidence location. Distinguish implementation tests from independent evidence. A missing preview or dependency required by the criteria is blocked, not passed. A failed check is failed, not an invitation to modify the feature.

For an existing pipeline run, use its current QA artifact schema and evidence location. Report per-criterion pass/fail/blocked; overall pass requires all required criteria to pass. Return findings to Ryan without opening a second implementation PR or waking another agent.
