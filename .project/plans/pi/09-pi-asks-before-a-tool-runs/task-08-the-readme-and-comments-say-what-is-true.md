---
title: The README and the comments say what the code does
status: implemented
depends: [task-07-no-test-only-seam.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/README.md#L29-L29](../../../../packages/agent-pi/README.md#L29-L29) - `model`: "a resumed session keeps its own", and a forked one does too"
  - "[code://packages/agent-pi/README.md#L50-L50](../../../../packages/agent-pi/README.md#L50-L50) - truncation, which a `!command` turn or one whose `prompt` threw cannot offer"
  - "[code://packages/agent-pi/README.md#L55-L55](../../../../packages/agent-pi/README.md#L55-L55) - the asking bullet"
  - "[code://packages/agent-pi/src/mapping.ts#L127-L136](../../../../packages/agent-pi/src/mapping.ts#L127-L136) - "nobody is being asked anything""
  - "[code://packages/agent-pi/src/session.ts#L308-L338](../../../../packages/agent-pi/src/session.ts#L308-L338) - the comments on `askBefore` that say the hook runs before `tool_execution_start`"
---

## Objective

Every sentence in `packages/agent-pi/README.md` and every comment in `packages/agent-pi/src` agrees with the code after tasks 04 to 07 and plans 01, 02 and 04's fixes.

## Files

- `UPDATE: packages/agent-pi/README.md`
- `UPDATE: packages/agent-pi/src/mapping.ts`, `packages/agent-pi/src/session.ts`, `packages/agent-pi/src/types.ts` - the comments.

## Steps

1. README: a forked session keeps its model too; name the turns truncation cannot reach; the asking bullet says a tool with no effects runs, reads outside the workspace ask, and the six modes carry cofold's meanings, with `default` as pi's default.
2. Comments: say what each declaration is, in pi's real event order; nothing describes a test seam, narrates, or cites a task or plan.
3. Remove the unused `PiCall` import in `session.ts`, and keep the `permissionMode` schema in one place.

## Validation

- Each named sentence read against the code.
- No em dash; the README keeps its own line style.
- `pnpm typecheck` green.

## Resume

Built.
README: the `model` row says a resumed or forked session keeps its own; the truncation bullet names the turns that leave no point to cut at, a turn this session did not watch end, a `!command` turn and one whose `prompt` threw; the asking bullet says a tool that declares no effects runs, a read outside the working directory asks, and the six modes carry the siblings' meanings with `default` as pi's default.
`permissionModeProperty()` in `types.ts` is the one place the control is defined, used by `agent.ts` and `session.ts`.
The `askBefore` and `tool_execution_start` comments already describe pi's real event order; `OpenPi`, the `PiBackend` header and `forget` no longer describe a test, and `PiCall` is not imported in `session.ts`.

- Validation: each named sentence read against the code; no em dash; `pnpm typecheck` green, 91 tests.
