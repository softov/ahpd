---
title: An SSH command that attaches VS Code to the running daemon
created: 2026-09-26
---

VS Code's SSH entry can skip its own CLI: with `chat.sshRemoteAgentHostCommand` set, it runs that command over SSH, reads the first `ws://127.0.0.1:PORT[?tkn=TOKEN]` it prints, and forwards that port over the same SSH connection ([`sshRemoteAgentHostService.ts#L937-L953`](https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/sshRemoteAgentHostService.ts#L937-L953)).
An SSH entry is one of the three VS Code offers dev containers through, so this is a second route beside the Dev Tunnel one ([decision](../decisions/vscode-reaches-ahpd-through-a-dev-tunnel.md)).

VS Code treats the command as a process it starts and owns, and ahpd is a daemon already running.
An `ahpd attach` would bridge that: find the running daemon through its status, print its URL, and stay open for as long as VS Code holds the channel.

Worth doing if the tunnel is too slow or its sign-ins get in the way, or for a host that must not go through a third party.
Open: the setting is per window and marked a dev override, so one VS Code window could not use it for ahpd and VS Code's own host on other SSH machines at once.
