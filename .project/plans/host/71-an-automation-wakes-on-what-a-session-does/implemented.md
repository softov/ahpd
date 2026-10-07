---
title: An automation wakes on what a session does - implemented
date: 2026-10-07
refs:
  - git://4279708 - the commit this work sits on; none of it is committed yet, on `build/agents/f0c62ad5`
  - "[code://packages/sdk/src/host/sessionevents.ts](../../../../packages/sdk/src/host/sessionevents.ts) - the stream of session events"
  - "[code://packages/sdk/src/triggers.ts](../../../../packages/sdk/src/triggers.ts) - the rule engine"
  - "[code://packages/sdk/src/host/automations.ts](../../../../packages/sdk/src/host/automations.ts) - the rules the host watches, the overlap modes and the pinned chat"
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - the `## Automations` section a person running the daemon reads"
---

An automation can now wake on what a session does, not only on a clock. It picks one of eight events: a turn ending, a tool call failing, a message queued, a session going idle, a child session finishing. It wraps that event in a count, a follow-up, an absence or a state check, or picks one of five presets somebody thought about. It may narrow any of those to a folder it names, or to the sessions a run made rather than a person. A pinned automation keeps one chat and adds each run as the next turn in it. Every automation says what an overlapping event does while it runs. A plugin can register a trigger type of its own and fire it. The daemon and plugin docs say all of it.

## What was built

- [`packages/sdk/src/host/sessionevents.ts`](../../../../packages/sdk/src/host/sessionevents.ts) - the stream of session events, what each session is doing as they arrive, where it works and whether a run made it. It also says the turn start the engine is handed, and the parent link a child session leaves.
- [`packages/sdk/src/types/triggers.ts`](../../../../packages/sdk/src/types/triggers.ts) - the event kinds, the facts every one of them carries, and the rule a trigger is written as.
- [`packages/sdk/src/triggers.ts`](../../../../packages/sdk/src/triggers.ts) - the rule engine: counts, windows, the timer a long turn is measured by, and the clock it is handed.
- [`packages/sdk/src/triggerpresets.ts`](../../../../packages/sdk/src/triggerpresets.ts) - the five presets, each a function from its numbers to a rule.
- [`packages/sdk/src/automations.ts`](../../../../packages/sdk/src/automations.ts) - the `session` and `watch` trigger types, the rule schema, and the refusal of a rule this host cannot fire.
- [`packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts) - the rules the host watches, the owner gate, the hourly cap, the overlap modes, the pinned chat, and the fire a plugin's type reaches.
- [`packages/sdk/src/wakemessage.ts`](../../../../packages/sdk/src/wakemessage.ts) - the six placeholders and the summary block a woken run's message carries.
- [`packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts), [`packages/sdk/src/plugins.ts`](../../../../packages/sdk/src/plugins.ts), [`packages/sdk/src/validate.ts`](../../../../packages/sdk/src/validate.ts) - `registerTriggerType` and `fireTrigger`, the fold that gathers the types, and the check on one.
- [`packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts), [`packages/server/src/config.ts`](../../../../packages/server/src/config.ts), [`packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the `unownedAutomations` key and flag, handed to the host.
- [`docs/DAEMON.md`](../../../../docs/DAEMON.md) - an `## Automations` section: the events, the rule, the presets, pinned, the overlap modes, the placeholders and the limits.
- [`docs/PLUGINS.md`](../../../../docs/PLUGINS.md) - `registerTriggerType` and `fireTrigger` under what a plugin can register.

## Verified

- `packages/sdk/test/session-events.test.ts` (13), `triggers.test.ts` (24, on fake time), `trigger-types.test.ts` (8), `automation-wake.test.ts` (24) and `plugin-triggers.test.ts` (5) hold 74 cases for this plan. `automations.test.ts` has one more, for the pinned chat a client may not write.
- From the repository root, `npx vitest run --maxWorkers=2`: 4290 passed in 245 files, none failed. The same suite at full parallelism has 17 machine tests time out at 5s on a loaded box. Every one of them passes at two workers.
- `node tools/schema.mjs` builds `tools/ahp.strict.schema.json`: 508 definitions from 506 exported types, 633 closed objects.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` all pass, and `git status` shows nothing outside `packages/`, `docs/` and `.project/`.
- `node .agents/skills/do-spec/scripts/lint-prose.mjs` on this plan folder finds nothing.
- The docs were read against the code they describe. Each event, preset number, overlap mode, placeholder and limit in `docs/DAEMON.md` was checked against that code.

## Departures from the plan

- task 01 reads what a session does from the host's own dispatch, not from each place a session moves. `sessionEvents.observe(channel, action)` is called once, in the action funnel every chat action passes through. A client's action and a backend's are read in the one place. So is the work in a session that never becomes an event: a delta, a tool call starting or taking its input.
- The automations prose in `docs/DAEMON.md` is a `## Automations` section after `## Options` rather than a subsection of the `--automations` flag entry, which links to it. The material is ten times the flag entry and `## Options` is a list of flags.
- `--unowned-automations` was added to the options table, which task 04 introduced the flag for and no task listed.
- task 06 lists the plugin's type keyed by the plugin in `PluginTriggers` and carries it to the host on `HostOptions.pluginTriggers`. A plugin fire is offered to every automation watching its type, under the gate a rule's own match passes. An automation whose owner may not read sessions is one this host does not run. One nobody owns runs only where `unownedAutomations` allows it, since a plugin's event is not a session either. The run still refuses when its owner has never signed in.
- Four stub automation stores in `packages/sdk/test/host-close.test.ts` gained `list` and `get`, which the host reads at build since task 04.
- Eleven hand-written `Contribution` literals in `plugin-host.test.ts` and the helper in `plugin-fold.test.ts` gained `triggers`.

## Left for later

- Dropping a plugin's trigger types when the plugin goes: nothing unloads a plugin here.
- The `no reply posted` wake, step 3 of the bot study: the event does not exist yet.
- See [deferred.md](deferred.md).
