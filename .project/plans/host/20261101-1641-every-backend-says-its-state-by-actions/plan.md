---
title: Every backend says its state by actions
domain: host
status: built
priority: high
created: 2026-11-01
revalidated: 2026-11-01
requires:
  - plans/host/20261101-0329-the-hosts-state-is-the-reducers-output/plan.md
  - plans/host/20261101-1357-backends-say-their-state-by-actions/plan.md
  - plans/host/20261101-1357-a-case-starts-from-its-initial/plan.md
refs:
  - git://b7a08801 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L3 - actions are the sole mutation mechanism for subscribable state"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L103-L120 - an input-needed entry leaves when the chat-level request resolves"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/elicitation.md#L25-L33 - a question is put on the chat by `chat/inputRequested`"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/reconciliation.md#L60 - the server's echo is the source of truth"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L106-L117 - the reference's `!` command reports a failed command on its call"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L201-L213 - and ends every local command's turn with `chat/turnComplete`"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/protocolServerHandler.ts#L585-L597 - a client's config vocabulary is taken into the host's own keys, which the state holds"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/common/claudeSessionConfigKeys.ts#L6-L25 - the reference's Claude host collapses `autoApprove` and `mode` onto `permissionMode`"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentSideEffects.ts#L1467-L1482 - the reference host says a chat's running turn cancelled when it stops that chat's work"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L449-L474 - a steering message that cannot reach the agent is logged and dropped, and the turn runs on"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentSideEffects.ts#L1006-L1016 - a subagent's charges are folded into the turn that delegated it"
  - "[code://packages/agent-claude/src/session/turns.ts#L422-L534](../../../../packages/agent-claude/src/session/turns.ts#L422-L534) - a `!` command, which records an error the action does not say"
  - "[code://packages/agent-claude/src/session/config.ts#L247-L302](../../../../packages/agent-claude/src/session/config.ts#L247-L302) - `mode` and `autoApprove` moved onto `permissionMode` with no action"
  - "[code://packages/agent-claude/src/session.ts#L206-L325](../../../../packages/agent-claude/src/session.ts#L206-L325) - `error` on the session state, and a close that leaves entries"
  - "[code://packages/agent-claude/src/session/servers.ts#L92-L108](../../../../packages/agent-claude/src/session/servers.ts#L92-L108) - a customization list said only when it holds something"
  - "[code://packages/agent-claude/src/session/customizations.ts#L278-L288](../../../../packages/agent-claude/src/session/customizations.ts#L278-L288) - a prompt's argument hint as a field no type declares"
  - "[code://packages/agent-pi/src/session.ts#L820-L829](../../../../packages/agent-pi/src/session.ts#L820-L829) - the thinking level said under `values`"
  - "[code://packages/agent-pi/src/session.ts#L1381-L1420](../../../../packages/agent-pi/src/session.ts#L1381-L1420) - a failed steer ends the turn while pi runs on"
  - "[code://packages/agent-acp/src/session/handlers.ts#L104-L112](../../../../packages/agent-acp/src/session/handlers.ts#L104-L112) - an ACP command's hint as a field no type declares"
  - "[code://packages/agent-cofold/src/mapping.ts#L628-L651](../../../../packages/agent-cofold/src/mapping.ts#L628-L651) - a question raised on the session alone"
  - "[code://packages/sdk/src/sessions/nested.ts#L882-L906](../../../../packages/sdk/src/sessions/nested.ts#L882-L906) - what the nested proxy relays, and under which names"
  - "[code://packages/sdk/src/sessions/nested.ts#L1180-L1186](../../../../packages/sdk/src/sessions/nested.ts#L1180-L1186) - a nested chat's status, read off the mirror's active turn"
  - "[code://packages/sdk/src/usage/meter.ts#L1-L18](../../../../packages/sdk/src/usage/meter.ts#L1-L18) - why a Claude turn's usage sums its workers'"
  - "[code://packages/sdk/src/host/snapshots.ts#L124-L182](../../../../packages/sdk/src/host/snapshots.ts#L124-L182) - a session's seed takes its status from the host's own bits"
---

## Goal

Every change a backend makes that a client can see goes out as the protocol's action for it.
The host's held state, and every client's, then carries it.
A field no protocol type declares leaves the state a backend builds.
A backend's own state is for its own work and for a seed.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The work list is the backends' plan's [deferred.md](../20261101-1357-backends-say-their-state-by-actions/deferred.md).

### Searches performed

- `rg -n "ctx\.failed" packages/agent-claude/src` - the `!` command's failure marks the session failed.
- `rg -n "permissionFor" packages/` - the mapped keys, and the echo that carries the key sent.
- `rg -n "inputNeededRemoved" packages/agent-claude/src` - a stop removes its entries and a close does not.
- `rg -n "argumentHint|scope: 'session'" packages/*/src` - the fields no type declares, on a prompt and on a schema property.
- `rg -n "chat/inputRequested" packages/*/src` - every backend that asks puts the question on its chat except cofold.
- `rg -n "outward|served\(" packages/sdk/src/sessions/nested.ts` - what the proxy renames and relays.

### Gaps

