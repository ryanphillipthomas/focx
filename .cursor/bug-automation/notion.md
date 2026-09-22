# Notion scope and bug-record field map

Secret-free. Do not invent destinations. Until `bug_database.status` is configured in `configuration.yaml` and the field map below is filled, the automation must **not** create or update Notion bug records (report the gap; continue code investigation).

## Product documentation (read)

| Field | Value |
|-------|-------|
| Status | **Candidate — confirm before traffic** |
| Database | [Docs](https://app.notion.com/p/3e17559fe2d780ed95d0e6f446f505d5) |
| Data source | `collection://3e17559f-e2d7-80af-833c-000bcc071e00` |
| Useful types | PRD, Spec, RFC, Decision, Guideline, Runbook |
| Related hubs | [Connect project](https://app.notion.com/p/3e17559fe2d781e1a375f368bcee64a0) (blank at discovery), [Focx.ai product](https://app.notion.com/p/3e17559fe2d781baa0e3c509da1ae2b4) |

Rules:

- Prefer Type in {PRD, Spec, RFC, Decision, Guideline} with Status Done or In progress over Draft-only notes.
- Read the full page before relying on search snippets.
- Do not edit product documentation to match a proposed fix.

## Bug database (write)

| Field | Value |
|-------|-------|
| Status | **UNCONFIGURED** |
| Database URL | _required_ |
| Data source | _required_ |

No dedicated Bugs database was found in the connected Notion workspace. **Tasks** (`https://app.notion.com/p/3e17559fe2d780b0b15cee7f6d5a757d`) exists but is a general task board (Assignee, Due date, Blocker, Evidence URL) without a Slack-thread field or bug-specific statuses. Do **not** treat Tasks as the bug database unless explicitly confirmed.

### Required field map (fill after destination is chosen)

| Semantic field | Notion property | Notes |
|----------------|-----------------|-------|
| Title | _TBD_ | Concise defect title |
| Slack thread link | _TBD_ | Exact permalink; primary dedupe key |
| Expected behavior | _TBD_ | |
| Observed behavior | _TBD_ | |
| Reproduction steps | _TBD_ | |
| Environment | _TBD_ | |
| Product doc links | _TBD_ | |
| Evidence / notes | _TBD_ | Hypotheses clearly labeled |
| Draft PR link | _TBD_ | Set when draft PR exists |
| Status | _TBD_ | Map only to existing options |

### Status mapping (fill with existing options only)

| Outcome | Notion status / note |
|---------|----------------------|
| New clear defect | _TBD_ |
| Investigating / reproduced | _TBD_ |
| Draft PR ready for review | _TBD_ (not “resolved”) |
| Duplicate of existing | _TBD_ / append to existing record |
| Cannot reproduce / blocked | _TBD_ |
| Not a bug (question/feature) | _TBD_ or skip create |

If no suitable status exists, add a concise note on the page body rather than inventing a status option.
