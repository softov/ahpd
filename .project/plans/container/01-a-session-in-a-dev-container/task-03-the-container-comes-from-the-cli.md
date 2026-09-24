---
title: The container comes from the Dev Container CLI
status: done
depends: []
layer: packages/computer
refs:
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts) - the Docker runtime, which is the other mechanism and shares nothing with this"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - the plugin, where a second port would be registered"
  - "[code://test/fixtures/docker.mjs](../../../../test/fixtures/docker.mjs) - the fake Docker the machine tests drive"
  - "[code://.project/decisions/a-dev-container-is-made-by-the-dev-container-cli.md](../../../decisions/a-dev-container-is-made-by-the-dev-container-cli.md) - why the CLI and not Docker alone"
---

## Objective

A `containers` port that answers whether Docker and the Dev Container CLI are there, makes the container a workspace's `devcontainer.json` asks for, runs commands in it, and refuses every failure with the CLI's own words.

## Files

- `CREATE: packages/computer/src/devcontainer.ts` - the CLI: `available(docker, cli)`, `up(workspaceFolder)`, `exec(workspaceFolder, command)`, the JSON result, and the refusals.
- `UPDATE: packages/computer/src/plugin.ts` - register the containers port when the plugin's options ask for it, beside the `computers` port.
- `CREATE: test/fixtures/devcontainer.mjs` - a fake CLI: `--version`, `up` answering the success JSON or a failure, `exec` running the command it is handed.
- `CREATE: test/devcontainer.test.ts` - every branch above, with no Docker and no CLI installed.

## Steps

1. Answer `available()` from two facts: whether Docker resolves and whether the CLI resolves. Resolve by running each with its own version flag and reading the exit code, not by looking on a path this process happens to have.
2. Run `up` as `devcontainer up --log-level debug --workspace-folder <dir>`, and read the CLI's JSON off stdout by scanning its lines from the end for the first that carries `outcome: 'success'` with a `containerId` and a `remoteWorkspaceFolder`. The CLI logs as it works, so the result is one line among many and not the whole stream. Anything else is a refusal carrying the CLI's own stdout or stderr, never a guessed container.
3. Run everything inside as `devcontainer exec --log-level debug --workspace-folder <dir> /bin/sh -c <command>`, which is the CLI's own contract and the only way a command reaches the container its definition made.
4. Stream both of the CLI's streams to the caller as they arrive, with the command line echoed first as the reference does, so a long `up` reports what it is doing rather than nothing until it ends. The surface already has an `output` notification for exactly this, and the same notification carries a nested host's own stderr later.
5. Answer `address` as `devcontainer:<containerId>`, which is what the reference returns and what the client shows, and carry `remoteWorkspaceFolder` back untouched.
6. Refuse a folder with no `devcontainer.json` or `.devcontainer/devcontainer.json` with a sentence naming the folder, even though the reference client would not ask: a second client can, and "there is nothing here to read" is the useful answer.
7. Keep the Docker runtime out of this file. A machine from a manifest and a container from a workspace definition are two mechanisms, and this port speaks only the second.

## Validation

- `test/devcontainer.test.ts` - with the fake CLI: a success answers the container id and the remote folder; a non-success outcome is a refusal carrying the CLI's text; a missing CLI is a refusal naming the flag that installs it; no Docker answers `available()` false; stderr arrives as output while the command runs.
- `test/computer.test.ts` and `test/computer-plugin.test.ts` still pass, because the machine runtime is untouched.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green with `devcontainer` absent from the machine.

## Resume

Done, 2026-09-24. See [implemented.md](implemented.md).
A subprocess that answers JSON, wrapped in refusals: nothing is parsed but the CLI's own two fields.
