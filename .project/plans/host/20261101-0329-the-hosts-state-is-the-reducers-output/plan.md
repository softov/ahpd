---
title: The host's state is the reducers' output
domain: host
status: built
priority: high
created: 2026-11-01
revalidated: 2026-11-01
requires:
  - plans/host/20261101-0207-the-protocol-cases-are-the-oracle/plan.md
refs:
  - git://c7899eff - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L3 - actions are the sole mutation mechanism for subscribable state"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L232 - the same reducer code runs on server and client, and side effects live in a separate dispatch layer"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/dotnet/tests/AgentHostProtocol.Tests/interop/session-host.ts#L122-L131 - the protocol's conformance host reduces each action through `sessionReducer` before it sends it"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2849-L3112 - the reference host applies the root, session and chat reducers to every action before anything reads the state"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1239-L1266 - a created session and its default chat open with a seed"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1538-L1548 - a restored session opens with a seed of what its agent restores"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L14664-L14675 - a restore reads the turns through the agent"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L14758-L14765 - and seeds the restored state with them and the values the host kept"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostSessionStateDatabase.ts#L19-L65 - the reference keeps a session's values in its own database, never its reduced state"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L4877-L4886 - `vscode/getAgentHostSessionStateFile` answers the provider's own `events.jsonl`"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3237-L3299 - a chat's state change moves its session's row and aggregate"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L311-L338 - a summary change carries the fields that changed, and `null` for a cleared activity"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2863-L2868 - a root config replace keeps the values the host keeps"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentSessionResidency.ts#L346-L361 - a session's state is let go only while no client subscribes to it"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L89-L101 - how a session summary aggregates its chats"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L24 - the session catalog stays consistent with each chat's inlined summary"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/root-channel.md#L146 - a summary change carries only the changed fields"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-root/state.ts#L39 - `activeSessions` counts the active, non-disposed sessions"
  - "[code://packages/sdk/src/host.ts#L825-L863](../../../../packages/sdk/src/host.ts#L825-L863) - `emit`, where every action this host sends goes out"
  - "[code://packages/sdk/src/host/snapshots.ts](../../../../packages/sdk/src/host/snapshots.ts) - each subscribe built from the backends' live state and this host's maps"
  - "[code://packages/sdk/src/host/catalogue.ts#L379-L421](../../../../packages/sdk/src/host/catalogue.ts#L379-L421) - the session's status and activity read from every backend"
  - "[code://packages/sdk/src/host/spawn.ts#L1454-L1468](../../../../packages/sdk/src/host/spawn.ts#L1454-L1468) - a chat's row re-sent whole when its backend's title, status or activity moves"
  - "[code://packages/sdk/src/host/spawn.ts#L212-L218](../../../../packages/sdk/src/host/spawn.ts#L212-L218) - worker chats reduced through `chatReducer`, the pattern this plan extends"
  - "[code://packages/sdk/src/machines/terminals.ts#L340](../../../../packages/sdk/src/machines/terminals.ts#L340) - terminals reduced through `terminalReducer`, the same pattern"
  - "[code://packages/sdk/src/sessions/nested.ts#L965-L998](../../../../packages/sdk/src/sessions/nested.ts#L965-L998) - the nested proxy's mirror reduced through the protocol's reducers"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the oracle, whose third check lists this plan's divergences"
---

## Goal

A client that subscribes to the root, a session or a chat is served the state the protocol's reducers make.
The host holds that state for each channel, seeds it once when the channel opens, and changes it only by the actions it sends.
So a client that watched and a client that subscribes afterwards hold the same state, which is the protocol's own convergence check.
Every field the host sets outside an action today becomes the action the protocol has for it, or goes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "sessionState\(\)|chatState\(\)" packages/sdk/src` - the snapshot and the catalogue read each backend's live state on every subscribe.
- `rg -n "status\(\)|activity\(\)|modifiedAt\(\)" packages/sdk/src/host` - a session's status, activity and time are read from every backend when asked.
- `rg -n "session/chatUpdated" packages/sdk/src/host` - a chat's row is re-sent whole, with `resource`, from the backend's answer.
- `rg -n "session/metaChanged" packages/sdk/src/host` - the action carries the folder's facts while the state's `_meta` carries four producers.
- `rg -n "customizations" packages/sdk/src/host.ts` - the subscribe lays the client plugins over a list the actions already laid them on.
- `rg -n "restartNeeded" packages/sdk/src` - root `_meta` moves with no action; no root action carries `_meta`.
- `rg -n "activeSessions" packages/sdk/src/host` - the count is the running sessions, not the open ones.

### Runtime path

```
backend or client -> dispatch -> emit: serverSeq, the channel's state through its reducer, replay buffer, broadcast
  a chat action -> the session's row and activity said as session actions -> the catalogue row
