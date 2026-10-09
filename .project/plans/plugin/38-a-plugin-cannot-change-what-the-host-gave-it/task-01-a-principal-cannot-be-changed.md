---
title: A principal cannot be changed once the host builds it
status: implemented
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

Implemented 2026-10-08. `packages/sdk/src/frozen.ts` is new and holds the plan's one helper: `frozenCopy` (`structuredClone`, then a deep `Object.freeze`) and `deepFreeze`, which freezes in place with a `WeakSet` guard so a cycle is walked once. `packages/sdk/test/plugin-boundary.test.ts` is new, and opens with the helper's own case and the principal cases below; tasks 02 to 04 add theirs to the same file.

Every principal the host builds is frozen where it is built, so a provider gets a read-only one whichever road reached it. `users.ts`'s `verify` returns `Object.freeze({...})`, and its `memberships`, `primary`, `projects` and `teams` getters still re-read the file, which freezing an accessor does not stop. `ROOT` in `packages/server/src/commands/authorize.ts` freezes the principal and its `roles` with it. `read`, `write` and `remove` all get `connection.principal`, so the one freeze covers the three roads plugin/37 opened.

Nothing else in the two `src` trees built a principal: `rg "can: \(" packages/*/src` answers `users.ts:804` and `ROOT`, and both are frozen.

Verified: `npx vitest run packages/sdk/test/plugin-boundary.test.ts` - 8 passed at this task's end (the helper, a write from `read`, from `write` and from `remove`, `Object.defineProperty` on the reader, `authorize`, the session that stays owned by `user:ana`, and `ROOT` with its `roles`).

**Review round, 2026-10-08.** The freeze was one level deep at two sites, and `roles` is the level that decides a grant. `packages/sdk/src/users.ts` now builds the directory's principal as `roles: Object.freeze([...record.roles, ...fromIssuer])`, the way `ROOT` already did. `packages/sdk/src/host.ts` gained `heldPrincipal(who)`, which freezes a principal's `roles` array when it is an array and then the principal, and it is what `accept` puts on the connection: an embedder hands the host its own literal, and this is the last place the host sees it before a provider is handed it. It freezes in place rather than spreading, because a principal the directory built carries getters that re-read the file. Two cases were added to `plugin-boundary.test.ts` and both failed before the fix: `freezes the roles a person signed in with, which no provider may add to` (the directory's own answer, and the same push from a provider at `read`) and `freezes the principal an embedder hands its host, roles and all`.
