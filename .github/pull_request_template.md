## Run

- **Run ID:** <!-- run-... , or "human change" for non-pipeline PRs -->
- **Trigger source:** <!-- ticket #N / manual / grok / grok-scheduled / human -->
- **Artifacts:** `pipeline/runs/<run-id>/`
- **Preview:** <!-- Render preview URL -->

## Checklist (reviewer)

- [ ] Drift gate green (required — see `docs/drift-gate.md`)
- [ ] Preview matches the Figma nodes cited in `40-design-spec.json`
- [ ] QA verdict is `pass` with evidence, or this is a human change
- [ ] Nothing here weakens the gate, CODEOWNERS, or a source of truth
