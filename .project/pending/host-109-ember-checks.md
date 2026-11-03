---
title: Check that the Ember session stays listed after a restart
plans:
  - plans/host/109-a-session-outside-the-paths-stays-listed/plan.md
---

# Check that the Ember session stays listed after a restart

host/109 is on main. The Ember bot's session runs in `~/.bots/ember`, a folder outside Claude's `paths`.

## Set up

1. Check that the Ember bot has a session from an earlier run.
2. Restart your daemon:

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

## After a restart

1. Open the session list in a client, before you send anything to Ember and before its next wake.
2. Check that the Ember session is in the list.
3. Open the list again twice.
4. Check that the Ember session is still in the list each time.
5. Open the Ember session, and check that it shows its earlier chat.

## Reply

Write "pass", or what you saw.
