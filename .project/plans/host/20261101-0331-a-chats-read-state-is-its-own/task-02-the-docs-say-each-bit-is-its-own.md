---
title: The docs say each bit is its own
status: todo
depends: [task-01-each-read-bit-moves-alone.md]
layer: docs
refs:
  - "[code://docs/sdk/AHP.md#L252](../../../../docs/sdk/AHP.md#L252) - the `session/isReadChanged` row"
  - "[code://docs/sdk/AHP.md#L280-L281](../../../../docs/sdk/AHP.md#L280-L281) - the `chat/isReadChanged` and `chat/isArchivedChanged` rows"
---

## Objective

`AHP.md` says each read action moves its own bit and its summaries, and a turn's end marks only its chat.

## Files

- `UPDATE: docs/sdk/AHP.md:252` - the `session/isReadChanged` row says it moves the session's bit alone.
- `UPDATE: docs/sdk/AHP.md:280-281` - the chat rows say a turn's end marks the chat unread and an archive marks it read.

## Steps

1. Grep the docs and the touched files for the wording of bits that move together.
2. Write each row from what the host does now.

## Validation

- `rg -n -i "read together|in step|session follows|counted" docs packages/sdk/src/host` names no read bit moved with another.

## Resume
