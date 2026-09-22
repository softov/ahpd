---
title: The catalogue, the transcript and a resume all read the cofold store
status: done
depends:
  - task-01-the-package-and-the-provider.md
layer: packages/agent-cofold
refs:
  - code://packages/sdk/src/types/agent.ts#L249-L286 - `list` and `transcript`, what a catalogue row and a readable past are
  - code://packages/sdk/src/types/agent.ts#L106-L121 - `Start.resume`, `forkAt` and `rewindAt`, how a session is continued
  - code://packages/sdk/src/types/wire.ts - `WireTurn`, the shape `transcript` answers with
  - file:///github/cofold/packages/agents/src/types/store.ts - `Store.sessions`, `Store.runs` and `Store.requests`
  - file:///github/cofold/packages/agents/src/types/run.ts#L27-L40 - `ResumeArgs`, the way a paused run is rejoined
  - file:///github/cofold/packages/agents/src/types/message.ts - `Message`, the parts a turn is rebuilt from
  - file:///github/cofold/packages/store-file/src/index.ts - `createFileStore`, which the daemon uses
---

## Objective

`facioAgent`'s `list()` answers the sessions the facio store holds for the served workspace, `transcript(id)` rebuilds a finished conversation as `WireTurn<Turn>[]` with its text, its reasoning and its tool calls, and a session the host resumes rejoins the paused facio run through `resume()` rather than replaying it, so a daemon restarted mid-conversation opens what it left.

## Files

- `CREATE: packages/agent-cofold/src/transcript.ts` - a facio `Message` and its steps as an AHP `WireTurn<Turn>`.
- `UPDATE: packages/agent-cofold/src/agent.ts` - `list`, `transcript` and `probe`.
- `UPDATE: packages/agent-cofold/src/session.ts` - `Start.resume` and the rejoin of a paused run.
- `CREATE: test/agent-cofold-store.test.ts` - the cases below.

## Steps

1. Write `list()` over `store.sessions.list({ workspace })`, answering `Listed[]` with the facio `sessionId` as the id, the first user message or the session's own title as the title, the store's timestamps, and the workspace as one `file://` directory.
2. Write `transcript(id)` over `store.sessions.listMessages({ sessionId })` and the run steps, folding each user message and each model reply into an AHP turn whose `responseParts` carry the text, the reasoning and the tool calls with their status, result and timing.
3. Keep the parts in the order facio recorded them, because a transcript that reorders a tool call and its answer is a conversation read wrong, and use the store's `listEvents` when a step record is not enough to say where a part belongs.
4. Answer `undefined` for a session the store does not know, the way the contract says, rather than an empty transcript that looks like a session with nothing said.
5. On `create` with `start.resume`, look the session up, find its newest run, and when that run is `awaiting`, rejoin it with `resume({ agent, sessionId, runId, afterSeq })` and re-raise its pending request through task 03's path.
6. When there is no awaiting run, start a new run in the same facio session, so continuing a finished conversation appends to it rather than starting a second identity.
7. Leave `forkAt` and `rewindAt` for later and say so in a comment: facio's fork and rewind slots exist, and mapping them is a task of its own rather than a silent branch here.
8. Wire the store path from task 01's option, and make the file store's directory the one the daemon named rather than a path beside the process.

## Validation

- `test/agent-cofold-store.test.ts`, with a file store under a temporary directory:
  - a session created and torn down is listed with its workspace and its title.
  - `transcript(id)` of a turn with text, reasoning and a tool call answers one turn whose parts are in the recorded order, and the tool call carries its status and result.
  - a session the store does not know answers `undefined`, and one with no messages answers an empty list.
  - a paused run reopened with `start.resume` continues the same facio session and does not append a duplicate of the input.
  - a finished session resumed appends a new run under the same `sessionId`.
  - a session deleted from the store is no longer listed.
- `pnpm test` green, `pnpm typecheck` green.

## Resume

Done 2026-09-20.
`transcript.ts` holds `turnsOf(store, sessionId)`, rebuilding a conversation from `listMessages` and each run's `listEvents`; `agent.ts` creates one store inside `facioAgent` and shares it with every session, adds `list()` and `transcript(id)`, and leaves `forkAt`/`rewindAt` unmapped with a comment; `session.ts` reopens an `awaiting` run through `resume({ afterSeq })` and replays its events so the durable request reaches the client by the path that put it there; `index.ts` exports the transcript helpers.
`test/agent-cofold-store.test.ts` is six tests over a file store under a temporary directory: the listing with its workspace and title, a transcript whose parts are in order with a completed tool call, an unknown session against a known empty one, a paused run reopened without replaying its input, a finished session resumed as a new run under the same id, and a deleted session gone from the listing.
Verified: `npx vitest run` 758 passed over 52 files, `pnpm typecheck` green, `pnpm boundary` green.
What facio's store and messages do not carry: message parts have no ids, so transcript part ids are derived from the message and the index; a message has no usage and no model, so per-turn usage comes from the run record and the model stays absent; a tool call has no duration, so its timing rides `_meta`; `Store.requests` has no `list`, so a pending request is found by walking the runs' `pendingRequestId`; an image part has no AHP counterpart and is kept as a system notification; and a `SessionRecord` has no title, so it is derived from the first user message.
Departures from the plan: `list()` calls `store.sessions.list({})` rather than filtering by one workspace, because `Agent.list()` takes no argument and the workspace is per session, so each row reports its own; a resume defers `begin` on an `opening` promise, because the host calls `create` and `begin` in one turn and a new run would otherwise race the paused run for facio's writer claim; and the transcript carries per-turn usage and duration from the run record, which the objective did not name.
A fork for task 05: the reopened paused turn is replayed through the mapping while the host also seeds `transcript(id)` into `start.seed`, so a client can be shown the open turn twice, once from the seed and once from the replay. Task 05 gained a step and a case to pin and resolve it, because it is a wire-shape question and not a store one.
