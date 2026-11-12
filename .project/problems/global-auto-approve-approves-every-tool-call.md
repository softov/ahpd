---
title: globalAutoApproveEnabled now approves every tool call on the host
status: open
date: 2026-11-08
severity: minor
blocks: []
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L545](../../packages/sdk/src/host/spawn.ts#L545) - `globalAutoApprove` is read into every question"
  - git://7e16a8a05 - the host decides a question with VS Code's chain
  - git://83efef0ca - the audit branch's head when the problem was read
  - git://598b5d35b - main when the problem was read again, on 2026-11-11
---

## Symptom

Read from the code in the security review of 2026-11-08, and not reproduced.
With `globalAutoApproveEnabled` on, the host approves every tool question in every session, with no person asked.

## Cause

At `e388d12f5` the key only skipped the trust question.
Main reads it into the approval chain of every question, as VS Code's host reads it.
A client with `config:change` can set it.

## Impact

One root config value removes every question on the host, for every person and every automation.
This may be intended for parity with VS Code, and nobody has decided it.

## Workaround

None.

## Fix

- Keep the meaning, and make it a daemon option that a client push cannot set.
- Keep the meaning at `e388d12f5`, and add a separate key for host-wide approval.
