---
title: A working connector is ready, not open
domain: plugin
status: active
priority: medium
created: 2026-10-24
revalidated: 2026-10-24
requires: []
refs:
  - "[code://packages/sdk/src/connectors/channel.ts#L79](../../../../packages/sdk/src/connectors/channel.ts#L79) - `ConnectorState`, whose `open` becomes `ready`"
  - "[code://packages/sdk/src/connectors/channel.ts#L252-L258](../../../../packages/sdk/src/connectors/channel.ts#L252-L258) - `stateOf`, which answers the state"
  - "[code://docs/plugins/PLUGINS.md#L1170-L1174](../../../../docs/plugins/PLUGINS.md#L1170-L1174) - the table of the three states"
  - "[code://docs/plugins/WEBHOOKS.md#L49](../../../../docs/plugins/WEBHOOKS.md#L49) - \"a connector that is not open yet\""
  - file:///github/ahpw/src/bridges/connectors.ts - ahpw's own copy of `ConnectorState`, changed in ahpw's plugins plan 07
---

## Goal

A connector that the host started with a valid config has the state `ready`.
The other two states, `invalid` and `unavailable`, do not change.
The adapter member `open` and the verb "open a connector" do not change, because they name the act and not the state.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "'open'" packages/sdk/src/connectors packages/server/src` - the type and `stateOf` are the only places that write the state.
- `rg -ln "state: 'open'" packages/*/test` - `connectors-channel.test.ts`, `users-host.test.ts` and `webhook-kind.test.ts` expect it.
- `rg -n "'open'" /github/ahpw/src` - ahpw reads it in `bridges/connectors.ts` and `ConnectorPage.tsx`, and its catalogs translate it as "Open" and "Aberto".

### Runtime path

```
x-ahpd/connectors row -> stateOf -> { state: 'ready' | 'invalid' | 'unavailable' } -> client label from its catalog
```

### Gaps

- `open` reads as a connection, and a person reads "Aberto" as a door that was left open.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The state `open` is renamed `ready` on the wire, in the host and in the clients | Softov, 2026-10-24: "we need a better state name then 'open'... open means more like a connection." Then `ready`, from the options | 01 |
| `ready` is the word the plugin list already uses for a plugin that loaded, so one word has one meaning on both screens | (defaulted: ahpw's `plugins.states.ready`) | 01 |
| The host sends `ready` only, and does not also send `open` | (defaulted: ahpd and ahpw ship together, and no other client reads the state) | 01 |
| ahpw's change is its own plan, plugins 07 in ahpw | (defaulted: each repository keeps its own plans) | - |

## Proposed architecture

- **Data flow** - the row's `state` value changes from `open` to `ready`.
- **Event flow** - none.
- **State flow** - none.
- **Layer responsibilities** - sdk: the type and `stateOf`.
  docs: the state table and the prose that names the state.
- **Source-of-truth files** - [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The connector state is ready](task-01-the-connector-state-is-ready.md) | implemented | - |

## Risks and tradeoffs

- An ahpw from before its plan 07 shows the raw word `ready` until it is updated.

## Resume state

- **Done so far:** [task-01-the-connector-state-is-ready.md](task-01-the-connector-state-is-ready.md) is implemented. The wire, the host and the docs name the state `ready`.
- **Next action:** none in this repository. The by-hand check waits for ahpw's plugins plan 07.
- **Open questions:** none.
- **Watch out for:** "open" as the act stays, such as `Adapter.open`, `openAll` and "the host opens the connector". The task's file list names `users-host.test.ts`, but its `state: 'open'` is a GitHub pull request's, not a connector's.

## Final verification checklist

- [ ] ahpw shows "Pronto" and "Ready" on a working connector.
- [x] `plans/index.md` updated.
