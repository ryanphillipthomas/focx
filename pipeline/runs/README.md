# pipeline/runs/

These are per-run evidence, not startup context or current product policy.
Follow the [context and evidence policy](../org/instructions/_preamble.md#context-and-evidence-policy).
Broad ripgrep searches omit run records; retrieve an assigned or relevant run
explicitly with `rg --no-ignore <pattern> pipeline/runs/<run-id>/`. Required
artifacts, validation and evidence retention are unchanged.

One directory per run, named by run ID (`run-<UTC yyyymmdd-HHMMSS>-<trigger>`), created on the run branch (`run/<run-id>`) — never directly on `main`. Run directories reach `main` only when their PR is merged by a human, which is what makes this the permanent audit trail.

Expected contents, in stage order (see [`docs/pipeline.md`](../../docs/pipeline.md)):

```
pipeline/runs/run-20260830-142201-ticket/
├── 00-run.json            # intake: run manifest
├── 10-brief.json          # Chief
├── 20-product-spec.json   # Product
├── 30-research.json       # Research (absent when skipped)
├── 40-design-spec.json    # Design
├── 50-build-report.json   # Engineer
├── 60-qa-verdict.json     # QA
└── evidence/              # QA screenshots and check outputs
```

Every file validates against its schema in [`pipeline/contracts/`](../contracts/). If a decision is not in an artifact, it didn't happen.
