---
title: A session in a dev container, with its whole host inside it
domain: container
status: built
priority: high
created: 2026-09-24
revalidated: 2026-09-24
requires:
  - plans/plugin/11-a-session-inside-a-computer/plan.md
  - plans/plugin/12-a-client-can-tell-what-a-scheme-does/plan.md
changes: []
creates:
  - packages/sdk/src/containers.ts
  - packages/sdk/src/types/containers.ts
decisions:
  - decisions/a-dev-container-is-made-by-the-dev-container-cli.md
  - decisions/the-relay-surface-is-the-reference-one.md
  - decisions/a-nested-host-speaks-stdio.md
  - decisions/connecting-to-a-dev-container-needs-a-grant.md
refs:
  - "[code://packages/sdk/src/rpc.ts#L74-L100](../../../../packages/sdk/src/rpc.ts#L74-L100) - `createPeer`, whose only demand is a `Wire`"
  - "[code://packages/sdk/src/rpc.ts#L163-L200](../../../../packages/sdk/src/rpc.ts#L163-L200) - `receive`, one frame as a string"
  - "[code://packages/sdk/src/listen.ts#L195-L225](../../../../packages/sdk/src/listen.ts#L195-L225) - the one transport this host has, and the seam it is built on"
  - "[code://packages/sdk/src/host.ts#L4547-L4600](../../../../packages/sdk/src/host.ts#L4547-L4600) - `accept`, where a connection is born and where per-socket state lives"
  - "[code://packages/sdk/src/host.ts#L4686-L4760](../../../../packages/sdk/src/host.ts#L4686-L4760) - `capabilityFor` and the per-connection handler table"
  - "[code://packages/sdk/src/host.ts#L4825-L4845](../../../../packages/sdk/src/host.ts#L4825-L4845) - the `initialize` `_meta` block the capability key joins"
  - "[code://packages/server/src/main.ts#L250-L290](../../../../packages/server/src/main.ts#L250-L290) - flag parsing, where a stdio mode is chosen"
  - "[code://packages/computer/src/plugin.ts#L100-L130](../../../../packages/computer/src/plugin.ts#L100-L130) - the plugin that owns Docker and registers the `computers` port"
  - "[code://.project/ideas/dev-container-sessions.md](../../../ideas/dev-container-sessions.md) - the reference route, read in full"
  - "[code://.project/research/a-backend-inside-a-machine.md](../../../research/a-backend-inside-a-machine.md) - why a nested host is the route that covers every backend"
---

## Goal