subscribe -> the channel's held state, opened from its seed if nothing holds it yet
```

### Gaps

- The host holds no state for the root, a session or a lead or peer chat; each subscribe builds one.
- So a later subscriber reads a title, a queue or a time no action said: 22 of the oracle's cases.
- A chat's row in its session moves on the backend's word and carries every field, `resource` among them.
- The session's status promotes any running chat, which the protocol's aggregation does not.
- A root summary change carries every mutable field.
- `session/metaChanged` erases the backend's keys, the origin and the owner that the state carries.
- `activeSessions` leaves out a session asleep, which is not disposed.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The host holds one state per root, session and chat channel, and every action it sends goes through the protocol's reducer for that channel before anything reads the state | [actions.md#L232](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L232); [agentHostStateManager.ts#L2849-L3112](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2849-L3112) | 01 |
| A running chat opens when its backend starts, a worker chat when it is spawned, a running session at its first action or subscribe, and a session or chat not running at its first subscribe | [agentHostStateManager.ts#L1239-L1266](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1239-L1266); [#L1538-L1548](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1538-L1548) | 01 |
| A seed is what the backend restores and what the host keeps beside it; a backend's `chatState()` and `sessionState()` are read for the seed only | [agentService.ts#L14758-L14765](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L14758-L14765) | 01 |
| Nothing writes the held state down; a restart opens each channel again from the backend's record and the host's store | [agentHostSessionStateDatabase.ts#L19-L65](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostSessionStateDatabase.ts#L19-L65); [copilotAgent.ts#L4877-L4886](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L4877-L4886) | 01 |
| A session not running lets its state go when no connection watches it or its chats; a running one holds it while it runs | [agentSessionResidency.ts#L346-L361](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentSessionResidency.ts#L346-L361) | 01 |
| A held chat that opened with no conversation takes its record's turns by `chat/turnsLoaded`, and a held session whose workers could not be read takes each one found later by `session/chatAdded` | [agentHostStateManager.ts#L759-L767](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L759-L767); [#L1698-L1767](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1698-L1767) | 01 |
| A session's `status` moves only by its reducer: the read and archived bits and the input-needed list; its chats' activity is on their rows | [actions.md#L3](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L3); the session reducer's `withInputNeededStatus` | 01 |
| Each chat action moves the chat's row by `session/chatUpdated` carrying the changed fields, and the session's activity by `session/activityChanged` | [chat-channel.md#L24](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L24); [agentHostStateManager.ts#L3237-L3299](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3237-L3299) | 02 |
| The catalogue row's status, activity and time follow the protocol's aggregation, over every chat, workers included | [session-channel.md#L89-L101](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L89-L101) | 02 |
| A summary change carries the changed fields only, and `null` for a cleared activity | [root-channel.md#L146](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/root-channel.md#L146); [agentHostStateManager.ts#L311-L338](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L311-L338) | 02 |
| `session/metaChanged` carries the whole `_meta` the session's state holds, whoever says it moved | [actions.md#L3](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L3) | 02 |
| A row's cleared `activity` stays on the row: a merge cannot clear it, and the chat's state and the session's `activity` say it | `(defaulted: the session reducer merges a partial, and the summary type has no value that clears it)` | 02 |
| The root's agents, sessions, terminals and config are held; `_meta`, the agents' sign-in flag and the per-connection config keys stay a per-connection reading | `(defaulted: root state global is correction 8, approved 2026-11-01 02:55Z, built after this plan)` | 03 |
| `activeSessions` counts the sessions this host holds open: running, and asleep until disposed | [channels-root/state.ts#L39](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-root/state.ts#L39) | 03 |
| `ahpd.restartNeeded` is a `readOnly` root config value the host sets with its own `root/configChanged`; a client's push of it moves nothing, and its echo carries the host's value | Softov, 2026-11-01, chose "A root config value" ([review](../../../working/maycxc-union-20261101-review.md), blocker 1); [agentHostSettingsFileSystemProvider.ts#L52-L67](https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/sessions/contrib/providers/agentHost/browser/agentHostSettingsFileSystemProvider.ts#L52-L67) | 03 |
| A write to the daemon's file that no client pushed is said on the root as the host's own `root/configChanged`, with `null` for a key the file no longer holds; the port is not read again at a subscribe | Softov's review of 2026-11-01, blocker 2 ([review](../../../working/maycxc-union-20261101-review.md)) | 03 |
| A terminal's title or claim moves the root's terminal list | [root-channel.md](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/root-channel.md); `TerminalInfo` carries both | 03 |
| A root config `replace` carries the values the host keeps, as the reference does | [agentHostStateManager.ts#L2863-L2868](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2863-L2868) | 03 |
| A canvas the host closes, or whose plugin goes, is said on its own channel; a failed changeset read says `error` | canvas `state.ts`: "Hosts MUST clear this field when the provider becomes unavailable"; changeset `state.ts` `Error` | 04 |
| Each oracle entry this plan fixes leaves `DIVERGES` in the same change, shown failing before it | the oracle plan's *Watch out for* | 05 |
| How an echo is answered and who hears it stay as they are | corrections 3 and 4 of the audit, each its own branch | - |

## Proposed architecture

- **Data flow** - `emit` numbers an action, reduces it into its channel's held state, buffers it and broadcasts it. A subscribe serves the held state.
- **Event flow** - after a chat action, `chatMoved` says the chat's row and the session's activity on the session channel and moves the catalogue row.
- **State flow** - a seed opens each channel once. From then on only actions move it. A running session's seed is read at its first action or subscribe.
- **Layer responsibilities** - sdk host: the held states, the seeds, the projections a subscribe applies. Backends: their own state, read for a seed only.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/host/snapshots.ts`](../../../../packages/sdk/src/host/snapshots.ts), [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - every channel holds its reduced state](task-01-every-channel-holds-its-reduced-state.md) | done | - |
| [02 - rows and summaries follow the held state](task-02-rows-and-summaries-follow-the-state.md) | done | 01 |
| [03 - the root holds its state](task-03-the-root-holds-its-state.md) | done | 01 |
| [04 - canvases and changesets say each change](task-04-canvases-and-changesets-say-each-change.md) | done | - |
| [05 - the oracle lists no R1 divergence](task-05-the-oracle-lists-no-r1-divergence.md) | done | 01, 02 |
| [06 - every suite holds the held state](task-06-every-suite-holds-the-held-state.md) | done | 01, 02, 03, 04 |

