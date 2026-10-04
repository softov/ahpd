---
title: The ACP bridge resumes, forks and asks
domain: plugin
status: planned
priority: medium
created: 2026-09-26
revalidated: 2026-10-03
requires:
  - plans/plugin/07-agent-acp/plan.md
  - plans/host/19-a-fork-copies-through-the-turn/plan.md
  - plans/acp/02-replay-lands-in-history/plan.md
changes: []
creates: []
decisions:
  - decisions/acp-bridge-uses-the-protocol-sdk.md
refs:
  - "[code://packages/agent-acp/src/session.ts#L1006-L1147](../../../../packages/agent-acp/src/session.ts#L1006-L1147) - `open`: a resume and a reopen after a death are always `session/load` today"
  - "[code://packages/agent-acp/src/session.ts#L1123-L1136](../../../../packages/agent-acp/src/session.ts#L1123-L1136) - the watched record, built only from what `session/load` replayed"
  - "[code://packages/agent-acp/src/session.ts#L20-L23](../../../../packages/agent-acp/src/session.ts#L20-L23) - a fork is one of the members the bridge does not support"
  - "[code://packages/agent-acp/src/connection.ts#L60-L150](../../../../packages/agent-acp/src/connection.ts#L60-L150) - the client handlers and agent calls the bridge wires"
  - "[code://packages/agent-acp/src/transcript.ts#L1-L13](../../../../packages/agent-acp/src/transcript.ts#L1-L13) - the record is what this process watched, and `session/load` replays into it"
  - "[code://packages/agent-acp/package.json#L66](../../../../packages/agent-acp/package.json#L66) - `@agentclientprotocol/sdk` `^1.5.0`, while `node_modules` still holds 1.4.0; `resumeSession`, `unstable_forkSession` and `createElicitation` are in both"
  - "[code://packages/sdk/src/types/agent.ts#L246-L261](../../../../packages/sdk/src/types/agent.ts#L246-L261) - `Start.resume`, `Start.forkAt` and `Start.seed`, the turns already known"
  - "[code://packages/sdk/src/types/agent.ts#L357](../../../../packages/sdk/src/types/agent.ts#L357) - `chats.fork`, a static field of the agent, set before any server is spawned"
  - "[code://.project/plans/host/19-a-fork-copies-through-the-turn/plan.md](../../host/19-a-fork-copies-through-the-turn/plan.md) - a fork copies through the chosen turn, and `forkPoint` names the turn's last entry; task 02 is written to it"
  - "[code://packages/sdk/src/types/session.ts#L245-L260](../../../../packages/sdk/src/types/session.ts#L245-L260) - `forkPoint`, whose absence is what hides the fork control"
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/guide/elicitation.md - an input request is `chat/inputRequested`, answered by `chat/inputCompleted`, and it is how a host completes an `elicitation/create`
---

## Goal

A session on an ACP server resumes without replaying what the host already holds, forks where the server can, and asks the person a question when the server asks one.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "loadSession|resumeSession|forkSession|elicitation" packages/agent-acp/src` - `loadSession` only.
- `rg -n "resumeSession|unstable_forkSession|createElicitation" node_modules/.pnpm/@agentclientprotocol+sdk@1.4.0*/node_modules/@agentclientprotocol/sdk/dist/acp.d.ts` - all three are in the version ahpd already has; `session/fork` is marked unstable and is offered only when the server advertises `session.fork`.
- The SDK marks `session/resume` and `elicitation/create` as stable and `session/fork` as unstable.

### Runtime path

```
createSession(resume) -> agent-acp open()
  -> [new] Start.forkAt set and server advertises session.fork -> unstable_forkSession -> a new ACP session id
  -> [changes] server advertises session.resume and Start.seed is not empty -> session/resume, watched record seeded from Start.seed
  -> otherwise session/load, as today
