---
title: Docs name the plugin commands and the flag
status: implemented
depends: [task-01-plugin-config-enable-and-disable.md, task-02-plugin-option.md]
layer: "docs"
refs:
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - the plugin commands and the flags"
---

## Objective

`docs/DAEMON.md` has `plugin config`, `enable`, `disable` and `--plugin-option`, with one example each.

## Files

- `UPDATE: docs/DAEMON.md`.

## Steps

1. Write it, short and direct, no hard wrap.

## Validation

- Read against the code of tasks 01 and 02.

## Resume

- `docs/DAEMON.md`: the commands block has `plugin config`, `enable` and `disable`; the options table has `--plugin-option`; the `--plugin` section has one example of each command and of the flag, how a value is read and checked, and the shell history risk; the configuration section names `pluginOptions` among the typed-only keys and says why the flag has no key; the HTTP section has the three commands in the grants table and their routes, with the `writeOnly` answer.
- Read against the code: the two `plugin config` routes, `/plugin/config` and `/plugin/config/set`, follow task 01's split into two declarations.
- New prose is one line per paragraph; the paragraph edited in the configuration section keeps the file's existing wrap, and the commands block keeps its columns.
- After the review of 2026-09-30: the `--plugin-option` paragraph says a plugin switched off with `enabled: false` is refused, and the `plugin config` paragraph says an `--unset` of an option not set leaves the file as it is.
- After the second review of 2026-09-30: the grants table has a `plugin update` row; the `plugin config` paragraph says a number that would not read back as typed stays text and a JSON-quoted value is always a string, and that a plugin switched off is never imported, its values written unchecked and answered as `<set>` over the API.
- After the third review of 2026-09-30: the `plugin config` paragraph says an object or array holding a whole number too large to keep exactly is refused, and to quote the number.
- After the fourth review of 2026-09-30: the sentence names both refusals, a whole number too large to keep exactly and a number too large to be one.
- After the fifth review of 2026-09-30: the sentence says a number inside an object or array must read back exactly as typed, as at the top, or the value is refused.
