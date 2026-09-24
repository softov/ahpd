---
title: A session in a dev container - implemented
date: 2026-09-24
refs:
  - code://packages/sdk/src/listen.ts
  - code://packages/sdk/src/types/listen.ts
  - code://packages/sdk/src/types/containers.ts
  - code://packages/sdk/src/host.ts
  - code://packages/sdk/src/users.ts
  - code://packages/computer/src/devcontainer.ts
  - code://packages/computer/src/plugin.ts
  - code://packages/server/src/main.ts
  - code://test/stdio.test.ts
  - code://test/containers.test.ts
  - code://test/devcontainer.test.ts
  - code://test/container-relay.test.ts
  - code://test/fixtures/devcontainer.mjs
  - code://test/fixtures/container-host.mjs
  - code://docs/CONTAINERS.md
---

A workspace with a `devcontainer.json` runs its session inside that container, and a whole `ahpd` runs in there with this host carrying its frames. The reference client's own flow drives it through `vscode/devContainers/*`, which this host now serves name for name under `_meta['vscode.devContainers']`, gated as `container:write`.

## What was built

- `code://packages/sdk/src/listen.ts` - `overStdio`, the second transport: one frame per line of JSON on this process's stdin and stdout, through the same `createPeer` and `receive` the socket uses, and the same gate, tap and framing. It takes its streams, so the suite drives it without taking over the test runner's pipes.
- `code://packages/sdk/src/types/containers.ts` - `ContainerPort` (`available`, `connect`, `send`, `disconnect`), `ContainerConnect`, `ContainerConnectResult` and `ContainerSink`.
- `code://packages/sdk/src/types/plugin.ts`, `code://packages/sdk/src/plugins.ts`, `code://packages/sdk/src/validate.ts` - `registerContainers` and the port's validation row.
- `code://packages/sdk/src/host.ts` - the four methods (`isDockerAvailable`, `connect`, `disconnect`, `relaySend`) and the four notifications (`relayMessage`, `output`, `relayClose`, `closeConnection`), the per-connection map that namespaces a client's `connectionId`, the disposal that stops a socket's relays, and the capability key, which is a probe rather than a presence.
- `code://packages/computer/src/devcontainer.ts` - the launcher: `devcontainer up`, the CLI's JSON read off whichever line carries it, the host inside probed and installed, the configuration written owner-only, and the stdio process whose lines are frames or output.
- `code://packages/computer/src/plugin.ts` - the launcher registered from the plugin's `devcontainer` option, on unless it says `false`.
- `code://packages/server/src/main.ts` - `--stdio`, refused for `ahpd start`, and the startup lines moved to stderr so stdout is the wire; `stamp` moved to stderr with them, which changes nothing for a detached daemon because both streams land in the same log.
- `code://docs/CONTAINERS.md` - the operator's page, and `--stdio` in `docs/DAEMON.md` and `registerContainers` in `docs/PLUGINS.md`.

## Verified

