---
title: Presets, and the `preset` key
status: done
depends: [task-01-each-option-is-one-declaration.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/plugin.ts#L34-L59](../../../../packages/agent-claude/src/plugin.ts#L34-L59) - `optionsSchema` and `optionsOf`"
  - "[code://packages/agent-claude/src/claude.ts#L513-L550](../../../../packages/agent-claude/src/claude.ts#L513-L550) - `create`, where `settings` reach a session"
---

## Objective

`optionsSchema` has `presets`, an object of named presets checked by `presetSchema`; with two or more, `schema()` has `preset`, an enum of their names defaulting to the first, fixed at creation; a session runs with its preset's values, and one whose preset is gone runs on the default.

## Files

- `UPDATE: packages/agent-claude/src/plugin.ts` - `presets` in `optionsSchema`, `package.json`'s `ahpd.options` and `ClaudeOptions`.
- `UPDATE: packages/agent-claude/src/claude.ts` - the `preset` key and the values it resolves to, passed to `createSession`.
- `CREATE: packages/agent-claude/test/agent-claude-presets.test.ts` - the cases below.

## Steps

1. Tests first: no presets gives no key and today's `query()` options; one preset gives no key and its values; two give the key, default the first, and each session gets its own preset's values; a stored name that no longer exists resumes on the first (with host/31); a preset with an unknown field fails the plugin's load with the key named.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

Done: `presets` is a plugin option (`optionsSchema`, `package.json`'s `ahpd.options`, the README's table), an object of named sets of Claude options checked at load against the declarations task 01 made. `claude()` holds the names, offers `preset` from two of them - an enum defaulting to the first, `sessionMutable: false` because the preset's values are in the query before the session's first turn - and hands them to every session. `session.ts` resolves the name its config carries, under the config, so the preset is what the operator wrote the session's own options down as. The cases in `test/agent-claude-presets.test.ts` are the shapes the step names: none, one, two, each session its own, a stored name that no longer exists, and the two plugin loads.

Three things the task did not settle, and what was done instead:

- The preset is over the session's own config keys, not under them. host/31 merges `defaults()` into a session's `settings`, so a key the client sent and a key that arrived as a default are the same thing by the time the session reads it. There is no telling them apart from here, and the plan's ordering is what makes two presets differ at all.
- A plugin whose load fails is reported by the loader with the time it took, so the case pins `failed…: options.presets.work.temperature is not an option a preset holds` and leaves the timing free.
- The resume case is run through `createSession` with a stored `settings.preset` rather than through the host's own resume, which `packages/sdk/test/host.test.ts` already covers; what it checks is the same thing from this side - the name nobody can resolve is the first preset.

Task 03 removes the three session keys this task still has to merge between the fallbacks and the preset.
