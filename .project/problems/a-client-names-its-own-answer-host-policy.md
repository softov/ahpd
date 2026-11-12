---
title: A client can name its own answer host_policy
status: open
date: 2026-11-08
severity: minor
blocks: []
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L2232-L2237](../../packages/sdk/src/host/chatactions.ts#L2232-L2237) - the client's `_meta` decision source goes to `session.confirm`"
  - git://b83986db0 - `Session.confirm` carries who decided
  - git://83efef0ca - the audit branch's head when the problem was read
  - git://598b5d35b - main when the problem was read again, on 2026-11-11
---

## Symptom

Read from the code in the security review of 2026-11-08, and not reproduced.
A client answers a question with `_meta['agentHost.permissionDecisionSource']` set to `host_policy`.
The backend is told that the host's rules decided the call.

## Cause

`chat/toolCallConfirmed` passes the decision source from the client's `_meta` to `session.confirm` without a check.
`host_policy` is meant for an answer the host's own rules made.

## Impact

A record or a backend that trusts the source shows a person's answer as the host's.
No backend was found that grants more on `host_policy`, so the impact today is a false record.

## Workaround

None.

## Fix

- Drop `host_policy` from a client's answer, and set it only where the host's chain answers.
