---
title: A socket on the door token is the host
status: done
depends: []
layer: packages/sdk
refs:
  - "[code://packages/sdk/src/listen.ts#L73-L120](../../../../packages/sdk/src/listen.ts#L73-L120) - `identityOf`, which now says whether the token was the deployment's own"
  - "[code://packages/sdk/src/types/host.ts#L403-L455](../../../../packages/sdk/src/types/host.ts#L403-L455) - `Connection.root`, and `accept` taking it"
  - "[code://packages/sdk/src/host.ts#L6346-L6360](../../../../packages/sdk/src/host.ts#L6346-L6360) - the dispatch gate"
  - "[code://packages/sdk/src/host.ts#L7540-L7560](../../../../packages/sdk/src/host.ts#L7540-L7560) - the command gate"
  - "[code://packages/sdk/src/host.ts#L5410-L5450](../../../../packages/sdk/src/host.ts#L5410-L5450) - `authenticate`, which may not demote a root connection"
  - "[code://packages/server/src/main.ts#L595-L615](../../../../packages/server/src/main.ts#L595-L615) - the daemon telling the door its token is the host"
---

## Objective

A socket admitted on the deployment's connection token is the host: every gated command is served with no `authenticate`, including a capability scoped to a scheme no role names, and signing in or out on that connection does not change it.

## Files

- `UPDATE: packages/sdk/src/types/host.ts` - `Connection.root`, and `accept(peer, principal?, root?)`.
- `UPDATE: packages/sdk/src/types/listen.ts` - `OnConnect` carrying root, and `ListenOptions.root`.
- `UPDATE: packages/sdk/src/listen.ts` - `identityOf` answering root for the deployment token, carried through all three runtimes.
- `UPDATE: packages/sdk/src/host.ts` - `accept` writing `root`; both gates returning before they ask for a capability; `authenticate` refusing to replace or delete it.
- `UPDATE: packages/server/src/main.ts` - `root: true` when a directory is configured, and the third argument threaded through.
- `UPDATE: test/users-gate.test.ts`, `test/listen-identity.test.ts` - the cases.

## Steps

1. Add `root?: boolean` to `Connection`, with the comment that it is a property of the socket and not a person.
2. Add `ListenOptions.root`, and have `identityOf` answer `{ admitted: true, root: true }` for the deployment's token when it is set.
3. Carry it to `accept` as a third argument in all three runtimes, and write it onto the connection.
4. Return early from both gates when `connection.root` is true.
5. Have `authenticate` ignore the host's own resource on a root connection, in both directions: it can neither be replaced by a person nor deleted by an empty token.
6. Pass `root: true` from the daemon when a directory is configured, so a deployment with none is untouched.

## Validation

- `test/users-gate.test.ts` - a root connection is served `listSessions`, refused nothing, served `read:computer` which no role names, and is unchanged by signing in as a read-only person and then signing out.
- `test/listen-identity.test.ts` - the deployment token arrives as root when told to, and a person's token still arrives as that person.
- By hand: a daemon with a user file and a connection token serves `listSessions`, `listAutomationTriggerDefinitions` and `fetchAutomationRuns` to the deployment token with no sign-in.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.

## Resume

Done 2026-09-23.
`Connection.root`, `ListenOptions.root` and the third `accept` argument are in; both gates return early; `authenticate` answers `{}` and changes nothing for the host's resource on a root connection.
The daemon passes `root: true` whenever a directory is configured, so an unconfigured daemon is exactly what it was.
Verified by the suite (72 files, 931 tests) and by hand against a daemon on `--users` with a connection token: `listSessions`, `listAutomationTriggerDefinitions` and `fetchAutomationRuns` all served, and `diagnosticsFetch` reached its handler rather than the gate.
