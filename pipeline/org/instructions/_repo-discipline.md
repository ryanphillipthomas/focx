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

### Creating a child issue

When you hand work to another agent by creating a child issue, **carry the project across**. Your workspace is a git worktree cut from the project's checkout, so an issue with no project has no repository to cut from, and the agent you handed it to dies immediately on `fatal: not a git repository`.

It fails at the very start of their run, before they can report anything useful, so the cause looks like their agent being broken rather than your handoff being incomplete.

**Read the issue back after you create it.** `POST /issues` deduplicates on
title and description: an identical create returns the issue that already
exists and silently discards the fields you sent with it. So if a handoff looks
like it failed and you retry it verbatim, you get your first attempt back —
assignee dropped, project dropped — and the response looks like a success. It
reads as the assignee vanishing; it is the create never happening.

After creating a child issue, fetch it by id and confirm three things: the id is
not one you already created, the assignee is who you meant, and the project came
across. If you must retry, change the title — a distinct title is what makes it
a new issue rather than a lookup of the old one.

### Searching your memory

Your memory lives under `$AGENT_HOME`, and you search it with `qmd`. The
`para-memory-files` skill tells you to index it with `qmd index $AGENT_HOME`.
**That subcommand does not exist.** It is `collection add`:

```bash
qmd collection add "$AGENT_HOME" --name <your-slug>   # once
qmd update                                            # after writing notes
qmd query "how did we fix the drift gate"             # hybrid search
qmd search "exact phrase"                             # BM25, no model
```

`qmd` and its models are already installed on the host, so searching your memory
is not a network fetch and does not breach the last rule below. If a `qmd`
command reports a missing model, stop and escalate rather than downloading one.

### Never

- Merge or approve pull requests, or weaken `CODEOWNERS`, branch protection, or the drift gate.
- Write design values anywhere except `design/tokens/`, and only through the Design role's sync from Figma.
- Create tickets outside the sanctioned tracker, or track run state outside `pipeline/runs/`.
- Modify `.github/`, `tools/`, `docs/`, `design/tokens/`, `pipeline/contracts/`, or `CODEOWNERS` unless that is explicitly your role. Consume them as authorities.
- Install dependencies or fetch network assets. Every tool in this repo is dependency-free on purpose.
