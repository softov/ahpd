---
title: A client plugin lists its parts, and a part can be switched off - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/pluginparts.ts](../../../../packages/sdk/src/pluginparts.ts)"
  - "[code://packages/sdk/src/host/tooling.ts](../../../../packages/sdk/src/host/tooling.ts)"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/agent-claude/src/session/query.ts](../../../../packages/agent-claude/src/session/query.ts)"
---

A client plugin that host/49 copied now lists its agents, skills, rules, hooks and MCP servers as `children`, in VS Code's order.
A part's id is the URI of its file in this host's copy, and a server's id adds `#mcp=<encoded name>`.
A client can switch off one MCP server through `childEnablement` or a toggle, and the agent does not get that server.
The chat starts again at the next send with the new set of servers.

## What was built

- [`code://packages/sdk/src/pluginparts.ts`](../../../../packages/sdk/src/pluginparts.ts) - `partsOf` reads `.claude-plugin/plugin.json` or `.plugin/plugin.json` and the default places, one part per file or server.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - the parts are published as `children`, `childEnablement` applies to servers, `mcpFor` skips a server switched off, and `deniedMcpServers` names the rest.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a server toggle is offered to the backend's live switch, and a backend with no switch does not refuse it.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - `Start.deniedMcpServers` carries the names to a backend.
- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - the names join the CLI's `settings.deniedMcpServers`.
- [`code://packages/agent-claude/src/session/servers.ts`](../../../../packages/agent-claude/src/session/servers.ts) - `serverNamed` reads a plugin server's id.

## Verified

- In the review worktree on main `69661c8`: install, schema, build, typecheck and boundary pass, and the full suite passes.
- `pluginparts.test.ts` has eight cases on reading the parts.
- `client-plugins-session.test.ts` covers the published `children` and `childEnablement` as a server's `enablement`.
- `host-tools.test.ts` toggles a server off and on, switches a plugin off, and toggles on a backend with no live switch.
- `host-harness.test.ts` switches a plugin server off on a live Claude session.

## Departures from the plan

- Task 02's tests are in `client-plugins-session.test.ts`, because `clientplugins.test.ts` does not exist; Softov settled this on 2026-10-09.
- The review changed the toggle on a backend with no live switch: the host drops the answer and does not refuse the toggle.

## Left for later

- A part's frontmatter, such as a description, is not read.
- Only the Claude format and `.plugin/plugin.json` are read; a plugin in another format lists no parts.
