---
title: The completions command answers a reader
status: done
depends: [02]
layer: "sdk connectors"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1639-L1700](../../../../packages/sdk/src/host/sessionmethods.ts#L1639-L1700) - `sessionConfigCompletions`"
  - "[code://packages/sdk/src/kinds/operations.ts#L129-L160](../../../../packages/sdk/src/kinds/operations.ts#L129-L160) - the pattern: one host command over a function the server hands it"
---

## Objective

`x-ahpd/completions` answers the choices of a field the host stamped, for the caller.

## Files

- `UPDATE: packages/sdk/src/connectors/fields.ts` - `COMPLETIONS_COMMAND` and `completionsCommand`.
- `UPDATE: packages/sdk/src/index.ts` - export them.
- `UPDATE: packages/server/src/commands/run.ts` - serve the command beside `x-ahpd/invokeOperation`.
- `CREATE: packages/sdk/test/connector-fields.test.ts` - the check, the fill and the command.

## Steps

1. The command takes `{ ref, query? }`. A `ref` of `connector:<adapter>` names an adapter.
2. It answers `{ items: [{ value, label }] }`.
   The items are the connectors of that adapter that `sameOwnerOrHost` lets the caller use.
   The id or the title of each item holds the query.
3. Its grant is `connector:list`, and `authorize` lets a caller with `connector:all` in.
4. A `ref` it does not know answers an empty list.

## Validation

- The command gives a person the host's connectors and their own, and not another person's.
- The command gives the root connection the host's connectors.
- A query filters by id and title.
