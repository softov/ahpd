---
title: Review the bot record store
plans:
  - plans/plugin/45-p2-the-bot-keeps-its-records-there/plan.md
---

# Review the bot record store

A bot is the file `~/.config/ahpd/bots/<slug>/bot.md`. Two checks by hand and one choice are left.

## Set up

Stop your daemon with Ctrl+C in its terminal, then run this in that terminal:

```bash
cd /github/ahpd && git pull --ff-only && pnpm install --frozen-lockfile
node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /home/softov/.config/ahpd/config-dev.json
```

## Check by hand

1. In ahpw, open a bot.
2. Change its `description` in its file, with the bot's slug in place of `<slug>`:

```bash
${EDITOR:-nano} ~/.config/ahpd/bots/<slug>/bot.md
```

3. Check that ahpw shows the new description without a restart.
4. In ahpw, delete a test bot, and check that it leaves the list.

## Your choice: the owner after a restart

The daemon ignores a hand edit of `owner` in a bot file until a restart. After a restart the bot has the new owner, with no log line. See [the problem](../problems/a-bot-file-edited-by-hand-to-a-new-owner-takes-it-after-a-restart.md).

- Keep the owner in the host's records, where a file edit does not reach.
- Or take the file as the truth after a restart, and log the change.

## Reply

- Write "pass" or what you saw for the check by hand.
- Say which way the owner is kept.

## Earlier results

On a second daemon on 2026-10-13, over the protocol:

1. **Pass.** A changed description in the `.md` file reads back at once. The bot's `updatedAt` does not change.
2. **Fail.** A hand edit of `owner` is ignored until a restart, then taken, with no log line.
3. **Pass.** A deleted bot's file goes, and a make with the same slug is refused with `-32010`.
