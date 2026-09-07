---
name: focx-design-figma
description: Build foundations and components in an assigned Figma file from an approved source of truth, discovery first, additively, with every visual property bound to a variable.
metadata:
  version: "0.1.0"
---

# focx-design-figma

A contracted procedure for the Product Designer role. It assumes the role file has been read.

## 0. Before any write

Produce a discovery record and write it to `pipeline/runs/<run-id>/design-discovery.json`:

- `fileKey` exactly as given in the task, and the file name the API reports for it
- every page with its node count
- every variable collection: name, modes, variable count
- every text style and effect style by name
- every component and component set by name
- `conflicts`: anything already present that the task did not lead you to expect

**If `conflicts` is non-empty, stop and report.** An unexpected design system in the target file is the single most likely way this role destroys work that is not yours.

## 1. Foundations before components

Variables first, then styles, then components. A component that binds to a variable cannot be built before it.

- Primitives carry raw values and take empty `scopes`, so they stay out of property pickers.
- Semantic tokens alias primitives. Never duplicate a raw value into the semantic layer.
- Set `scopes` explicitly on every variable. `ALL_SCOPES` pollutes every picker and is never correct.
- Set WEB code syntax on every variable, using the real CSS variable name from the source where one exists.

## 2. Components

One component at a time, in dependency order, simplest first. For each:

1. Build the base with auto-layout, every visual property bound to a variable.
2. Create the variant matrix. If Size x Style x State exceeds 30 combinations, split the component.
3. Position variants after combining them — they stack at the origin otherwise.
4. Add component properties for text and instance swaps. Never a variant per icon.
5. Read the structure back and capture a screenshot. Fix before continuing.

## 3. Evidence

Write to `pipeline/runs/<run-id>/`:

| File | Contents |
|---|---|
| `design-discovery.json` | the section 0 record, written before the first write |
| `design-result.json` | every created id by name, every validation performed, every conflict and its resolution |

Report ids, not descriptions. An id is checkable; "created the button" is not.

## 4. Stop conditions

Stop and report, rather than proceeding, when:

- the target file contains anything the task did not lead you to expect
- a value you need is absent from the source of truth (that is a gap for Ryan, not a value to invent)
- a write would remove or alter something you did not create in this run
- validation after a step does not match what you intended
