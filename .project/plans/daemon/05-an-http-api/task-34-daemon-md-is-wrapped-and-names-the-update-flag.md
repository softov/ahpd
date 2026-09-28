---
title: DAEMON.md is wrapped where it is prose, and its flag table names the update check as declared
status: done
depends: []
layer: "docs"
refs:
  - "[code://docs/DAEMON.md#L464-L473](../../../../docs/DAEMON.md#L464-L473) - the `--remote` paragraph, wrapped at the file's 80 columns"
  - "[code://docs/DAEMON.md#L160](../../../../docs/DAEMON.md#L160) - the flag row, `--update-check`, `--no-update-check`"
  - "[code://docs/DAEMON.md#L197](../../../../docs/DAEMON.md#L197) - the section the row's \"See below\" points at"
  - "[code://packages/server/src/commands/options.ts#L200-L203](../../../../packages/server/src/commands/options.ts#L200-L203) - `updateCheck`, declared positive and negatable, with its description"
---

## Objective

`docs/DAEMON.md`'s `--remote` paragraph is wrapped like the rest of the file, and the flag table describes the update check as the command declares it: `--update-check`, on by default, turned off with `--no-update-check`.

## Files

- `UPDATE: docs/DAEMON.md:464-473` - rewrap the paragraph at the file's width, changing no word.
- `UPDATE: docs/DAEMON.md:160` - the row.

## Steps

1. Rewrap only the paragraph that holds the long line.
2. The row reads `--update-check`, `--no-update-check` and says what `updateCheck`'s description says: ask npm in the background whether a newer version exists, on by default, and what turns it off, with "See below".
3. Check the section the row points to agrees with it.

## Validation

- `awk 'length > 80 && $0 !~ /^\|/' docs/DAEMON.md` lists no line from the `--remote` paragraph.
- The row and `updateCheck`'s description say the same thing, read side by side.
- No em dash in the changed lines.

## Resume

Implemented 2026-09-27. The `--remote` paragraph at `docs/DAEMON.md:464-473` is wrapped at 80 columns and no word changed; the 123-column line is gone, and `awk 'length > 80 && $0 !~ /^\|/' docs/DAEMON.md` lists no line from it, only the file's pre-existing long lines elsewhere. The flag row at `:160` reads `--update-check`, `--no-update-check` and describes the check the way `options.ts:200-203` declares it, on by default with the flag turning it off, and "See below" now points at the heading `--update-check`, and knowing when it is old at `:197`, which agrees. No changed line holds an em dash.

Since this task changes prose only, the check run instead of a failing test was `awk 'length > 80 && $0 !~ /^\|/' docs/DAEMON.md`, which listed line 468 at 123 columns before the change and lists nothing from the paragraph after it.

Review 2026-09-27: the row said "the flag turns it off" beside two flags; it now names `--no-update-check`, `NO_UPDATE_NOTIFIER`, `CI` and `"updateCheck": false`, as the section below does.
