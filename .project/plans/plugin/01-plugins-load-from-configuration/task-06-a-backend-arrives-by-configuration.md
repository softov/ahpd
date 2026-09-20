---
title: A backend arrives by configuration, end to end
status: todo
depends:
  - task-05-main-builds-through-the-loader.md
layer: test
refs:
  - code://test/example.test.ts#L1-L30 - the whole pattern this test follows: a host, a fake peer, and a real conversation
  - code://test/scenario.ts - the scenario client the host suite uses, if driving a turn through it is shorter than the fake peer
  - code://examples/echo/agent.ts - the backend the fixture plugin contributes, so the test proves the contract and not a second one
  - code://packages/server/src/plugins.ts - `loadPlugins`, called with a real fixture spec
  - code://packages/sdk/src/types/host.ts#L132-L245 - `HostOptions`, which the fold produces
---

## Objective

A test loads a plugin from a path spec, folds it over a base with no agents of its own beyond a fake, builds a host from the result, drives a turn through a fake peer, and sees the plugin's backend answer, so the whole path from a spec on disk to a served session is covered once.

## Files

- `CREATE: test/fixtures/plugin-echo/package.json` - a manifest with `name`, `type: "module"` and an `ahpd` key naming `./index.ts`, and no dependencies.
- `CREATE: test/fixtures/plugin-echo/index.ts` - a plugin exporting `name = "echo-plugin"` and an `apply` that calls `host.agent(echo({ path: host.path }))` from `../../../examples/echo/agent.js`.
- `CREATE: test/plugin-end-to-end.test.ts` - the test.

## Steps

1. Write the fixture manifest so the `ahpd` key is exercised for real rather than mocked, with `{ "ahpd": { "entry": "./index.ts", "title": "Echo plugin" } }`.
2. Write the fixture plugin against the published contract only: import `type { Plugin }` from `@ahpd/sdk`, and otherwise export `name` and `apply` with no default export, importing `echo` by relative path.
3. In the test, call `loadPlugins(['./test/fixtures/plugin-echo'], { base, configDir, cwd: REPO, log })` with a `base` that has one fake agent and no ports, and assert `loaded[0].title` reads from the manifest.
4. Build the host with `createHost(folded.options)` and drive it the way `test/example.test.ts` does: initialize, subscribe to the root channel, assert two agents are listed with `echo` among the providers.
5. Create a session on the `echo` provider, send one turn, and assert the chat channel carries `chat/turnStarted` followed by the echoed text, which proves the contributed backend is served exactly as a literal one is.
6. Add a second case that loads the same fixture disabled and asserts the host has one agent, so `enabled: false` is covered end to end and not only in the loader unit test.
7. Keep the fixture out of the root `build` script by giving it no build step and letting the runner import its `.ts`, the way `examples/` already run from source under the development conditions.

## Validation

- `test/plugin-end-to-end.test.ts` green.
- `pnpm test` green, with the suite still passing against source and not a stale `dist`.
- By hand, once: `node packages/server/dist/main.js --port 0 --plugin ./test/fixtures/plugin-echo` and the startup line names `echo-plugin`; then `ahpc --host ws://127.0.0.1:<port>` offers two backends.

## Resume

Empty until started.
