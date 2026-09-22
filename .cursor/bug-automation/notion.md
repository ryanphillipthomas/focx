# Notion scope and bug-record field map

Secret-free. Bug database and product-docs scope are **configured**. Use only the properties and status options below — do not invent fields or statuses.

## Product documentation (read)

| Field | Value |
|-------|-------|
| Status | **Configured** |
| Database | [Docs](https://app.notion.com/p/3e17559fe2d780ed95d0e6f446f505d5) |
| Data source | `collection://3e17559f-e2d7-80af-833c-000bcc071e00` |
| Useful types | PRD, Spec, RFC, Decision, Guideline, Runbook |
| Related hubs | [Connect project](https://app.notion.com/p/3e17559fe2d781e1a375f368bcee64a0), [Focx.ai product](https://app.notion.com/p/3e17559fe2d781baa0e3c509da1ae2b4) |

Rules:

- Prefer Type in {PRD, Spec, RFC, Decision, Guideline} with Status Done or In progress over Draft-only notes.
- Read the full page before relying on search snippets.
- Do not edit product documentation to match a proposed fix.

## Bug database (write)

| Field | Value |
|-------|-------|
| Status | **Configured** |
| Database | [Bugs](https://app.notion.com/p/d90b04c202fd413a886fc6026bbb4aae) |
| Data source | `collection://24dc9aeb-1c47-43c1-9f95-8309f900da1f` |
| Location | Workspace root (alongside Docs / Projects) |
| Not used | Tasks — general work board; never write bugs there |

### Field map

| Semantic field | Notion property | Type | Notes |
|----------------|-----------------|------|-------|
| Title | Name | title | Concise defect title |
| Slack thread link | Slack thread | url | Exact permalink; **primary dedupe key** |
| Expected behavior | Expected | text | |
| Observed behavior | Observed | text | |
| Reproduction steps | Reproduction steps | text | |
| Environment | Environment | text | e.g. local compose/`dist/` |
| Product doc links | Product docs | relation → Docs | Relate Docs pages; do not invent destinations |
| Evidence / notes | Evidence / notes | text | Label hypotheses clearly |
| Draft PR link | Draft PR | url | Set when draft PR exists (ready for review, not resolved) |
| Status | Status | select | Options below only |
| Project (optional) | Project | relation → Projects | When known |
| Archived | Archived | checkbox | Do not archive via automation |
| Bug ID | Bug ID | auto_increment_id | System-managed (`BUG-n`) |

### Status mapping

| Outcome | Notion Status |
|---------|---------------|
| New clear defect | **New** |
| Investigating / reproduced | **Investigating** |
| Draft PR ready for review | **Draft PR ready** (not “resolved”) |
| Duplicate of existing | **Duplicate** — also append evidence to the existing record |
| Cannot reproduce / blocked | **Blocked** |
| Not a bug (question/feature) | **Not a bug** — or skip create when clearly non-defect |

Do not invent additional status options. If none fit, leave Status unchanged and add a concise note in **Evidence / notes**.
