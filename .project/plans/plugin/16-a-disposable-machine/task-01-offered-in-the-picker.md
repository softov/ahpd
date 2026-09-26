---
title: A disposable profile is offered in the picker
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L297-L321](../../../../packages/computer/src/plugin.ts#L297-L321) - the answerer"
---

## Objective

The `computer` answerer adds a `disposable:<profile>` row, labelled with the profile's title, for every profile with `disposable: true`.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - `disposable`, `disposableDelay`, `disposableAlone`.
- `UPDATE: packages/computer/src/plugin.ts` - the rows.

## Steps

1. Validate the three fields; `disposableDelay` defaults to 300000.

## Validation

- The answerer test shows the row, and not for a profile without the flag.

## Resume
