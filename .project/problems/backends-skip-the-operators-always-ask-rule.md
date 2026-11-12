---
title: Three backends skip the operator's always-ask rule on a call they do not ask about
status: open
date: 2026-11-08
severity: major
blocks: []
refs:
  - "[code://packages/agent-claude/src/session/asking.ts#L397-L399](../../packages/agent-claude/src/session/asking.ts#L397-L399) - a host tool with `confirm: false` is allowed before any question"
  - "[code://packages/agent-pi/src/session.ts#L549](../../packages/agent-pi/src/session.ts#L549) - `decide` reads the modes and not the rule"
  - "[code://packages/agent-cofold/src/turnagent.ts#L393](../../packages/agent-cofold/src/turnagent.ts#L393) - `beforeTool` returns `allow`"
  - "[code://packages/sdk/src/host/spawn.ts#L571-L575](../../packages/sdk/src/host/spawn.ts#L571-L575) - the host reads `eligibleForAutoApproval` on a question only"
  - "[code://packages/sdk/src/tools/shell.ts#L383](../../packages/sdk/src/tools/shell.ts#L383) - `write_<shell>` has `confirm: false`"
  - git://aeb41b9d8 - `Start.getAutoApproval` is removed from every backend
  - git://6ad6c36d3 - the Claude `PreToolUse` rule hook is removed
  - git://83efef0ca - the audit branch's head when the problem was read
  - git://598b5d35b - main when the problem was read again, on 2026-11-11
---

## Symptom

Read from the code in the security review of 2026-11-08, and not reproduced.
The operator sets `eligibleForAutoApproval` to `false` for a tool, which means the tool asks every time.

- In a Claude session, a host tool with `confirm: false`, such as `write_bash`, runs with no question.
- In a pi or cofold session in `bypassPermissions`, `auto` or `acceptEdits`, a tool the rule names runs with no question.
- In cofold, a tool allowed for the session before the rule named it stays allowed.

## Cause

At `e388d12f5` each backend read the rule first, in every mode, through `Start.getAutoApproval`.
A matched call asked, and `dontAsk` refused it.
Main removes `getAutoApproval`, and the host now reads the rule only when a backend raises a question.
A call that the backend or the mode settles itself never reaches the host.
Claude hands the rule to the CLI as an ask rule, and the CLI asks.
`asking.ts` then allows a `confirm: false` host tool before it asks the host.
cofold no longer deletes the remembered approval at `approvals/<session>/<tool>`.

## Impact

The operator's per-tool ask does not hold in these cases.
`write_bash` types into a shell, so the bypass runs commands.

## Workaround

Keep sessions on these backends out of `bypassPermissions`, `auto` and `acceptEdits`.
No workaround for the Claude host tools.

## Fix

Choices asked on 2026-11-08. A plan builds them after Softov validates this file.

VS Code reads `eligibleForAutoApproval: false` as a session-wide lock on the bypass modes.
It does so only for Copilot sessions on a local host (`agentHostManagedSettings.ts` at `6b68d3fe7dd7`, `contributeEligibleForAutoApprovalRestriction`).
Its rule grammar has no family for a tool name, so it asks about no call because of the setting.
ahpd at `e388d12f5` read the setting as "ask every time", in every backend.

| Decision | Options | Chosen |
| --- | --- | --- |
| How the rule holds | Per call under `managedRules: checked`, VS Code's way under `handed`; VS Code's lock everywhere; per call under both values | Per call under `checked` (Softov, 2026-11-08) |

The chosen fix:

- Under `managedRules: checked`, the default, the host gives each backend a check on `Start`, as `getAutoApproval` did at `e388d12f5`.
- Each backend reads the check before its mode and before `confirm: false`. A matched call asks, and `dontAsk` refuses it.
- Under `managedRules: handed`, no backend checks. The host hands the rules to the runtimes that take them, as VS Code does.
- The docs say what `false` means under each value of `managedRules`.
