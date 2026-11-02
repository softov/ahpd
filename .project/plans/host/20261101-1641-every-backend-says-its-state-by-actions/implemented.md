---
title: Every backend says its state by actions - implemented
date: 2026-11-01
refs:
  - git://920dbf6f
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts)"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts)"
  - "[code://packages/agent-cofold/src/mapping.ts](../../../../packages/agent-cofold/src/mapping.ts)"
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts)"
---

Each backend now says every change a client can see as the protocol's action for it, so the host's held state carries it.
The state each backend builds carries only fields the protocol's types declare.
Each site of the backends' plan's [deferred.md](../20261101-1357-backends-say-their-state-by-actions/deferred.md) is built here, or shown below to need nothing.

## What was built

- [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts) - a failed `!` command ends its turn `complete`, its call carrying the failure, and marks nothing failed.
- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - `ConfigTaken`: `setConfig` may answer the values it took under its own keys.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the host says and keeps those values in place of the key sent.
- [`code://packages/agent-claude/src/session/config.ts`](../../../../packages/agent-claude/src/session/config.ts) - `mode` and `autoApprove` are answered as the `permissionMode` they moved.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - `error` is gone from the session state; a stop says each held entry removed and its turns cancelled.
- [`code://packages/agent-claude/src/session/servers.ts`](../../../../packages/agent-claude/src/session/servers.ts) - a customization list is said whenever it moved, an emptied one included.
- [`code://packages/agent-claude/src/session/customizations.ts`](../../../../packages/agent-claude/src/session/customizations.ts) and [`code://packages/agent-acp/src/session/handlers.ts`](../../../../packages/agent-acp/src/session/handlers.ts) - a prompt's argument hint is under `_meta['ahpd.argumentHint']`.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - the slash menu reads a hint there.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - the thinking level goes out as `config`; a failed steer is logged and taken out; a running turn has no `state`.
- [`code://packages/agent-pi/src/types.ts`](../../../../packages/agent-pi/src/types.ts) and [`code://packages/agent-acp/src/session/config.ts`](../../../../packages/agent-acp/src/session/config.ts) - a property in a session's schema carries no `scope`.
- [`code://packages/agent-cofold/src/mapping.ts`](../../../../packages/agent-cofold/src/mapping.ts) - a question goes on the chat by `chat/inputRequested` beside its entry.
- [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts) - a chat's status is the mirror's activity, and the host is answered in the outer names.
- The same file - an inner terminal is copied into an output terminal of the outer host.
- The same file - the outer host alone says the changesets, the canvases and the lead chat's row.
- [`code://packages/sdk/src/types/terminals.ts`](../../../../packages/sdk/src/types/terminals.ts) - an output terminal can say it holds a pseudoterminal's text.

## Each deferred site

| Site | Audit row | What it is now |
| --- | --- | --- |
| claude, a `!` command that fails | E4 | Built: the turn is `complete` and nothing is marked failed |
| claude, `mode` and `autoApprove` | E14, E4 | Built: the echo and the store carry the `permissionMode` taken |
| claude, `close('stopping')` | CT12, C5 | Built: each entry removed, its workers' and its own turn cancelled |
| claude, a customization list that empties | E4 | Built: said whenever it moved |
| claude, `error` on `SessionState` | CT10 | Built: gone; the turn's `chat/error` part says the failure |
| claude, a prompt's `argumentHint` | E40 | Built: under `_meta`, and the same for ACP's commands |
| claude, a worker's usage | CS6 | Needs nothing: said by `chat/usage` on the turn that delegated it, which holds the same total |
| pi, `thinking_level_changed` | P7 | Built: `config` |
| pi, a failed steer | P1 | Built: logged and taken out, and the turn runs on |
| pi, `activeTurn.state` | E40 | Built: gone, and `scope` with it from pi's and ACP's schemas |
| cofold, a request for input | F1 | Built: `chat/inputRequested` on the chat |
| bot, a session's status | B12 | Needs nothing: a session's seed takes its status from the host's own bits |
| nested proxy, a chat's status | X4 | Built: the mirror chat's activity bits |
| nested proxy, inner URIs | X17, X18, X20 | Built: outer names in what it answers, terminals copied, the outer host's own lists and row kept |

A worker's usage needs nothing for this plan's requirement: nothing a client can see moves without an action.
The meter's record relies on the lead's sum, as [meter.ts#L1-L18](../../../../packages/sdk/src/usage/meter.ts#L1-L18) says.
The reference folds a subagent's charges into the turn that delegated it at [agentSideEffects.ts#L1006-L1016](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentSideEffects.ts#L1006-L1016).
The bot's session `status` is never read: [snapshots.ts](../../../../packages/sdk/src/host/snapshots.ts) seeds a session's status from its read and archived bits and its input list.
Its catalogue row is the aggregation over its chats.

## Verified

- Each change has a case that fails before it, for the reason it names, and passes after it.
- `host-local-turns.test.ts`: a failed command's kept turn read `error` before, `complete` after.
- `conformance.test.ts`: a client's `mode` was echoed as `mode` before, and as `permissionMode` after.
- `agent-claude-stopped-call.test.ts`: a stopped session left its question's entry up before; nothing is up after.
- `agent-claude-cancelled-turn.test.ts`, `agent-claude-reread.test.ts` and `wire.test.ts`: `error`, the emptied list and `argumentHint`.
- `agent-pi.test.ts` and `agent-pi-declared.test.ts`: the level reduced to nothing, a failed steer ended the turn, and `state` and `scope` were undeclared.
- `agent-acp-ports.test.ts` and `agent-acp-catalog.test.ts`: `argumentHint` and `scope`.
- `agent-cofold-approval.test.ts`: the chat held no request before.
- `nested-proxy.test.ts`: the status, the kept-back row and canvases, and the terminal copy each failed before.
- `pnpm run test:unit --maxWorkers=2` passes 7352 of 7389, 28 skipped.
- Of the 9 failures, 8 are timeouts under load; seven of them pass alone.
- The other two fail alone on the base commit as well: `nested-start.test.ts`'s first case, and the usage pools case.
- `pnpm run typecheck` and `pnpm run boundary` exit 0.

## Departures from the plan

- `Session.setConfig` gained an answer, the values taken, which the plan's first answer row names.
- The output terminal gained `isPty`, so a copy of a pseudoterminal says what its text is.

## Left for later

- Nothing; every site of the backends' plan's deferred list is built or needs nothing.
