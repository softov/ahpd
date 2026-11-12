---
title: A tunnel can require a real token
status: implemented
depends: [task-03-tunnel-streams-come-into-the-process.md]
layer: "tunnel-devtunnel"
refs:
  - "[code://packages/tunnel-devtunnel/src/kind.ts](../../../../packages/tunnel-devtunnel/src/kind.ts) - the schema, and the `admit` decision in `hopFor`"
  - "[code://packages/tunnel-devtunnel/README.md](../../../../packages/tunnel-devtunnel/README.md) - the settings table and the visitor cases"
---

## Objective

A devtunnel record has a `requireToken` setting. With it on, the derived token is never swapped, so a visitor needs a token the daemon accepts, on any host.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/kind.ts` - the schema gains `requireToken`, and `admit` keeps every token as it came when it is on.
- `UPDATE: packages/tunnel-devtunnel/README.md` - the setting, and the fourth visitor case.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` - the setting's cases.

## Steps

1. Add `requireToken` to `SCHEMA` as a boolean, default false, with the title "Require a token".
2. Describe it as: "Visitors must bring a token this host accepts. VS Code over the tunnel cannot connect."
3. In `admit`, answer `keep` for every request when `requireToken` is on, before the derived-token check.
4. Let the system tunnel take `requireToken` from the plugin's options, as it takes `person`.
5. Apply a change of `requireToken` on a running tunnel live, as a change of `person` is.
6. Add the setting and the case "a tunnel that requires a token" to the README.

## Validation

- Test a host with no users and `requireToken` on. Expect a request with the derived token to reach the daemon unchanged.
- Test a host with users, a person and `requireToken` on. Expect the derived token to reach the daemon unchanged, with no key set.
- Test a request with a person's own token and `requireToken` on. Expect it unchanged.
- `TMPDIR=/home/softov/tmp/ahpd-test npx vitest run packages/tunnel-devtunnel` passes.

## Resume

Implemented 2026-11-12, uncommitted in the worktree.

- `packages/tunnel-devtunnel/src/kind.ts`: `SCHEMA` gains `requireToken` as a boolean, title "Require a token", default false, with the task's description. `KindOptions.requireToken` carries the plugin's option, and `system()` puts it in the system tunnel's settings only when it is on.
- The hop holds `requireToken`, and `hopFor` takes it as a fourth argument. The `admit` decision answers `keep` for every request when it is on, before the derived-token check, so nothing is swapped on any host: a derived token, and a person's own token, reach the daemon as the visitor wrote them.
- `update` reads `requireToken` from the record and writes it on the running hop, so a saved change applies to the next request without moving the port. A changed port's new hop is built with the new value, and a changed connector restarts into it.
- Beyond the task's Files list: `packages/tunnel-devtunnel/src/plugin.ts` gains the `requireToken` option and its `defaults` entry, `package.json`'s options schema declares it, and `packages/server/test/plugin-load.test.ts` expects the seventh option key. Step 4 cannot take the option from the plugin without them.
- CASES: `packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` gains five cases - the derived token unchanged on a host with no users where it would otherwise get the daemon's token; the derived token unchanged on a host with users, a person and a key; a visitor's own token and `Authorization` unchanged; a saved change of the setting applied on the running hop; and `system()` taking the option. The fake service needed no change.
- A tunnel that requires a token and also names a person whose record requires the issuer still does not start: the issuer row of the Answers table is unconditional, and the key is minted before the setting is read.
- `pnpm exec tsc -p tsconfig.json --noEmit` passes. The tunnel and server suites were run, and `implemented.md` has the counts.

