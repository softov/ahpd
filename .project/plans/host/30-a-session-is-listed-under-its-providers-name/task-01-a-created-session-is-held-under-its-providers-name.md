---
title: A session a client creates is held under its provider's name
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L442-L566](../../../../packages/sdk/src/host/sessionmethods.ts#L442-L566) - `createSession`, where the held name is computed"
  - "[code://packages/sdk/src/host/channels.ts#L67-L81](../../../../packages/sdk/src/host/channels.ts#L67-L81) - `named`, whose comment says the host echoes the client's URI as the key"
  - "[code://packages/sdk/src/host.ts#L263](../../../../packages/sdk/src/host.ts#L263) - `names`, whose comment says the client names the session"
  - "[code://packages/sdk/src/host/spawn.ts#L695-L697](../../../../packages/sdk/src/host/spawn.ts#L695-L697) - `names.set(idOf(uri), uri)` in `spawn`"
  - "[code://packages/sdk/src/host/chatactions.ts#L140-L204](../../../../packages/sdk/src/host/chatactions.ts#L140-L204) - resume, which spawns under `nameOf(id)`: the pattern to mirror"
  - "[code://packages/sdk/test/host-names.test.ts#L74-L199](../../../../packages/sdk/test/host-names.test.ts#L74-L199) - `a session a client names`, where the new cases go"
---

## Objective

A session created as `ahp-session:/<uuid>` with `provider: "claude"` is held, listed and announced as `claude:/<uuid>`, and the backend is still handed `<uuid>` as its id.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts:442-566` - `createSession` computes ``held = `${provider}:/${idOf(uri)}` `` and passes it to `placedIn`, `openSession` and the `presence` / `activeClientSet` block, instead of `uri`.
- `UPDATE: packages/sdk/src/host/channels.ts:67-81` - the comment on `named`: the client names the id and the host names the scheme, per decision 1; the code is unchanged.
- `UPDATE: packages/sdk/src/host.ts:263` and `packages/sdk/src/host/spawn.ts:695-697` - the comments: `names` records the held name, which is the provider's.
- `UPDATE: packages/sdk/test/host-names.test.ts` - new cases under `a session a client names`.

## Steps

1. In `createSession`, compute the held name from `provider` (the resolved one, `params.provider ?? first.provider`) and `idOf(uri)`, applying decision 1.
2. Use it for every call below that line in the handler; `uri` itself is no longer used after it is checked by `named`.
3. Leave `openSession`'s duplicate check as `sessions.has(held)`, so creating `ahp-session:/x` after `claude:/x` exists is refused the same way.
4. Rewrite the three comments so they say what the code does now, without the history.

## Validation

- `host-names.test.ts`, `a session a client names`:
  - created as `ahp-session:/<uuid>`, `listSessions` returns `resource: "claude:/<uuid>"` and `root/sessionAdded` carries `summary.resource: "claude:/<uuid>"`;
  - subscribing `ahp-session:/<uuid>` returns a snapshot whose `resource` and `defaultChat` are in the `ahp-session:` spelling;
  - the backend's `sessionId` is `<uuid>`;
  - created as `claude:/<uuid>`, nothing changes (the conformance case `takes the session URI VS Code chose, and answers on it` still passes).
- `pnpm -C packages/sdk test` passes.

## Resume

`createSession` computes the held name ``uri = `${provider}:/${idOf(given)}` `` right after `named` checks the client's URI, and every call below it (`isolated`, `settle`, `placedIn`, `openSession`, the `activeClientSet` block) uses the held name.
The comments on `named`, `names` and the `names.set` in `spawn` say what the code does now.
Test: `host-names.test.ts`, `a session a client names`, `holds a session created under another scheme as its provider's, and answers its creator in its own`: listed and announced as `claude:/<uuid>`, subscribed as `ahp-session:/<uuid>` with `resource` and `defaultChat` in that spelling, and the backend's `sessionId` is `<uuid>`.
It failed first on `listSessions` returning `ahp-session:/<uuid>`.
A live session snapshot has no `state.resource`, so the case checks `snapshot.resource` and `defaultChat` only.
Not known to the plan: two example backends and one package derived their id by stripping a literal `ahp-session:/` rather than through `idOf`, so a session held as `echo:/one` got the id `echo:/one`: `examples/echo/agent.ts`, `examples/notes/agent.ts` and `packages/agent-cofold/src/session.ts` (`sessionIdOf`) now call `idOf`; a cofold session created before this by VS Code as `cofold:/<uuid>` was stored under the id `cofold:/<uuid>` and still resumes under it, since a resume carries the stored id.
The change broke 124 existing cases across the repository at first; tasks 02 and 03 fixed the host side, and the rest were expectations of the created name where the held one is now published (listings, `root/session*` notifications, plugin events, session tools, terminal claims, OTLP log lines), updated in `host-names.test.ts`, `operations.test.ts`, `changes-refresh.test.ts`, `plugin-events-fire.test.ts`, `otlp.test.ts`, `subagent-chat.test.ts`, `agent-acp-turn.test.ts` and `agent-cofold-turn.test.ts`.
The session tools answer with the held name (`list_sessions`, `create_session`) and resolve the name they are given through `heldAs` (`send_message`, `delete_session`, `get_session_context`); the tests pass them `claude:/...`, the name a model is given by `list_sessions`.
`packages/sdk/test/fixtures/wire.jsonl` is rewritten by `wire.test.ts` and shows the new names.
After the review of 2026-09-30, the `create_session` session tool and `startForAutomation` now make their session as `<provider>:/<uuid>`, as `createSession` does; tests: `host-tools.test.ts` `creates an independent session in a directory, titled, with its first prompt` checks the announced `resource` is `claude:/<uuid>`, and `automations.test.ts` `settles a run cancelled when its session is disposed mid-turn` and `lets go of a session a run was holding when the session is disposed` expect `echo:/<uuid>`; all three failed first with `ahp-session:/`.
A session whose id is already held under any scheme is refused with `-32003`, since everything kept about a session is kept by id; test: `host-names.test.ts` `refuses a session whose id another provider already holds` (`claude:/<id>` live, then `ahp-session:/<id>` with provider `codex`), which failed first by resolving.
After the re-review of 2026-09-30 that check is `unheld`, asked at the top of `createSession` and `startForAutomation` before any worktree, machine or recorded choice is made, and in `openSession` for the session tools; it refuses an id a running session holds or a listed one has (`sessions` or `owners` under `nameOf(id)`).
`removeSession` now drops the session from `owners`, so a disposed session's id can be created again until a listing finds it on disk.
Tests in `host-names.test.ts`: `refuses a held id before it makes anything for the new session` (a fake worktrees port is never asked for a repository) and `refuses the id of a session a backend keeps on disk`; each fails with its half of the fix taken out.
`startForAutomation`'s id is a fresh uuid, so its check is not tested on its own.
Comments rewritten to say what the code is: `heldAs`, `uriFor` and `idOf` in `catalog.ts`, and `formerChatUri`, `titleOf` and `keepTitle`, which now say the fallback exists because a session store may hold a chat's title under its `ahp-session:` spelling.
`heldAs`, `spellingOf` and `sessionChannel` share one `OWN_CHANNEL` pattern for an `ahp-` channel that is not a session.
The `agent-acp` and `agent-cofold` turn tests compare sessions by `idOf` from `@ahpd/sdk` instead of a local slice.
The third pass of the review moved the restart wait: `applyDispatch` asks `restarting` for the session the channel names (`sessionFor`), before the branches for a session nothing is running, since a session being started again is out of `sessions` and its chats out of `byChat`, which sent a config change to the store alone and a turn to a second backend.
The wait is returned into the connection's `waiting` queue, so the connection's later dispatches, on any channel, are applied after it.
Test: `session-fixed-key.test.ts` `applies a config change and a turn sent while the session starts again into a machine, in order, to the new backend` (a `disposable:box` source whose machine is held back; the change and the turn reach the second backend in order, and a root dispatch sent after them is echoed after); it fails with the old lookup, and its root half fails with the queue taken out.
After the fourth pass of the review a terminal could not take a session's name nor a session a terminal's; the fifth pass made that one rule for every kind of name: `claims` holds every name the host holds, `claimable` refuses a claimed, resolving or reserved name, and `unheld` asks it of the held name and the name the client asked for, which `createSession` then claims as the session's.
In the seventh pass `createSession` claims both names before `isolated`, `settle` and `placedIn` and lets them go if the session is not made, `restart` and `restartChat` take a chat out of `byChat` with its name still claimed (`Claiming.drop`), and a scheme that names a provider is a session's space (`spaceHere`); tests in the task 08 Resume.
Tests: `users-gate.test.ts` `keeps terminals and sessions from being named after each other` (fourth pass, which failed first with all three answered) and `keeps every name to one kind of thing` (fifth pass: a relay named after a session, a session named after a relay, chats in reserved spaces, terminals named after a chat or a session's channels, and a session named `vscode:/three` over a terminal; it failed first with the relay taken).
The waits in `applyDispatch` are bounded: a dispatch that waits on `restarting` or on `past` is refused after `WAIT_LIMIT` (60 s) with `<channel> starting again took longer than 60s` or `reading the catalogue took longer than 60s`, and the connection's queue moves on; the bound is a defaulted row in the plan.
The first dispatch that waits on a restart is dropped when its connection has left by the time the restart ends, as the ones queued behind it already were, and a queued step that throws is refused to the client with the error as `rejectionReason`, as well as logged.
Tests in `session-fixed-key.test.ts`: `drops a turn that waited on a restart when its connection left`, `refuses a waiting turn the backend throws on, to the client that sent it`, `refuses a dispatch that waited too long on a restart, and goes on with the next` and `refuses a config change that waited too long on the catalogue`; the first three fail with their half of the fix taken out.
Brought onto `5221af7`: `beginAutomation` holds its session as `<provider>:/<uuid>` and asks `unheld` first, `createSession` refuses a closing host before it claims any name, and a create that `spawn` refuses for closing lets its names go in the same `finally`; three tests from that commit expected the created name and now expect the held one (`host-close.test.ts`, `turning.test.ts`), and the `plugin-kept` fixture in `packages/server/test` takes its row's id through `idOf`, as the example backends do.
