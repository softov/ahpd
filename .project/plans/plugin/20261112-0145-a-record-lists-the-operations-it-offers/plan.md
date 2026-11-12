---
title: A record lists the operations it offers now
domain: plugin
status: planned
priority: medium
created: 2026-11-12
revalidated: 2026-11-12
refs:
  - git://6616d1537 - the last commit that holds the brief this plan replaces, `briefs/a-record-lists-the-operations-it-offers-now.md`
  - "[code://packages/sdk/src/kinds/operations.ts#L1-L60](../../../../packages/sdk/src/kinds/operations.ts#L1-L60) - `OperationChannel` and `x-ahpd/invokeOperation`, the one command every channel's operations run through"
  - "[code://packages/sdk/src/types/kinds.ts#L44-L102](../../../../packages/sdk/src/types/kinds.ts#L44-L102) - `KindOperation` and `Operation`, with nothing about a record's state"
  - "[code://packages/sdk/src/tunnels/channel.ts#L279-L333](../../../../packages/sdk/src/tunnels/channel.ts#L279-L333) - `operationsOf`, one list per kind for every record"
  - "[code://packages/sdk/src/clients/channel.ts#L192](../../../../packages/sdk/src/clients/channel.ts#L192) - the clients channel's operations, on the same contract"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L90-L104](../../../../packages/tunnel-devtunnel/src/kind.ts#L90-L104) - devtunnel's own operations"
  - "[code://packages/sdk/src/agents/channel.ts#L40-L50](../../../../packages/sdk/src/agents/channel.ts#L40-L50) - agents' fixed methods"
  - "[code://packages/sdk/src/connectors/channel.ts#L1654](../../../../packages/sdk/src/connectors/channel.ts#L1654) - connectors' fixed enable and disable"
  - "[code://docs/plugins/PLUGINS.md](../../../../docs/plugins/PLUGINS.md) - where `x-ahpd/invokeOperation` is documented"
  - https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/types/channels-session/state.ts#L1001-L1017 - AHP keeps `enabled` on a customization's state, and the client draws from it
---

## Goal

Each tunnel, client, agent and connector record says which operations it offers now.
A client draws only those, so an enabled tunnel shows Disable and not Enable, and a running one shows Stop and not Start.
Agents and connectors move to the operations list that tunnels use.
A client then draws all of them with one piece of code, and takes every label from the host.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "OperationChannel" packages/sdk/src` - the tunnels and clients channels use it; agents and connectors do not.
- `rg "agentModes" ahpw/src` - ahpw picks an agent's buttons from its state with its own code.
- Softov saw a devtunnel record in ahpw on 2026-11-11 with Enable, Disable, Start, Stop and Restart together.

### Runtime path

```
channel state -> record.operations (ids) + list operations (labels, grants) -> client draws the record's ids -> x-ahpd/invokeOperation -> channel run
```

### Gaps

- No record carries the operations it offers.
- `x-ahpd/invokeOperation` accepts any operation the channel lists, whatever the record's state.
- Agents and connectors have no operations list.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Each record carries the ids of the operations it offers now | Softov, 2026-11-11: "each record list its actions ids" | 01 |
| A condition on each operation, such as a `when`, is a later idea, noted in code and in ideas | Softov, 2026-11-11: "idea for support when in a future. noted in code and ideas" | 01 |
| Agents and connectors move to the operations list, and their fixed methods keep working until ahpw and ahpc move | Softov, 2026-11-11: "Move them to the operations list" | 02, 03 |
| `x-ahpd-clients` gets the same list, since it uses the same contract | (defaulted: one shape for every operations channel) | 01 |
| Hiding or greying an operation a record does not offer is each client's choice | (defaulted: ahpd sends the list, a client draws it) | - |
| `x-ahpd/invokeOperation` refuses an operation that the target record does not offer now | (defaulted: a call the list does not offer is refused today, and the record's list is the same check) | 01 |

## Proposed architecture

- **Data flow** - the channel's list operations keep the label, grant, input and confirmation. Each record carries `operations`, the ids it offers now.
- **State flow** - the host works the ids out from the record's state each time the record is published. A kind gives a function for its own operations, which the host calls with the record and never sends.
- **Layer responsibilities** - sdk: the record field, the kind function, the `invokeOperation` check, and two new lists. · server: two channels join `channels` in `run.ts`. · tunnel-devtunnel: which of its four operations a record offers.
- **Source-of-truth files** - [`code://packages/sdk/src/kinds/operations.ts`](../../../../packages/sdk/src/kinds/operations.ts), [`code://packages/sdk/src/types/kinds.ts`](../../../../packages/sdk/src/types/kinds.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A record lists the operations it offers](task-01-a-record-lists-its-operations.md) | todo | - |
| [02 - Agents serve an operations list](task-02-agents-serve-an-operations-list.md) | todo | 01 |
| [03 - Connectors serve an operations list](task-03-connectors-serve-an-operations-list.md) | todo | 01 |
| [04 - The docs say what a record offers](task-04-the-docs-say-what-a-record-offers.md) | todo | 02, 03 |

## Risks and tradeoffs

- ahpw and ahpc draw these pages. They keep working on the fixed methods until each moves, in its own repository.
- A record's list is worked out on every publish. The work is a few comparisons per record.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-record-lists-its-operations.md](task-01-a-record-lists-its-operations.md).
- **Open questions:** none.
- **Watch out for:** plugin/20261112-0145-a-tunnel-visitor-is-the-named-person changes `packages/tunnel-devtunnel/src/kind.ts` too. Merge `origin/main` after it merges.

## Final verification checklist

- [ ] An enabled, running devtunnel record lists Disable, Stop, Restart and Anonymous access, and not Enable or Start.
- [ ] A paused agent lists Enable and Disable, and not Pause.
- [ ] `x-ahpd/invokeOperation` refuses Enable on an enabled record.
- [ ] `pnpm typecheck` passes, and the sdk and tunnel-devtunnel suites pass, named with their counts.
