---
title: A removed node keeps serving its running sessions
status: open
date: 2026-11-03
severity: major
blocks: []
refs:
  - "[code://packages/sdk/src/nodes.ts#L562-L570](../../packages/sdk/src/nodes.ts#L562-L570) - `drop` closes only the control socket"
  - git://3a6ba76d - container/05-p10 added nodes
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A node runs a session.
The operator removes the node through the daemon.
The session's turn goes on, and the session still answers.

## Cause

`drop` closes the control socket, and fails the sessions the node has not dialled yet.
The data socket of each session already open is not held per node, so nothing closes it.

## Impact

The plan's goal says that removing a node drops it.
A node taken away for cause keeps working on the hub's sessions.

## Workaround

Stop the sessions on the node by hand, or restart the daemon.

## Fix

- Keep the data sockets per node, and close them in `drop`.
