---
title: A root config push can turn off the auto-approval restriction
status: open
date: 2026-11-08
severity: minor
blocks: []
refs:
  - "[code://packages/sdk/src/host/actions.ts#L280-L293](../../packages/sdk/src/host/actions.ts#L280-L293) - every pushed key is applied and kept"
  - "[code://packages/sdk/src/host/spawn.ts#L546](../../packages/sdk/src/host/spawn.ts#L546) - `autoApprovePolicyRestricted` decides the session's auto-approve"
  - git://cd9bd5a84 - the root keeps keys it does not declare
  - git://7e16a8a05 - the host reads `autoApprovePolicyRestricted` for the first time
  - git://83efef0ca - the audit branch's head when the problem was read
  - git://598b5d35b - main when the problem was read again, on 2026-11-11
---

## Symptom

Read from the code in the security review of 2026-11-08, and not reproduced.
A client with `config:change` pushes `root/configChanged` with `autoApprovePolicyRestricted: false`.
The host applies it, and a session with `autoApprove` set is auto-approved again.

## Cause

`autoApprovePolicyRestricted` is declared `readOnly`, but `root/configChanged` refuses no read-only key.
Main also keeps, persists and broadcasts any key a push carries, where `e388d12f5` refused or dropped an undeclared key.

## Impact

A client with `config:change` can remove a restriction that a VS Code window or the operator set.
The push needs `config:change`, which only an admin holds.

## Workaround

None.

## Fix

- Refuse a read-only key in `root/configChanged`.
- Keep only declared keys from a push, as at `e388d12f5`.
