---
title: A record lists the operations it offers now
created: 2026-11-11
refs:
  - git://ef6768fc8 - the commit of ahpd the facts were checked at
  - git://8cf423ac5 - the commit of ahpw the facts were checked at
  - "[code://packages/sdk/src/tunnels/channel.ts#L279-L333](../../packages/sdk/src/tunnels/channel.ts#L279-L333) - `operationsOf` lists each kind's operations once, for every record of the kind"
  - "[code://packages/sdk/src/types/kinds.ts#L91-L102](../../packages/sdk/src/types/kinds.ts#L91-L102) - `Operation` has a kind, scopes, a grant and a status, and nothing that says which record it applies to"
  - "[code://packages/sdk/src/kinds/operations.ts#L45-L50](../../packages/sdk/src/kinds/operations.ts#L45-L50) - `OperationChannel`, which the tunnels and clients channels use"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L90-L104](../../packages/tunnel-devtunnel/src/kind.ts#L90-L104) - devtunnel's own operations: Start, Stop, Restart and Anonymous access"
  - "[code://packages/sdk/src/agents/channel.ts#L40-L50](../../packages/sdk/src/agents/channel.ts#L40-L50) - agents offer fixed methods: `enable`, `pause`, `disable`, `check`"
  - file:///github/ahpw/src/resources/agents/actions.ts - `agentModes` picks an agent's buttons in ahpw, from the row's state
  - file:///github/ahpw/src/bridges/connectors.ts - connectors offer fixed methods, `enable` and `disable` among them
  - https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/types/channels-session/state.ts#L1001-L1017 - AHP puts `enabled` on a customization's state, and the client draws one toggle from it
---

# A record lists the operations it offers now

Softov wants each tunnel, connector and agent record to say which operations it offers now.
A client then draws only those, and never Enable beside Disable or Start beside Stop.
He saw a devtunnel record in ahpw on 2026-11-11 that showed Enable, Disable, Start, Stop and Restart together.
He chose on 2026-11-11: "each record list its actions ids".

## What others do

- AHP keeps state on the record, not on the action. A customization carries `enabled`, and the client draws the toggle that the state allows.
- VS Code's menus carry a `when` clause, which the client evaluates against context keys. That is the future idea [an operation says when it applies](../ideas/an-operation-says-when-it-applies.md), not this change.

## What ahpd has today

- Tunnels and clients send one operations list per channel. Each kind's operations appear once, with the scope `tunnel`, for every record of the kind.
- `Operation` says nothing about a record's state, so a client cannot tell that an enabled tunnel does not need Enable.
- Agents serve fixed methods. ahpw's `agentModes` works out which to draw from the row's state, which is client logic the host does not send.
- Connectors serve fixed methods too, `enable` and `disable` among them.

## Who writes

- `/github/ahpd` is shared with other sessions. The change touches `packages/sdk/src/tunnels/`, `packages/sdk/src/kinds/`, the agents and connectors channels, and each tunnel kind.
- ahpw and ahpc draw these pages. Each needs a change in its own repository after the host sends the list.
- MayCXC's fork has no branch on these files, as checked on 2026-11-11.

## The change

- Each record carries the ids of the operations it offers now, from its own state.
- An enabled record offers Disable and not Enable, and a disabled record the other way round.
- A tunnel kind says which of its own operations a record offers: a running tunnel offers Stop and Restart, and a stopped one offers Start.
- The grant on each operation stays where it is. The record's list says what applies, and the grant says who may call it.
- The code that builds the list carries a comment that names the idea of `when` conditions, with a link to it.
- A client draws a record's buttons from that record's list.

## Open points

- Whether agents and connectors move to the operations list that tunnels use, or keep their fixed methods and add the list to each row.
- Whether the clients channel, `x-ahpd-clients`, gets the same list.
- Whether a client hides an operation a record does not offer, or shows it greyed. That is each client's choice, or a setting there.
