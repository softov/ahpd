---
title: The host reads secret
status: done
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/channels/owners.ts](../../../../packages/sdk/src/channels/owners.ts) - the two helpers"
  - "[code://packages/sdk/src/plugins/validate.ts](../../../../packages/sdk/src/plugins/validate.ts) - the sign-in check and the gap lines"
---

## Objective

The host moves a field to the vault when its schema says `secret: true`.
It still does so for `writeOnly: true` with no `secret`, and the plugin's load gives a problem line for it.

## Files

- `UPDATE: packages/sdk/src/channels/owners.ts:128-170` - adds `isSecret(node)`, and renames `writeOnly` to `secretFields` and `writeOnlyPaths` to `secretPaths`, both read through `isSecret`.
- `UPDATE: packages/sdk/src/index.ts:118` - exports `secretPaths` and `isSecret` in place of `writeOnlyPaths`.
- `UPDATE: packages/sdk/src/connectors/channel.ts:15-80` - imports and comments name `secret`.
- `UPDATE: packages/sdk/src/connectors/channel.ts:674-775` - the three calls use `secretFields`.
- `UPDATE: packages/sdk/src/agents/channel.ts:10-51` - imports and comments name `secret`.
- `UPDATE: packages/sdk/src/agents/channel.ts:227-231` - the call uses `secretPaths`.
- `UPDATE: packages/sdk/src/plugins/validate.ts:638-657` - a sign-in field must be one `secretFields` names, and the message says `secret`.
- `UPDATE: packages/sdk/src/plugins/validate.ts:118-130` - `checkAgent` adds a gap for each vault field marked `writeOnly` with no `secret`.
- `UPDATE: packages/sdk/src/plugins/validate.ts:673-760` - `checkAdapter` and `checkEngine` add the same gap.
- `UPDATE: packages/sdk/src/types/connectors.ts:265-340` - the comments name `secret`.
- `UPDATE: packages/sdk/src/types/agents.ts:47` - the comment names `secret`.
- `UPDATE: packages/sdk/src/types/host.ts:740` - the comment names `secret` beside `writeOnly`.
- `UPDATE: packages/server/src/agents/migrate.ts:40-481` - the migration uses `secretPaths`.
- `UPDATE: packages/sdk/test/owners-nested-secrets.test.ts` - `secret`, the `writeOnly` fallback and `secret: false`.
- `UPDATE: packages/sdk/test/connectors-signin.test.ts` - a sign-in field marked `secret`.
- `UPDATE: packages/sdk/test/schema-gaps.test.ts` - the gap for a `writeOnly` vault field.

## Steps

1. Write `isSecret(node)`: true for `secret: true`, and true for `writeOnly: true` when `secret` is absent.
2. Rename `writeOnly` to `secretFields` and `writeOnlyPaths` to `secretPaths`, and make both read `isSecret`.
3. Change every caller and the export in `index.ts`.
4. Make the sign-in check accept a field that `secretFields` names, and say `secret` in its message.
5. Write a helper in `validate.ts` that walks a schema like `secretPaths` and lists each `writeOnly` node with no `secret`.
6. Add one gap for each such node in `checkAgent`, `checkAdapter` and `checkEngine`, with the reason `writeOnly kept in the vault; mark it secret`.
7. Change the comments that say a `writeOnly` field goes to the vault.
8. Change the existing tests that call the old names, and write the new tests.

## Validation

- `owners-nested-secrets.test.ts`: `secretPaths` finds `secret: true` at the top and under `env`, and finds `writeOnly: true` alone; it skips `secret: false` with `writeOnly: true`.
- `connectors-signin.test.ts`: the check accepts a sign-in field marked `secret`.
- `schema-gaps.test.ts` or a new validate test: an adapter with a `writeOnly` key loads with one gap line.
- Run `pnpm typecheck` and `pnpm test`.

## Resume

