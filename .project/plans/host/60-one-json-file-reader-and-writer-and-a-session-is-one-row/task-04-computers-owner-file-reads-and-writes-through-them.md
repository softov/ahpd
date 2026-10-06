---
title: Computer's owner file reads and writes through them
status: todo
depends: [task-01-one-json-file-reader-and-one-atomic-writer.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/owners.ts#L117-L138](../../../../packages/computer/src/owners.ts#L117-L138) - `read`"
  - "[code://packages/computer/src/owners.ts#L157-L171](../../../../packages/computer/src/owners.ts#L157-L171) - `write`"
  - "[code://packages/computer/package.json#L58](../../../../packages/computer/package.json#L58) - the peer range host 59 task 05 raises"
---

## Objective

Computer's owner file is read with the shared reader and written with the shared writer, saying what it says today.

## Files

- `UPDATE: packages/computer/src/owners.ts:117-138` - `missing` is `{}`; `unreadable`, `not-json` and `not-object` each `complain(log, 'could not read', ...)` as now.
- `UPDATE: packages/computer/src/owners.ts:157-171` - `writeJsonAtomic(path, held)` inside the same `try`.

## Steps

1. Start only once host 59 task 05 has raised computer's `@ahpd/sdk` peer range to a version that exports `jsonfile.ts`; if host 59 has not landed, raise it here to the same version and say so in this task's Resume.

## Validation

- A pure refactor: `computer-owner.test.ts` and the rest of `packages/computer/test` stay green unchanged.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test packages/computer`.

## Resume
