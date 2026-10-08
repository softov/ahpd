---
title: Install and update put the daemon's @ahpd/sdk beside the plugins and check no peers
status: done
depends: [task-06-the-plugin-keeps-npms-sdk.md]
layer: "server"
refs:
  - "[code://packages/server/src/install.ts](../../../../packages/server/src/install.ts) - `installPlugins`, `updatePlugins`, `behind`, `heldBack` and the ERESOLVE branch"
  - "[code://.project/decisions/the-daemon-installs-its-own-sdk-beside-the-plugins.md](../../../decisions/the-daemon-installs-its-own-sdk-beside-the-plugins.md) - the decision"
---

## Objective

`plugin install` and `plugin update` (all and named) run `npm install --prefix <config dir> --legacy-peer-deps @ahpd/sdk@<daemon version> <targets...>`, so the configuration directory's `@ahpd/sdk` is always the daemon's version and one plugin never blocks another.
`behind`, `minorOf`, `heldBack`, install's ERESOLVE branch and task 07's refusal go, with their tests; `NpmFailure` and the terminal and HTTP split stay.
`@ahpd/sdk` is never reported as a plugin: `update` does not say it moved it as one, and `plugin remove` never uninstalls it.

## Steps

1. Failing first, with the fake runner: install and update each pass `--legacy-peer-deps` and `@ahpd/sdk@<daemon version>`; `update @ahpd/agent-acp` beside an `@ahpd/agent-claude` 0.7.0 calls npm and succeeds; a daemon version of `unknown` names `@ahpd/sdk` unpinned, as `pinned` does.
2. By hand, a scratch configuration directory with agent-claude and agent-acp at 0.7.0 against the registry: `update @ahpd/agent-acp` installs 0.8.0 and `node_modules/@ahpd/sdk` is the daemon's version; a load with the 0.8 daemon refuses agent-claude 0.7.0 with the loader's sentence and loads agent-acp.
3. The same load on Node, Bun and Deno.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test` 3 times.

## Resume

Built 2026-09-29 in the `fixes-0-8-1` worktree, test-first, and stopped at the by-hand check; status left `todo`.
- In code: `daemonsSdk` in `install.ts` adds `--legacy-peer-deps` and `pinned('@ahpd/sdk', version)` to every install and update call; `behind`, `minorOf`, `heldBack`, install's ERESOLVE branch and task 07's refusal are gone with their tests. `update all` moves `@ahpd/sdk` without reporting it, a named `@ahpd/sdk` is refused as not a plugin, and `plugin remove` never uninstalls it. Nothing else reads the configuration directory's dependencies as plugins. Failing first: the argv cases lacked the flag and the sdk, the named update beside a 0.7.0 agent-claude was refused by task 07's check, the `unknown` case had no sdk, and remove uninstalled `@ahpd/sdk`.
- By hand, against the registry: with agent-claude and agent-acp at 0.7.0 installed by plain npm, `plugin update @ahpd/agent-acp` exits 0 and leaves agent-acp 0.8.0, `@ahpd/sdk` 0.8.0, agent-claude 0.7.0. On load (Node 24.19.0, Bun 1.4.0, Deno 2.9.6, from a build) agent-claude is refused with `needs @ahpd/sdk ^0.7, this is 0.8.0`, but agent-acp fails too: `Cannot find package '@microsoft/agent-host-protocol' imported from .../@ahpd/sdk/dist/host.js`.
- Cause: `@microsoft/agent-host-protocol` is a peer of `@ahpd/sdk`, which the sdk imports at runtime. A plain install puts it there; an install with `--legacy-peer-deps` does not, and removes the copy a plain install left. So with this task every plugin that imports `@ahpd/sdk` fails to load. How the sdk's own peer is provided is Softov's call.
Implemented 2026-09-29, after Softov made `@microsoft/agent-host-protocol` a dependency of `@ahpd/sdk`.
- In code: `packages/sdk/package.json` moves `@microsoft/agent-host-protocol` from `peerDependencies` to `dependencies`, range `^0.9.0` kept; the lockfile's sdk importer moved with it. `plugin install @ahpd/sdk` is refused with the same "not a plugin" sentence as `update`, before npm runs; failing first, the install resolved instead of rejecting.
- Docs that read the protocol package as the sdk's peer changed with it: the sdk README's install line and note, the "In your own host" install line of agent-acp, agent-pi and agent-cofold, and `DEVELOPER.md`'s boundary paragraph. agent-claude still declares it as a peer of its own and keeps its line. `pnpm boundary` counts dependencies and peers alike, and passes.
- By hand, with the worktree's sdk packed by `npm pack`: agent-claude and agent-acp 0.7.0 installed by plain npm in a scratch `XDG_CONFIG_HOME`, then `npm install --prefix <dir> --legacy-peer-deps <sdk tarball> @ahpd/agent-acp@0.8.0` exits 0 and leaves agent-acp 0.8.0, `@ahpd/sdk` 0.8.0, agent-claude 0.7.0 and `node_modules/@microsoft/agent-host-protocol` 0.9.0. The same call in an empty directory installs the protocol package with the tarball and not with the published `@ahpd/sdk@0.8.0`. Over `--stdio` from a build, on Node 24.19.0, Bun 1.4.0 and Deno 2.9.6 (Deno by path, through `--config-file`): agent-claude is refused with `needs @ahpd/sdk ^0.7, this is 0.8.0` and agent-acp loads. dist deleted afterwards.
- `pnpm typecheck` 0, `pnpm boundary` 0, full `pnpm test` 0 three times, 1744 passed each.
