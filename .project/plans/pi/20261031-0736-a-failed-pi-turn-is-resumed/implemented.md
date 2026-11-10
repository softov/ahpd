---
title: A failed pi turn is resumed - implemented
date: 2026-10-31
refs:
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - `resume`, `settle` and the resumable error part"
  - "[code://packages/agent-pi/src/backend.ts](../../../../packages/agent-pi/src/backend.ts) - `PiBackend.resume`"
  - "[code://packages/agent-pi/src/replay.ts](../../../../packages/agent-pi/src/replay.ts) - the last failed turn read back is resumable"
---

A pi turn that failed on a model call can be resumed. The client sends `chat/turnResume`, the turn reopens with its message and parts, and pi continues from the call that failed. The tools the turn already ran are not run again. A failed turn read back from pi's file after a restart is resumable too, when it is the latest turn.

## What was built

- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - `finish` takes `resumable` and puts the error part on the turn as well as on `chat/error`. `settle` holds the end of a run, which `agent_settled` and a resumed run both call. `resume` checks the turn, reopens it, emits `chat/turnResume` and starts the run.
- [`code://packages/agent-pi/src/backend.ts`](../../../../packages/agent-pi/src/backend.ts) - `resume()` removes the failed reply from the model's context with `appendContextEdit` and `refreshContext`, then runs `agent.continue()`. It answers `false` when the leaf is not a failed assistant reply.
- [`code://packages/agent-pi/src/replay.ts`](../../../../packages/agent-pi/src/replay.ts) - the error part of the last turn read back is resumable when that turn failed.
- [`code://packages/agent-pi/test/fake-pi.ts`](../../../../packages/agent-pi/test/fake-pi.ts) - the fake `resume` answers a value, throws, or waits on a promise.
- `docs/sdk/AHP.md` and the pi README say how pi resumes a turn.

## Verified

- `packages/agent-pi/test`: 17 files, 229 tests pass. Nine new cases are in `agent-pi.test.ts` and `agent-pi-disk.test.ts`.
- `packages/sdk/test/echo-origin.test.ts`: 6 tests pass, with the new case that a resume is echoed with its `clientSeq`.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- The whole suite: 7960 pass and 1 fails. The failure is `computer-git-fetch.test.ts`, which finds a temporary folder of another test. That file passes alone, 26 of 26.
- Steps 1 to 3 of the check by hand passed on 2026-11-10, in VS Code. With no key, a turn failed with a retry control. With an OpenRouter key added, the retry worked. Steps 4 to 6 were not run: a retry after a restart, and a retry that is stopped. The check was `pending/pi-resume-checks.md`, last held at git://41bd5ca05.

## Departures from the plan

- `spent` keeps the usage of the turn, and is not reset. The resumed run adds to what the turn already used, as a live turn does.
- `namePrompt` does nothing on a resumed turn. The prompt was named when the turn first ended, and `promptedAfter` is not valid after a restart.
- The host test is in `packages/sdk/test/echo-origin.test.ts`, not in `host-turn.test.ts`. That suite has a backend wrapper for an echo test, and `host-turn.test.ts` drives only Claude.
- The case "unknown model" of task 01 uses a pi that fails to open. Both fail in the `begin` catch, before pi has the prompt.
- Three tests that build their own `PiBackend` got a `resume` that answers `false`.

## Left for later

- A turn that was resumed and then completed reads back from pi's file without its earlier error parts. Replay makes the error part from the last reply only, as it does for a turn that pi retried by itself.
- Claude does not emit `chat/turnResume` in its `resume`, so the host sends no echo for it. This belongs to `.project/briefs/claude-cofold-and-acp-resume-a-failed-turn.md`.
