---
title: DAEMON.md says how the check works
status: done
depends: [task-02-daemon-and-verbs.md]
layer: docs
refs:
  - code://docs/DAEMON.md#L16-L45 - the Commands and Options sections
  - code://docs/DAEMON.md#L80-L100 - the Configuration section, which lists every key
  - code://README.md#L58-L112 - "Install and run the daemon", where one sentence says the daemon tells you when it is old
  - code://.project/ideas/deliberate-duplication.md - the idea that gains the second copy
---

## Objective

A person reading `docs/DAEMON.md` knows the flag, the key, the two environment variables, the file, the six hours and the registry variable, and the deliberate-duplication idea names the second copy.

## Files

- `UPDATE: docs/DAEMON.md:33-45` - `--no-update-check` in the options table.
- `UPDATE: docs/DAEMON.md:80-100` - `updateCheck` in the configuration keys, and a short subsection "Knowing when it is old": the file, the interval, `NO_UPDATE_NOTIFIER`, `CI`, `npm_config_registry`, and that nothing is ever said on failure.
- `UPDATE: README.md:58-112` - one sentence in the install section.
- `UPDATE: .project/ideas/deliberate-duplication.md` - one line naming `update.ts` as the second copy.

## Steps

1. Write the DAEMON.md rows and subsection in the file's own voice and wrap; it is already hard-wrapped, so match it.
2. The README sentence, after the `ahpd start` example.
3. Add the line to the deliberate-duplication idea.
4. Mark this plan `built`, write `implemented.md`, update `plans/index.md` and `00-daemon.md`'s known gaps.

## Validation

- Every path and flag named in the docs exists: `rg -n "no-update-check|updateCheck|update.json" docs README.md packages/server/src`.
- Relative links in `.project/` resolve.

## Resume

Done 2026-09-18. `docs/DAEMON.md`: the options row and a `--no-update-check` subsection under Options, one sentence under Configuration. `README.md`: one paragraph under "Run in the background". The deliberate-duplication idea names `update.ts` as the second copy.

