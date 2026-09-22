# Bug automation configuration

Secret-free configuration for the Slack bug triage + resolution automation.

## Path choice

This repository had **no** existing `.cursor/benny/` or `.cursor/bug-automation/` tree and is **not** adopting the Benny two-job pack.

Configuration lives under **`.cursor/bug-automation/`**. Operational instructions live under **`.cursor/automations/bug-agent/`** (single combined agent).

Do not put secrets here. Notion Bugs DB, Docs read scope, local env, and Playwright MCP are configured. Keep live traffic disabled until the old Automations entry is disabled/deleted and validation passes.

## Files

| Path | Purpose |
|------|---------|
| `configuration.yaml` | Slack, repo, Notion pointers, environment, tools |
| `notion.md` | Product-doc scope + bug-record field map |
| `feature-map.md` | User-facing surfaces and verification notes |
| `../automations/bug-agent/OPERATIONS.md` | Authoritative run instructions |

## Automations entry

| Item | Value |
|------|--------|
| New automation id | `3762c69f-b631-11f1-bb68-864e54d14197` |
| Dashboard | https://cursor.com/automations/3762c69f-b631-11f1-bb68-864e54d14197 |
| Suggested name | Slack bug triage + resolution |
| Preferred model | `cursor-grok-4.6-medium-fast` (cost-aware; not Claude thinking) |
| Source channel | `#bug-reports` (`C0C3ASJ4RLL`) |
| Traffic | **Disabled** (`enabled_for_traffic: false`) |
| **Old automation to disable/delete** | `59897871-b611-11f1-bb68-864e54d14197` — https://cursor.com/automations/59897871-b611-11f1-bb68-864e54d14197 |
