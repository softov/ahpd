---
title: ahpd node rm at the hub's terminal does not drop a joined node
status: open
date: 2026-11-03
severity: major
blocks: []
refs:
  - "[code://packages/server/src/commands/nodes.ts#L30-L49](../../packages/server/src/commands/nodes.ts#L30-L49) - without the daemon, `place` writes the nodes file only"
  - "[code://packages/server/src/commands/nodes.ts#L108-L125](../../packages/server/src/commands/nodes.ts#L108-L125) - the `node.rm` action"
  - "[code://docs/plugins/COMPUTERS.md#L430](../../docs/plugins/COMPUTERS.md#L430) - the docs say a joined node is dropped"
  - git://3a6ba76d - container/05-p10 added nodes
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A node has joined the hub.
The operator runs `ahpd node rm <name>` at the hub's terminal, without `--remote`.
The node stays connected and keeps its sessions.

## Cause

The command run in its own process gets no `served` facts.
It removes the node from the file, and the daemon's live registry never hears of it.
Only the HTTP route `/node/rm` reaches `served.nodes` and drops the connection.

## Impact

An operator who removes a node to cut it off does not cut it off.
The token is refused only from the node's next connection.

## Workaround

Run `ahpd node rm <name> --remote`, or restart the daemon.

## Fix

- Send `node rm` to the running daemon by default when one is up.
- Or make the daemon watch the nodes file and drop a node that leaves it.
