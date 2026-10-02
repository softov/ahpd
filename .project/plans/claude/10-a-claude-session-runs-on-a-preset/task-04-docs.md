---
title: Docs say what a preset is, and the six-modes line is corrected
status: done
depends: [task-03-the-chips-move-into-presets.md]
layer: "docs"
refs:
  - "[code://packages/agent-claude/README.md](../../../../packages/agent-claude/README.md) - the backend's options"
  - "[code://.project/decisions/permission-modes-live-in-the-harness.md](../../../decisions/permission-modes-live-in-the-harness.md) - line 28"
---

## Objective

The README documents `presets` with an example of two, the five fields, the default, and what a session whose preset is gone runs on; the decision's line 28 says the window draws five modes and Claude offers six, citing [claude-approvals-keeps-dont-ask](../../../decisions/claude-approvals-keeps-dont-ask.md).

## Files

- `UPDATE: packages/agent-claude/README.md` - the `presets` option.
- `UPDATE: .project/decisions/permission-modes-live-in-the-harness.md:28` - the factual correction only.

## Steps

1. Write both, short and direct, no hard wrap.

## Validation

- Read against the code of tasks 02 and 03.

## Resume

Done: a "Presets" subsection under the daemon's options table, with a configuration of two, a table of the five fields and what each means, and the three cases a session can be in - one preset and no choice, no preset and what it ran on before, and a stored name that no longer resolves to the first. Every word read back against tasks 02 and 03: the fields are `options.ts`'s five declarations, "checked when the plugin loads" is `optionsOf` throwing, and "the first is the default" is `claude.ts`'s `defaults()`. The decision's line 28 now says the union is the six Claude offers and one more than the window draws, and says why in as many words: the window's own Claude host leaves `dontAsk` out on purpose, per `claude-approvals-keeps-dont-ask`. Only that sentence changed; the six values and what each means are untouched.

Not touched, and named so it is not lost: `docs/AHP.md` describes `sandboxEnabled` as a config key this backend serves, which after task 03 it does not. No task named that file, so it is left for a docs task that owns it.
