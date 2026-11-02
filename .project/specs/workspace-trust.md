---
title: Workspace trust and served folders
status: current
covers:
  - packages/sdk/src/host/trust.ts
  - packages/sdk/src/host/spawn.ts
  - packages/sdk/src/host/lifecycle.ts
  - packages/sdk/src/host/chatactions.ts
  - packages/sdk/src/host/gate.ts
  - packages/server/src/commands/paths.ts
  - packages/server/src/commands/configure.ts
  - packages/server/src/commands/options.ts
decisions:
  - decisions/root-config-declares-what-vscode-pushes-and-refuses-the-rest.md
refs:
  - "[code://packages/sdk/src/host/trust.ts#L106-L143](../../packages/sdk/src/host/trust.ts#L106-L143) - `trusted`, whether one folder is trusted"
  - "[code://packages/sdk/src/host/trust.ts#L165-L222](../../packages/sdk/src/host/trust.ts#L165-L222) - `granted` and `requireTrust`, the question to a window"
  - "[code://packages/sdk/src/host/spawn.ts#L630-L657](../../packages/sdk/src/host/spawn.ts#L630-L657) - `trustedBy`, the answer a backend gets as `start.trusted`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L834-L870](../../packages/sdk/src/host/lifecycle.ts#L834-L870) - `moveSession`, which asks before a move"
  - "[code://packages/sdk/src/host/chatactions.ts#L645-L670](../../packages/sdk/src/host/chatactions.ts#L645-L670) - a working directory added to a session"
  - "[code://packages/sdk/src/host/actions.ts#L372-L378](../../packages/sdk/src/host/actions.ts#L372-L378) - a `workspaceTrust` push clears the pushing window's folder answers"
  - "[code://packages/sdk/src/host/gate.ts#L297-L308](../../packages/sdk/src/host/gate.ts#L297-L308) - `dispatchNeeds`, the `trust:push` scope"
  - "https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostSessionPrewarmer.ts#L162 - VS Code's host reads one trust value for every session"
  - "[code://packages/server/src/commands/paths.ts#L100-L320](../../packages/server/src/commands/paths.ts#L100-L320) - `ahpd paths list`, `add` and `remove`"
  - "[code://packages/server/src/commands/configure.ts#L308-L320](../../packages/server/src/commands/configure.ts#L308-L320) - `askToServe`"
  - "[code://packages/server/src/commands/options.ts#L1035-L1048](../../packages/server/src/commands/options.ts#L1035-L1048) - the start folder and `--no-cwd`"
  - "[code://packages/agent-claude/src/session/query.ts#L320](../../packages/agent-claude/src/session/query.ts#L320) - Claude reads project settings only in a trusted folder"
  - "[code://packages/agent-acp/src/session/opening.ts#L333-L335](../../packages/agent-acp/src/session/opening.ts#L333-L335) - ACP refuses an untrusted folder unless the preset sets `honoursTrust`"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-folder-is-untrusted-until-a-client-says-otherwise, a-served-paths-change-reaches-the-running-daemon, a-start-in-an-unserved-folder-asks-to-serve-it, a-worktree-inherits-its-repositorys-trust, ahpd-paths-lists-adds-and-removes-a-served-folder, the-sender-decides-on-a-host-with-no-people
---

Workspace trust says whether a backend may load a folder's own settings, hooks and MCP servers. A window pushes `workspaceTrust`, and the host keeps one value for every session, which the last push sets, as VS Code's host does. A backend asks the host through `start.trusted(folder)`, and a folder is untrusted until a client says otherwise. Before a session moves to a folder, or adds a working directory, the host asks the window with `vscode/requestWorkspaceTrust`. Served folders are a different thing: they are the folders this host offers at all, kept in `paths` and edited with `ahpd paths`.

## Scenarios

### A folder is untrusted until a client says otherwise

WHEN a backend asks whether a folder is trusted
AND the host's `workspaceTrust` has `enabled: true` and a `trustedUris` list
THEN the folder is trusted when the list holds the folder or a folder above it.

WHEN the host's value has `enabled: false`
THEN every folder is trusted.

WHEN no window pushed a value, or the value has no `enabled`
THEN the folder is untrusted, unless the window that sent the turn said yes to it when it was asked.

The host resolves symlinks and `..` before it compares folders, also for a folder that does not exist yet.
A `file://` URI with a host other than `localhost` names no folder here.
See [`code://packages/sdk/src/host/trust.ts`](../../packages/sdk/src/host/trust.ts).

### A backend acts on the answer

WHEN a Claude session starts in an untrusted folder
THEN it reads only user settings, and it does not read the folder's `.mcp.json`.

WHEN an ACP session starts in an untrusted folder
AND the preset does not set `honoursTrust`
THEN the start fails with a message that names the folder.

