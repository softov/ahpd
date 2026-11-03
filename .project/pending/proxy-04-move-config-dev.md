---
title: Check the proxy after the move to connectors
plans:
  - plans/proxy/04-providers-are-connectors/plan.md
---

# Check the proxy after the move to connectors

The move is done: `config-dev.json` has no `modelProxy.providers`, and `~/.config/ahpd/connectors/` holds `openrouter`, `claude-login` and other connectors. One call through the proxy is left. The proxy is served under `/v1` only while `httpApi` is on, and your `config-dev.json` does not set it.

## Set up

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node -e 'const fs=require("fs"),f="/home/softov/.config/ahpd/config-dev.json",c=JSON.parse(fs.readFileSync(f,"utf8"));c.httpApi=true;fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n")'
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

## Steps

1. In a second terminal, list the models, and check that the list has `openrouter/...` names:

```bash
curl -s http://127.0.0.1:37537/v1/models -H "Authorization: Bearer $(cat /home/softov/.vscode/cli/agent-host-token)" | head -c 2000
```

2. Call one of them, with its name in place of `<model>`, and check that the answer has a reply:

```bash
curl -s http://127.0.0.1:37537/v1/chat/completions -H "Authorization: Bearer $(cat /home/softov/.vscode/cli/agent-host-token)" -H 'Content-Type: application/json' -d '{"model":"<model>","messages":[{"role":"user","content":"Say ok."}]}'
```

## Reply

Write "pass", or say which step stopped.
