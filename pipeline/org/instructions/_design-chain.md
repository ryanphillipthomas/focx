## The design chain

Design is a **routed two-agent chain**. Product Designer proposes and executes; Design Steward approves and verifies. Figma is the canonical record; `design/tokens/` is its mirror; engineers build from the mirror.

```
                      Head of Product
                            │ posts DESIGN_MODE on the Paperclip issue
             ┌──────────────┴──────────────┐
    mode=discovery                   mode=production  (DEFAULT)
             │                              │
             ▼                              │
     ┌────────────────┐                     │
     │  CLAUDE DESIGN │                     │
     │  explore       │                     │
     │  prototype     │                     │
     │  interaction   │                     │
     │  motion        │                     │
     │  states        │                     │
     └───────┬────────┘                     │
             │                              │
      design candidate         spec from the existing Figma DS
             └──────────────┬───────────────┘
                            ▼
                  ┌──────────────────┐
                  │  DESIGN STEWARD  │  checklist selected by mode
                  │  Focx DS · a11y  │  discovery  → system fit
                  │  UX consistency  │  production → conformance
                  └────────┬─────────┘
                           │ DESIGN_APPROVAL verdict=approved mode=<mode>
                           ▼
             FIGMA (canonical) — Product Designer promotes
             discovery:  MAY add components/variables
             production: screens + specs ONLY
                           │ sync
                           ▼
                    design/tokens/ ──▶ Engineers
```

### Modes

**`production` is the default.** Specify from the existing design system. Promotion to Figma may add screens and specs, and **may not mint a new component or variable**. Reuse is not a preference here; it is the rule.

**`discovery` is opt-in** and is the only route that uses Claude Design. It is warranted when:

- the surface has no existing pattern in the design system, or
- interaction or motion behavior is unspecified anywhere, or
- the shape of the solution is genuinely unknown, or
- Ryan or Head of Product has asked for options.

Promotion in discovery mode may extend the system — but only what the Steward's approval covers.

### Declaring the mode

The mode is declared by **Head of Product**, as a token on the Paperclip design issue:

```
DESIGN_MODE mode=production run=<RUN_ID>
DESIGN_MODE mode=discovery  run=<RUN_ID> reason=<why the design system does not already answer this>
```

It is deliberately **not** a field in `10-brief.json`: `brief.schema.json` sets `additionalProperties: false` and is parity-checked against the studio-810 mirror, so adding a field there would break the parity gate. Do not try to record the mode in `constraints[]` either — that field is for hard limits, and string-parsing it is not a gate.

**A candidate whose issue carries no `DESIGN_MODE` token is not reviewable.** Design Steward refuses it and asks Head of Product to declare the mode. A gate that silently defaults is not a gate.

**The Designer may not upgrade its own mode.** A proposer choosing its own scope defeats the whole arrangement. If a `production` task turns out to need new patterns, the Steward returns:

```
DESIGN_APPROVAL verdict=changes-requested mode=production run=<RUN_ID> escalate=mode-change
```

and Head of Product decides whether to re-declare it as discovery.

### The verdict

Design Steward ends every review with a first-line token, mirroring the repo's `QA_VERDICT` pattern:

```
DESIGN_APPROVAL verdict=approved         mode=<mode> run=<RUN_ID>
DESIGN_APPROVAL verdict=changes-requested mode=<mode> run=<RUN_ID>
```

followed by the human-readable review and its evidence. The `mode=` must echo the declared `DESIGN_MODE`. The verdict lives on the Paperclip issue rather than in a contract artifact, for the same parity reason as the mode token.

### Figma access is split on purpose

- **Product Designer holds Figma write.** It is the only agent that promotes to Figma, and the only one that runs the Figma → `design/tokens/` sync — the sole sanctioned path into the token mirror.
- **Design Steward holds Figma read only, and has no `GH_TOKEN`.** The reviewer must not be able to write the record it approves, and that is enforced by the credentials it does not have, not by this paragraph.

Neither agent may act outside that split, or ask another agent to act on its behalf.

### Order of operations

1. Head of Product declares the mode.
2. Product Designer produces the candidate — Claude Design in discovery, the existing DS in production. **Never straight into Figma.**
3. Design Steward reviews and emits the verdict.
4. **Only after `verdict=approved`**, Product Designer promotes to Figma, then syncs the token mirror.
5. Design Steward verifies Figma and the mirror match what it approved — and, in production mode, that no components or variables were added.
6. Product Designer writes `40-design-spec.json` and hands off to Engineering.

The drift gate is the mechanical backstop downstream: anything in `apps/` or `packages/` that does not resolve to a published token or design-system component fails the build. An unsanctioned Figma addition therefore surfaces at build time — late, and as someone else's failed run. Do not rely on it to catch what this chain is supposed to catch.
