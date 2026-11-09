---
title: Each agent has a host tools switch - implemented
date: 2026-11-06
refs:
  - git://ce0bac324
  - "[code://packages/agent-claude/src/session/clienttools.ts](../../../../packages/agent-claude/src/session/clienttools.ts)"
  - "[code://packages/agent-cofold/src/session.ts](../../../../packages/agent-cofold/src/session.ts)"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts)"
---

Claude, cofold and pi each have a `hostTools` switch, as acp has.
The plugin option sets it for every agent, and an agent record's value wins over the plugin's.
With the switch off, a session offers the clients' tools and none of the host's own, at its start and on a later list.

## What was built

- [`code://packages/agent-claude/src/options.ts`](../../../../packages/agent-claude/src/options.ts) - `hostTools` as a record field.
- [`code://packages/agent-claude/src/plugin.ts`](../../../../packages/agent-claude/src/plugin.ts) - the plugin's value under the record's, in `presetOf`.
- [`code://packages/agent-claude/src/session/clienttools.ts`](../../../../packages/agent-claude/src/session/clienttools.ts) - the host's own tools are dropped and each client's are kept.
- [`code://packages/agent-cofold/src/session.ts`](../../../../packages/agent-cofold/src/session.ts) - only the tools with an owner in `offered` are kept.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - only the tools with an owner in `offering` are kept.
- [`code://packages/agent-pi/src/types.ts`](../../../../packages/agent-pi/src/types.ts) - `PiOptions` carries `hostTools`.
- The README of each of the three packages lists the option.

## Verified

- `agent-claude-plugin-switch.test.ts`, `agent-cofold-plugin.test.ts` and `agent-pi-tools.test.ts`: a switch that is off keeps the host's tools out. Each case fails without the change.
- The options, declarations and engine tests of each package hold the new option and field.
- CI passed every job on PR #247.

## Departures from the plan

- pi's option is in `PiOptions` in `src/types.ts`, not in `src/backend.ts`, which holds the pi runtime's options.
- The options, declarations and engine tests outside the tasks' *Files* changed, because they pin each option and record field.

## Left for later

- None.
