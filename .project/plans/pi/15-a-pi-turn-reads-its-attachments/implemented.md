---
title: A pi turn reads its message's attachments, queued and steered ones included - implemented
date: 2026-10-07
refs:
  - git://8b4f9c7 - the commit this work sits on; none of it is committed yet, on `build/agents/140b955c`
  - "[code://packages/agent-pi/src/session.ts#L74-L106](../../../../packages/agent-pi/src/session.ts#L74-L106) - `promptFor` and `attachmentsOf`, which turn a message's attachments into pi's one text and its images"
  - "[code://packages/agent-pi/src/session.ts#L867-L874](../../../../packages/agent-pi/src/session.ts#L867-L874) - the inner `begin`, which takes the turn's attachments as its last parameter"
  - "[code://packages/agent-pi/src/session.ts#L950](../../../../packages/agent-pi/src/session.ts#L950) - the prompt, built after the turn's model is chosen"
  - "[code://packages/agent-pi/src/session.ts#L965](../../../../packages/agent-pi/src/session.ts#L965) - `startNext`, which hands a queued message's attachments on"
  - "[code://packages/agent-pi/src/session.ts#L1114-L1127](../../../../packages/agent-pi/src/session.ts#L1114-L1127) - `begin` as the host calls it, which keeps them on the message"
  - "[code://packages/agent-pi/src/session.ts#L1152-L1172](../../../../packages/agent-pi/src/session.ts#L1152-L1172) - `steer`, which builds its own"
  - "[code://packages/agent-pi/src/session.ts#L1188-L1201](../../../../packages/agent-pi/src/session.ts#L1188-L1201) - `queue`, which keeps them on the entry"
  - "[code://packages/agent-pi/src/backend.ts#L41-L43](../../../../packages/agent-pi/src/backend.ts#L41-L43) - `prompt(text, images?)` and `steer(text, images?)` on `PiBackend`"
  - "[code://packages/agent-pi/src/backend.ts#L53-L61](../../../../packages/agent-pi/src/backend.ts#L53-L61) - `takesImages()`"
  - "[code://packages/agent-pi/src/backend.ts#L277-L281](../../../../packages/agent-pi/src/backend.ts#L277-L281) and #L305 - what `wrap` passes pi, and where the flag is read off the model"
  - "[code://packages/agent-pi/src/models.ts#L20-L35](../../../../packages/agent-pi/src/models.ts#L20-L35) - `PiModel`, which now carries pi's `input`"
  - "[code://packages/agent-pi/test/agent-pi-attachments.test.ts](../../../../packages/agent-pi/test/agent-pi-attachments.test.ts) - the attachment cases"
  - "[code://packages/agent-pi/test/fake-pi.ts#L100-L132](../../../../packages/agent-pi/test/fake-pi.ts#L100-L132) - the scripted backend records the images it is prompted and steered with, and `noImages()`"
---

A message sent to a pi session with attachments now reaches the model with them.
The text and the reference block go into pi's one prompt, and an image the model takes goes as its bytes beside it.
A queued message carries its attachments until its turn comes, and a steering message carries them into the running turn.
A picture the model will not take is named by its path, so a provider that refuses one never fails the turn.

## What was built

