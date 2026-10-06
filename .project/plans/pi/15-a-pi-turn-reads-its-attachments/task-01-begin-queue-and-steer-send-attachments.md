---
title: begin, queue and steer send their attachments to pi
status: todo
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L779](../../../../packages/agent-pi/src/session.ts#L779) - the inner `begin`"
  - "[code://packages/agent-pi/src/backend.ts#L40-L42](../../../../packages/agent-pi/src/backend.ts#L40-L42) - the backend's `prompt` and `steer` contract"
---

## Objective

The backend's `prompt` and `steer` take images; `begin`, `queue` and `steer` build them with `partsOf` and keep attachments on the turn's and the entry's `message`.

## Files

- `UPDATE: packages/agent-pi/src/backend.ts:40-42`, `:268-269` - `prompt(text, images?)`, `steer(text, images?)`.
- `UPDATE: packages/agent-pi/src/models.ts:20-28` - `PiModel` carries whether its `input` has `image`.
- `UPDATE: packages/agent-pi/src/session.ts:779`, `:852`, `:879`, `:1007-1015`, `:1041`, `:1072`.
- `UPDATE: packages/agent-pi/test/` - the attachment cases.

## Steps

1. Inner `begin` takes `attachments` as a new last parameter; the exported `begin` passes the host's fifth argument.
2. At the prompt: `partsOf`, text parts joined, image parts as `ImageContent`.
3. `queue` keeps them on the entry; `startNext` hands them on; `steer` does the same at the steer.

## Validation

- The plan's checklist.

## Resume
