---
title: Fork and rewind wait on facio being able to cut a conversation, and only rewind truly needs it
status: proposed
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

Proposed, and it is one of three:

1. **Fork only, from the bridge, and refuse a rewind.** `forkPoint`/`endPoint` answer the message ids a cut would use; `create` with `forkAt` seeds a new facio session through the public store calls and runs there; `rewindAt` is refused by name. A rewind needs facio to gain a truncation and is not faked.
2. **A facio cut first, then both.** `@facio/agents` gains a way to run on a given history (a `RunArgs.history`, or `from`/`to` message ids) and `Store.sessions` gains a truncation, so a rewind can drop a tail without losing the run and step records. Then the bridge maps both, and the change is a plan and a decision in `/github/facio`.
3. **Refuse both.** Neither `forkPoint` nor `endPoint` is implemented, so the host advertises no fork and no rewind for a facio session and the controls are not drawn. Nothing else regresses, and the capability waits for a client that needs it.

## Consequences

Option 1 gives fork today at the cost of an asymmetry a client cannot see until it tries a rewind, which is refused rather than silently continuing.
Option 2 is the only one where both work and a rewind keeps the conversation's own record; it costs a change in another repository and a decision there about the shape of the cut.
Option 3 is the smallest and the most honest about what facio can do, and it is the one that leaves a window's controls absent rather than present and failing.

Whichever is chosen, `forkPoint`/`endPoint` must only be implemented when a `forkAt`/`rewindAt` can actually be honoured: the host advertises the controls from the methods' presence, so answering a point without being able to cut at it is a control that fails when used.

## Options

- **Seed a new session for a rewind as well**, keeping the id by deleting and recreating the session.
  Rejected: it takes the runs, events and steps with it, so usage and tool timings are lost from the transcript a rewind was supposed to keep.
- **Write the messages into a new session without claiming the writer.**
  Rejected: the claim is what orders writers, and a store that accepted an unclaimed append would be a store whose whole claim protocol means nothing.
