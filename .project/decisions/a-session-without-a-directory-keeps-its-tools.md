---
title: A cofold session with no working directory keeps its tools, and the permission mode confines them
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-cofold/src/session.ts#L191](../../packages/agent-cofold/src/session.ts#L191) - `where`, the client's directory or the daemon's current directory"
  - "[code://packages/agent-pi/src/session.ts#L63](../../packages/agent-pi/src/session.ts#L63) - pi falls back to the daemon's current directory the same way"
  - "[code://packages/agent-acp/src/session.ts#L78](../../packages/agent-acp/src/session.ts#L78) - acp does too, after its own `cwd` option"
---

## Context

A client may create a session without naming a working directory.
The cofold session then works in the daemon's current directory, so files, shell, the `acceptEdits` boundary and the memory slug all hang off wherever the daemon was started.

## Decision

A session with no working directory keeps `shell_exec` and the files tools; they are left out only where that is mandatory, and nothing here makes it so.
The root relative paths resolve against is the session's working directory, and when the client named none it is the daemon's current directory, as `agent-pi` and `agent-acp` do.
What confines the tools is the permission mode, not the workspace.
Source: Softov, 2026-09-26, asked "Should a session with no working directory get the tools at all? (a) Yes, rooted at the daemon's cwd, as now. (b) Leave out shell and files. (c) Refuse the session.": keep shell and files, "a workspace is not a constraint to not write on some place if write full is enabled".

## Consequences

Memory for such a session is keyed by the daemon's current directory, the same workspace every such session shares.
`default` still asks before a write, a command and, by [the read decision](a-cofold-read-outside-the-workspace-asks-in-default-mode.md), a read outside that directory.

## Options

- **Leave out shell and files.** A session with no folder could not do what the plan's goal says a cofold session does.
- **Refuse the session.** A client that names no folder gets nothing, where every other backend serves it.
