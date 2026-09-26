---
title: Cofold runs its own tools in its own process, as Claude does
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-cofold/src/session.ts#L353-L365](../../packages/agent-cofold/src/session.ts#L353-L365) - `agentOf`, where a session's cofold agent is built with the host's tools only"
  - "[code://packages/agent-claude/src/session.ts#L932](../../packages/agent-claude/src/session.ts#L932) - Claude's write tools, reported through `onFileEdit` while the CLI runs them itself"
  - file:///github/cofold/packages/tools/src/index.ts - `files`, `shell`, `web` and `memory`, as capabilities
  - file:///github/cofold/packages/papo/src/agent.ts - `capabilitiesOf`, how papo turns them on
---

## Context

A cofold session in ahpd gets only the host's tools (`ahp_resource`, `ahp_terminals`, the session tools, a client's tools), so it cannot read, edit or run anything the way a Claude session can.
`@cofold/tools` ships files, shell, web and memory, and cofold exists to be a library for agents.

## Decision

A cofold session gets `@cofold/tools`' four capabilities, and they run in cofold's own process, the way Claude's tools run in the Claude CLI.
ahpd reports the calls, asks for permission through cofold's policy and hooks, and reports edits through `onFileEdit`; it does not execute them.
Source: Softov, 2026-09-26, "so the thing is to change cofold tools to act like internal claude tools? tools and agent-cofold already has hooks... cofold was created just for that purpose.. be a lib for agent usage", and asked "Which cofold tools should a cofold session get?", answered "files, shell, web, memory".

## Consequences

`@cofold/tools` becomes a dependency of `@ahpd/agent-cofold`, beside `@cofold/agents`; the daemon does not change.
The tools act on the machine cofold runs on, so a session in a computer needs cofold to run there: [a cofold session in a computer runs in a nested host](a-cofold-session-in-a-computer-runs-in-a-nested-host.md).

## Options

- **Route them through the host.** Same names and inputs, executed by the host's resource layer and terminals, so they would follow a session into a computer; but every tool is rewritten on ahpd's side and cofold stops being the library that runs its own tools.
- **Keep the host's tools only.** Nothing to build, and cofold stays unable to do what the other backends do.