The pi backend trusts the project only when the folder is trusted and its own trust option is not `deny`.

### A move asks the window

WHEN a client moves a session to a folder, or adds a working directory to it
AND the host's trust does not cover the folder, and that window did not say yes to it
THEN the host sends `vscode/requestWorkspaceTrust` with the folder as `workspace`
AND only the answer `{trusted: true}` lets the move go on.

A client that does not serve the method gives an error, and the host reads that as a no.
There is no timeout, as in VS Code, because a person may take time to answer.
A refusal says "Workspace trust was not granted for '<folder>'".
With `globalAutoApproveEnabled` or `autoApprove: 'autoApprove'`, the host does not ask.

### A yes is kept on the connection

WHEN a window says yes to a folder
THEN the host keeps the folder on that connection
AND each backend started from that connection sees the folder as trusted.

WHEN the window pushes a new `workspaceTrust` value
THEN the host forgets that window's folder answers, because the value answers for every folder.

A push of `workspaceTrust` needs the `trust:push` scope.
See [`code://packages/sdk/src/host/gate.ts`](../../packages/sdk/src/host/gate.ts).

### No window asked

WHEN a move or a new working directory comes from no connection, for example from an automation
AND the host's trust does not cover the folder
THEN the host refuses it without a question, because nobody can vouch for the folder.

### A worktree inherits its repository's trust

WHEN a backend asks about a worktree that this host made for the session
THEN the host answers for the repository that the worktree was cut from.

The reason: a window never opened the worktree, so it cannot have pushed trust for it.
The host does not send `trustedParent`, which VS Code sends for a folder that does not exist yet.
When a move names a repository other than the move folder, the host asks about the repository too.
See [`code://packages/sdk/src/host/spawn.ts`](../../packages/sdk/src/host/spawn.ts).

### The host's trust decides on a host with no people

WHEN the host has no people
THEN the host's trust decides for every turn, a turn no window sent among them.

WHEN the host has people
AND the sender is not the session's owner
THEN the folder is untrusted for that session.

The reason: a host with no people has no owner to compare, so a check would refuse every folder.
On a host with people, a turn with no sender sees every folder as untrusted.

### ahpd paths lists the served folders

WHEN a person runs `ahpd paths list`
THEN ahpd prints the served folders.

On a running daemon, the list is the live list.
The verb needs the `config:read` scope.

### ahpd paths adds a served folder

WHEN a person runs `ahpd paths add <folder>`
AND the folder exists and is a folder
THEN ahpd adds it to `paths`, with no question.

A folder that is already served, or under a served folder, stays as it is.
When the file has no `paths`, ahpd also writes the start folder, so that a restart still serves it.

### ahpd paths removes a served folder

WHEN a person runs `ahpd paths remove <folder>`
THEN ahpd removes it from `paths` and keeps every other key.

WHEN the folder is not in `paths`
THEN ahpd refuses.

WHEN it is the last folder
THEN ahpd refuses, because a daemon with no `paths` serves the folder it starts in.

`add` and `remove` need the `config:write` scope, and over HTTP they need the deployment token.
See [`code://packages/server/src/commands/paths.ts`](../../packages/server/src/commands/paths.ts).

### A served paths change reaches the running daemon

WHEN a person runs `ahpd paths add` or `remove` at the terminal, with no `--config-file`
AND the record names a daemon that serves the HTTP API
THEN ahpd sends the change to that daemon, with the token from the record
AND the daemon changes its live list and its file, and the change applies at once.

WHEN the daemon does not answer in 10 seconds
THEN ahpd writes the file
AND when a daemon is recorded, it prints "Restart the daemon to apply the change: ahpd restart."

A wildcard bind address in the record is sent to loopback.
The default folder and the plugins' copy of `paths` change only at the next start.

### A start in an unserved folder asks to serve it

WHEN `ahpd start` or `ahpd run` starts at a terminal in a folder that no served folder holds
THEN ahpd asks "Serve <folder>?", with No as the default
AND a yes writes the folder to the config file and serves it in this run.

ahpd does not ask with `--no-cwd`, without a terminal, or when the folder is already served.
`ahpd start` asks before it starts the detached daemon.
See [`code://packages/server/src/commands/configure.ts`](../../packages/server/src/commands/configure.ts).

### No paths and no start folder

WHEN `paths` is empty
THEN the daemon serves the folder it starts in.

WHEN `paths` is empty and `--no-cwd` is given
THEN ahpd stops with "--no-cwd serves only what --path or "paths" names, and neither does. Pass --path, or run ahpd configure."

`ahpd configure` asks "Serve <folder>?" for each folder with Yes as the default, and it refuses when every folder is refused.