- [`code://packages/agent-pi/src/session.ts#L74-L106`](../../../../packages/agent-pi/src/session.ts#L74-L106) - `promptFor(text, attachments, takesImages)`, which asks `partsOf` for the parts, joins the text ones with a blank line, and returns the image ones as pi's `ImageContent`. It returns the text unchanged when there is nothing attached. `attachmentsOf` reads the attachments a queued message carries.
- [`code://packages/agent-pi/src/session.ts#L1114-L1127`](../../../../packages/agent-pi/src/session.ts#L1114-L1127) - `begin`. A turn that starts keeps its attachments on the message. One that queues keeps them on the entry a client reads while it waits.
- [`code://packages/agent-pi/src/session.ts#L965`](../../../../packages/agent-pi/src/session.ts#L965) and #L950 - `startNext` hands a queued message's attachments to the inner `begin`, which prompts with them once the turn's model is chosen.
- [`code://packages/agent-pi/src/session.ts#L1152-L1172`](../../../../packages/agent-pi/src/session.ts#L1152-L1172) - `steer`. It still answers `true` at once, and builds the parts before it reaches pi.
- [`code://packages/agent-pi/src/backend.ts#L41-L43`](../../../../packages/agent-pi/src/backend.ts#L41-L43) - `PiBackend.prompt` and `PiBackend.steer` each take images, passed through `wrap` to pi's `prompt(text, { source, images })` and `steer(text, images, { source })`.
- [`code://packages/agent-pi/src/backend.ts#L53-L61`](../../../../packages/agent-pi/src/backend.ts#L53-L61) - `takesImages()`, read off `session.model` with pi's `input`. A session with no model yet answers false, and the picture goes by its path.
- [`code://packages/agent-pi/src/models.ts#L20-L35`](../../../../packages/agent-pi/src/models.ts#L20-L35) - `PiModel` carries the `input` pi lists, so the check needs no second source of truth.

## Verified

- `pnpm build` clean, `pnpm typecheck` clean, `pnpm boundary` clean - `@ahpd/agent-pi` still declares three dependencies, none undeclared.
- `npx vitest run` from the root - **251 files, 4353 tests, all passing**, none skipped. The run needs `node tools/schema.mjs` first, which is what `pnpm test` does. Without it eight cases in `packages/sdk` fail on a missing `tools/ahp.strict.schema.json`, and none of them is this plan's.
- `packages/agent-pi` alone - **14 files, 190 tests**, of which 10 are the new `agent-pi-attachments.test.ts`.
- `agent-pi-attachments.test.ts` writes real files and reads what the scripted pi was prompted and steered with. A message with nothing attached is the plain text it was. A pasted PNG arrives as pi's own image and a 5 MB one is named by its path. A pasted text is inlined as a fenced block, and one of exactly 64 KiB still is. A file somebody picked is named rather than inlined, because only a file this host wrote is the message's own. `noImages()` sends the picture by path. A steer carries its image into the running turn.
- The attachments are also visible where a client reads them. `chatState().queuedMessages[0].message.attachments` is the chip a client draws, and `chat/turnStarted`'s `message.attachments` is the turn it accepted.
- By hand: removing `attachmentsOf(next.message)` from `startNext` failed the queued case only, and every other case stayed green. The argument was put back unchanged.

## Departures from the plan

- The plan's Files named `session.ts`, `models.ts` and `backend.ts`, and the backend's `prompt` and `steer`. The flag `partsOf` needs has no home in that list, so `PiBackend` gained `takesImages()` and `PiModel` gained pi's `input`. Only pi knows what a model takes, and reading it from the model the session is on keeps one source of truth.
- `steer` no longer reaches pi in the same tick, because the parts are read off disk. It still answers `true` at once. One case in `agent-pi.test.ts` now waits before it reads what pi was steered with, and the assertion itself is unchanged.
- The plan's risk said the check falls back to the session's model when the turn's model is not known. The model is chosen and awaited before the parts are built, so the check reads the turn's model. The plan's risk line now says what remains true: a session with no model yet sends the picture by path.
- The plan's own prose did not pass `lint-prose.mjs` when it arrived. Its Goal, its risk line and one checklist item ran over the sentence limit. Every ref in `plan.md` and task 01 pointed about 50 lines low in `session.ts`. Both files were corrected.
- The task is `implemented`, not `done`, and the plan is left `planned`. Nothing here is committed or reviewed, so no run has seen it and CI has not run.

## Left for later

- `@ahpd/agent-cofold` still maps attachments itself - see plugin 36.
- A model pi cannot find fails the turn before the parts are built, so nothing reads the disk for it.
