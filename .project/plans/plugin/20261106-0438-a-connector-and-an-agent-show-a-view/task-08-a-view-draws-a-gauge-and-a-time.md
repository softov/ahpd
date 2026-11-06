---
title: A view draws a gauge and a time
status: implemented
depends: [task-07-a-login-asks-the-profile-scope.md]
layer: "sdk, agent-claude"
refs:
  - "[code://packages/sdk/src/plugins/view.ts](../../../../packages/sdk/src/plugins/view.ts) - `VIEW_KINDS` and the check of each kind's literal props"
  - "[code://packages/agent-claude/src/views.ts](../../../../packages/agent-claude/src/views.ts) - the login and agent views, and their data"
---

## Objective

A view may hold a `Progress` bar and a `DateTime`, which a client shows in its reader's own zone.
A Claude login's view draws a gauge for each window, and the time it resets.

## Files

- `UPDATE: packages/sdk/src/plugins/view.ts` - `Progress` and `DateTime` join `VIEW_KINDS`, and `DATE_TIME_FORMATS` lists the formats.
- `UPDATE: packages/sdk/src/types/plugin.ts` - the doc of `ViewComponent` names the two kinds.
- `UPDATE: packages/agent-claude/src/views.ts` - labelled lines, a gauge and a reset time for each window, and `used`, `resetInSeconds` and `extraText` in the data.
- `UPDATE: packages/agent-claude/src/session/limits.ts` - `maskedEmail` keeps three letters.
- `UPDATE: docs/plugins/PLUGINS.md` - the two kinds and their props.
- `UPDATE: packages/sdk/test/plugin-view.test.ts` - the two kinds, and the literals the check refuses.

## Steps

1. Add `Progress` and `DateTime` to `VIEW_KINDS`.
2. Refuse a literal `value` or `max` of a `Progress` that is not a number.
3. Refuse a literal `value` of a `DateTime` that is not an ISO time, and a `format` not in `DATE_TIME_FORMATS`.
4. Draw each window as a `Progress` of `used`, labelled with its name, then `Reset at:` and an `auto` `DateTime`.
5. Add `used`, `resetInSeconds` and `extraText` to each window's data.
6. Keep three letters of an email's name.

## Validation

- `plugin-view.test.ts`: a bound and a literal `Progress` and `DateTime` pass, and the check refuses a bad literal.
- `agent-claude-views.test.ts`: the login and agent views pass the host check.
- `pnpm exec vitest run packages/agent-claude/` passes.
- By hand, once ahpw draws the two kinds: the login's view shows a gauge and a local reset time.

## Resume

Done. `Progress` and `DateTime` are view kinds, and the Claude views draw them.
`resetInSeconds` is counted when the data is made, so it ages until the next answer sets it again.

Left: ahpw registers a `Progress` and a `DateTime` component, which draw these kinds.
