---
name: focx-reconcile-truth
description: Reconcile Focx architecture or documentation claims with current code, approved decisions, and pinned legacy evidence.
metadata:
  version: "0.1.0"
---

# focx-reconcile-truth

For the assigned concern, identify the canonical source in docs/sources-of-truth.md. Compare claims at recorded revisions, separating implemented behavior from desired behavior. A later timestamp alone does not establish authority.

Classify each disputed claim as active, superseded, retired, or unknown. Include source path and revision, contradictory evidence, proposed disposition, and the owner decision required. The legacy recovery branch supplies evidence of intent; copying its prompt or declaring all its behavior active is not adoption.

Propose the smallest canonical edit that resolves the contradiction. Keep historical evidence in place and link it; do not clone whole document trees into current context. When authorized to edit documentation, prepare a reviewable change and ask independent QA to be initiated by Ryan. Do not approve your own proposal or invent missing product decisions.
