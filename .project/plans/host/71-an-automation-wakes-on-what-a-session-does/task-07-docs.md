---
title: Docs
status: todo
depends: [task-05-pinned-sessions-and-overlap.md, task-06-a-plugin-adds-a-trigger-type.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - the plugin API"
---

## Objective

The docs say how an automation wakes on a session and what each preset watches for.
They also say what pinned and overlap do, and how a plugin adds a trigger type.

## Files

- `UPDATE: docs/DAEMON.md` or the automations page - event triggers, the rule shape, the presets, pinned, overlap, placeholders.
- `UPDATE: docs/PLUGINS.md` - `registerTriggerType` and `fireTrigger`.

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

