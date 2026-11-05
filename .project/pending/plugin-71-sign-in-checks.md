---
title: Check an OpenRouter sign-in
plans:
  - plans/plugin/71-a-connector-signs-in-with-its-provider/plan.md
---

# Check an OpenRouter sign-in

plugin/71 is on main, and ahpw main has the sign-in button. A connector of the `openrouter` adapter signs in to OpenRouter. This check needs a real OpenRouter account.

## Set up

Run this from a terminal that is not a Claude Code session.

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

## Steps

1. In ahpw, add a connector of the `openrouter` adapter, and press the sign-in button.
2. Sign in to OpenRouter on the page it opens.
3. Check that the connector row is `ready`.
4. Check the record, with the connector's id in place of `<id>`. Expect a `$secret` reference and no key:

```bash
cat ~/.config/ahpd/connectors/<id>.json
```

5. Check that the daemon's terminal, the answers and every row show no code and no key.
6. Call a model through the connector, with its name in place of `<model>`, and check that the answer has a reply:

```bash
curl -s http://127.0.0.1:37537/v1/chat/completions -H "Authorization: Bearer $(cat /home/softov/.vscode/cli/agent-host-token)" -H 'Content-Type: application/json' -d '{"model":"<model>","messages":[{"role":"user","content":"Say ok."}]}'
```

## Reply

Write "pass", or say which step stopped.
