---
title: Check /mcp from a real MCP client
plans:
  - plans/host/20261102-1347-the-host-serves-its-tools-at-mcp/plan.md
---

# Check /mcp from a real MCP client

Plan host 1347 serves the host's sessionless tools at `/mcp`. Its tests call the door over HTTP with no MCP client. This check needs your daemon and VS Code.
Set `httpApi` on and `mcpTools` to `all`, then restart the daemon on main.
Add the server to VS Code's `mcp.json` as [MCP.md](../../docs/server/MCP.md) says, with a member's token.

## Steps

1. Start the server in VS Code. Check that it lists the seven session tools.
2. Ask the chat to list your sessions. Check that the answer holds only your sessions.
3. Ask it to create a session with `relationship: independent` and a named `agent`. Check that the session runs that agent and is yours.
4. Ask it to send a message to that session. Check that the turn shows you as the sender.
5. Change the token to a guest's. Check that it lists `list_sessions` and `get_session_context` only.
6. Set `mcpTools` to `none` and restart. Check that VS Code cannot reach `/mcp`.

## Reply

Write "done" when each step works, or say which step stopped.
