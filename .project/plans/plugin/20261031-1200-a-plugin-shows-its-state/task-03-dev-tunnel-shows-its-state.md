---
title: Dev Tunnel shows its state
status: implemented
depends:
  - task-02-the-row-carries-the-view.md
layer: tunnel-devtunnel
refs:
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L132-L136](../../../../packages/tunnel-devtunnel/src/plugin.ts#L132-L136) - where `devtunnel host` starts and the plugin says the tunnel"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L159-L168](../../../../packages/tunnel-devtunnel/src/plugin.ts#L159-L168) - where the tunnel stops"
  - "[code://packages/tunnel-devtunnel/src/devtunnel.ts#L85-L131](../../../../packages/tunnel-devtunnel/src/devtunnel.ts#L85-L131) - `ok`, `parse` and `find`, the read of a `--json` answer that `show` copies"
  - "[code://packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts](../../../../packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts) - the plugin tests, with a fake runner and spawner"
---

## Objective

The Dev Tunnel plugin shows a view on the surface `main`.
The view has the tunnel URL, the tunnel id, the port, the relay state and the count of connected clients.
The plugin reads them from `devtunnel show <id> --json`, once at the start and then every 30 seconds.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/devtunnel.ts:124-131` - add `show(tunnel, runner)`, which answers the URL, the host count and the client count, next to `find`.
- `CREATE: packages/tunnel-devtunnel/src/view.ts` - `tunnelView(state)`, the `PluginView` of a state.
- `UPDATE: packages/tunnel-devtunnel/src/plugin.ts:132-136` - read the state at the start, poll it, and show the view when it changes.
- `UPDATE: packages/tunnel-devtunnel/src/plugin.ts:159-168` - stop the poll and clear the view when the tunnel stops.
- `UPDATE: packages/tunnel-devtunnel/i18n/pt.json` - the texts of the view in Portuguese.
- `UPDATE: packages/tunnel-devtunnel/i18n/es.json` - the texts of the view in Spanish.
- `CREATE: packages/tunnel-devtunnel/test/tunnel-devtunnel-view.test.ts` - the cases of this task.
- `UPDATE: packages/tunnel-devtunnel/README.md` - say what the plugin's page shows.
- `UPDATE: tools/i18n-check.mjs` - accept a `views` block, and check its shape.
- `UPDATE: packages/server/test/plugin-i18n.test.ts` - the cases of a `views` block that matches no field.

## Steps

1. Run `devtunnel show <id> --json` on a tunnel with a host, and on one without a host.
2. Put both answers in the test as fixtures, with the tunnel id and the URLs replaced.
3. In `show`, run `show <id> --json` through `ok`, and read the answer with `parse`.
4. Take the URL from the `portUri` of the port whose `portNumber` is the tunnel's port.
5. Take the relay state from `hostConnections`: 0 is down, and more is up.
6. Take the client count from `clientConnections`.
7. Keep the tunnel id, its label and the port from the start of the plugin.
8. Make `tunnelView` a Card with a Column: the URL as a Link, then a Text for each value.
9. Give each Text a fixed component id, so its text has a catalog key.
10. Read the state once the tunnel starts, and show the view.
11. Read the state again every 30 seconds, and show the view only when the state changed.
12. When `show` fails, keep the last view, and log only the first failure of a run of failures.
13. Stop the poll and clear the view when the tunnel stops.
14. Add a test that each fixture gives the URL, the relay state and the client count.
15. Add a test that the plugin shows a view that `checkView` accepts.
16. Add a test that a changed answer shows a new view, and an equal answer shows none.
17. Add a test that a failed `show` keeps the view and logs once.
18. Add a test that a stop ends the poll and clears the view.

## Validation

- `pnpm vitest run packages/tunnel-devtunnel/test` passes, with the new cases.
- `pnpm typecheck` is clean.
- By hand, start a test ahpd under XDG directories with the plugin, and read `views.main` on its row in `x-ahpd-plugins`.

## Resume

Built on 2026-10-31, and not committed: `git add` is refused in this session, and `view.ts` and the test file are new.
The `devtunnel` CLI is not installed here and could not be run. So the fixtures of `show` are built from the field names the plan gives, not from captured answers.
`show(tunnel, runner)` is in `devtunnel.ts`, and `tunnelView` and `sameState` are in `src/view.ts`.
The plugin draws the page at the start, and reads it again every `POLL_MS`. It keeps the last page when a read fails, and logs one run of failures once. It clears the page at `stopping`.
`packages/tunnel-devtunnel/test/tunnel-devtunnel-view.test.ts` holds 8 cases, and the devtunnel suite passes.
`tools/i18n-check.mjs` accepts the `views` block, as the plan's *Answers* says.
A stop during the first read starts no poll.