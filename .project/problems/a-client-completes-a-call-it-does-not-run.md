---
title: A client can complete a tool call that it does not run
status: open
date: 2026-11-08
severity: minor
blocks: []
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L2684-L2696](../../packages/sdk/src/host/chatactions.ts#L2684-L2696) - `chat/toolCallComplete` refuses only a call of another client"
  - "[code://packages/sdk/src/tools/clientcalls.ts#L282-L289](../../packages/sdk/src/tools/clientcalls.ts#L282-L289) - the backend drops a result from a client that does not own the call"
  - git://f5d46682f - the host takes a client's result for a call it holds no owner for
  - git://83efef0ca - the audit branch's head when the problem was read
  - git://598b5d35b - main when the problem was read again, on 2026-11-11
---

## Symptom

Read from the code in the security review of 2026-11-08, and not reproduced.
A client with `chat:tool` sends `chat/toolCallComplete` for a call of the agent itself.
The host dispatches it, and every client draws the forged result.

## Cause

At `e388d12f5` the host took a result only from the client that ran the call, and only for a call in `running`.
Main refuses only a call whose contributor is another client.
A call with no contributor, and a call the chat does not hold, are dispatched.
The protocol reducer completes a call in `running` or in `pending-confirmation`.

## Impact

- A client can show a false result for the agent's call, such as a shell call that says the tests passed.
- A client can complete a call that waits for confirmation. The owner's answer is then refused as not pending, and the backend waits until it times out.
- The backend does not take the forged result, so the agent itself is not misled.

## Workaround

None.

## Fix

- Refuse `chat/toolCallComplete` unless the sending client runs the call and the call is `running`, as at `e388d12f5`.
