---
title: Agents are records after the first start
plans:
  - plans/host/122-agents-are-records-on-their-own-channel/plan.md
---

# Agents are records after the first start

host/122 is on main (#89). The move is done: `~/.config/ahpd/agents/` holds 18 records, and `config-dev.json.bak-2026-10-24T22-18-21-373Z` is next to the configuration file. The turns are left.

## Set up

Run this from a terminal that is not a Claude Code session.

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

## Steps

1. List the agents in a client, and find `claude-deepseek-build` and the others.
2. Start a session on `claude-deepseek-build`, and send one turn.
3. Add a second agent-cofold record in ahpw, and send it one turn.
4. Keep the session of step 3 open. In ahpw, edit its record, and replace its `apiKey` with a wrong one, such as `sk-wrong`.
5. Send one more turn in that session. Expect it to fail on the key, because an edit applies at the next turn.
6. Put the good key back in ahpw, and send one more turn. Expect it to answer.

## Reply

Write "pass", or say which step stopped.
