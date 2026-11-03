---
title: Check the session pickers in a client
plans:
  - plans/host/20261030-0618-every-session-setting-is-a-picker/plan.md
---

# Check the session pickers in a client

host/20261030-0618 is on main (#146). Every setting of the new session form is a picker.

## Set up

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

Then open the new session form in ahpw or VS Code.

## The Bot chat offers its bots

1. Choose the Bot chat agent.
2. Check that the `Bot` setting is a picker with each bot by its name.
3. Choose a bot, and check that the chat opens with it.

## ACP approvals list their modes

1. Choose a Codex, Gemini or Qwen agent.
2. Check that `Approvals` is a picker with the modes of that agent.

## The form order

1. Check that the computer comes first, then isolation and branch, then the agent's own settings.

## Reply

Write "pass" for each section, or what you saw.
