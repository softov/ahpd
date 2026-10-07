---
title: A preset can turn the sandbox off, and two small fixes
status: todo
depends: []
layer: "agent-claude, sdk"
refs:
  - "[code://packages/agent-claude/src/session.ts#L73](../../../../packages/agent-claude/src/session.ts#L73) - the order of the values"
  - "[code://packages/sdk/src/sessiontools.ts#L430-L431](../../../../packages/sdk/src/sessiontools.ts#L430-L431) - a hand-written URI"
  - "[code://packages/sdk/src/host/lifecycle.ts#L690](../../../../packages/sdk/src/host/lifecycle.ts#L690) - `chat.close()`"
---

## Objective

A preset with `sandbox: "off"` turns the sandbox off for a session stored with it on, and two small defects are gone.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:73` - skip the stored value when the preset says off.
- `UPDATE: packages/sdk/src/sessiontools.ts:430-431` - write the folder with `uriOf`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:690` - call `chat.close(false)`, as the restart at line 500 does.
- `UPDATE: packages/agent-claude/test/` and `packages/sdk/test/` - the cases below.

## Steps

1. Spread `storedSandbox(settings)` only when `options.preset.sandbox` is not `off`.
2. Replace the hand-written `file://` with `uriOf(folder)`.
3. Pass `false` to `chat.close` at line 690.

## Validation

- `it('a preset with sandbox off wins over a stored on')`
- `it('a preset with no sandbox keeps a stored on')`
- `it('names a folder with a # in the worktree message as a valid URI')`
- Run the full gates from the plan. All pass.

## Resume