server died, next turn -> open() again -> session/resume when advertised (the record is kept), else session/load as today
server elicitation/create -> [new] chat/inputRequested -> a client answers chat/inputCompleted -> the elicitation's response
```

### Gaps

- A resume always replays the whole conversation, even when the host already holds its turns.
- A fork is never offered for an ACP session.
- An `elicitation/create` from the server is not answered, because the bridge does not advertise the capability.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [The ACP bridge uses the published protocol SDK](../../../decisions/acp-bridge-uses-the-protocol-sdk.md) | Softov, 2026-09-22 |

| What | Source | Task |
| --- | --- | --- |
| `session/resume` when the server advertises `session.resume` and `Start.seed` holds the conversation; `session/load` otherwise, because its replay is the only record for a session this process never watched | [`code://packages/agent-acp/src/transcript.ts#L1-L13`](../../../../packages/agent-acp/src/transcript.ts#L1-L13) | 01 |
| A fork uses `unstable_forkSession`, only when the server advertises `session.fork` | Softov's brief of 2026-09-26 names `session/fork` | 02 |
| The bridge declares `chats.fork: true` statically, and each session's `forkPoint` answers `undefined` where its server did not advertise `session.fork`; nothing spawns at load | Softov, 2026-10-04, asked "`chats.fork` is a static field of the agent and `probe` spawns nothing. Declare `chats.fork: true` statically and answer `forkPoint` per session, or spawn the server once at load to read its capabilities?": declare it statically | 02 |
| `forkPoint` answers only for the last turn, because `session/fork` copies the whole session and has no cut | the SDK's `ForkSessionRequest`, which carries no message id | 02 |
| `forkPoint` names the end of the chosen turn, its last entry, so the fork copies through the turn | Softov, 2026-09-26, in [host 19](../../host/19-a-fork-copies-through-the-turn/plan.md): "a fork copies history through the chosen turn" | 02 |
| The bridge advertises `elicitation` and answers `elicitation/create` through `chat/inputRequested` and `chat/inputCompleted`; `elicitation/complete` closes a URL request | the AHP elicitation guide | 03 |
| The bridge stays on ACP v1 until a stable v2 SDK is published; v2 is in [deferred.md](deferred.md) | Softov, 2026-09-26 | - |
| `open` tries fork, then resume, then load, in that order; a reopen after the server died uses `session/resume` when advertised and `session/load` otherwise, and never forks | (defaulted: a fork is asked once, at create; a reopen continues the same ACP session) | 01, 02 |
| After `session/resume`, the watched record is seeded from `Start.seed`, because no replay arrives to build it | [`code://packages/agent-acp/src/session.ts#L1123-L1136`](../../../../packages/agent-acp/src/session.ts#L1123-L1136) | 01 |
| No SDK change in this plan; `package.json` already asks `^1.5.0`, and `pnpm install` brings `node_modules` up from 1.4.0 before task 01 | [`code://packages/agent-acp/package.json#L66`](../../../../packages/agent-acp/package.json#L66) | 01 |

## Proposed architecture

- **Data flow** - `open` chooses the ACP call from the handshake and `Start`; an elicitation's form becomes the input request's questions, and the answers become the elicitation's content.
- **Event flow** - an elicitation is an input request on the chat, so `session/inputNeededSet` follows as it does for a permission.
- **State flow** - a fork's new ACP session id replaces the old one on the forked session; nothing else is kept.
- **Layer responsibilities** - `packages/agent-acp/src/session.ts`: the choice of call, the fork and the request · `packages/agent-acp/src/connection.ts`: the new handler and the advertised capability · `docs/PLUGINS.md`: what the bridge asks and answers.
- **Source-of-truth files** - [`code://packages/agent-acp/src/session.ts`](../../../../packages/agent-acp/src/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A resume does not replay what the host holds](task-01-a-resume-does-not-replay.md) | todo | - |
| [02 - A session forks where the server can](task-02-a-session-forks-where-the-server-can.md) | todo | 01, and host 19 task 01 |
| [03 - A server's question is asked in the chat](task-03-a-servers-question-is-asked-in-the-chat.md) | todo | - |
| [04 - Docs](task-04-docs.md) | todo | 01, 02, 03 |

## Risks and tradeoffs

- `session/fork` is unstable and may change - it is called only when advertised, and a change is a type error at the SDK bump rather than a silent miss.
- A resume that skips the replay leaves this process without a record of the old turns - it is chosen only when `Start.seed` already carries them.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-resume-does-not-replay.md](task-01-a-resume-does-not-replay.md); task 03 does not depend on it.
- **Watch out for:** check that the host hands `Start.seed` on a resume before relying on it; if it does not, task 01 keeps `session/load` and says so in its Resume.
  ACP v2 drops `session/load`, `fs/*` and `terminal/*`; this plan stays on v1, and v2 waits in [deferred.md](deferred.md).

## Final verification checklist

- [ ] Against a scripted ACP server that advertises `session.resume`, a resumed session with known turns sends `session/resume` and no replay arrives.
- [ ] After that resume, the session's transcript holds the seeded turns and the new ones.
- [ ] Against one that does not, `session/load` is sent as today.
- [ ] A fork of the last turn creates a new ACP session; a fork of an earlier turn is not offered.
- [ ] Against a server that does not advertise `session.fork`, the agent still declares `chats.fork` and no turn has a fork point.
- [ ] An `elicitation/create` with a form appears as an input request, and the answer reaches the server.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/PLUGINS.md`, `plans/index.md` updated.