- `test/stdio.test.ts` - 8 cases: a handshake over a pipe, a frame the pipe split answered once, two frames in one write both answered, an escaped newline kept inside one frame, the parse error for a line that is not JSON with the connection still serving, the connection admitted as the host by default and as nobody with `root: false`, the tap seeing both directions, and silence after close.
- `test/containers.test.ts` - 8 cases: the key present only with a launcher that answers, the reference's result shape, frames and output both ways, `relayClose` then `closeConnection` on an end, per-client namespacing, a repeated name refused, `container:write` asked for with the probe left ungated, a launcher's refusal reported and its name freed, a dropping socket stopping its containers, and the three strings checked.
- `test/devcontainer.test.ts` - 11 cases against a fake CLI: availability from two version probes, the folder refused when it is not a dev container, the result parsed from among the CLI's log lines, the CLI's own words on failure, the install only when the image has no host, the configuration decoded and checked, the launch in stdio mode with no port, frames both ways with the container's own line arriving as output, and a disconnect ending the process once.
- `test/container-relay.test.ts` - the relay end to end with a real process on the other side: a real `ahpd --stdio` under a fake launcher, a client's `initialize` and `ping` carried by `relaySend`, answered by a host that is not this one, its own `_meta` without the containers key, and the nested host's non-protocol output arriving as `output`.
- `test/users-gate.test.ts` - the staleness test now reads quoted handler names too, which found nine `vscode/*` methods that were served and classified nowhere. They are classified now: the worktree and artifact methods as `session:write`, the state file as `session:read`, the debug logs and `getNetworkDiagnosticsInfo` as `diagnostics:read`.
- `pnpm test` 78 files / 1007 tests, with `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.

## By hand, with Docker and the real CLI

Run on 2026-09-24, Docker 29.6.2, `@devcontainers/cli` 0.89.0 through `npx -y`, image `node:22` already local.

A workspace at `/github/ahpd/.scratch/devc-work` with `.devcontainer/devcontainer.json` = `{ "image": "node:22" }`, driven through `createHost({ containers: devContainer({ command: 'npx', args: ['-y', '@devcontainers/cli'], host: ['node', '/workspaces/ahpd/packages/server/dist/main.js'] }) })`.

- `available()` answered true and the handshake advertised `vscode.devContainers`.
- `connect` answered `address: devcontainer:a30e082064cb3bd6a9c360c0cdf8b320d0037fa5e34d4ebf7ece22b2a3baeed4` and `remoteWorkspaceFolder: /workspaces/ahpd/.scratch/devc-work`. The CLI mounted the git root, so the container saw the whole tree at `/workspaces/ahpd`.
- An `initialize` and a `ping` sent through `relaySend` were both answered by the host inside, and its answer proves where it was: `defaultDirectory: file:///workspaces/ahpd/.scratch/devc-work`, which is a path this host does not have. Its `_meta` carried no `vscode.devContainers`, as a host with no launcher should.
- 242 lines arrived as `output`, the container's own startup line among them, and none of them was mistaken for a frame.

**The finding, and why the launcher's default changed.** The first run used the default host command, `npx -y @ahpd/server@0.6.3`, and the nested host exited 2 at once: that is the *published* 0.6.3, which predates `--stdio`, so it refused the flag. The install step is right for a released build and wrong for an unreleased tree, which is exactly what the `host` option is for; the default is now `ahpd`, the command the install step provides, rather than a resolution through `npx` on every start. This by-hand case therefore names `host` explicitly, and the default works once a version with `--stdio` is published.

## Departures from the plan

- The port answers `connect`, `send` and `disconnect` rather than handing back a duplex. The launcher owns the stream, so line framing and knowing which output is not a frame live there, and the SDK never sees a partial line. `ContainerSink` is how frames, output and the end arrive.
- The capability key is a probe, not a presence: `initialize` awaits `available()` and omits the key when it is false, which is what decision 1 says and what a plugin-loaded host without Docker must look like.
- The staleness test was strengthened beyond the plan's wording, because it read bare identifiers only: every quoted extension method was invisible to it, and nine were classified nowhere. That is the hole the test exists to close.
- The client half is a scope document rather than a plan: `/github/ahpapp/.project/working/dev-containers.md`. That repository has no `plans/` - its records are `working/` scope documents and `decisions/` - so writing one there would have invented a convention rather than followed the one it has. **It was then built**, in that repository, and its scope document records what was verified: the app's own transport opened a real container and shook hands with the host inside it.
- The computer plugin dropped the launcher's `args` option, so an operator who pointed it at `npx` asked npm to run the verb `up` as a package. It passes every option through now, and the page's example names the bin, because a scoped package does not: `["-y", "-p", "@devcontainers/cli", "devcontainer"]`.
- `stamp` now writes to stderr rather than stdout. A socket host's stdout is a log and a detached host's two streams share `daemon.log`, so nothing reads it differently; a stdio host's stdout is the wire, and a status line there would be a frame nothing sent.

## Left for later

- Drawing the CLI's own output while a container starts. The host streams it as `output` notifications and the app drops them, so a first build looks like a pause.
- The container is left running when a relay ends, which is the CLI's lifecycle and the reference host's behaviour. An option to stop it is a later decision.
- A nested host with its own user directory, so the container checks for itself rather than relying on this host's grant.
- The typed upstream field, if AHP ever grows one: the `vscode.devContainers` key and these four names are the reference client's, and the decision that chose them says what would retire them.
