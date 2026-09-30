---
title: An install npm refuses for a peer names the installed package that blocks it
status: implemented
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/install.ts#L233](../../../../packages/server/src/install.ts#L233) - `installPlugins`"
  - "[code://packages/server/src/commands/plugin.ts#L101-L113](../../../../packages/server/src/commands/plugin.ts#L101-L113) - where the failure is stopped with"
---

## Objective

When `plugin install` fails because an installed `@ahpd/*` package peers an older `@ahpd/sdk` than the one being installed, the message names that package and its version and says to run `ahpd plugin update`. npm's error is printed once, not twice.

## Files

- `UPDATE: packages/server/src/install.ts` - read the installed `@ahpd/*` versions before the call, and word the failure.
- `UPDATE:` the install tests.

## Steps

1. Reproduce first with the faked runner answering `ERESOLVE`, the way dev86 did on 2026-09-29 (`@ahpd/agent-acp` 0.7.0 installed, three others asked at 0.8.0).
2. Find why npm's error reaches the terminal twice (once from npm's own stderr, once in the stop message) and keep one.

## Validation

- The case names `@ahpd/agent-acp 0.7.0` and `ahpd plugin update`, and npm's error appears once.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

Implemented 2026-09-29 for the peer refusal, in the `fixes-0-8-1` worktree.
Cause of the double print: the real `run` writes npm's stderr through as it arrives and also returns it, and `installPlugins` put the whole of it in the thrown message that `stop` prints.
`installPlugins` reads, before npm runs, the `@ahpd/*` dependencies not being installed whose installed minor differs from the daemon's (`behind`). When npm fails with `ERESOLVE` and one is found, the message is `npm could not install <names>: <pkg> <version> is installed for another @ahpd/sdk. Run ahpd plugin update to move every plugin to <version>.`, without npm's text.
Failing first: the ERESOLVE case in `test/plugin-install.test.ts` did not name `@ahpd/agent-acp 0.7.0`, and the CLI case in `test/server-cli.test.ts` (fake npm writing `FAKE_NPM_STDERR`) saw npm's error twice. Both pass after.
Reopened for the any-failure row, and implemented again 2026-09-29: every failed npm call in `install.ts` (install, update, uninstall) throws an `NpmFailure`, whose `message` carries npm's reason and whose `failed` is only what failed. `failure` in `commands/plugin.ts` stops with `failed` at the terminal and with `message` when served. The peer refusal is an `NpmFailure` with no reason, so it reads the same either way.
Failing first: `a failed npm says what failed at the terminal, and npm's error only as npm said it` in `test/server-cli.test.ts` saw `npm error code E404` twice for install. It passes after for install, update and remove. `keeps npm's reason in a served install that fails` in `test/server-http.test.ts` guards the served side; it passed before and after.
