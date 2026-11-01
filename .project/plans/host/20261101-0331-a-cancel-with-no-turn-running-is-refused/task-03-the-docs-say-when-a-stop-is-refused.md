---
title: The docs say when a stop is refused
status: todo
depends: [task-01-a-stop-with-no-turn-running-is-refused.md, task-02-the-backend-stops-the-turn-the-host-names.md]
layer: docs
refs:
  - "[code://docs/sdk/AHP.md#L276](../../../../docs/sdk/AHP.md#L276) - the `chat/turnCancelled` row"
  - "[code://docs/sdk/AHP.md#L760-L763](../../../../docs/sdk/AHP.md#L760-L763) - \"A cancel is the same case\""
  - "[code://.project/specs/sessions-and-chats.md#L86-L98](../../../specs/sessions-and-chats.md#L86-L98) - a stop in a worker chat"
---

## Objective

`AHP.md` says a stop on a chat that runs no turn is refused, and a stop naming another turn is answered to its sender alone.
The spec of sessions and chats says a stop in a worker chat whose worker has ended is refused.

## Files

- `UPDATE: docs/sdk/AHP.md:276` - the `chat/turnCancelled` row says when a stop is refused.
- `UPDATE: docs/sdk/AHP.md:760-763` - the paragraph on a stop that changes nothing.
- `UPDATE: .project/specs/sessions-and-chats.md:86-98` - the worker chat's stop, with the refusal.

## Steps

1. Grep the touched files for the wording of a stop answered with an echo.
2. Write each row and paragraph from what the host does now.
3. Run the prose lint on the spec.

## Validation

- `rg -n "A cancel is the same case|stopped nothing|stops nothing" docs .project/specs` names no stop with no turn running as an echo.
- `node .agents/skills/do-spec/scripts/lint-prose.mjs .project/specs/sessions-and-chats.md` prints nothing.

## Resume
