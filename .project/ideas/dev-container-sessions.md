---
title: Dev Container sessions
created: 2026-09-19
---

VS Code's reference host can run a session's agent host inside a Dev Container, and the window reaches it through the host it is already connected to.
The host that owns the socket runs `devcontainer up --workspace-folder <dir>` and `devcontainer exec`, then starts a relay child process whose stdio is wrapped in a WebSocket pointed at the agent host inside the container, with the connection token on that URL as `?tkn=`.
Frames for the nested host then cross the outer AHP connection as base64, sent with `vscode/devContainers/relaySend` and delivered as `vscode/devContainers/relayMessage`, with `relayClose`, `closeConnection` and `output` notifications beside them, and `vscode/requestWorkspaceTrust` asked before any of it starts.
The whole surface is gated on `initialize._meta['vscode.devContainers']`, so a host that omits the key is never asked for any of it, which is what this daemon does today and what makes omitting it complete rather than a gap.

What it would take here: a module owning the CLI processes, per-connection state and the relay, the capability key in `initialize`, and the reverse trust request.
The reference is `src/vs/platform/agentHost/node/devContainerAgentHostService.ts` in the clone, with the method names in `src/vs/platform/agentHost/common/agentHostExtensionProtocol.ts`, both read in the pass recorded at `.project/review/2026-09-19-upstream-pass-4.md`.
It is worth doing only if sessions inside a container are wanted: a git worktree is what this host isolates with today, and a container is a different kind of isolation rather than a better one.
