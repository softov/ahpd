---
title: Check the proxy after the move to connectors
plans:
  - plans/proxy/04-providers-are-connectors/plan.md
---

# Check the proxy after the move to connectors

The move is done: `config-dev.json` has no `modelProxy.providers`, and `~/.config/ahpd/connectors/` holds `openrouter`, `claude-login` and other connectors. One call through the proxy is left. The proxy is served under `/v1` only while `httpApi` is on. Your `config-dev.json` sets `http`, the old name of `httpApi`, so it is on. Do not add `httpApi` too, because the daemon refuses a file that holds both names.

## Results so far

The same two calls passed on a test daemon at 8b5423b2 on 2026-11-04: `/v1/models` listed 417 `openrouter/` names, and a call answered. That daemon had a fresh config, so the check of `config-dev.json` after the move stays.

## Set up

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
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
