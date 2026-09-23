---
title: The door token is the host, and a person's own token is that person - implemented
date: 2026-09-23
refs:
  - code://packages/sdk/src/types/host.ts
  - code://packages/sdk/src/types/listen.ts
  - code://packages/sdk/src/listen.ts
  - code://packages/sdk/src/host.ts
  - code://packages/server/src/main.ts
  - code://test/users-gate.test.ts
  - code://test/listen-identity.test.ts
  - code://docs/USERS.md
---

The deployment's connection token is the host's key and now behaves like one: a socket on it is the host, every gated command is served with no sign-in, and it stays that way when somebody signs in or out on that connection.
A person's own token still arrives as that person, and a deployment with no directory is untouched.

## What was built

- `code://packages/sdk/src/types/host.ts` - `Connection.root`, and `accept(peer, principal?, root?)`.
- `code://packages/sdk/src/types/listen.ts` - `ListenOptions.root` and an `OnConnect` that carries it.
- `code://packages/sdk/src/listen.ts` - `identityOf` answering root for the deployment token, carried through Bun, Deno and Node.
- `code://packages/sdk/src/host.ts` - the connection records root; both gates return before they ask for a capability; `authenticate` ignores the host's own resource on a root connection, so it can be neither replaced nor revoked.
- `code://packages/server/src/main.ts` - `root: true` whenever a directory is configured.

## Verified

- `pnpm test`: 72 files, 931 tests. `test/users-gate.test.ts` has a root connection served `read:computer`, a scheme no role declares, and unchanged by signing in as a read-only person and then out; `test/listen-identity.test.ts` has the door arriving as root.
- `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- By hand: a daemon with `--users` and a connection token served `listSessions`, `listAutomationTriggerDefinitions` and `fetchAutomationRuns` to that token with no `authenticate`, and `diagnosticsFetch` reached its handler rather than the gate.

## Departures from the plan

- The plan expected two tasks; the prose is the second and the code the first, which is what was built.
- Root is a flag on the connection rather than a principal, because `authenticate` would otherwise be able to demote or revoke the host's own key.

## Left for later

- Nothing. The root row in plan 07's `deferred.md` points here.
