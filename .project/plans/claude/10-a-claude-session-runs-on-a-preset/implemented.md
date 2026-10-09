---
title: A Claude session runs on a preset, and the ahpd-only chips move into it - implemented
date: 2026-10-09
refs:
  - git://e1c4ccc
  - "[code://packages/agent-claude/src/options.ts](../../../../packages/agent-claude/src/options.ts)"
---

A Claude session starts on a preset that the plugin config declares. Output style, thinking and sandbox are set in the preset, not in chips. The composer no longer draws those three chips, and Approvals keeps Don't Ask.

## What was built

- [`code://packages/agent-claude/src/options.ts`](../../../../packages/agent-claude/src/options.ts) - one declaration per option, and `presetSchema`.
- [`code://packages/agent-claude/src/plugin.ts`](../../../../packages/agent-claude/src/plugin.ts) - the `presets` option.
- [`code://packages/agent-claude/src/claude.ts`](../../../../packages/agent-claude/src/claude.ts) - the `preset` key, and the three keys removed from `schema()` and `defaults()`.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - the live `setConfig` branches for the three keys are removed.
- [`code://packages/agent-claude/README.md`](../../../../packages/agent-claude/README.md) - the `presets` option.

## Verified

- `packages/agent-claude/test/agent-claude-presets.test.ts`, and the gates on main.
- Softov checked in ahpapp on 2026-10-09: no Output style, Thinking or Sandbox chip, and Approvals keeps Don't Ask.

## Departures from the plan

- Three checklist items moved to claude/15, which checks presets as variants.
- The review findings on task 03 were fixed in host 64.

## Left for later

- None.
