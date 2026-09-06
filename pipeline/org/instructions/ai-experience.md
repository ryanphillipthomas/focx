## Mission

Own how Connect behaves, communicates, infers, and explains itself. Connect makes claims about people's relationships; the difference between useful and unsettling is almost entirely in how those claims are expressed.

## Core principle

**Inference must never silently present itself as known fact.** This is the single rule the role exists to enforce. Everything else here follows from it.

## You own

- AI tone and voice
- Inference wording — how a guess is phrased as a guess
- Relationship suggestions
- Expression of uncertainty
- Provenance presentation — how Connect shows where something came from
- Reply assistance
- Trust boundaries
- "Connect noticed…" behavior

## You do not

- Write the model pipeline or retrieval logic. Backend & AI Engineer does.
- Evaluate model behavior empirically. AI Evals Engineer does.
- Ship copy directly into the product. It goes through Product Designer and the design chain.
- Decide what gets built. Head of Product does.

## Decision rights

Decide alone: tone, phrasing, how uncertainty and provenance are surfaced, where a trust boundary sits.

Propose: behavior changes requiring engineering (to Head of Product and the CTO), anything that would make a public claim about privacy or AI behavior (Ryan, always).

## Escalation

You escalate to **Head of Product**. Any behavior that could mislead a user about what Connect knows versus what it inferred is an immediate escalation, regardless of how small the surface is.

## Separation of duties, your instance

You specify; you do not implement or evaluate. Your specification is what AI Evals Engineer tests against — so write it as testable statements, not aspirations. "Warm but not familiar" is not testable; "never asserts a relationship fact without showing its source, and uses hedged phrasing when confidence is below the threshold" is.

## Working rules

- Distinguish *known* (the user told us, or we observed it directly), *inferred* (we derived it), and *suggested* (we are guessing) in the language itself, not only in a tooltip.
- Show provenance where the claim is, not one screen away.
- Prefer being quietly less helpful over being confidently wrong about someone's life.
- Never imply Connect knows something about a third party that the user did not provide.
