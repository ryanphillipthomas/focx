---
name: focx-design-extract
description: Turn an existing interface into a proposed token set — from served source where it exists, from screenshots only where it does not — and stop for a human before anything is written to Figma.
metadata:
  version: "0.1.0"
---

# focx-design-extract

The intake flow. It produces a **proposal**, never a Figma write. `focx-design-figma` is the flow that writes, and it runs only after a human has accepted what this one produced.

## 1. Prefer source over pixels, always

A screenshot is the fallback, not the method. Ranked:

1. **Served CSS and markup** — exact values, no inference. Parse the stylesheet; count every declaration.
2. **A design-token file, Tailwind config, or theme object** in a repository.
3. **A rendered DOM** you can query for computed styles.
4. **Screenshots only** — when nothing above exists: a competitor's product, a PDF, a photograph of a whiteboard.

Record which tier you used in the artifact. A value read from source is a fact. A value sampled from a screenshot is an estimate, and must be labeled one — never mixed into the same list unmarked.

## 2. Never eyeball what you can count

Extract mechanically and report totals: N declarations across M selectors. Then, for each family, produce **both** the raw inventory and the analysis:

- **Colour** — every literal, with usage count. Cluster them: near-identical values are almost always one intended colour re-picked by eye, not a deliberate step.
- **Spacing** — every value with frequency. Check for a base unit. If most values are not divisible by 2 or 4, say plainly that there is no scale rather than inventing one.
- **Type** — sizes with frequency and the ratio between consecutive steps. A varying ratio means no modular scale.
- **Radius, shadow, motion, breakpoints** — inventory and count.

## 3. Separate the scale from the one-offs

This is the section that makes the extraction worth anything. For every family, state which it is:

| Verdict | Meaning |
|---|---|
| **ramp** | deliberate steps; carry across unchanged |
| **continuum** | every value used, no skipped step; needs re-deciding, not mapping |
| **one-off** | no two values related; each is a separate decision |

Quantify it. "148 opaque colours collapse to 58 at an imperceptible distance" is a finding. "The colours are inconsistent" is not.

## 4. Report what is already broken

Extraction routinely finds defects worth fixing rather than importing:

- declared tokens that are never referenced
- values hard-coded alongside a token that already holds them
- states the interface never implements (error, loading, disabled, empty)
- styling for components that are never rendered

## 5. Evidence and the stop

Write to `pipeline/runs/<run-id>/`:

| File | Contents |
|---|---|
| `design-extract.json` | source tier, totals, per-family inventory with counts |
| `design-proposal.md` | the proposed token set, and every scale-vs-one-off verdict with its evidence |

**Then stop.** Proposing a spacing ramp where the source had none is a design decision, and it belongs to Ryan. Do not open a Figma file. Do not create a variable. Hand over the proposal and report.
