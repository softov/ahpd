---
title: The package, the runtime and the provider
status: done
depends: []
layer: plugin
refs:
  - code://packages/agent-acp/package.json - the manifest, the `ahpd` key and the peer range this copies
  - code://packages/agent-acp/tsconfig.json - the package build, which the root build loop already covers
  - code://packages/agent-acp/src/plugin.ts - the `name`, `title` and `apply` this mirrors
  - code://packages/sdk/src/types/resources.ts#L186-L211 - `ResourceProvider`, the four optional methods and `read`
  - code://scripts/computer.mjs - the Docker verbs and the label the runtime performs and reads
---

## Objective

`@ahpd/computer` builds, loads as a plugin, registers `computer:` and answers `list`, `resolve` and `read` from a Docker runtime selected by an option, with the runtime reached through a command so a test can drive a fixture instead.

## Files

- `CREATE: packages/computer/package.json` - name `@ahpd/computer`, version `0.6.3`, no runtime dependencies, `@ahpd/sdk` as a peer and a workspace dev dependency, the `exports` map with the `development` condition, and an `ahpd` key naming `./dist/index.js` with the options below.
- `CREATE: packages/computer/tsconfig.json` - the same three lines as the other packages.
- `CREATE: packages/computer/src/runtime.ts` - `ComputerRuntime`, the interface the provider and the tools use, and `dockerRuntime(options)` over `spawn`: `list`, `inspect`, `run`, `stop`, `remove`, `exec`, each answering parsed output or throwing with what the command said.
- `CREATE: packages/computer/src/provider.ts` - `computerProvider(runtime)`: `list('computer://')` answers one directory entry per machine, `resolve` answers a machine or a file, `read` answers `computer://<id>/status` from `inspect` and `computer://<id>/capabilities` from the runtime; no write half.
- `CREATE: packages/computer/src/plugin.ts` - `name`, `title` and `apply(host, options)`: option checking that drops what it does not understand, one runtime, one provider registered, and the tools registered when task 02 adds them.
- `CREATE: packages/computer/src/index.ts` - the four exports.

## Steps

1. Write the manifest from `@ahpd/agent-acp`'s, with `options` for `runtime`, `command`, `args`, `env`, `image`, `cpus`, `memory`, `max` and `label`, each optional, and a `runtime` default of `docker`.
2. Write `ComputerRuntime` and the Docker implementation, spawning the configured command with `spawn` and reading `stdout`; a non-zero exit throws with the command, the exit code and what it printed, because a provider that answers an empty list on a broken daemon is worse than one that fails.
3. Write the provider: the three URIs the research names, `RpcError(-32008, ...)` for a machine that is not there, and `capabilities` listing the runtimes this host accepts.
4. Write `apply` so an unknown option is dropped rather than fatal, as the ACP entry does, and so an unknown `runtime` is a problem reported at load rather than a crash later.
5. `pnpm build`, `pnpm typecheck` and `node scripts/boundary.mjs`.

## Validation

- `node scripts/boundary.mjs` - `@ahpd/computer: 1 declared, none undeclared` (the peer is the one).
- `pnpm build` emits `dist/index.js`, so `ahpd plugin list --plugin ./packages/computer` says `ready`.
- By hand: a host built with the provider answers `resourceRead` for `computer://<id>/status` against the machines `scripts/computer.mjs` left.
- `pnpm test` unchanged and green, because no test yet.

## Resume

Done 2026-09-22.
Built: the manifest and `tsconfig`, `runtime.ts` (`ComputerRuntime` and `dockerRuntime` over `spawn`), `provider.ts` (`ComputerProvider`, narrower than the optional contract), `plugin.ts` and `index.ts`.
Found: `HostTool` was not on the SDK's public surface even though `PluginHost.registerTool` takes one, so `packages/sdk/src/types/index.ts` now exports `HostTool` and `ToolCall`.
Found: the workspace lockfile needs the new importer, which `pnpm install --no-frozen-lockfile` added; and building this package alone fails until the SDK's `dist` is current, because the workspace link resolves the built SDK rather than its source.
Found: a provider whose methods are typed as the optional `ResourceProvider` cannot be called in TypeScript without a check, so the factory answers a narrower `ComputerProvider` with `list`, `resolve` and `read` required.
