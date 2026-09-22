# Bug automation configuration

Secret-free configuration for the Slack bug triage + resolution automation.

## Path choice

This repository had **no** existing `.cursor/benny/` or `.cursor/bug-automation/` tree and is **not** adopting the Benny two-job pack.

Configuration lives under **`.cursor/bug-automation/`**. Operational instructions live under **`.cursor/automations/bug-agent/`** (single combined agent).

Do not put secrets here. Fill unknown Notion bug-database mappings before enabling live traffic.

## Files

| Path | Purpose |
|------|---------|
| `configuration.yaml` | Slack, repo, Notion pointers, environment, tools |
| `notion.md` | Product-doc scope + bug-record field map |
| `feature-map.md` | User-facing surfaces and verification notes |
| `../automations/bug-agent/OPERATIONS.md` | Authoritative run instructions |

## Existing automation to reuse

Do **not** create a second Slack bug automation. Edit the existing entry:

- Dashboard: https://cursor.com/automations/59897871-b611-11f1-bb68-864e54d14197
- Observed name: **Fix bugs reported in Slack** / run label **Bug report resolution**
- Automation id: `59897871-b611-11f1-bb68-864e54d14197`
- Source channel (observed): `#bug-reports` (`C0C3ASJ4RLL`)
