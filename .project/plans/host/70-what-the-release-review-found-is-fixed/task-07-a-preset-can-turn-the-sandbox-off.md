---
title: A preset can turn the sandbox off, and two small fixes
status: done
depends: []
layer: "agent-claude, sdk"
refs:
  - "[code://packages/agent-claude/src/session.ts#L84-L88](../../../../packages/agent-claude/src/session.ts#L84-L88) - the order of the values"
  - "[code://packages/sdk/src/sessiontools.ts#L435](../../../../packages/sdk/src/sessiontools.ts#L435) - the folder written as a URI"
  - "[code://packages/sdk/src/host/lifecycle.ts#L706](../../../../packages/sdk/src/host/lifecycle.ts#L706) - `chat.close(false)`"
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
- `it('a nested chat started again keeps the transcript inside the machine')`, added for step 3.
- Run the full gates from the plan. All pass.

## Resume

- **Implemented** 2026-10-07 on `build/agents-4f2c8f8e`. Nothing is left.
- `session.ts`: the stored sandbox is spread only when the preset does not say `off`, so a preset that asks for no sandbox gets none.
- `sessiontools.ts`: both answers name the folder with `uriOf`, which escapes a `#` or a `?` a path may hold.
- `lifecycle.ts`: `restartChat` closes the chat it replaces with `removing` false, as the whole-session restart does.
- `nested-proxy.test.ts`: the case for step 3. It waits for the chat's own host inside to be up before the directory change. It then waits for the third subscription to the session, which is the host that replaces it.
- Step 3 had no case named, so one was written. With `chat.close()` it fails on `expected true to be false` for `disposeSession`; it passes with `close(false)`.
- `host-sessionconfig.test.ts` held the answer decision 2 reversed: a case named "keeps a stored sandbox on over a preset that says off". Running the full gates found it, and it now asks for the preset's `off` in both spellings. `agent-claude-declarations.test.ts` passed `settings: undefined`, which `exactOptionalPropertyTypes` refuses, so the helper spreads the member only when it is there.

