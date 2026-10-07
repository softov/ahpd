---
title: begin, queue and steer send their attachments to pi
status: done
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L867-L874](../../../../packages/agent-pi/src/session.ts#L867-L874) - the inner `begin`, which takes the attachments last"
  - "[code://packages/agent-pi/src/backend.ts#L41-L43](../../../../packages/agent-pi/src/backend.ts#L41-L43) - the backend's `prompt` and `steer` contract, each taking images"
---

## Objective

The backend's `prompt` and `steer` take images; `begin`, `queue` and `steer` build them with `partsOf` and keep attachments on the turn's and the entry's `message`.

## Files

- `UPDATE: packages/agent-pi/src/backend.ts:41-43`, `:277-281` - `prompt(text, images?)`, `steer(text, images?)`, and `takesImages` beside `chosen`.
- `UPDATE: packages/agent-pi/src/models.ts:20-35` - `PiModel` carries whether its `input` has `image`.
- `UPDATE: packages/agent-pi/src/session.ts:867-874`, `:951`, `:965`, `:1114-1127`, `:1152-1172`, `:1188-1201` - the parts, and the three doors.
- `CREATE: packages/agent-pi/test/agent-pi-attachments.test.ts` - the attachment cases.
- `UPDATE: packages/agent-pi/test/fake-pi.ts` - the scripted backend records the images it is prompted and steered with.

## Steps

1. Inner `begin` takes `attachments` as a new last parameter; the exported `begin` passes the host's fifth argument.
2. At the prompt: `partsOf`, text parts joined, image parts as `ImageContent`.
3. `queue` keeps them on the entry; `startNext` hands them on; `steer` does the same at the steer.

## Validation

- The plan's checklist.

## Resume

- Built 2026-10-07. `promptFor` in `session.ts` asks `partsOf` for the parts, joins the text ones with a blank line, and returns the image ones as `ImageContent`.
- The inner `begin` takes the turn's attachments last. The exported `begin`, `queue` and `startNext` keep them on the message, and `steer` builds its own.
- `PiBackend` gained `takesImages()`, which the plan's Files did not name. The flag `partsOf` needs comes from the model the session is on, and only pi knows it.
- `steer` no longer reaches pi synchronously, because the parts are read off disk. One case in `agent-pi.test.ts` now waits a turn of the event loop before it reads what pi was steered with.
- `packages/agent-pi/test/fake-pi.ts` records `images` on every prompt and steer, and `noImages()` makes the session's model take none.
