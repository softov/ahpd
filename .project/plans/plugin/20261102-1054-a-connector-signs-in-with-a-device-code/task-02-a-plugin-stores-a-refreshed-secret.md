---
title: A plugin stores a refreshed secret
status: todo
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/connectors/channel.ts#L955-L990](../../../../packages/sdk/src/connectors/channel.ts#L955-L990) - `note`, whose grant, owner rule and plugin check the new command copies"
  - "[code://packages/sdk/src/connectors/channel.ts#L15-L19](../../../../packages/sdk/src/connectors/channel.ts#L15-L19) - a secret field's vault path, `connector/<id>/<field>` in the owner's scope"
  - "[code://packages/sdk/src/connectors/channel.ts#L1054-L1062](../../../../packages/sdk/src/connectors/channel.ts#L1054-L1062) - the command table"
  - "[code://packages/sdk/test/connectors-channel.test.ts](../../../../packages/sdk/test/connectors-channel.test.ts) - the `note` tests, which the new tests copy"
---

## Objective

`x-ahpd/connectors/secret { id, values }` replaces secrets of one open connector in the vault.
Only the plugin that registered the connector's adapter sends it, so a refreshed token reaches the vault with no new sign-in.

## Files

- `UPDATE: packages/sdk/src/connectors/channel.ts:955-990` - add the `secret` command beside `note`, with the same grant, owner rule and plugin check.
- `UPDATE: packages/sdk/src/connectors/channel.ts:1054-1062` - add `[SECRET]` to the command table.
- `UPDATE: packages/sdk/src/connectors/channel.ts:15-50` - describe the command in the file's head comment.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - the command's cases.
- `UPDATE: docs/plugins/PLUGINS.md:1508` - a table row for `x-ahpd/connectors/secret`, after `note`.

## Steps

1. Add a `SECRET` name for `x-ahpd/connectors/secret`, and a `secretCall` method with grant `connector:put`.
2. Copy `note`'s `authorize`, its owner refusal and its check that the reader is the adapter's plugin.
3. Refuse a connector that is not open.
4. Refuse an empty `values`, and a key the adapter's schema does not mark secret.
5. Refuse a value that is not a non-empty string.
6. Write each value to the vault under `connector/<id>/<field>` in the owner's scope, as the put does.
7. Write the record only when a field had no `$secret` reference yet.
8. Do not reopen the connector, because the plugin already holds the new value.
9. Answer the row, which carries no secret.
10. Add the command to the head comment and to `PLUGINS.md`.
11. Say there that no answer, error or log carries a value.

## Validation

- `packages/sdk/test/connectors-channel.test.ts` holds: the adapter's plugin replaces a secret, and the vault holds the new value.
- The same file refuses another plugin, a person's connector and a closed connector.
- The same file refuses a field not marked secret and an empty value.
- The same file holds: the answer, the error and the log carry no value.
- `pnpm --filter @ahpd/sdk test -- connectors-channel` passes.
- `pnpm typecheck` passes.

## Resume
