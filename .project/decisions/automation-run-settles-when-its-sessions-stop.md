---
title: An automation run settles when its sessions stop, not when it starts
status: accepted
date: 2026-09-22
refs:
  - code://packages/sdk/src/types/automations.ts - the `AutomationStore` port, which gains `settle`
  - code://packages/sdk/src/automations.ts - `memoryAutomations`, where the run lifecycle is written and never finished
  - code://packages/sdk/src/host.ts - the turn ends and the session disposal, which are the only places a run's session stopping is visible
  - npm://@microsoft/agent-host-protocol@^0.9.0 - `AutomationRunStatus`, whose terminal statuses are `completed`, `failed` and `cancelled`, and whose rule is that a run stays `running` while any linked session executes or awaits a person
  - code://test/automations.test.ts - the run lifecycle the tests hold
---

## Context

`memoryAutomations().run` wrote `pending`, then `running`, and never anything else.
`failed` was written when the session could not be started, so the one terminal status in use covered the one case where nothing had run.
A run whose session finished, errored, was cancelled or was disposed stayed `running` for ever, on its own channel and in the `runs` summary the automations catalogue carries, so a client drew "in execution" over work that had stopped.

The protocol is unambiguous about what should happen instead: `completed`, `failed` and `cancelled` are terminal, and a run remains `running` while any linked session executes or awaits client-side work.
Only the host sees a turn end or a session be disposed, and only the store owns the run, so the two facts live in different places.

## Decision

`AutomationStore` gains an optional `settle(run, ending)`, and the host calls it when a session linked to a run stops: the turn ending is `completed`, a cancelled turn is `cancelled`, a `chat/error` is `failed` with its message, and disposal of the last live linked session is `cancelled`.
The store writes the terminal lifecycle, with `completedAt`, and announces it through the `onChanged` the host already listens on, so the run channel and the catalogue summary move together.
A settle on an already-terminal run is refused and answers `false`, so a late event from a session a run no longer holds cannot reopen it.
A settle is passed over while another linked session is still in progress or waiting on a person, because one session finishing is not the run finishing.
The failure path in `run` is corrected in the same change: the protocol's failed lifecycle names the field `completedAt`, and it had been written as `endedAt`.

Source: the user, 2026-09-22: "The automations, even if session finished... it keep showing in execution... its a problem or something else..."

## Consequences

`settle` is optional, so a store that keeps its runs immutable is unaffected, and `scheduledAutomations` inherits it from the `memoryAutomations` it composes with no edit of its own.
The host's settlement point is the session's own `emit` callback, which already recognises the three endings, and the disposal path, which already reads the session's origin to unlink the run.
A run with several sessions now moves when the last of them stops, which is the rule the protocol states and the only one that does not declare a run finished while a second worker is still running.
The run is marked `running` before the session is asked for, not after, because a backend can finish its turn before `start` resolves - the echo backend with no pace does exactly that - and a completed ending needs the `startedAt` the protocol requires on a completed run.
The start resolving afterwards records the session and never rewrites a lifecycle a settle has already made terminal.

## Options

- **Hand the ending to the store**, which is the direction taken.
- **Derive the run's lifecycle in the host at read time and overlay it.**
  Rejected: the store builds the `runs` summary the catalogue carries, so an overlay would leave the catalogue saying `running` while the run channel said `completed`, which is two answers to one question.
- **Have the store poll the sessions it started.**
  Rejected: a store does not know what a session is, which is the whole reason `run` is handed a `start` function rather than a host to reach into.
