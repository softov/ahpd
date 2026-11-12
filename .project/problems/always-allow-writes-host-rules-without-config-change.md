---
title: An Always Allow answer writes host-wide rules without config:change
status: open
date: 2026-11-08
severity: major
blocks: []
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L2251-L2268](../../packages/sdk/src/host/chatactions.ts#L2251-L2268) - a host grant sets, broadcasts and persists `rootConfig.permissions`"
  - "[code://packages/sdk/src/host/permissions.ts#L651-L657](../../packages/sdk/src/host/permissions.ts#L651-L657) - `grantOf` reads the grant from the picked option"
  - "[code://packages/sdk/src/host/spawn.ts#L539](../../packages/sdk/src/host/spawn.ts#L539) - every session reads the host's `permissions`"
  - "[code://packages/sdk/src/access/commandautoapprover.ts#L785](../../packages/sdk/src/access/commandautoapprover.ts#L785) - an allow from a rule is approved before the table's deny list"
  - git://7e16a8a05 - the host decides a question with scoped grants
  - git://83efef0ca - the audit branch's head when the problem was read
  - git://598b5d35b - main when the problem was read again, on 2026-11-11
---

## Symptom

Read from the code in the security review of 2026-11-08, and not reproduced.
A member steers the agent in their own session to ask about `npm install <package>`.
The member answers with the Always Allow option.
After that, every session on the host runs `npm install` commands with no question, an admin's sessions and automation runs included.

## Cause

`chat/toolCallConfirmed` needs `chat:answer` only.
An `allow-always-rules` option writes its rules into the host's own `permissions`, and the host persists them.
At `e388d12f5` no answer changed the root config, and a host-wide setting needed `config:change`, which only an admin holds.
The options come from the agent's own question, so a prompt in the session chooses the rule.
An allow from a permission rule now settles the call before the terminal table's deny list is read.

## Impact

- A member sets host-wide approvals that only an admin could set.
- A rule set this way also overrides the default denies of the terminal table, such as `find -exec`.
- A prompt injection in another session or an automation can use the rule with no person asked.

## Workaround

None.

## Fix

Choices asked on 2026-11-08. A plan builds them after Softov validates this file.
VS Code has one person per host, so its "Always" is that person's setting. Copilot's own menu shows it: Session, Workspace and Always are three levels.
ahpd has many people per host, so it splits "Always" into the person's level and the host's.

| Decision | Options | Chosen |
| --- | --- | --- |
| What "Always Allow" writes | The host's rules; the person's rules; the session's rules | The host's rules: "Always Allow Command -> is the host one" (Softov, 2026-11-08) |
| A level for one person | Add one; none | Add one: "Always Allow Command in User" (Softov, 2026-11-08) |
| Who may write the host's rules | A new `config:permissions` grant; `config:change`, which covers every root key | `config:permissions` (Softov, 2026-11-08) |
| A host grant from a person without `config:permissions` | Keep it in the session; refuse it | Keep it in this session (Softov, 2026-11-08) |
| An allow rule against the terminal table's deny list | Deny list first, as at `e388d12f5`; allow rule first | Deny list first (Softov, 2026-11-08) |
| A Workspace level, as Copilot has | In this fix; later | Later, in a brief of its own (Softov, 2026-11-08) |
| Allow All Commands in this Session | Add it; not now | Add it (Softov, 2026-11-08) |
| The same levels for file and URL grants | (defaulted: yes, every grant kind gets the same levels, because they share `grantOption`) | |

The chosen fix:

- A grant option gets a third scope, the person's, beside `session` and `host` in `PermissionGrantScope`.
- The host keeps each person's rules in a store of their own.
- It reads them in that person's sessions, between the session's rules and the host's.
- A new grant, `config:permissions`, lets a person write the host's rules. `admin` holds it. A `root/configChanged` that pushes only `permissions` needs it, as a push of only `workspaceTrust` needs `trust:push`.
- The host offers the host options only when the session's owner holds `config:permissions`, and checks the grant again when the answer arrives.
- `commandautoapprover.ts` reads the terminal table's deny list before an allow from any rule.
- An option "Allow All Commands in this Session" sets the session's `autoApprove`. The host refuses it where `autoApprovePolicyRestricted` is set.
- The options keep their `group`, so a client can draw Copilot's split button: Allow Once, and the grants in a menu.
- A mockup of the card comes before the plan. The labels of the person's options are settled there.
- The docs name the grant `config:write`, and the code checks `config:change` (`gate.ts:149`). The plan corrects the docs.

The menu, before the mockup:

```
Allow Once
Allow `whois …` in this Session
Always Allow `whois …` for Me            (the person)
Always Allow `whois …`                   (the host, with config:permissions)
Allow Exact Command in this Session
Always Allow Exact Command for Me        (the person)
Always Allow Exact Command               (the host, with config:permissions)
Allow All Commands in this Session
Skip
```
