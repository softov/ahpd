---
title: Auto-approval and folder trust apply to a turn whoever sent it
status: open
date: 2026-11-08
severity: major
blocks: []
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L507-L547](../../packages/sdk/src/host/spawn.ts#L507-L547) - `toolReady` reads the rules, the patterns and auto-approve for every turn"
  - "[code://packages/sdk/src/host/spawn.ts#L1218-L1224](../../packages/sdk/src/host/spawn.ts#L1218-L1224) - `trustedBy` reads `workspaceTrust` for every start"
  - git://e80652719 - every turn reads the host's rules and trust whoever sent it
  - git://e388d12f5 - `getAutoApproval` and `trustedBy` checked that the sender owns the session
  - git://83efef0ca - the audit branch's head when the problem was read
  - git://598b5d35b - main when the problem was read again, on 2026-11-11
---

## Symptom

Read from the code in the security review of 2026-11-08, and not reproduced.
On a host with users, a turn that the session's owner did not send gets the owner's approvals.
An automation run, a bot wake and a restart get them too, with nobody as the sender.

## Cause

At `e388d12f5`, `getAutoApproval` answered nothing unless the sender owned the session.
`trustedBy` answered false for anyone but the owner.
A start that nobody sent got no rules and no trust.
Main reads these for every turn:

- the terminal rules, the edit patterns and the permission allow rules;
- the read approvals inside the working folders;
- `globalAutoApproveEnabled` and the session's `autoApprove`;
- `workspaceTrust`.

## Impact

- A role with `chat:send` and no `chat:answer` sends a turn into another person's session and gets commands run with no question.
- An automation started from webhook or bot input runs approved commands and fetches.
- A trusted folder loads its project settings and hooks for those starts, which were untrusted at `e388d12f5`.
- With [always-allow-writes-host-rules-without-config-change.md](always-allow-writes-host-rules-without-config-change.md), rules one member set run in other people's turns.
- The built-in `member` role holds `chat:answer`, so for it the change mostly matters for automations and custom roles.

## Workaround

None.

## Fix

Choices asked on 2026-11-08. A plan builds them after Softov validates this file.

| Decision | Options | Chosen |
| --- | --- | --- |
| Which turns get the rules and the trust | The owner's turns, and a setting for starts nobody sent; back to `e388d12f5` with no setting; keep main | The owner's turns, and a setting (Softov, 2026-11-08) |

The chosen fix:

- On a host with users, a turn that a connection sends gets the rules and the trust only from the session's owner.
- That is the check at `e388d12f5`.
- A new host setting covers a start that nobody sent: an automation run, a bot wake, a daemon restart.
- The setting is off by default. Off, such a start gets no rules and no trust, as at `e388d12f5`. On, it gets the owner's.
- The plan names the setting and documents it.
