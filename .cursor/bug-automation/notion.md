# Notion scope and bug-record field map

Secret-free. Do not invent destinations. Until `bug_database.status` is configured in `configuration.yaml` and the field map below is filled, the automation must **not** create or update Notion bug records (report the gap; continue code investigation).

## Product documentation (read)

| Field | Value |
|-------|-------|
| Status | **Configured** (Ryan confirmed) |
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
| Database URL | _required — Ryan must pick or confirm tracker-free_ |
| Data source | _required_ |

### Notion MCP discovery (2026-09-22)

Searched connected workspace (`ryanthomas.ai` teamspace) via Notion MCP for Bugs / Issues / Defects / incident / ticket / tracker. **No dedicated bug database was found.**

Nearby databases (not proposed as the bug tracker unless Ryan explicitly picks one):

| Database | URL | Data source | Why not auto-selected |
|----------|-----|-------------|------------------------|
| Tasks | https://app.notion.com/p/3e17559fe2d780b0b15cee7f6d5a757d | `collection://3e17559f-e2d7-804d-80cc-000b13450095` | General task board (Assignee, Due, Blocker, Evidence URL). **Do not use unless Ryan explicitly confirms.** He did not. |
| My Tasks | https://app.notion.com/p/f35b8d405c5f4c26939374f10f83c82d | (personal home view) | Personal assignee view — not a defect tracker |
| Docs | https://app.notion.com/p/3e17559fe2d780ed95d0e6f446f505d5 | `collection://3e17559f-e2d7-80af-833c-000bcc071e00` | Product docs (read scope) — not bugs |
| Projects | https://app.notion.com/p/3e17559fe2d7807b8606d983bd43f14d | `collection://3e17559f-e2d7-8001-a3f1-000b42ab1a67` | Project portfolio |
| Products | https://app.notion.com/p/98ee4ff7b0ce471a96e1986af98149cc | `collection://2702d554-bc46-4c33-b98e-a114d809c924` | Product catalog |
| Seeds | https://app.notion.com/p/b7c4a904d8b1469e9d39d0adff182ae3 | `collection://71eefd5b-abee-448c-b2cc-59cbb4508ccf` | Idea seeds |
| Meetings | https://app.notion.com/p/3e17559fe2d780bdaf31d0863480c6ff | `collection://3e17559f-e2d7-8056-aefc-000b85e7c43b` | Meeting notes |
| Notes | https://app.notion.com/p/3e17559fe2d7804a9792e734764421e6 | `collection://3e17559f-e2d7-8069-8cac-000b5f13ff95` | Freeform notes (title only) |

There is **no single clear Bugs DB** to propose. Options for Ryan: create a Bugs database, explicitly confirm Tasks (not recommended without confirmation), or run tracker-free (no Notion bug writes).

Candidate inventory also in Project store: `docs/bug-agent-notion-bug-db-candidates.md`.

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
