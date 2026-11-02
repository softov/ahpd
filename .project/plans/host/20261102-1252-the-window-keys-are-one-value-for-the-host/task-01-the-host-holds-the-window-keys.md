---
title: The host holds the window keys
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/gate.ts#L301-L368](../../../../packages/sdk/src/host/gate.ts#L301-L368) - the grant a push needs, and `PER_CONNECTION`"
  - "[code://packages/sdk/src/host/actions.ts#L339-L411](../../../../packages/sdk/src/host/actions.ts#L339-L411) - where a push is kept"
  - "[code://packages/sdk/src/host/spawn.ts#L887-L968](../../../../packages/sdk/src/host/spawn.ts#L887-L968) - trust and approvals"
---

## Objective

A push of a window key sets the host's one value, which every client reads and every reader on the host uses.
A push of a window key needs `config:change`, and a push of `workspaceTrust` alone needs `trust:push`.

## Files

- `UPDATE: packages/sdk/src/host/gate.ts:272-368` - the root branch of `dispatchNeeds`, and `PER_CONNECTION` goes.
- `UPDATE: packages/sdk/src/host/actions.ts:123-411` - a push keeps every key but the daemon's in `rootConfig`.
- `UPDATE: packages/sdk/src/host.ts:628-738` - `seenBy` sends one echo of a push to every connection.
- `UPDATE: packages/sdk/src/host/root.ts:148-717` - `rootFor` reads the root state alone, and the comments say whose the keys are.
- `UPDATE: packages/sdk/src/host/snapshots.ts:19-270` - `snapshotOf` takes no connection's own values.
- `UPDATE: packages/sdk/src/host/handshake.ts` - three subscribes call `snapshotOf` with the connection alone.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:421` - the subscribe calls `snapshotOf` with the connection alone.
- `UPDATE: packages/sdk/src/host/spawn.ts:887-968` - `trustedBy` and `getAutoApproval` read `rootConfig`.
- `UPDATE: packages/sdk/src/host/trust.ts:1-230` - `requireTrust` reads the host's trust, handed to it as `trust`.
- `UPDATE: packages/sdk/src/host/chatactions.ts:724` - a new folder's question carries the host's trust.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:930-960` - a move's question carries the host's trust.
- `UPDATE: packages/sdk/src/host/terminals.ts:125-470` - a client's terminal opens the host's shell.
- `UPDATE: packages/sdk/src/types/host.ts:1245-1260` - `Connection.config` goes.
- `UPDATE: packages/sdk/src/access/commandautoapprover.ts:436-444` - `isRegexRuleKey` goes with the gate's last use of it.
- `UPDATE: packages/sdk/src/access/users.ts` - the `trust` subject says whose answer it pushes.
- `UPDATE: packages/sdk/src/vscoderootconfig.ts:17-41` - the keys this host acts on, and whose they are.
- `UPDATE: packages/sdk/src/types/terminals.ts:28-33` - the shell a client's terminal opens.
- `UPDATE: packages/sdk/src/machines/terminals.ts:96-104` - `shellOf`'s `asked`.
- `UPDATE: packages/sdk/src/host/owners.ts:128-138` - `sentBy`, the window a folder is asked of.
- `UPDATE: packages/sdk/test/root-config.test.ts` - the keys read by every client, and their grant.
- `UPDATE: packages/sdk/test/users-gate-dispatch.test.ts` - the grants, the shell for every client, and the echo.
- `UPDATE: packages/sdk/test/host-trust.test.ts` - the trust of the last push, and an automation's on a host with no people.
- `UPDATE: packages/sdk/test/autoapproval.test.ts` - the rules of the last push.

## Steps

1. Ask `config:change` for a push of a window key, and `trust:push` for `workspaceTrust` alone.
2. Keep every pushed key but the daemon's in `rootConfig`, and drop `Connection.config`.
3. Send one echo of a push to every connection, and serve one root state.
4. Make each reader of the trust, the rules and the shell read `rootConfig`.
5. Keep the owner check on a host with people, and the folders a window said yes to on its connection.
6. Move each test that held a value to its connection to the host's one value.

## Validation

- The changed cases in the four test files fail on `60fa2ccd` and pass after.
- The sdk and agent-acp test files pass.
- `pnpm run typecheck`, `pnpm run boundary` and `pnpm i18n` are clean.

## Resume

Built 2026-11-02 in `8e6cbbc5`.

- `root-config.test.ts` moved with the behavior: the trust and the three approval keys read by every client, and their grant.
- `users-gate-dispatch.test.ts` moved: the grants a push needs, the echo and replay, the replace, and the shell every client's terminal opens.
- `host-trust.test.ts` moved: the trust of the last push, and an automation's on a host with no people.
- `autoapproval.test.ts` moved: the rules of the last push, whichever window pushed them.
- Each moved case fails on `60fa2ccd`'s sources, 14 in all.
