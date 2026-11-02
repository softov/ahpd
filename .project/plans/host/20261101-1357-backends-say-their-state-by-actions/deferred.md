---
title: Backends say their state by actions - deferred
date: 2026-11-01
---

## What waits

The audit of 2026-11-01 names these backend sites, each a change a backend keeps or says outside an action.
Each stays at its seed for every client until its backend says it by its action, or the field goes.

| Site | What the backend does | Audit row |
| --- | --- | --- |
| claude `session/turns.ts`, a `!` command that fails | records the turn `error` and the session failed, while it says `chat/turnComplete` | E4 |
| claude `session/config.ts`, `mode` and `autoApprove` | maps them onto `permissionMode`, which moves with no action | E14, E4 |
| claude `session/session.ts`, `close('stopping')` | leaves each open question's `inputNeeded` entry in place | CT12, C5 |
| claude `session/servers.ts`, a rebuilt customization list | says the list only when it holds something, so a list that empties is never said; a session in a machine lists no folder rows, so its list can empty | E4 |
| claude `session/session.ts`, `error` on `SessionState` | a field the type does not declare | CT10 |
| claude `session/customizations.ts`, a prompt's `argumentHint` | a top-level field the type does not declare | E40 |
| claude `session/parts.ts` and `stream.ts`, a worker's usage | summed into the lead turn | CS6 |
| pi `session.ts`, `thinking_level_changed` | says the level as `session/configChanged` with `values`, a field the action does not declare | P7 |
| pi `session.ts`, a failed steer | `chat/error` ends the turn while pi runs on | P1 |
| pi `session.ts`, `activeTurn.state: 'running'` | a field the type does not declare | E40 |
| cofold `mapping.ts`, a request for input | an `inputNeeded` entry with no `chat/inputRequested` on the chat | F1 |
| bot `chat.ts`, a session's status | stands for its default chat's activity | B12 |
| nested proxy, a chat's status | read off the mirror's active turn | X4 |
| nested proxy, inner URIs | terminal, changeset and canvas URIs keep their inner names | X17, X18, X20 |
| every backend's record | turns read back after a restart differ from the turns clients reduced live | CS20, Q24, B10, P8 |

## Where it goes

Each site goes to a plan of its backend, which says the change by its action or removes the field.
The record rows stay with each backend's record.
Nothing writes the held state down, so a backend's record is what a restart reads.
