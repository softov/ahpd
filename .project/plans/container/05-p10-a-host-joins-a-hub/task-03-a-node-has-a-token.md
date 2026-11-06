---
title: A node has a token, and nodes are a grant subject
status: done
depends: []
layer: "sdk | server"
refs:
  - "[code://packages/sdk/src/access/users.ts#L56-L79](../../../../packages/sdk/src/access/users.ts#L56-L79) - `SUBJECTS`"
  - "[code://packages/sdk/src/access/users.ts#L1227-L1259](../../../../packages/sdk/src/access/users.ts#L1227-L1259) - `verify`, a token kept as a hash and compared in constant time"
  - "[code://packages/server/src/commands/user.ts](../../../../packages/server/src/commands/user.ts) - the `user` commands, the pattern for the node ones"
---

## Objective

The hub keeps nodes in a file beside its users, each with a name and a token hash; `node:read` lists them and `node:write` adds one (answering its token once), removes one and drops its connection.

## Files

- `UPDATE: packages/sdk/src/access/users.ts:56-79` - `node` in `SUBJECTS`, a `node:` scheme with `node:read` and `node:write`, like `user:` and `team:`.
- `UPDATE: packages/sdk/src/nodes.ts` - the file, `add`, `remove`, `verify`.
- `CREATE: packages/server/src/commands/nodes.ts` - `ahpd node add|list|remove`, CLI and `/api`.
- `UPDATE: packages/server/test/server-commands.test.ts`.

## Steps

1. A token is shown once at `add` and only its hash is kept, as a user's.
2. A node token is refused on every door but the join path, and the join path asks for nothing else: not the deployment token, not a person's.

## Validation

- Add, list, remove; a removed node's token is refused; a node token on the ordinary door is refused.

## Resume

- **Implemented** 2026-10-30.
- `packages/sdk/src/nodes.ts` holds `fileNodes({ path, onProblem })`, the `Nodes` port, `NodeRecord`, `NodeFile` and `nodesFileOf(usersPath)`.
- The nodes file sits beside the users file: `users.json` answers `users.nodes.json`, as the tokens file already sits there. It has no flag or configuration key of its own, so `ahpd node` reads `--users` and the configuration's `users`.
- `add` mints 32 random bytes as base64url, writes `sha256:<hex>` and answers the token once. Adding a node that is already there keeps its place and replaces its token.
- `verify` hashes the token and compares every record with `same`, keeping the match rather than returning it, and answers the node's name.
- A file that will not parse reads as no nodes, says one line through `onProblem`, and refuses to be written over.
- `packages/sdk/src/access/users.ts` has `node` in `SUBJECTS` and `OPERATIONS.node` with `list`, `add` and `remove`, in the read and write groups.
- `packages/server/src/commands/nodes.ts` declares `node.list` (`node:read`), `node.add` and `node.rm` (`node:write`), on the CLI and under `/api`. The token goes to stdout alone and the sentence that it is shown once goes to stderr, as `user token` does.
- `docs/sdk/USERS.md` has the `node` row its table test asks for, because `test/users.test.ts` reads that table.
- `test/server-commands.test.ts` covers add, list, a replaced token, remove, a removed token refused, a node token refused by the people directory, and the grants on both surfaces.
- The token is refused on every door but the join path by construction: it is in no users file, so `fileUsers().verify` answers nothing for it, which one case asserts.
- **Left for later:** `node rm` does not drop the node's connection yet. Only a served `node rm` can, and the registry that holds the sockets is task 02's; its resume names the wiring.
