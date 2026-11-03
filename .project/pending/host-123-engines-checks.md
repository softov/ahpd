---
title: Engines replace agent kinds
plans:
  - plans/host/123-agent-kinds-on-their-own-channel/plan.md
---

# Engines replace agent kinds

host/123 is on main. Every record in `~/.config/ahpd/agents/` already says `engine` and no `kind`. ahpw main reads `x-ahpd-engines`.

## Set up

Run this from a terminal that is not a Claude Code session.

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

## Steps

1. Check that the daemon's terminal shows no line with `names no engine`.
2. List the agents in a client, and check that no agent is `unavailable`.
3. Open the agents page in ahpw, and check that each engine shows its icon, in light and in dark.
4. Add an agent from an engine, and send it one turn.

## Reply

Write "pass", or say which step stopped.
