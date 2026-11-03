---
title: Check /mcp from a real MCP client
plans:
  - plans/host/20261102-1347-the-host-serves-its-tools-at-mcp/plan.md
---

# Check /mcp from a real MCP client

host/20261102-1347 is on main. The daemon serves its sessionless tools at `/mcp` when `httpApi` is on and `mcpTools` is `all`. Your `config-dev.json` has neither key now.

## Set up

1. Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node -e 'const fs=require("fs"),f="/home/softov/.config/ahpd/config-dev.json",c=JSON.parse(fs.readFileSync(f,"utf8"));c.httpApi=true;c.mcpTools="all";fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n")'
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

2. In a second terminal, make a member's token, and keep the secret it prints. Put a person from `~/.config/ahpd/users.json` in place of `<member>`:

```bash
cd /github/ahpd && node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts token mint --user <member> --label mcp-check --config-file /home/softov/.config/ahpd/config-dev.json
```

3. Add this to VS Code's `mcp.json`, with the secret in place of `<token>`:

```json
{
  "servers": {
    "ahpd": {
      "type": "http",
      "url": "http://127.0.0.1:37537/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## Steps

1. Start the `ahpd` server in VS Code. Check that it lists the seven session tools.
2. Ask the chat to list your sessions. Check that the answer holds only that person's sessions.
3. Ask it to create a session with `relationship: independent` and a named `agent`. Check that the session runs that agent and belongs to that person.
4. Ask it to send a message to that session. Check that the turn shows that person as the sender.
5. Mint a guest's token the same way, and put it in `mcp.json`. Check that the server lists only `list_sessions` and `get_session_context`.
6. Set `mcpTools` to `none` in `config-dev.json`, and restart the daemon. Check that VS Code cannot reach `/mcp`.

## Reply

Write "pass", or say which step stopped.
