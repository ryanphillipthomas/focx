# Bug automation configuration

Secret-free configuration for the Slack bug triage + resolution automation.

## Path choice

This repository had **no** existing `.cursor/benny/` or `.cursor/bug-automation/` tree and is **not** adopting the Benny two-job pack.

Configuration lives under **`.cursor/bug-automation/`**. Operational instructions live under **`.cursor/automations/bug-agent/`** (single combined agent).

Do not put secrets here. Notion Bugs DB, Docs read scope, local env, and Playwright MCP are configured. Keep live traffic disabled until the new Automations entry is created, the old one is disabled/deleted, and validation passes.

## Files

| Path | Purpose |
|------|---------|
| `configuration.yaml` | Slack, repo, Notion pointers, environment, tools |
| `notion.md` | Product-doc scope + bug-record field map |
| `feature-map.md` | User-facing surfaces and verification notes |
| `../automations/bug-agent/OPERATIONS.md` | Authoritative run instructions |

## New automation (do not reuse the old entry)

Create a **new** Automations entry. Do **not** leave the old Slack bug automation active alongside it.

| Item | Value |
|------|--------|
| New automation id | `PENDING_NEW_AUTOMATION_ID` (placeholder until created) |
| Suggested name | Slack bug triage + resolution |
| Source channel | `#bug-reports` (`C0C3ASJ4RLL`) |
| **Old automation to disable/delete** | `59897871-b611-11f1-bb68-864e54d14197` — [Fix bugs reported in Slack](https://cursor.com/automations/59897871-b611-11f1-bb68-864e54d14197) |

Live traffic stays **disabled** until the checklist passes.
