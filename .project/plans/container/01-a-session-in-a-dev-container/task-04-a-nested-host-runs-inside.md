---
title: A nested host runs inside the container
status: done
depends:
  - task-01-the-daemon-answers-over-stdio.md
  - task-03-the-container-comes-from-the-cli.md
layer: packages/computer, packages/server
refs:
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - the plugin's own options, where the command and the plugin list come from"
  - "[code://packages/server/src/main.ts#L250-L290](../../../../packages/server/src/main.ts#L250-L290) - the flags the nested host is started with"
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts) - the config file shape the nested host reads"
  - "[code://packages/sdk/src/version.ts](../../../../packages/sdk/src/version.ts) - the version the install command is pinned to"
  - "[code://.project/decisions/a-nested-host-speaks-stdio.md](../../../decisions/a-nested-host-speaks-stdio.md) - why it is stdio and not a socket"
---

## Objective

After the container is up, an `ahpd` of the same version runs inside it in stdio mode, configured with this daemon's plugins, and the port answers a channel onto its pipes.

## Files

- `CREATE: packages/computer/src/nested.ts` - finding or installing the host inside, writing its config, and starting it with `exec` in stdio mode.
- `UPDATE: packages/computer/src/plugin.ts` - the port's `connect` composes `up`, the nested host's start, and the channel; `disconnect` closes them.
- `UPDATE: packages/computer/src/devcontainer.ts` - an `execStreaming(workspaceFolder, command)` that hands back stdio rather than collecting it.
- `CREATE: test/fixtures/ahpd-in-container.mjs` - a fake `ahpd` standing in for the installed one, which is enough to assert the command.
- `UPDATE: test/devcontainer.test.ts` - the nested host's cases.

## Steps

1. Ask inside whether the host is there: `command -v ahpd`. A container that has it is used as it is, which is what an image built for this should do.
2. When it is not, install the outer daemon's own version: `npm i -g @ahpd/server@<version>`, with the version read from this build rather than from `latest`, so the two hosts are the same build and a mismatch is not a mystery.
3. Write the nested config inside the container through `exec`, as base64 decoded to a file with owner-only permissions. It carries what this daemon's own configuration carries for plugins, minus anything secret: no connection token, no user file, no credential.
4. Start it in stdio mode: `ahpd --stdio --path <remoteWorkspaceFolder>` with the generated config file, and no `--port`. Nothing listens in the container.
5. Hand back the process's stdin and stdout as the channel the port promised, and keep the process handle so `disconnect` can end it. A nested host that exits is a channel that closes, which the surface already reports.
6. Make the command configurable in the plugin's options, with the default above, because an image that carries the host at another path or a registry that needs a mirror is a deployment fact rather than a code change.
7. Say in the refusal what to install when the container has no Node, rather than reporting `command not found` from inside: the useful sentence names the two ways out, an image with Node or a host already installed.

## Validation

- `test/devcontainer.test.ts` - the command sequence is asserted with the fake CLI and the fake host: probe, install when absent, config write with mode 600, then the stdio launch; the config carries this daemon's plugin list and no credential; a container with the host already there is not installed into.
- The version in the install command equals the version this package reports, asserted against `packages/sdk/src/version.ts`.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green; `@ahpd/computer`'s declared dependencies unchanged, or grown by `@ahpd/server` only if the version is imported rather than read.

## Resume

Done, 2026-09-24. See [implemented.md](implemented.md).
Depends on the stdio mode existing inside the container, which is why task 01 is first.
