---
title: Roles and the docs speak in operations
status: done
depends: [task-02-every-method-and-action-needs-one-operation.md, task-03-the-host-advertises-its-subjects.md]
layer: "sdk, server, docs"
refs:
  - "[code://packages/sdk/src/people.ts#L236-L268](../../../../packages/sdk/src/people.ts#L236-L268) - the `role:` scheme's description and manifest, which say `<subject>:<verb>`"
  - "[code://packages/server/src/commands/user.ts#L34-L41](../../../../packages/server/src/commands/user.ts#L34-L41) - `bounded`"
  - "[code://docs/USERS.md#L356-L401](../../../../docs/USERS.md#L356-L401) - the grants section"
  - "[code://packages/sdk/test/people.test.ts](../../../../packages/sdk/test/people.test.ts) - the `role:` write cases"
---

## Objective

A role written through `role://` or the `users` file may hold operations, a malformed one is refused with the subject's operations named, and `docs/USERS.md` lists every subject's operations and groups.

## Files

- `UPDATE: packages/sdk/src/people.ts:236-268` - the description says `<subject>:<operation>`, with `read`, `write` and `*` as groups; a grant `isGrant` refuses is refused with `-32602` naming the subject's operations from `OPERATIONS`.
- `UPDATE: docs/USERS.md:356-401` - the table of subjects, operations and groups from task 02, the chat cover, and one example role of operations; a sentence that `read` and `write` are only ever groups, `get` and `put` the one-resource operations, and that a role written before this plan keeps its meaning.
- `UPDATE: docs/USERS.md:471-473` - the people schemes advertise `get` and `put` among their operations, and the advertised words are the grant's words (`user:get` reads one record, `user:read` the whole group).
- `UPDATE: packages/sdk/test/people.test.ts` - the cases below.
- `UPDATE: packages/server/test/server-http.test.ts` - the `bounded` case below.

## Steps

1. Write `role://senders` with `{ grants: ['session:read', 'chat:send'] }` in a test and read it back unchanged.
2. Refuse `session:launch` with a message listing `session`'s operations. A role naming `file:get` or `user:put` is taken.
3. `bounded` is not changed: a person holding `chat:send` and not `chat:write` cannot hand out `chat:write`, and can hand out `chat:send`.
4. The docs table is written by hand from `OPERATIONS`, and a test in `packages/sdk/test/users.test.ts` reads `docs/USERS.md` and fails when a subject or operation in `OPERATIONS` is missing from it.

## Validation

- `packages/sdk/test/people.test.ts`: the write and read back; the refusal names `dispose`; `role://readers` with `{ grants: ['user:get', 'file:read'] }` is written and read back unchanged.
- `packages/server/test/server-http.test.ts`: an actor holding `chat:send` adds a user with a role of `['chat:send']` and is refused one of `['chat:write']` with `403`.
- `packages/sdk/test/users.test.ts`: the docs check passes, and fails when a row is deleted from `docs/USERS.md`.
- `pnpm test` passes.

## Resume
