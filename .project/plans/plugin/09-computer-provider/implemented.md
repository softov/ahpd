---
title: "A computer: provider that makes machines - implemented"
date: 2026-09-22
refs:
  - code://packages/computer
  - code://test/computer.test.ts
  - code://test/computer-plugin.test.ts
  - code://test/fixtures/docker.mjs
  - code://.github/workflows/release.yml
  - code://docs/PLUGINS.md
  - code://docs/COMPUTER.md
  - code://packages/sdk/src/types/index.ts
---

`@ahpd/computer` is a plugin a daemon loads by name: it serves the `computer:` scheme read-only from a runtime, and it offers three host tools, so a session's model can make a machine, run something in it and throw it away.
Docker is the runtime that ships, chosen by an option, and `computer://<id>/capabilities` says which runtimes, limits and maximum this host has.
The scheme, the fixture that proved it and the operator's script are now one story: the package reports what the script makes and what it makes itself, because both label it `ahpd.computer=1`.

## What was built

- `code://packages/computer/src/runtime.ts` - `ComputerRuntime`, and `dockerRuntime` over `spawn`: `list`, `inspect`, `run`, `stop`, `remove`, `exec` and `capabilities`, each one run of the configured command.
- `code://packages/computer/src/provider.ts` - `ComputerProvider`: the root lists machines, `<id>` is a directory with `status` and `capabilities` in it, `-32008` for a machine that is not there, and no write half.
- `code://packages/computer/src/tools.ts` - `request_disposable_computer`, `release_computer` and `computer_exec`, with `effects` on each and a maximum the first enforces.
- `code://packages/computer/src/plugin.ts` - `name`, `title`, `defaults` and `apply`, one runtime, one provider registered, the three tools after it, and an unknown `runtime` reported at load.
- `code://packages/computer/package.json` - the manifest, the `ahpd` options block and the peer range.
- `code://packages/sdk/src/types/index.ts` - `HostTool` and `ToolCall` exported, which `PluginHost.registerTool` needed and the public surface lacked.
- `code://.github/workflows/release.yml` - a sixth name in the tag check, the staging loop, the rehearsal loop and the printed list.
- `code://docs/PLUGINS.md`, `code://docs/COMPUTER.md` - the worked example, and the package beside the script.

## Verified

- `test/computer.test.ts` - 5 cases against a runtime that is a plain object: the listing, status and capabilities, the refusals, making with limits and overrides, releasing, exec, the maximum, and the `effects`.
- `test/computer-plugin.test.ts` - 3 cases through the real loader and the scripted `docker`: the scheme served through a host, the three tools offered, the commands recorded in the fixture's state file, an unknown runtime reported, and the manifest listed `ready` without importing its entry.
- `pnpm test` green: 67 files, 872 tests; `pnpm typecheck`, `pnpm boundary`, `pnpm build` and `pnpm install --frozen-lockfile` green.
- By hand, against a real Docker: the script made a labelled container, a daemon started with `--plugin ./packages/computer` listed it on `computer://`, read `computer://<id>/status` from `docker inspect`, answered `capabilities`, and refused a write `-32601`.

## Departures from the plan

- `computerProvider` answers a narrower `ComputerProvider` rather than the optional `ResourceProvider`, because a caller holding it should not have to test for methods that are always there; the plan said only that the provider implements the contract.
- `HostTool` had to join the SDK's public exports, which the plan did not name: a plugin could not write a tool without the type.

## Left for later

- A `kvm` runtime. The option and the capability list are in place; a VM behind them needs a hypervisor, which is not installed here.
- The master the research names, which would replace the runtime behind the same three tools and authorize a request. Nothing here asks it, because it does not exist.
- Release. The package has never been published, so its first version needs a token bootstrap before OIDC can stage it, and `0.6.4` is now the tag that would carry this, `host/05` and the write-gate fix.
