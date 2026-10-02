---
title: The docs name the usage subject, the scheme and the command
status: todo
depends: [task-03-usage-timezone-and-the-command.md]
layer: "docs"
refs:
  - "[code://docs/USERS.md#L356-L397](../../../../docs/USERS.md#L356-L397) - the grant subjects and the roles, where `usage` is a row"
  - "[code://docs/PLUGINS.md#L87](../../../../docs/PLUGINS.md#L87) - the `registerUsage` row and the members it lists"
  - "[code://docs/DAEMON.md#L412-L427](../../../../docs/DAEMON.md#L412-L427) - the configuration keys, where `usage` is described"
  - "[code://docs/DAEMON.md#L512-L520](../../../../docs/DAEMON.md#L512-L520) - what each command needs over `/api`"
---

## Objective

`docs/USERS.md` lists `usage` beside the other subjects and says what a person reads without it, `docs/DAEMON.md` describes `usage.timezone` and `ahpd usage`, and `docs/PLUGINS.md` names the calls a usage store must answer.

## Files

- `UPDATE: docs/USERS.md:363-372` - the subject table, and the paragraph under it that says how a scheme's subject is discovered.
- `UPDATE: docs/DAEMON.md:412-427` - the `usage` configuration key paragraph.
- `UPDATE: docs/DAEMON.md:512-520` - the `/api` command table.
- `UPDATE: docs/PLUGINS.md:87` - the `registerUsage` row.
- `UPDATE: .project/plans/usage/00-usage.md` - the runtime path, the contracts and the tests.
- `UPDATE: .project/plans/index.md:251` - the `usage 04` row.

## Steps

1. A `usage` row in the `docs/USERS.md` table, with `read` and no `write` beside it, saying what it covers: what each pool has been charged and the records charged to it.
2. Under it, one sentence of the rule the plan's decision settles: a person reads their own `user:` pool and the `team:` and `project:` pools they are a member of without the grant, and anything else is `usage:read`.
3. In `docs/DAEMON.md`, `usage.timezone` beside the `per` the paragraph already describes, saying what it changes: the midnight a day starts at and the Monday a week starts on, with the system's own zone when the key is absent.
4. The three URIs the scheme serves and what each answers, in the same paragraph, so a client is told what to ask for rather than only that something is there.
5. A row in the `/api` command table for `usage`, saying what it needs as the command really needs it: their own pools for a person, every pool for `usage:read`, which is not the flat pair every other row carries.
6. `docs/PLUGINS.md:87` names all four calls on the port, `record`, `total`, `pools` and `records`, since a plugin that answers two of them is no longer a `Usage`.
7. `.project/plans/usage/00-usage.md` gains the read half of the runtime path, from the resource calls to the provider to the store, and names `packages/sdk/test/usage-scheme.test.ts` under Tests.
8. `.project/plans/index.md:251` carries what is true when this task lands: the plan's status, and `implemented.md` once there is one.

## Validation

- Read by hand: every URI, key and command named here is one the code answers, and no grant named in `docs/USERS.md` is one `packages/sdk/src/users.ts:40` does not list.
- `pnpm test`, which runs `tools/schema.mjs` over the configuration schema `usage.timezone` joined.

## Resume
