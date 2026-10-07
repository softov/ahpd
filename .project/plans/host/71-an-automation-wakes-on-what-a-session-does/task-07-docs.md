---
title: Docs
status: done
depends: [task-05-pinned-sessions-and-overlap.md, task-06-a-plugin-adds-a-trigger-type.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - the plugin API"
---

## Objective

The docs say how an automation wakes on a session and what each preset watches for.
They also say what pinned and overlap do, and how a plugin adds a trigger type.

## Files

- `UPDATE: docs/DAEMON.md` - event triggers, the rule shape, the presets, pinned, overlap and placeholders, in the `--automations` section a person running the daemon reads.
- `UPDATE: docs/PLUGINS.md` - `registerTriggerType` and `fireTrigger`, under "What you can register".
- `UPDATE: docs/DAEMON.md` - the `--unowned-automations` row in the options table, which task 04 added and nothing yet listed.

## Steps

1. Write one example for each part of a rule: a count, a follow-up, an absence and a state check.
2. Write a table of the presets with their default numbers.
3. Write the four overlap modes, and say that pinned refuses `parallel`.
4. Write the placeholders and show the summary block.
5. Write the four limits: owner read access, no self wake, 20 runs an hour, counts reset on restart.

## Validation

- Run `node .agents/skills/do-spec/scripts/lint-prose.mjs` on this plan folder. It finds nothing.
- Read each section against the code it describes.

## Resume

Written. `docs/DAEMON.md` gained a `## Automations` section after `## Options`. It carries the event table, the four parts of a rule and a worked example, and the five presets with their numbers. Then pinned, the four overlap modes, the six placeholders with a sample summary block, and the four limits. The `--automations` subsection points at it, and the options table gained the `--unowned-automations` row task 04 left unwritten.

It also carries the two answers of 2026-10-07. One is what every event says about a session, the folders and whether a run made it. The other is the turn nothing emits an event for, which the host times instead.

`docs/PLUGINS.md` gained a `registerTriggerType` row in the table and a `### A trigger type of your own` section beside the route and close sections, carrying `fireTrigger` with it.

The plan asked for the automations prose "in the `--automations` section". It is a section of its own just after the options, because the material is far longer than the flag entry that introduces it. `## Options` is a list of flags. The flag entry links to it.

