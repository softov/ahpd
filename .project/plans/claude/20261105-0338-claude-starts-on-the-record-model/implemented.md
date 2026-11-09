---
title: Claude starts on the record's model - implemented
date: 2026-11-06
refs:
  - git://2374fd76d
  - "[code://packages/agent-claude/src/plugin.ts](../../../../packages/agent-claude/src/plugin.ts)"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts)"
---

A Claude session whose settings name no model starts on the model its agent record names, when the agent offers that model.
A record model the agent does not offer leaves the CLI's default, as before.

## What was built

- [`code://packages/agent-claude/src/plugin.ts`](../../../../packages/agent-claude/src/plugin.ts) - `open` passes the record's `model` to the agent.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - a session with no model in its settings takes the record's model when the agent offers it.
- [`code://packages/agent-claude/src/session/context.ts`](../../../../packages/agent-claude/src/session/context.ts) - `ClaudeSessionOptions` carries `model`.

## Verified

- `agent-claude-models.test.ts`: a session starts on an offered record model. The case fails without the change.
- CI passed every job on PR #245.

## Departures from the plan

- `ClaudeSessionOptions` in `session/context.ts` also declares `model`. The task's *Files* did not name it.
- `defaults` is still the mode alone, as the plan said.

## Left for later

- None.
