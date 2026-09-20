---
title: Fork and rewind are a cut in the store, and the run loop keeps reading the session
status: accepted
date: 2026-09-20
refs:
  - code://.project/plans/plugin/04-agent-facio-extras/task-02-fork-and-rewind.md - the task this decides the shape of
  - code://packages/agent-facio/src/agent.ts - where the two point methods would live, and where the comment says they are unmapped
  - file:///github/facio/packages/agents/src/run/run.ts - `run()`, which has no argument for the history to run on
  - file:///github/facio/packages/agents/src/run/turn.ts - `store.sessions.listMessages({ sessionId })`, the whole session, read once per turn
  - file:///github/facio/packages/agents/src/types/store.ts - `Store.sessions`, whose only removal is a whole session
  - file:///github/facio/packages/agents/src/types/run.ts - `RunArgs` and `ResumeArgs`, neither of which can start at a message
---

## Context

`@ahpd/agent-facio` leaves `Start.forkAt` and `Start.rewindAt` unmapped, so the window's fork and rewind controls do nothing on a facio session.
AHP means two different things by them: a fork continues from a turn under a **new** session id and leaves the original whole, while a rewind continues under the **same** id with the turns after the cut dropped.

Facio records the two facts a cut needs - a run's `inputMessageId` and `lastMessageId` - but it has no way to act on them.
`run()` takes no history: `turn.ts` reads `store.sessions.listMessages({ sessionId })`, which is the whole session, and `ResumeArgs` only rejoins a run after a sequence number.
`Store.sessions` can append, list, claim and release, and delete a whole session; it cannot remove the messages after one.

A fork is therefore reachable from today's public store API: create a new session, take its writer claim, append the messages up to the cut, release, and run in it.
A rewind is not: the same session id cannot drop a tail, and deleting and recreating the session to rebuild a shorter one would take its runs, events and steps with it, so tool timings and usage would be lost by a rewind, which is a cost nobody asked for.

## Decision

`@facio/agents` gains two store primitives, and the run loop is not touched:

1. `Store.sessions.truncate({ sessionId, throughMessageId })` drops the messages after the given one, and with them the runs, events, steps and requests of the turns that went with them. A run record is kept only when its `inputMessageId` and its `lastMessageId` are both among the messages that remain, so the kept turns keep their usage and their tool timings. It refuses with `writer_busy` while a `running` claim is held, the way `delete` already does, and with `not_found` for a session or a message that is not there. A rewind is this.
2. `Store.sessions.fork({ fromSessionId, throughMessageId, sessionId })` creates the target session and copies the kept messages and their run, event and step records into it, leaving the source untouched. A fork is this, and the new id is what makes the original whole for somebody else to find.

`run()` keeps reading `store.sessions.listMessages({ sessionId })` and gains no history argument: the session is the one place that says what the conversation is, and a history passed per call would let the store and the model's prompt disagree. The cut happens before the run, in the place that owns the conversation.
Source: Softov, 2026-09-20: "ok do option 2".

## Consequences

Both AHP operations are honoured with the semantics AHP gives them: a fork under a new id with the original untouched, a rewind under the same id with the tail dropped, and neither one losing the record of the turns it keeps.
The host's two paths already hand the cut point over - `forkPoint` for a fork, `endPoint` for a rewind - so the bridge only has to honour it, and a client that offers the controls gets a working one.
The loop, the model request and the run record are unchanged, so nothing about a normal turn moves and the change is testable at the store alone.
A truncation is also the primitive a compaction that replaces a prefix needs, so the store owns one more operation rather than the harness growing a second notion of history.
The cost is a store contract that both implementations must honour identically, which is what the conformance suite is for.

## Options

- **Fork only, from the bridge, and refuse a rewind.**
  Rejected once the cut was understood: it is asymmetric for no reason, and the host has no separate rewind flag, so the window would offer a fork and no rewind, which is honest but half the feature.
- **Refuse both.**
  Rejected: the host's paths exist, `inputMessageId` and `lastMessageId` are already recorded, and the control is something a client draws.
- **`RunArgs.history`, with the run given the messages to run on.**
  Rejected: two sources of truth for the conversation. The store would hold one history and the prompt another, and every later feature would have to reconcile them.
- **Seed a new session for a rewind as well**, keeping the id by deleting and recreating the session.
  Rejected: it takes the kept turns' runs, events and steps with it, so usage and tool timings vanish from the conversation a rewind was supposed to keep.
- **Write the messages into a new session without claiming the writer.**
  Rejected: the claim is what orders writers, and a store that accepted an unclaimed append would be a store whose whole claim protocol means nothing.
