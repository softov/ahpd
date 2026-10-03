---
title: A node has a token, and nodes are a grant subject
status: todo
depends: []
layer: "sdk | server"
refs:
  - "[code://packages/sdk/src/users.ts#L40-L54](../../../../packages/sdk/src/users.ts#L40-L54) - `SUBJECTS`"
  - "[code://packages/sdk/src/users.ts#L632-L640](../../../../packages/sdk/src/users.ts#L632-L640) - `verify`, a token kept as a hash and compared in constant time"
  - "[code://packages/server/src/commands/user.ts](../../../../packages/server/src/commands/user.ts) - the `user` commands, the pattern for the node ones"
---

## Objective

The hub keeps nodes in a file beside its users, each with a name and a token hash; `node:read` lists them and `node:write` adds one (answering its token once), removes one and drops its connection.

## Files

- `UPDATE: packages/sdk/src/users.ts:40-54` - `node` in `SUBJECTS`, a `node:` scheme with `node:read` and `node:write`, like `user:` and `team:`.
- `UPDATE: packages/sdk/src/nodes.ts` - the file, `add`, `remove`, `verify`.
- `CREATE: packages/server/src/commands/nodes.ts` - `ahpd node add|list|remove`, CLI and `/api`.
- `UPDATE: packages/server/test/server-commands.test.ts`.

## Steps

1. A token is shown once at `add` and only its hash is kept, as a user's.
2. A node token is refused on every door but the join path, and the join path asks for nothing else: not the deployment token, not a person's.

## Validation

- Add, list, remove; a removed node's token is refused; a node token on the ordinary door is refused.

## Resume
