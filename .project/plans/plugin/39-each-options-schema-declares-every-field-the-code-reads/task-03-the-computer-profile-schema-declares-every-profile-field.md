---
title: The computer profile schema declares every profile field
status: todo
depends: []
layer: computer
refs:
  - "[code://packages/computer/src/plugin.ts#L98-L133](../../../../packages/computer/src/plugin.ts#L98-L133) - the `profiles` schema"
  - "[code://packages/computer/src/plugin.ts#L179-L240](../../../../packages/computer/src/plugin.ts#L179-L240) - `profilesOf`, the fields a profile holds"
---

## Objective

`profiles.additionalProperties.properties` declares each of the 16 fields that `profilesOf` reads and the schema leaves out.

## Files

- `UPDATE: packages/computer/src/plugin.ts:98-133` - add `title`, `description`, `image`, `cpus`, `memory`, `workdir`, `mounts`, `agents`, `folder`, `host`, `disposable`, `disposableDelay`, `disposableAlone`, `sessionFolder`, `sessionRepository` and `sessionTree`, each with a description and no type.
- `UPDATE: packages/computer/README.md` - correct a `profiles.<name>` row only where it disagrees with the description.
- `CREATE: packages/computer/test/computer-options-schema.test.ts` - the schema test.

## Steps

1. Read the comment and the default of each of the 16 fields in `profilesOf` and `defaults`.
2. Add one property for each to `profiles.additionalProperties.properties`, with a description that names its type and default.
3. Write a test that each field `profilesOf` returns is a property of the profile schema.
4. Write a test that a profile with `cpus: 2` loads, and the profile keeps no `cpus`.
5. Compare each new description with its README row, and correct the README where they differ.

## Validation

- `computer-options-schema.test.ts` holds the two cases above.
- `pnpm build`, `pnpm typecheck` and `npx vitest run packages/computer` pass.

## Resume
