---
title: VS Code offers a dev container on a folder served by ahpd
domain: container
status: active
priority: high
created: 2026-09-26
revalidated: 2026-10-04
requires:
  - plans/container/01-a-session-in-a-dev-container/plan.md
  - plans/container/03-a-dev-container-is-a-computer/plan.md
  - plans/plugin/16-a-disposable-machine/plan.md
changes: []
creates: []
decisions:
  - decisions/vscode-reaches-ahpd-through-a-dev-tunnel.md
refs:
  - "[code://.project/research/how-vscode-offers-a-dev-container.md](../../../research/how-vscode-offers-a-dev-container.md) - the checks VS Code makes, and which ones ahpd fails"
  - "[code://packages/sdk/src/host/handshake.ts#L259](../../../../packages/sdk/src/host/handshake.ts#L259) - the `vscode.devContainers` key"
  - "[code://packages/sdk/src/host/handshake.ts#L163-L165](../../../../packages/sdk/src/host/handshake.ts#L163-L165) - `containersReady`, which decides whether the key is advertised"
  - "[code://packages/tunnel-devtunnel/src/discovery.ts#L33-L69](../../../../packages/tunnel-devtunnel/src/discovery.ts#L33-L69) - the tunnel labels, `vscode-server-launcher`, the protocol label and `_ahpd`"
  - "[code://packages/tunnel-devtunnel/README.md](../../../../packages/tunnel-devtunnel/README.md) - reaching ahpd as a Tunnel entry"
  - "[code://packages/server/src/config.ts#L427](../../../../packages/server/src/config.ts#L427) - where the daemon's `ws://` URL is built"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/sessions/contrib/providers/remoteAgentHost/browser/devContainerSource.ts#L26-L33 - only SSH, Tunnel and WSL entries are a dev container source
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/sessions/contrib/providers/remoteAgentHost/electron-browser/tunnelAgentHostServiceImpl.ts#L205-L227 - VS Code lists tunnels with its own GitHub or Microsoft token
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/agentHostExtensionProtocol.ts#L24-L34 - the `vscode/devContainers/*` methods, `stop` and `remove` among them
---

## Goal

A person in VS Code, on any machine, picks a folder that lives on the ahpd host, sees "Use Dev Container", and gets a session in that folder's dev container, made by ahpd with the host's Docker.
Today the option never appears, because ahpd is connected as a WebSocket entry and VS Code offers dev containers only through SSH, Tunnel and WSL entries.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
The whole finding is in the research note.

### Runtime path

```
VS Code: Connect via Dev Tunnel             -> a Tunnel entry for ahpd
picker: folder on that host, devcontainer.json -> isDockerAvailable on ahpd -> "Use Dev Container"
first send                                      -> vscode/devContainers/connect (container/01)
reload                                          -> VS Code reconnects on demand
idle or removed                                 -> [new] vscode/devContainers/stop | remove -> the folder's computer
```

### Gaps

- ahpd is reachable only as a WebSocket entry in the setup Softov uses.
- Whether a Tunnel entry to ahpd passes every check is untested.
- Nothing documents the route.
- ahpd does not serve `vscode/devContainers/stop` and `vscode/devContainers/remove`, which VS Code sends to stop an idle container or remove one.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [VS Code reaches ahpd through a Dev Tunnel for its dev container flow](../../../decisions/vscode-reaches-ahpd-through-a-dev-tunnel.md) | 01, 02, 03 |
| [Stopping a dev container needs the computer's grant](../../../decisions/stopping-a-dev-container-needs-the-computers-grant.md) | 04 |

| What | Source | Task |
| --- | --- | --- |
| The container is made at the first send, as VS Code does | VS Code's `prepareNewSession` | - |
| An SSH route waits as an idea | Softov, 2026-09-26: "Later, as an idea" ([idea](../../../ideas/an-ssh-command-that-attaches-to-the-daemon.md)) | - |
| A relayed dev container listed as a computer is `container/03` | Softov, 2026-09-26: "Its own plan, container/03" | - |
| ahpapp keeping a container across its own reload is an ahpapp plan | Softov, 2026-09-26: "Yes, via do-spec in ahpapp" | - |
| ahpd serves `vscode/devContainers/stop` and `remove` under VS Code's names and shapes | upstream parity; VS Code 1.140 `agentHostExtensionProtocol.ts:27-28` | 04 |
| Stop and remove also answer `false` while any session is placed on the folder's computer, and task 04 is built after container/03 and plugin/16 | (defaulted: after container/03 the container is a shared computer with sessions placed on it, and plugin/16 brings the `computer:write` gate and the owner) | 04 |
| `chat.remoteAgentHostsEnabled` and `chat.agentHost.devContainer.enabled` both default to `true` in VS Code 1.140, so neither is a step, only a check | VS Code 1.140 (`7516b04bc94`) | 01, 03 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The tunnel route tried by hand, with every check recorded](task-01-the-tunnel-route-tried-by-hand.md) | blocked | Softov's Windows VS Code run |
| [02 - What the tunnel try found missing is fixed in ahpd](task-02-what-the-tunnel-try-found-missing.md) | blocked | 01 |
| [03 - The route to VS Code's dev container flow is documented](task-03-the-route-documented.md) | blocked | 01 |
| [04 - VS Code's stop and remove reach the folder's computer](task-04-stop-and-remove-are-served.md) | done | container 03, plugin 16 |

## Risks and tradeoffs

- The Tunnel route needs a Dev Tunnels sign-in on both ends, and adds Microsoft's relay to every frame.
- Task 01 needs Softov's Windows VS Code; nobody else can run it.

## Resume state

- **Done so far:** the research note and the route decision, 2026-09-26. Task 04 built, reviewed and done 2026-10-10, with its decision; a stop that misses a session placed by computer URI is an open problem.
- **Next action:** task 01 again, with the tunnel made under the same provider and account VS Code signs in with. Tasks 02 and 03 wait on it.
- **Open question (answered 2026-10-10):** what do `vscode/devContainers/stop` and `remove` need from the asker? Softov: `container:write` and `computer:write`, with no owner check, because a grant is role-wide everywhere else in the host. Recorded in [Stopping a dev container needs the computer's grant](../../../decisions/stopping-a-dev-container-needs-the-computers-grant.md).
- **Watch out for:** a local Windows folder is launched by VS Code with Windows' Docker and never reaches ahpd; testing with one proves nothing about ahpd. The tunnel labels already match what VS Code filters on; VS Code lists tunnels with its own GitHub or Microsoft token, so a tunnel made by `devtunnel user login` under another provider or account never appears.

## Final verification checklist

- [ ] VS Code on Windows, connected to ahpd by the chosen route, shows "Use Dev Container" on a folder with a `devcontainer.json`.
- [ ] The first send makes the container on the ahpd host and the session runs in it.
- [ ] After a VS Code reload the session is there and continues.
- [ ] `docs/CONTAINERS.md` has the route.
- [ ] VS Code stopping an idle dev container, and removing one, acts on the folder's computer on the ahpd host.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `plans/index.md` updated.
