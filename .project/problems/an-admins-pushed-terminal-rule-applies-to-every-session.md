---
title: An admin's pushed terminal rule applies to every session on the host
status: open
date: 2026-11-09
severity: major
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L507-L517](../../packages/sdk/src/host/spawn.ts#L507-L517) - every question reads the host's one `terminalAutoApproveRules`, whoever sent the turn"
  - "[code://packages/sdk/src/host/gate.ts#L300](../../packages/sdk/src/host/gate.ts#L300) - a push of a root config key needs `config:change`"
  - git://4c3738f08 - every turn reads the host's terminal rules, whoever sent it
  - git://18ab9642d - the last commit that holds `pending/host-100-p2-review.md`, with the results this file quotes
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L380 - VS Code's host reads the rules from its root config for every question
---

## Symptom

On 2026-11-02, on a test daemon at `893051dc`, alice and bob were users of one host.
bob, an admin, pushed `{"rm": true}` as `terminalAutoApproveRules`.
`rm` then ran with no question in alice's session.
As a member, bob's push did not apply, and `rm` asked.

Softov passed the check of plan host/100-p2 on 2026-11-09, and asked to keep this case as a problem to check.

## Cause

The terminal rules are one value for the whole host, as VS Code has them.
A push needs `config:change`, which an admin has.
VS Code pushes its rules on every connect, so the last admin to connect from VS Code sets the rules for every person's sessions.

## Impact

On a host with more than one person, an admin's VS Code settings approve commands in sessions of other people.
A person cannot keep a stricter rule for their own sessions.
On a host with one person, nothing changes.

## Workaround

None. Give `config:change` only to people whose rules every session may follow.

## Fix

No fix is chosen. Check first whether this is wanted, because VS Code's host has one person.

- Keep the rules per person, and read the rules of the session's owner. [a-claude-session-from-vs-code-has-no-owner.md](a-claude-session-from-vs-code-has-no-owner.md) must be fixed first.
- Keep one host value, and refuse a push from VS Code's connect when the value differs, so only an explicit change sets it.
