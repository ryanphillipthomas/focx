## Repository discipline

You have a working checkout of `ryanphillipthomas/focx`. Everything in this section is non-negotiable.

### Two files named AGENTS.md

There are two, and they do not conflict once you know the rule:

- The repository's own `AGENTS.md` at the checkout root — **authoritative for repository mechanics**: guardrails, artifact contracts, where things live.
- This bundle — **authoritative for your role**: what you own, what you may decide, and who you escalate to.

Where they appear to disagree, the repo wins on repo mechanics and this bundle wins on who does what. Report any real conflict rather than picking silently.

### The three guardrails, verbatim from the repo

1. **No design drift.** Figma is the design source of truth. Every color, spacing, radius, type style, and component you use must resolve to a published token in `design/tokens/` or a component in `packages/design-focx` / `packages/design-connect`. Raw hex values, raw pixel values, and invented components fail the drift gate and the run dies there. Do not route around the gate; fix the build or escalate.
2. **Build, never merge.** Your output is a pull request with a Render deploy preview. You do not merge, approve, force-push to `main` or `develop`, or dismiss reviews. Human review is the only path to merge; `CODEOWNERS` enforces it.
3. **One source of truth per concern.** Never create a second home for design values, tickets, run state, or deployment config. If information seems missing from its canonical home, that is a finding to report — not a licence to improvise a new location.

### Cold start, in order

1. The repo's `AGENTS.md`
2. `docs/sources-of-truth.md`
3. `docs/org.md` — who executes which pipeline stage
4. `docs/pipeline.md`
5. Your stage's role file in `docs/roles/`
6. The JSON Schema for the artifact you must produce, in `pipeline/contracts/`

### Run mechanics

- Every run has a run ID and a branch `run/<run-id>`. All your work happens on that branch.
- Every stage writes its artifact to `pipeline/runs/<run-id>/` **before** handing off, and commits it. An artifact that fails schema validation is an incomplete handoff.
- Validate with `node tools/contracts/validate.mjs`. Check drift with `node tools/drift-check/index.mjs`. Run both yourself; never trust a passed-along result or another agent's self-report.
- Deploy only through `render.yaml` previews attached to your PR.
- Record ambiguities and the interpretation you chose in your artifact's `assumptions` field. If an ambiguity blocks you, halt and escalate.

### Never

- Merge or approve pull requests, or weaken `CODEOWNERS`, branch protection, or the drift gate.
- Write design values anywhere except `design/tokens/`, and only through the Design role's sync from Figma.
- Create tickets outside the sanctioned tracker, or track run state outside `pipeline/runs/`.
- Modify `.github/`, `tools/`, `docs/`, `design/tokens/`, `pipeline/contracts/`, or `CODEOWNERS` unless that is explicitly your role. Consume them as authorities.
- Install dependencies or fetch network assets. Every tool in this repo is dependency-free on purpose.
