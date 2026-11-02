---
title: The window keys are one value for the host - implemented
date: 2026-11-02
refs:
  - git://8e6cbbc5 - the change
  - git://59911c5e - the docs and the two specs
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts)"
  - "[code://packages/sdk/src/host/gate.ts](../../../../packages/sdk/src/host/gate.ts)"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts)"
---

The window's five keys in root config are one value for the whole host, as VS Code's host holds them.
The last push from any window sets each, every client reads the same value, and every reader on the host reads it.
A push of a window key needs `config:change`, and a push of `workspaceTrust` alone needs `trust:push`.

## What was built

- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - a push keeps every key but the daemon's in `rootConfig`.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `seenBy` sends one echo of a push to every connection.
- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - `rootFor` serves the one root state.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - `trustedBy` and `getAutoApproval` read `rootConfig`.
- [`code://packages/sdk/src/host/trust.ts`](../../../../packages/sdk/src/host/trust.ts) - `requireTrust` reads the host's trust.
- [`code://packages/sdk/src/host/terminals.ts`](../../../../packages/sdk/src/host/terminals.ts) - a client's terminal opens the host's shell.
- [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts) - the grant a push needs; `PER_CONNECTION` is gone, and `Connection.config` with it.
- Four test files and five docs, with the two specs, say the keys are the host's.

## Verified

- On `60fa2ccd`'s sources the 14 changed cases fail, each holding a value to its connection or a key to no grant.
- The sdk and agent-acp test files but `nested-process` pass, 4222 tests in 227 files, on the change before one case's filter.
- That case reads the admin's own answer apart from any refusal, so it holds where a refusal reaches every subscriber.
- With `8e6cbbc5` the case's file passes, 34 of 34.
- `pnpm run typecheck`, `pnpm run boundary` and `pnpm i18n` report no errors, and the prose lint is clean.

## Departures from the plan

- None.

## Left for later

- Left as it is: on a host with people, a turn reads trust and rules only when the session's owner sends it.
- VS Code's host has no people, and reads the one value for every session it runs.
- Left as it is: a person holding `trust:push` sets the trust every session reads, as the grants spec gives it.
- VS Code's host has no grants.
- Left as it is: the folders a window said yes to one at a time stay on its connection.
- Left as it is: a folder the host trusts is not asked about.
- VS Code's host keeps no such answer, and asks the window each time trust is needed.
- Left as it is: a backend's terminal opens the daemon's own shell.
- VS Code's host opens the pushed `defaultShell` for every terminal it makes, an agent's shell tool among them.