- A failed `!` command says `chat/turnComplete` while its record says `error` and its session says failed.
- A client's `mode` or `autoApprove` moves `permissionMode` with no action, and the store keeps the key sent.
- A close to start again leaves its questions in every client's input list, and its running turn running.
- A customization list that empties is never said.
- `error`, a prompt's `argumentHint` and a schema property's `scope` reach the state with no type declaring them.
- pi says its thinking level under a field the action does not declare, and a failed steer ends a turn pi still runs.
- pi's running turn carries a `state` its type does not declare.
- cofold raises a question on the session alone, so the chat holds no request to answer.
- The nested proxy draws a chat's status as two values, and passes the host its inner names.
- It relays inner terminal, canvas and changeset names, and the inner host's rows for the lead chat.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A failed `!` command ends its turn complete, its call carrying the failure, and marks nothing failed | [bangLocalCommand.ts#L106-L117](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L106-L117); [localChatCommand.ts#L201-L213](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L201-L213) | 01 |
| A backend's `setConfig` answers the values it took when it took them under keys of its own, and the host says and keeps those | [protocolServerHandler.ts#L585-L597](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/protocolServerHandler.ts#L585-L597); [reconciliation.md#L60](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/reconciliation.md#L60) | 01 |
| Claude takes `mode` and `autoApprove` as `permissionMode` | [claudeSessionConfigKeys.ts#L6-L25](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/common/claudeSessionConfigKeys.ts#L6-L25) | 01 |
| A Claude session stopped to start again says each entry it held removed and its running turn cancelled | [session-channel.md#L103-L120](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L103-L120); [agentSideEffects.ts#L1467-L1482](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentSideEffects.ts#L1467-L1482) | 01 |
| A customization list is said whenever it moved, an empty one included | `types/channels-session/actions.ts`, `session/customizationsChanged`: "Full-replacement semantics" | 01 |
| `error` leaves Claude's session state, and the turn's `chat/error` part says the failure | `types/channels-session/state.ts`, `SessionState`, which declares `creationError` alone | 01 |
| A prompt's argument hint goes under `_meta['ahpd.argumentHint']`, as a skill's does, for Claude and for ACP | `types/channels-session/state.ts`, `PromptCustomization`, which declares `description` alone | 01, 03 |
| pi says its thinking level as `session/configChanged` with `config` | `types/channels-session/actions.ts`, `SessionConfigChangedAction.config` | 02 |
| A steer pi fails to take is logged and taken out, and the turn runs on | [claudeSdkPipeline.ts#L449-L474](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L449-L474) | 02 |
| `state` leaves pi's running turn, and `scope` leaves the schemas pi and ACP put in their state | `types/channels-chat/state.ts`, `ActiveTurn`; `types/channels-session/state.ts`, `SessionConfigPropertySchema` | 02, 03 |
| cofold puts a question on its chat by `chat/inputRequested`, beside the session's entry | [elicitation.md#L25-L33](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/elicitation.md#L25-L33) | 04 |
| A nested chat's status is the activity the inner host's reducer gave it | [actions.md#L3](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L3) | 05 |
| The proxy answers its customizations and turns under the outer names | [actions.md#L3](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L3) | 05 |
| An inner terminal is relayed into an output terminal of the outer host, and named by it | `types/channels-chat/state.ts`, `ToolResultTerminalContent.resource`: "subscribable for live or retained terminal state" | 05 |
| The outer host alone says a nested session's changesets, its canvases and its lead chat's row | [actions.md#L3](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L3); the backends' plan's *Answers* | 05 |
| A Claude worker's usage needs nothing: `chat/usage` says it on the turn that delegated it, which holds the same | [meter.ts#L1-L18](../../../../packages/sdk/src/usage/meter.ts#L1-L18); [agentSideEffects.ts#L1006-L1016](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentSideEffects.ts#L1006-L1016) | - |
| The bot's session status needs nothing: a session's seed takes its status from the host's own bits, and its row from its chats | [snapshots.ts#L124-L182](../../../../packages/sdk/src/host/snapshots.ts#L124-L182); [session-channel.md#L89-L101](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L89-L101) | - |

## Proposed architecture

- **Data flow** - a backend's change goes out through its `emit`, and the host reduces it into the held state.
- **State flow** - a backend's `chatState()` and `sessionState()` are read for a seed, so what they carry is what an action has said.
- **Layer responsibilities** - backends: each change as its action, and only declared fields. sdk host: the echo of a config key in the backend's own keys.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts), [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts), [`code://packages/agent-cofold/src/mapping.ts`](../../../../packages/agent-cofold/src/mapping.ts), [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Claude says its state by actions](task-01-claude-says-its-state-by-actions.md) | done | - |
| [02 - pi says its state by actions](task-02-pi-says-its-state-by-actions.md) | done | - |
| [03 - ACP declares only declared fields](task-03-acp-declares-only-declared-fields.md) | done | - |
| [04 - cofold asks on its chat](task-04-cofold-asks-on-its-chat.md) | done | - |
| [05 - the nested proxy says the outer names](task-05-the-nested-proxy-says-outer-names.md) | done | - |

## Risks and tradeoffs

- A client that sent `mode` is answered with `permissionMode`, so its own key leaves its state with the echo.
- An inner terminal reaches a client as text in an output terminal, so a client cannot type into it.

## Resume state

- **Done so far:** tasks 01 to 05.
- **Next action:** none; the plan is built.
- **Open questions:** none.
- **Watch out for:** a backend action said inside a client's dispatch of the same type is taken as that dispatch's echo.

## Final verification checklist

- [x] Each backend's suite and the sdk suite pass, and each changed case failed before its change for its reason.
- [x] `undeclaredIn` finds nothing in each backend's frames and snapshots.
- [x] `pnpm run typecheck` and `pnpm run boundary` exit 0, and the prose lint is clean.
