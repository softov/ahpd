---
title: The first events fire at the host's own moments
status: todo
depends:
  - task-01-event-option-and-on.md
layer: packages/sdk
refs:
  - code://packages/sdk/src/types/events.ts - the union this task raises
  - code://packages/sdk/src/host.ts#L775-L780 - `log()`, where `log` is raised and every notable line already passes
  - code://packages/sdk/src/host.ts#L3800-L3830 - `openSession`, where `session_start` is raised
  - code://packages/sdk/src/host.ts#L2810-L2825 - where a session is disposed, for `session_end`
  - code://packages/sdk/src/host.ts#L4007 - the request handlers, where `resource_write`, `terminal_open` and `authenticated` are raised
  - code://packages/sdk/src/host.ts#L5290-L5310 - `createTerminal`, for `terminal_open`
  - code://packages/sdk/src/host.ts#L6750-L6795 - `accept`, where `client_connect` and `client_disconnect` are raised
  - code://.project/decisions/plugin-events-are-observed-not-answered.md - an event carries what a handler cannot get elsewhere
---

## Objective

Each event in the union is raised at the host moment it names, with the payload that moment knows, so a plugin subscribed to `session_start`, `turn_end`, `tool_call`, `log` or any other sees it once per occurrence and in the order the host did the work.

## Files

- `UPDATE: packages/sdk/src/host.ts` - one `fire(name, event)` helper and the call sites below.
- `CREATE: test/plugin-events-fire.test.ts` - one case per event.

## Steps

1. Write `fire` next to `log` in `createHost`, calling `options.events?.[name]` in order through the awaiting helper task 03 defines, and call it with the connection or session context the site has.
2. Raise `log` from inside `log()`, with the line the host already wrote, and call it before the OTLP payload is built so a slow handler does not sit between the line and the export.
3. Raise `session_start` at the end of `openSession`, once the session is in the map and its `sessionId` and provider are known, and not when a resumed session is opened from a catalogue row, which is a different moment.
4. Raise `session_end` where a session is disposed and after the entry is removed, with the URI and the reason.
5. Raise `turn_start` and `turn_end` where the host dispatches `chat/turnStarted`, `chat/turnComplete` and `chat/turnCancelled`, since those are the three ways a turn begins and ends as the host sees them.
6. Raise `message` where a client's dispatch carries a turn the host is about to start or queue, before it is queued, so a handler sees it once whether or not it runs at once.
7. Raise `tool_call` where a `HostTool.run` is invoked, with the tool name, the session and the chat, after the call and with whether it threw, so a handler knows the outcome and not only the attempt.
8. Raise `client_connect` where a connection is added and `client_disconnect` where one goes away, with the client id; raise `authenticated` in the `authenticate` handler with the resource, since that is the one place a token arrives.
9. Raise `automation_fire` where an automation starts a session, with the automation's resource and the run, which is the only place that knows it was not a person.
10. Raise `resource_write` in the `resourceWrite` handler after the store accepted the write, and `terminal_open` in `createTerminal` after the terminal exists, so neither reports something that did not happen.
11. Raise nothing for a per-token delta: a plugin that wants the stream is a client, and a `chat/delta` callback is not in the union.

## Validation

- `test/plugin-events-fire.test.ts`, driving a host with a fake peer the way `test/host.test.ts` does and one plugin subscribed to everything:
  - a created session fires `session_start` once with its provider; disposing it fires `session_end`.
  - one turn fires `turn_start` then `turn_end` in that order, with the same turn id.
  - a cancelled turn fires `turn_end` with the cancelled status.
  - a host tool call fires `tool_call` once, and a tool that throws still fires it with the failure.
  - `resourceWrite` fires `resource_write`, and `createTerminal` fires `terminal_open`, each once.
  - the host's own lines fire `log` with the same string `onEvent` receives.
  - no event fires for a `chat/delta`.
- `pnpm test` green and `pnpm typecheck` green.

## Resume

Empty until started.