## Risks and tradeoffs

- A field a backend changes with no action stays at its seed for every client - the backends' plan says each one by its action.
- The held state of every open session is kept in memory - a session not running lets it go once nobody watches it.
- A session channel's `status` keeps the activity bits its reducer makes, and a running chat leaves them as they were.
- A drained question leaves `InProgress` there until the session's state opens again.
- The chat rows and the catalogue row say what runs, by the protocol's aggregation.
- No v1.0.0 action moves a session's activity bits, and the reference host writes its aggregate into the state outside its reducer at [agentHostStateManager.ts#L3305-L3320](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3305-L3320).

## Where this meets corrections 3 and 4

- The echo of a client's `chat/turnStarted` or `chat/queuedMessagesReordered` goes out as the host rewrites it.
- The held state reduces that echo, and correction 3 says what the echo carries.
- An action the host's own records say moves nothing is echoed to its sender alone; correction 4 sends it to every subscriber.
- The records and the held state agree for every channel this host opens, because each seed reads them.
- A case of the oracle seeded with its own state shows the two apart.

## Resume state

- **Done so far:** tasks 01 to 06.
- **Next action:** none; the plan is built.
- **Open questions:** none.
- **Watch out for:** a seed read after the delta window holds a word writes that word twice; empty the window first.

## Final verification checklist

- [x] The oracle's third check lists no divergence of this plan, and each removed entry failed before the change.
- [x] `pnpm run test:unit --maxWorkers=2` passes, with each failure under load passing alone.
- [x] `pnpm run typecheck` and `pnpm run boundary` exit 0, and the prose lint is clean.
