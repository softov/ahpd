---
title: Check the host marks
plans:
  - plans/plugin/69-a-plugin-names-a-host-mark/plan.md
---

# Check the host marks

plugin/69 is on main (#102). A plugin names a mark the host ships as `{ "src": "mark:<name>" }`. On 2026-11-03 a test plugin with `mark:whatsapp` got a `data:image/svg+xml` icon on its plugins row. The screens are left.

## Set up

Run this from a terminal that is not a Claude Code session. Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

## Steps

1. Open the connectors page in ahpw, and check that Jira, Linear, Resend and WhatsApp show their marks.
2. Check that the daemon's terminal shows no fetch from the CDN for those four.
3. Check that a webhook connector shows the webhook plugin's icon.
4. Open the agents page, and check that your Codex record shows the OpenAI mark.
5. Check both pages in light and in dark.

## Reply

Write "pass", or say which step stopped.
