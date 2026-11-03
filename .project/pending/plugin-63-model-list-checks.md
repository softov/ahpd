---
title: Check the agent-cofold model list
plans:
  - plans/plugin/63-cofold-lists-models-by-provider/plan.md
---

# Check the agent-cofold model list

plugin/63 is on main. agent-cofold lists the models of every cofold provider under the provider's own id.

## Set up

Run this from a terminal that is not a Claude Code session.

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

## Steps

1. Open the model list of the `cofold` agent in a client.
2. Check that the list shows `open_router/...` ids and no `cofold/...` id.
3. Pick an `open_router/...` model, and send one turn.
4. Check that the turn answers on the model you picked.

## Reply

Write "pass", or say which step stopped.
