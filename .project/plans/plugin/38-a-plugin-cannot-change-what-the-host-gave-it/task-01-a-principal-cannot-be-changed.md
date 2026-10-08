---
title: A principal cannot be changed once the host builds it
status: todo
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/users.ts#L782-L810](../../../../packages/sdk/src/users.ts#L782-L810) - the principal a person's token gets"
  - "[code://packages/server/src/commands/authorize.ts#L29-L33](../../../../packages/server/src/commands/authorize.ts#L29-L33) - `ROOT`"
  - "[code://packages/sdk/src/host/resourcemethods.ts#L74-L92](../../../../packages/sdk/src/host/resourcemethods.ts#L74-L92) - providers get `connection.principal`"
  - "[code://packages/sdk/src/host/admission.ts#L206-L231](../../../../packages/sdk/src/host/admission.ts#L206-L231) - `authorize` runs before `who.can`"
---

## Objective

Every principal the host builds is frozen, so a provider that gets one cannot replace `can`, `id`, `trusted` or `standing`, or redefine a getter.

## Files

- `CREATE: packages/sdk/src/frozen.ts` - `frozenCopy(value)`: `structuredClone` then deep `Object.freeze`; exported for the other tasks.
- `UPDATE: packages/sdk/src/users.ts:782-810` - the returned literal is passed through `Object.freeze`; the getters still re-read the file.
- `UPDATE: packages/server/src/commands/authorize.ts:29-33` - `ROOT` and its `roles` are frozen.
- `UPDATE: every other principal literal` - find them with `rg "can: " packages/*/src` and `rg ": Principal" packages/*/src`; each is frozen where it is built.
- `CREATE: packages/sdk/test/plugin-boundary.test.ts` - the cases below; tasks 02-04 add theirs here.

## Steps

1. Write `frozenCopy` and its unit test: nested objects and arrays are frozen, the source is untouched.
2. Write the tests below; they fail.
3. Freeze each principal where it is built.
4. Run the full suite; a host or plugin site that wrote to a principal is fixed at that site.

## Validation

- A provider whose `authorize` sets `who.can = () => true` throws, and the same command is still refused `bot:get`.
- A provider whose `read` sets `reader.id = 'bob'` throws, and the connection's next session is still owned by the reader.
- `Object.defineProperty(reader, 'memberships', ...)` throws.
- `ROOT.can = ...` throws.
- `npx vitest run packages/sdk packages/server` passes.

## Resume