A workspace with a `devcontainer.json` can run a session in its dev container against this host.
The reference client's own flow drives it through `vscode/devContainers/*`, and a session inside the container is a session whose files, shells, tools and backends are the container's, because a whole `ahpd` runs in there and this host relays its frames.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "supportsAgentHostDevContainers" /github/externals/vscode/src` - the client gates the flow on `initialize._meta['vscode.devContainers'] === true` (`devContainerAgentHostConnector.contribution.ts:305`) and calls the four methods only after that.
- `rg -n "hasDevContainerConfiguration|isDockerAvailable" .../devContainerAgentHostConnector.contribution.ts` - the flow is offered only for a folder with `.devcontainer/devcontainer.json` or `.devcontainer.json` **and** a Docker answer (`:61-73`, `:139`), which is why Docker alone is not a launcher.
- `rg -n "getDevContainerExecArgs|'up'" .../devContainerAgentHostService.ts` - the CLI contract: `exec --log-level debug --workspace-folder <dir> /bin/sh -c <cmd>`, and `up --log-level debug --workspace-folder <dir>` answering JSON with `containerId` and `remoteWorkspaceFolder`.
- `rg -n "tkn=|createConnection|Duplex" .../devContainerAgentHostService.ts` - the reference relays a WebSocket over the exec's stdio with the nested token on the URL, which this plan does not copy.
- `rg -n "stdio" packages/sdk/src packages/server/src` - nothing: the daemon has one transport and it is a WebSocket.
- `rg -n "createPeer\(|receive\(" packages/sdk/src` - `createPeer` needs `send`, `close`, `isOpen`; `receive` takes a frame as a string. A stdio transport is those calls over stdin and stdout.
- `rg -n "vscode/" packages/sdk/src/host.ts` - nine extension methods are already served and three `vscode.*` keys advertised, so a vendor surface is this host's practice.
- `rg -n "NEEDS|UNGATED" packages/sdk/src/host.ts test/users-gate.test.ts` - every handler must be classified, and the staleness test names both sets.
- `which devcontainer; which docker` - Docker 29.6.2 is present, `devcontainer` is not, so the CLI's absence is the default case the code must answer well.

### Runtime path

```
client: vscode/devContainers/connect { connectionId, workspaceFolder, name }
  -> the host checks `container:write`, then asks the containers port
  -> the port runs `devcontainer up --workspace-folder <dir>`  (the folder's own devcontainer.json)
  -> { containerId, remoteWorkspaceFolder }
  -> the port installs or finds `ahpd` inside, and starts `ahpd --stdio` through `devcontainer exec`
  -> the host answers { connectionId, address: 'devcontainer:<containerId>', remoteWorkspaceFolder, ... }
client: vscode/devContainers/relaySend { connectionId, data }   -> the nested host's stdin
nested: ahpd --stdio                                            -> one JSON frame per line
  -> the host notifies `vscode/devContainers/relayMessage` { connectionId, data }
```

### Gaps

- No stdio transport, so there is nothing for a relay to talk to.
- No `containers` port and no surface, so no client can ask and no plugin can answer.
- The SDK has no runtime dependencies and may not spawn, so the process side has to be a port.
- The nested host has to exist inside the container, which means a command, a version and a config decided by the outer daemon.
- Neither Docker nor the CLI can be assumed by `pnpm test`, and the CLI is not installed on this machine.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A dev container is made by the Dev Container CLI](../../../decisions/a-dev-container-is-made-by-the-dev-container-cli.md) | The user, 2026-09-24: "supporting the vscode/devContainers RPC is possible since we will be supporting docker". The client only asks when a `devcontainer.json` exists, so Docker alone would answer a request whose file we ignored. |
| 2 | [The surface is the reference client's own, name for name](../../../decisions/the-relay-surface-is-the-reference-one.md) | VS Code is the client that has the flow; this host already serves its `vscode/*` methods and gates them on `_meta` keys. |
| 3 | [The nested host speaks AHP over stdio](../../../decisions/a-nested-host-speaks-stdio.md) | Owning both ends makes the reference's WebSocket-over-a-duplex unnecessary: no forwarder, no endpoint, no token on a URL. |
| 4 | [Connecting needs `container:write`](../../../decisions/connecting-to-a-dev-container-needs-a-grant.md) | Starting a container is the host's Docker access by proxy, and a method nobody classified is served to anybody. |

| What | Source | Task |
| --- | --- | --- |
| The daemon answers over stdin and stdout | decision 3 | 01 |
| The four methods and four notifications, gated, per connection | decisions 2, 4 | 02 |
| The container comes from `devcontainer up` | decision 1 | 03 |
| The nested host is installed, configured and started | decisions 1, 3 | 04 |
| Frames cross both ways, and the connection dies with the socket | decisions 2, 3 | 05 |
| The pages and the client | decisions 1, 2 | 06 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The daemon answers over stdio](task-01-the-daemon-answers-over-stdio.md) | done | - |
| [02 - The host serves the dev container surface](task-02-the-host-serves-the-surface.md) | done | - |
| [03 - The container comes from the Dev Container CLI](task-03-the-container-comes-from-the-cli.md) | done | - |
| [04 - A nested host runs inside the container](task-04-a-nested-host-runs-inside.md) | done | 01, 03 |
| [05 - The relay carries the frames](task-05-the-relay-carries-the-frames.md) | done | 02, 04 |
| [06 - The pages, and the client that drives it](task-06-the-pages-and-the-client.md) | done | 02, 05 |

## Risks and tradeoffs

- **The client checks for a `devcontainer.json` and we might not honour it.** The mitigation is decision 1: the CLI is the launcher, and the capability is advertised only where it resolves, so the flow is never offered against a container we would build differently.
- **A relay is a second transport, and a second path is a second place the gate can be missing.** The mitigation is that `receive` and `createPeer` are shared with the socket and the tests drive the same acts over both.
- **A container is not a security boundary.** Docker access from inside a container is not the subject here, but a session's own tools run in there, and a bind mount is the host's files by definition. The pages say so where the machine pages already say it.
- **The version inside the container can drift from the one outside.** The mitigation is that the install command is generated from the outer daemon's own version, and the config handed in is the outer daemon's plugin list, so the two hosts are meant to be the same build.
- **VS Code may combine its detached worktree flow with a dev container.** This host serves both surfaces, and the combination is not tested. The mitigation is a risk note here and a by-hand case in task 06 rather than a claim.
- **`pnpm test` has no Docker and this machine has no CLI.** The mitigation is a fake CLI fixture for `up`, `exec` and the availability probe, and a real end-to-end case that uses stdio with no Docker at all.
- **The nested host needs the container's own backends, keys and tools to be useful.** The mitigation is that the nested config is the outer daemon's own plugin list, and a container without those plugins is a host with no backends, which says so in the session list rather than failing oddly.

## Resume state

- **Done so far:** every task on this host, 2026-09-24. See [implemented.md](implemented.md), which has the by-hand run and the one finding it produced. Task 06's `ahpapp` half is not started.
- **Next action:** none on this host. The client half is `/github/ahpapp/.project/working/dev-containers.md`, a scope document for that repository.
- **Open questions:**
  1. Does the nested host load the outer daemon's plugins, or a container-specific list? - proposed: the outer daemon's list by default, with a config key to replace it, because the container is meant to be the same host in a different place.
  2. Where do the container's model credentials come from? - proposed: the relayed client signs in against the nested host's own protected resources, so nothing is copied out of the outer host's configuration.
  3. What happens to the container when the connection drops? - proposed: it is left running, because the reference leaves the container to the CLI and a person's `devcontainer` lifecycle, and only the relay dies. A later option could stop it.
  4. Does `isDockerAvailable` answer for the CLI too, or is the key the only place that is decided? - proposed: `isDockerAvailable` stays literally Docker, because its name is another program's, and the CLI's presence is the key.
- **Watch out for:** `--token` in this daemon's CLI is the connection token and not a credential for a model; the nested host's config is a file written inside a container, so nothing secret belongs in it. `@devcontainers/cli` is not installed here and the plan must not require it for the suite to pass.

## Final verification checklist

- [x] `pnpm test`, `pnpm typecheck`, `pnpm boundary` and `pnpm build` green with no Docker and no `devcontainer` installed.
- [x] A frame written to the daemon's stdin is answered on its stdout, and the gate and the tap apply to it as they do to a socket.
- [x] `_meta['vscode.devContainers']` is absent without a launcher that answers and present with one; an ungranted client is refused `-32009` with `container:write` in the sentence.
- [x] The four methods and four notifications are exercised through a fake port, including a relay whose process exits, whose stderr arrives as `output`, and whose socket closes.
- [x] With a real nested `ahpd` on stdio and no Docker: `connect`, then `initialize` and one `ping` through `relaySend`, answered by the nested host.
- [x] By hand, with `@devcontainers/cli` 0.89.0 and Docker 29.6.2: a workspace with a `devcontainer.json`, a container the CLI made, and the tree's own host answering from inside it. Recorded in [implemented.md](implemented.md) and named in `docs/CONTAINERS.md`.
- [x] `plans/index.md`, `docs/CONTAINERS.md`, `docs/PLUGINS.md` and `working/HANDOFF.md` updated.
- [x] The `ahpapp` half of task 06, which is a scope document in that repository's own convention.
