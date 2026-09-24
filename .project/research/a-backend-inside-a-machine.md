---
title: Two ways a backend could run inside a machine, and which backends each covers
date: 2026-09-23
refs:
  - "[code://packages/sdk/src/computers.ts](../../packages/sdk/src/computers.ts) - the gate that refuses today, and the two functions either route would replace"
  - "[code://packages/sdk/src/types/computers.ts](../../packages/sdk/src/types/computers.ts) - `ComputerPort.how`, which answers how to reach a machine as a process"
  - "[code://packages/computer/src/plugin.ts#L100-L125](../../packages/computer/src/plugin.ts#L100-L125) - the port over Docker, and the `asked.cwd` it already honours"
  - "[code://packages/agent-acp/src/session.ts#L447-L479](../../packages/agent-acp/src/session.ts#L447-L479) - `placed()`, the one backend that moves today"
  - "[code://packages/agent-claude/src/session.ts#L1522-L1531](../../packages/agent-claude/src/session.ts#L1522-L1531) - the Claude SDK's `query` options, where `cwd` is passed"
  - "[code://packages/agent-claude/src/claude.ts#L378-L390](../../packages/agent-claude/src/claude.ts#L378-L390) - `refuseComputer`, the line the hook would replace"
  - "[code://packages/agent-cofold/src/session.ts#L171](../../packages/agent-cofold/src/session.ts#L171) - cofold's working directory, which is this process's"
  - "[code://packages/agent-cofold/src/tools.ts#L32-L40](../../packages/agent-cofold/src/tools.ts#L32-L40) - the host's tools as cofold tools, run in this process"
  - "[code://.project/ideas/dev-container-sessions.md](../../.project/ideas/dev-container-sessions.md) - the reference client's route: a whole agent host inside the container"
---

# The question

After the refusal was built, the user asked whether Claude and cofold can be made to run in a machine properly, rather than refusing.
The answer is not the same for the two, and it is not a limitation of this host either way.

# Route one: move the process the backend spawns

A backend that starts a child process and speaks to it can start that child in the machine instead.
That is what `@ahpd/agent-acp` does through `Start.computers`, and the port already builds the whole command: `docker exec -i`, the machine's working directory or the caller's (`asked.cwd`, `plugin.ts:109`), the caller's environment as `-e`, the id, then the command and its arguments.

**Claude Code fits this route, and the SDK is written for it.**
`Options.spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess` exists in the installed SDK (`sdk.d.ts:2339-2343`), its doc comment says "Use this to run Claude Code in VMs, containers, or remote environments", and the runtime passes it straight through to its process transport (`spawnClaudeCodeProcess: u.spawnClaudeCodeProcess` in `sdk.mjs`).
`SpawnOptions` carries `command`, `args`, `cwd` and `env`, and `SpawnedProcess` is the child-process surface the transport needs: `stdin`, `stdout`, `killed`, `exitCode`, `kill`, `on`. A Node `ChildProcess` satisfies it as it is.
The SDK even warns about this case by name: a custom spawner with a session store must keep `CLAUDE_CONFIG_DIR` the same in the subprocess, "custom spawnClaudeCodeProcess / container?", so the concern is anticipated rather than fought.
What the route needs from this host:

1. `spawnClaudeCodeProcess` is **synchronous** while `how()` is **async**, because it inspects the machine first. So the descriptor has to be asked before `query(...)` starts and the hook spawns what was already resolved. That is the same shape `placed()` already has in the ACP backend, one step earlier.
2. The CLI has to exist in the image. `pathToClaudeCodeExecutable` names it, so the backend would take it from its own options the way the ACP backend takes `command`.
3. The session's directory has to be a path the machine has, which means a bind mount declared in the manifest. The port will pass `-w <cwd>`, and without the mount the CLI starts in a directory that is not there.
4. The credential travels as it does for ACP: the SDK's `env` (which carries `ANTHROPIC_API_KEY`) is what the backend hands `how()`, and the port forwards it as `-e`.

None of that is a protocol change, and none of it is Claude-specific plumbing invented here: it is four decisions about where the CLI lives and what the machine must be given.

# Route two: put a whole agent host in the machine and relay

The reference client does not move a backend. It runs an entire agent host inside the container and reaches it through the connection it already has (`dev-container-sessions.md`: `devcontainer up`, `devcontainer exec`, a relay child whose stdio is wrapped in a WebSocket, frames carried over the outer AHP connection as base64, gated on `initialize._meta['vscode.devContainers']`).
Every harness that host has then runs in the container, because the host is in the container, and so do its files, its shells and its `computer:` provider.

This is the only route that covers cofold, and it covers Claude too, so it is the one to weigh rather than route one.
What it costs here: a relay and the methods that carry its frames, the capability key in `initialize`, the reverse trust request, and per-connection lifecycle for the CLI processes. That is a plan, not a task, and it is a second isolation mechanism beside the git worktree this host uses today.

# Why cofold cannot take route one

cofold has no child process to move.
Its loop runs in this process, its working directory is `start.workingDirectory ?? process.cwd()` (`agent-cofold/src/session.ts:171`), and its tools are the host's own `BoundTool`s wrapped for cofold and executed here (`agent-cofold/src/tools.ts:32-40`).
Its outbound model calls are `fetch` from this process, and its shell tool is this host's shell.
So there is no single process to point at a machine, and moving only the HTTP calls would leave the loop, the tools and the files on the host: a session that says `computer://box` and runs in neither place would be exactly the lie the refusal exists to prevent.
cofold gains a machine the day it has a server mode a backend can drive, and its own survey lists ACP as something the other harnesses have and it does not (`/github/cofold/.project/research/agent-harness-survey.md:273`). Until then the honest answer for cofold is route two: its loop runs inside the machine as part of a host that is running there.

# What was decided now, and what is open

Nothing was built from this note: the refusal stays, and it is what makes the current state honest.
What is open is a choice between a small feature (route one, for Claude, which still leaves cofold out) and a plan (route two, which covers every backend and is the reference client's own answer).
Route one does not become wasted work under route two: `Start.computers` and the port are what the ACP backend uses either way.
