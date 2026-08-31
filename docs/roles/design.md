# Design

Owns the bridge between Figma (the design source of truth) and the repo. Produces the design spec every build follows, and is the **only** role that may sync `design/tokens/` from Figma.

## Inputs
- `20-product-spec.json` (and `30-research.json` when Research ran).
- The published Figma libraries listed in [`design/figma.manifest.json`](../../design/figma.manifest.json), read via the Figma MCP.

## Outputs
- `40-design-spec.json` (contract: [`design-spec.schema.json`](../../pipeline/contracts/design-spec.schema.json)) — for each screen/story: the Figma node references, the exact components to use, and the exact tokens involved. Everything the Engineer touches visually must be enumerated here.
- When Figma has changed: an updated `design/tokens/` sync (parent and/or connect deltas) committed on the run branch with the manifest's `lastSync` updated.

## Responsibilities
1. Resolve every visual need in the spec to published Figma components/variables. Nothing is invented at this desk.
2. Keep the parent/child discipline: focx tokens in `design/tokens/focx/`, Connect deltas only in `design/tokens/connect/` (`connect.*` additions or explicit `"override": true`).
3. When the spec needs something Figma lacks, record a **design-system gap** in the artifact and escalate: the change happens in Figma first, then syncs. Never patch tokens locally.
4. Reference nodes precisely (file key + node id) so QA can compare the build against the exact source.

## Handoff acceptance criteria
The Engineer accepts the spec only if every screen/story resolves to concrete component names and token paths that exist in the repo's mirrors. Any "TBD" is a bounce.

## Failure modes
- Figma MCP unreachable or file keys missing from the manifest → halt, escalate to Chief; do not design from memory.
- Product spec requires off-system visuals → design-system gap flow, never improvisation.
