---
title: The answer is the client's own action, on its channel, in its order, implemented
plan: plan.md
built: 2026-11-02
commits:
  - git://954a4bd0 - the plan
  - git://bbc84908 - tasks 01 to 07
  - git://2e038d5d - the order case holds the backend's start
---

## What changed

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `answering` matches the dispatch by its channel, type and names; `owed` is keyed by the dispatch's channel.
  A turn's end owes only a turn start.
  A backend's end of a turn the chat has ended, and its result for a completed call, are not said.
  `applyNow` holds the connection's next dispatch until an owed or taken dispatch is answered, for `WAIT_LIMIT` at most.
  `leaves` removes an entry under the `clientId` it carries.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - an answer a backend says goes out as the client's own action, the backend's value filling a field the client left out.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a stop is said when taken and a client's result once the backend took it.
  A config change is answered once or refused whole.
  A rename and a config change sent on a chat's channel are answered there.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - a `chat/*` action off a chat's channel is refused; an active client's entry is taken as sent.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - a turn asked for while one runs is refused, a command's too.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md), [`code://docs/sdk/TERMINALS.md`](../../../../docs/sdk/TERMINALS.md), [`code://docs/sdk/CHATS.md`](../../../../docs/sdk/CHATS.md) - the rows for the changed actions.

## Verified

- On c3c8c3e4's sources 30 of the new and changed cases fail, and all pass with the change:
  - the oracle's cases 005 to 009, 053 to 055, 070, 075, 105 and 161, with their rewritten-echo rows gone, and 035 and 036 with theirs;
  - `echo-origin.test.ts`, seven cases: a stop, a chat's action on a session's channel, a rename on a chat's channel and a denial's fields;
  - and two config keys, an unchanged fixed key, and a draft sent after a start;
  - `presence.test.ts`, `host-terminals.test.ts`, `agent-acp-turn.test.ts`, `agent-cofold-turn.test.ts` and `agent-cofold-approval.test.ts`, one case each.
- The unit suite on the branch: 7423 passed and 2 failed of 7453; the two, `plugin-contracts` and `plugin-i18n`, timed out under load and pass alone.
- `pnpm run typecheck` exits 0.

## Each label against VS Code's host (main 8fb60541)

- H1, A3: the reference host emits a client's action on the channel it came on (`agentService.ts` L13625).
  Its client takes an answer only on that subscription (`agentSubscription.ts` L375-L377, L539-L542).
  Its window sends no `chat/*` action on a session's channel, so the refusal follows the protocol's text.
- E8: the reference host emits the client's own action (`agentHostStateManager.ts` L2745-L2752).
  Before this change a VS Code client lost a denial's reason from its state.
- H2: the reference client matches an answer anywhere in its pending list (`agentSubscription.ts` L386-L403).
  It cannot tell the order, so the order follows the protocol's text.
- The stop: the reference host takes a client's cancel into its state and then aborts the agent.
  The lines are `agentService.ts` L13526-L13537 and `agentSideEffects.ts` L1921-L1955.
  Before this change a VS Code client saw text arrive after its stop.
- Q14: the reference host says a client's result when it takes it (`agentService.ts` L13625-L13650).
- A5, a turn while one runs: no VS Code client sends one.
  Its window sends a queued message (`remoteSessionMessageRouter.ts` L251-L262).
- A8: the reference host checks every key and says the action once (`agentService.ts` L13548-L13588).
  Before this change a VS Code client held a push of unchanged keys pending until it reconnected.
- C12: the reference host applies the action as sent and checks the match only on `createSession`.

## Departures from the plan

- A `session/*` action on a chat's channel of its session is answered on that channel and kept.
  A key the schema scopes to one chat is set that way, so only a `chat/*` action off a chat's channel is refused.
- A config change does not hold the connection's next dispatch.
  A backend may answer a key only as a later start closes it, and that start can be the next dispatch.

## Open

- The `tools` filled into an entry that names none: plugin/04 task-03 names only this repository's `Start` type for it.
  The protocol's `SessionActiveClient` declares `tools`, and VS Code's host applies the entry as sent.
  No source the method ranks decides the fill, and it stays as it was.
