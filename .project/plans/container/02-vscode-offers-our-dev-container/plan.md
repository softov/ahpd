---
title: VS Code offers a dev container on a folder served by ahpd
domain: container
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/container/01-a-session-in-a-dev-container/plan.md
changes: []
creates: []
decisions:
  - decisions/vscode-reaches-ahpd-through-a-dev-tunnel.md
refs:
  - "[code://.project/research/how-vscode-offers-a-dev-container.md](../../../research/how-vscode-offers-a-dev-container.md) - the checks VS Code makes, and which ones ahpd fails"
  - "[code://packages/sdk/src/host.ts#L5140-L5149](../../../../packages/sdk/src/host.ts#L5140-L5149) - the `vscode.devContainers` key"
  - "[code://packages/tunnel-devtunnel/README.md](../../../../packages/tunnel-devtunnel/README.md) - reaching ahpd as a Tunnel entry"
  - "[code://packages/server/src/main.ts#L1052](../../../../packages/server/src/main.ts#L1052) - the line that prints the daemon's `ws://` URL"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/sessions/contrib/providers/remoteAgentHost/browser/devContainerSource.ts#L26-L33 - only SSH, Tunnel and WSL entries are a dev container source
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
```

### Gaps

- ahpd is reachable only as a WebSocket entry in the setup Softov uses.
- Whether a Tunnel entry to ahpd passes every check is untested.
- Nothing documents the route or the two VS Code settings.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [VS Code reaches ahpd through a Dev Tunnel for its dev container flow](../../../decisions/vscode-reaches-ahpd-through-a-dev-tunnel.md) | 01, 02, 03 |

| What | Source | Task |
| --- | --- | --- |
| The container is made at the first send, as VS Code does | VS Code's `prepareNewSession` | - |
| An SSH route waits as an idea | Softov, 2026-09-26: "Later, as an idea" ([idea](../../../ideas/an-ssh-command-that-attaches-to-the-daemon.md)) | - |
| A relayed dev container listed as a computer is `container/03` | Softov, 2026-09-26: "Its own plan, container/03" | - |
| ahpapp keeping a container across its own reload is an ahpapp plan | Softov, 2026-09-26: "Yes, via do-spec in ahpapp" | - |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The tunnel route tried by hand, with every check recorded](task-01-the-tunnel-route-tried-by-hand.md) | blocked | - |
| [02 - What the tunnel try found missing is fixed in ahpd](task-02-what-the-tunnel-try-found-missing.md) | todo | 01 |
| [03 - The route to VS Code's dev container flow is documented](task-03-the-route-documented.md) | todo | 01 |

## Risks and tradeoffs

- The Tunnel route needs a Dev Tunnels sign-in on both ends, and adds Microsoft's relay to every frame.
- Task 01 needs Softov's Windows VS Code; nobody else can run it.

## Resume state

- **Done so far:** the research note and the route decision, 2026-09-26.
- **Next action:** parked 2026-09-26: the tunnel did not appear in VS Code's Agents window; task 01's *Resume* says what to check first.
- **Open questions:** none.
- **Watch out for:** a local Windows folder is launched by VS Code with Windows' Docker and never reaches ahpd; testing with one proves nothing about ahpd.

## Final verification checklist

- [ ] VS Code on Windows, connected to ahpd by the chosen route, shows "Use Dev Container" on a folder with a `devcontainer.json`.
- [ ] The first send makes the container on the ahpd host and the session runs in it.
- [ ] After a VS Code reload the session is there and continues.
- [ ] `docs/CONTAINERS.md` has the route.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `plans/index.md` updated.
