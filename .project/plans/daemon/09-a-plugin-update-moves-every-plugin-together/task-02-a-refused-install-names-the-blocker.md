---
title: A failed npm call says what failed once, and keeps npm's reason when served
status: implemented
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/install.ts#L233](../../../../packages/server/src/install.ts#L233) - `installPlugins`"
  - "[code://packages/server/src/install.ts#L80-L93](../../../../packages/server/src/install.ts#L80-L93) - `NpmFailure` and `npmFailed`"
  - "[code://packages/server/src/commands/plugin.ts#L66-L74](../../../../packages/server/src/commands/plugin.ts#L66-L74) - `failure`, which stops with `failed` at the terminal and `message` when served"
---

## Objective

Every failed npm call in `install.ts` (install, update, remove) throws an `NpmFailure`. At the terminal the command stops with its `failed` line only, because npm's error has already streamed there, so npm's error is printed once. Served over HTTP, the error is its `message`, which keeps npm's reason.
No message names a blocking plugin: since task 08, install and update put the daemon's `@ahpd/sdk` beside the plugins with `--legacy-peer-deps`, and the peer refusal this task first named is gone.

## Files

- `UPDATE: packages/server/src/install.ts` - read the installed `@ahpd/*` versions before the call, and word the failure.
- `UPDATE:` the install tests.

## Steps

1. Failing first: a fake npm that writes its error to stderr and exits non-zero, through the CLI, for install, update and remove; the error appears twice.
2. Every failed npm call throws `NpmFailure(failed, reason)`; `failure` in `commands/plugin.ts` answers `failed` at the terminal and `message` when served.

## Validation

- `test/server-cli.test.ts`: a failed install, update and remove each print npm's error once and the `failed` line once.
- `test/server-http.test.ts`: a served install that fails keeps npm's reason.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

Implemented 2026-09-29 for the peer refusal, in the `fixes-0-8-1` worktree.
Cause of the double print: the real `run` writes npm's stderr through as it arrives and also returns it, and `installPlugins` put the whole of it in the thrown message that `stop` prints.
`installPlugins` reads, before npm runs, the `@ahpd/*` dependencies not being installed whose installed minor differs from the daemon's (`behind`). When npm fails with `ERESOLVE` and one is found, the message is `npm could not install <names>: <pkg> <version> is installed for another @ahpd/sdk. Run ahpd plugin update to move every plugin to <version>.`, without npm's text.
Failing first: the ERESOLVE case in `test/plugin-install.test.ts` did not name `@ahpd/agent-acp 0.7.0`, and the CLI case in `test/server-cli.test.ts` (fake npm writing `FAKE_NPM_STDERR`) saw npm's error twice. Both pass after.
Reopened for the any-failure row, and implemented again 2026-09-29: every failed npm call in `install.ts` (install, update, uninstall) throws an `NpmFailure`, whose `message` carries npm's reason and whose `failed` is only what failed. `failure` in `commands/plugin.ts` stops with `failed` at the terminal and with `message` when served. The peer refusal is an `NpmFailure` with no reason, so it reads the same either way.
Failing first: `a failed npm says what failed at the terminal, and npm's error only as npm said it` in `test/server-cli.test.ts` saw `npm error code E404` twice for install. It passes after for install, update and remove. `keeps npm's reason in a served install that fails` in `test/server-http.test.ts` guards the served side; it passed before and after.
