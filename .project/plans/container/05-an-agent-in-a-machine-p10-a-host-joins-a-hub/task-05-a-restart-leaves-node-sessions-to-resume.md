---
title: A restart of the hub or the node leaves its sessions to resume
status: todo
depends: [task-04-the-hub-lists-a-node.md]
layer: "sdk | server"
refs:
  - "[code://.project/plans/daemon/13-ahpd-restart/plan.md](../../daemon/13-ahpd-restart/plan.md) - `ahpd restart`: quiesce, end agents, resume sessions from the store"
  - "[code://packages/sdk/src/nested.ts#L232](../../../../packages/sdk/src/nested.ts#L232) - `innerSession`, which container/04 task 11 names by the outer id"
---

## Objective

After `ahpd restart` on the hub, a session on a node resumes once the node reconnects.
When the node's `ahpd join` restarts, the data socket closes and `nested.ts` fails the session on the inner host's exit today; what happens instead waits on the plan's open question, and steps for that case are written once it is answered.

## Files

- `UPDATE: packages/sdk/src/nodes.ts` - `connect` for a node that is reconnecting waits a bounded time for it.
- `UPDATE: packages/sdk/src/nested.ts` - a resumed session reopens through `start` with `resume`, by container/04 task 11.
- `UPDATE: packages/sdk/test/nodes.test.ts`, `packages/server/test/join.test.ts`.

## Steps

1. The hub's close ends data sockets with p9 task 05's `stopping`, so no inner session is disposed.
2. The node keeps no session state of its own: the inner host's store under the node's config directory is what is resumed.
3. A node that does not come back within the bound ends the session with a sentence naming it.
4. The node-restart case follows the answer to the plan's open question.

## Validation

- `nodes.test.ts`: a session answers a turn, the hub is closed and a second hub resumes it against the same fake node store; the earlier turn is in the snapshot.
- A node reconnecting after its control socket dropped is listed again under the same id.

## Resume
