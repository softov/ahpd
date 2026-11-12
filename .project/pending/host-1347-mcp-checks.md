---
title: Check /mcp from a real MCP client
plans:
  - plans/host/20261102-1347-the-host-serves-its-tools-at-mcp/plan.md
---

# Check /mcp from a real MCP client

host/20261102-1347 is on main. The daemon serves its sessionless tools at `/mcp` when `httpApi` is on and `mcpTools` is `all`. Your `config-dev.json` sets `httpApi` and already sets `mcpTools` to `all`. The `node -e` line in *Set up* makes sure of it.

## Set up

1. Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node -e 'const fs=require("fs"),f="/home/softov/.config/ahpd/config-dev.json",c=JSON.parse(fs.readFileSync(f,"utf8"));c.mcpTools="all";fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n")'
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

2. In a second terminal, add a member and a guest, and make the member's token. Keep the secret it prints. Your `users.json` has no member and no guest yet:

```bash
cd /github/ahpd && ahpd() { node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts "$@" --config-file /home/softov/.config/ahpd/config-dev.json; }
ahpd user add mia --role member && ahpd user add gus
ahpd token mint --user mia --label mcp-check
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

1. Start the `ahpd` server in VS Code. Check that it lists the eleven session tools that `ELEVEN` names in `packages/server/test/mcp.test.ts`, `archive_chat` and `move_session` among them.
2. Ask the chat to list your sessions. Check that the answer holds only that person's sessions.
3. Ask it to create a session with `relationship: independent` and a named `agent`. Check that the session runs that agent and belongs to that person.
4. Ask it to send a message to that session. Check that the turn shows that person as the sender.
5. Mint `gus`'s token the same way (`ahpd token mint --user gus --label mcp-guest`), and put it in `mcp.json`. Check that `/mcp` refuses it with 403, because the built-in `guest` role does not hold `mcp:call`.
6. Set `mcpTools` to `none` in `config-dev.json`, and restart the daemon. Check that VS Code cannot reach `/mcp`.

## Reply

Write "pass", or say which step stopped.
