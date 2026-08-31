# Connect

The first focx.ai sub-application. A web app today; native iOS, iPadOS, and macOS targets will land as sibling directories (`apps/connect-apple/`) without restructuring.

Deliberately empty in Phase 1: **the app scaffold is itself built by the pipeline in Phase 2**, as the first proof that a run can go from trigger → design spec → drift-free build → previewable PR. Nothing here is hand-built ahead of that proof.

When it exists, this app consumes `@focx/design-connect` exclusively — see [`AGENTS.md`](../../AGENTS.md) and [`docs/drift-gate.md`](../../docs/drift-gate.md).
