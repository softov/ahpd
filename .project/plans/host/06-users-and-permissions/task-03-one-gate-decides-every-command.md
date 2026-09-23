---
title: One gate decides every command
status: done
depends:
  - task-02-the-host-verifies-a-person.md
layer: packages/sdk
refs:
  - "[code://packages/sdk/src/host.ts#L7170-L7186](../../../../packages/sdk/src/host.ts#L7170-L7186) - the dispatch boundary and the `handshook` check the gate goes beside"
  - "[code://packages/sdk/src/host.ts#L122](../../../../packages/sdk/src/host.ts#L122) - `GREETINGS`, the set of methods served before a handshake and the pattern the ungated set follows"
  - "[code://packages/sdk/src/host.ts#L4641-L4692](../../../../packages/sdk/src/host.ts#L4641-L4692) - `subscribe`, the one handler whose capability depends on its channel"
  - "[code://packages/sdk/src/host.ts#L4130-L4140](../../../../packages/sdk/src/host.ts#L4130-L4140) - `metadataFor`, which builds the record a `-32007` carries"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `AhpErrorCodes.AuthRequired` (-32007) and `PermissionDenied` (-32009), and `PermissionDeniedErrorData.request` being optional
---

## Objective

Every command a host serves is checked once, in one place, against the principal on the connection: unauthenticated is `-32007` with the record to sign in against, and a role that does not cover the method is `-32009` with nothing to negotiate.
A host with no `users` port refuses nothing.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `NEEDS`, a record from method name to `Capability`, beside `GREETINGS`; `capabilityFor(method, params)` for the channel-aware case; and the gate itself at the dispatch boundary.
- `UPDATE: packages/sdk/src/host.ts:7170-7186` - the check, after the `handshook` check and before the client relay.
- `CREATE: test/users-gate.test.ts` - the matrix.

## Steps

1. Write `NEEDS` as a plain record, one entry per gated method, grouped by capability with a blank line between groups so a reader can see the shape of a role:
   - `read`: `resourceList`, `resourceRead`, `resourceResolve`, `createResourceWatch`, `completions` (scheme-scoped by step 3)
   - `write`: `resourceWrite`, `resourceDelete`, `resourceMkdir`, `resourceMove`, `resourceCopy`, `resourceRequest`, `invokeChangesetOperation` (scheme-scoped by step 3)
   - `session`: `listSessions`, `fetchTurns`, `createSession`, `createChat`, `disposeChat`, `disposeSession`, `resolveSessionConfig`, `sessionConfigCompletions`
   - `terminal`: `createTerminal`, `disposeTerminal`
   - `automation`: `listAutomationTriggerDefinitions`, `runAutomation`, `fetchAutomationRuns`
   - `diagnostics`: `diagnosticsFetch`
2. Leave five methods ungated and say why in one comment: `initialize`, `reconnect` and `ping` are the handshake, and gating them would refuse a client before it could learn where to sign in; `authenticate` is how a person signs in, so gating it is a loop with no way out; `subscribe` is handled by step 3.
3. Write `capabilityFor(method, params)`, which answers `NEEDS[method]` for most methods and reads the params for two kinds:
   - **`subscribe`** reads the channel. `ahp-root://` needs nothing, because that is the discovery a client reads to find the login record. `ahp-session:/…` needs `session`, `ahp-automations://` needs `automation`, and a terminal channel needs `terminal`. A channel it does not recognise needs `read`, the conservative answer for something a later plan added.
   - **Every resource method** reads the URI's scheme, through the same `storeFor` expression `plugin/08` added, because `resourceWrite` on `file:` and `resourceWrite` on a plugin's scheme are the same method and not the same act. `file:` answers the plain `read` or `write`. A registered provider's scheme answers the scheme-scoped `read:<scheme>` or `write:<scheme>`. A role that names plain `write` therefore does not acquire a provider's scheme by accident, and `@ahpd/computer`'s `computer:` is refused to everybody until a role names it.

   This is what `HANDOFF.md`'s pending step 9 means by scoping the gate rather than restoring it: the file half stays open for the role that has `write`, and a scheme is opt-in per role.
4. Write the gate, immediately after the `handshook` check at `host.ts:7185` and before the client relay, so that a URI another client owns is still that client's to answer and this host's roles do not reach into it:
   - `options.users === undefined` returns at once, which is what keeps an unconfigured daemon identical;
   - `capabilityFor` answering nothing returns at once;
   - no `connection.principal`: `throw new RpcError(-32007, 'Sign in to use this host', { resources: [metadataFor(login.resource)] })`;
   - a principal whose `can(capability)` is false: `throw new RpcError(-32009, \`${principal.id} may not ${capability} here\`, {})` with **no** `request` key, which decision 3 explains is what tells a client the refusal is final.
5. Add the staleness guard: a test, not a runtime check, asserting that every key of `handlers` is either in `NEEDS` or in the ungated set. A handler added later then fails the suite rather than being served to anybody, which is the property `needsWrite` did not have.
6. Run `pnpm test`, `pnpm typecheck` and `pnpm boundary`.

## Validation

- `test/users-gate.test.ts`:
  - every key of `handlers` is classified, and adding a fake one to neither list fails the assertion;
  - with no `users` port, every method is served exactly as today, driven by running a handful of commands with no principal;
  - with a port and no sign-in: `listSessions` answers `-32007`, its `data.resources` carries the login record, and `initialize`, `ping` and `authenticate` still work;
  - signed in as `member`: `resourceWrite` and `createTerminal` are served, `runAutomation` answers `-32009`, and the error carries no `request` key;
  - signed in as a role with `read` alone: `resourceRead` is served and `resourceWrite` answers `-32009`;
  - with a provider registered for `computer:`, a role holding plain `read` and `write` is served on `file:` and refused `-32009` on `computer:`, and a role holding `read:computer` is served there; this is the case pending step 9 names;
  - `subscribe` to `ahp-root://` is served with no principal, and to a session channel answers `-32007`;
  - a revoked or expired credential takes the capability away on the next command, not on the next connection.
- `test/host.test.ts`, `test/writes.test.ts` and `test/operations.test.ts` unchanged and green, which is the proof that a daemon with no directory did not move.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume


Done 2026-09-23, as written. See [implemented.md](implemented.md).
