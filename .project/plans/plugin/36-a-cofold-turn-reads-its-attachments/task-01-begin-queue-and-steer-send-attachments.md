---
title: begin, queue and steer send their attachments to the run
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/turns.ts#L120-L127](../../../../packages/agent-cofold/src/turns.ts#L120-L127) - the run's input"
---

## Objective

`begin`, `queue` and `steer` carry attachments; the run's `input` is `partsOf`'s parts as `ContentPart[]` when there are any.

## Files

- `UPDATE: packages/agent-cofold/src/session.ts:288`, `:307-316`.
- `UPDATE: packages/agent-cofold/src/turns.ts` - `beginTurn`, `queue`, `startNext`, the `run` call.
- `UPDATE: packages/agent-cofold/test/` - the attachment cases.

## Steps

1. Read `features.images` from the model the turn resolves.
2. A text part is a `TextPart`; an image part an `ImagePart` with `data`.
3. The turn's and the entry's `message` keep the attachments.

## Validation

- The plan's checklist.

## Resume

Implemented 2026-10-09 on `build/agents/f6b5a6d3`, uncommitted.

`turns.ts` gained `attachmentsOf(message)`, which reads the attachments a message carries, and the exported `partsFor(text, attachments, images)`.
`partsFor` awaits the shared `partsOf` and maps each part to cofold's own two shapes, a `TextPart` as `{ type: 'text', text }` and an image as `{ type: 'image', mimeType, data }`.
The `source` the helper keeps is dropped: cofold sends the part itself, and a second copy of a pasted file's text in the transcript is a copy nothing reads.

A sixth `attachments` parameter runs through `beginTurn`, `openTurn`, `startTurn` and `failTurn`, and `openTurn` puts it on the `chat/turnStarted` message, so the turn a client reads back names what it was sent with.
`startNext` builds the turn's agent, records `agent.model.features.images` in `takesImages`, and launches the turn with the text when there are none or with `partsFor`'s parts when there are.
`queue` keeps them on the entry beside the message, and `Turns.takesImages()` answers from the recorded flag.

A turn with attachments starts one event-loop turn later than one without, because `partsOf` reads real files.
The turn is already open on the wire for that moment, so `startTurn` watches it: a turn somebody else settled in the window is left alone, and one the client stopped is ended with the synthetic `run.finished` a stopped turn gets.
Without that, a stop landing inside the read would find no handle and leave a turn that never settles.
The plan does not name this, and it is forced by the deferral the plan does name.

`session.ts` forwards its fifth argument in `begin`, and `steer` sends the run `{ type: 'steer', text, parts }`.
cofold puts the text part first, and the first part `partsOf` makes is always that text, so only `parts.slice(1)` is handed over and the text is not sent twice.
`steer` submits asynchronously when there are attachments, because reading the bytes is real I/O; it still answers `true` for a running turn, and a submit that lands after the run finished is dropped.

The cases live in `packages/agent-cofold/test/agent-cofold-attachments.test.ts`, seven of them.
They are plain text as the string it always was, a pasted image as an image part on an images model, and the same image named by path on a model that takes none.
Then pasted text inlined, a picked file named by path, a queued message whose own turn sends its attachments, and a steering message.

Gates, all green: `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck`, `pnpm boundary` (`@ahpd/agent-cofold` 6 declared, none undeclared), and the full `npx vitest run --maxWorkers=2 --testTimeout=10000` - 267 files, 4733 passed.
One test failed in that run and passes alone in 11.66s: `packages/sdk/test/changes-refresh.test.ts`, "says recomputing before a re-read that finds a file", which is host/47 p6's and a wait on a filesystem watcher that the loaded box outran.

A correction's file read has no wire event, so the steer case holds the turn open on a host tool it releases by hand.
A draft change sent behind the message is the barrier that says the host applied it, and a bounded number of event-loop turns then covers the read.
The assertion is on the run's last request rather than the next one, so a slow read still passes.
