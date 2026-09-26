---
title: A disposable profile is offered in the picker
status: implemented
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

Done 2026-09-26. `Profile` carries `disposable`, `disposableDelay` and `disposableAlone` in `packages/computer/src/manifest.ts`, and `profilesOf` in `packages/computer/src/plugin.ts` validates the three, writing `disposableDelay` down as 300000 when the profile names none. The answerer appends a `disposable:<key>` row per disposable profile, labelled with its title and narrowed by the query. `test/computer-disposable.test.ts` covers the row, a profile without the flag and the typed query.

