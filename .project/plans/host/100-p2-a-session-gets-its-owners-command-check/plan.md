---
title: A session gets its owner's command check
domain: host
status: built
priority: medium
created: 2026-10-16
revalidated: 2026-10-16
requires:
  - plans/host/100-terminal-commands-approved-by-rule/plan.md
  - plans/host/100-p1-a-command-is-split-and-matched/plan.md
changes: []
creates: []
decisions: []
problems: []
refs:
  - "[code://packages/sdk/src/types/agent.ts#L183](../../../../packages/sdk/src/types/agent.ts#L183) - `trusted`, the field this one sits beside"
  - "[code://packages/sdk/src/host/spawn.ts#L648-L661](../../../../packages/sdk/src/host/spawn.ts#L648-L661) - `trustedBy`, which reads the owner's connection"
  - "[code://packages/sdk/src/host/gate.ts#L274-L298](../../../../packages/sdk/src/host/gate.ts#L274-L298) - the grant a pushed key needs"
  - "[code://packages/sdk/src/host/gate.ts#L342](../../../../packages/sdk/src/host/gate.ts#L342) - `PER_CONNECTION`"
  - "[code://packages/sdk/src/host/root.ts#L557-L567](../../../../packages/sdk/src/host/root.ts#L557-L567) - what a connection reads back"
  - "[code://packages/sdk/test/root-config.test.ts#L185-L212](../../../../packages/sdk/test/root-config.test.ts#L185-L212) - the pushed keys"
  - "[code://packages/server/src/config.ts#L247-L258](../../../../packages/server/src/config.ts#L247-L258) - `clientToolTimeoutMs` and `shellEnv`, daemon keys that reach a session"
  - "[code://packages/server/src/commands/run.ts#L732-L741](../../../../packages/server/src/commands/run.ts#L732-L741) - where the daemon passes those keys to the host"
  - https://github.com/microsoft/vscode/blob/a959ba62444/src/vs/platform/agentHost/node/sessionPermissions.ts#L248 - `getAutoApproval`, the name of the check
  - https://github.com/microsoft/vscode/blob/a959ba62444/src/vs/platform/agentHost/node/sessionPermissions.ts#L334-L354 - the shell step
---

## Goal

Each session gets one approval check on `Start`, built from its owner's connection.
The check reads that connection's terminal rules and edit rules, and calls the approver of p1.
A daemon setting says what applies when the owner pushed no rules.
host/101 adds its own rule to the same check.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `git grep -n "PER_CONNECTION" packages/sdk/src` - the gate and `root.ts` keep two keys per connection.
- `git grep -n "trustedBy" packages/sdk/src` - the owner's connection answers `trusted`.

### Runtime path

```
owner's connection -> rules, edit rules, enabled -> Start.getAutoApproval(kind, line, shell) -> CommandAutoApprover.evaluate -> not-needed / nothing
```

### Gaps

- `Not found: an approval check on Start - searched "approve" in packages/sdk/src/types/agent.ts`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The owner's connection's rules apply, as `trustedBy` does for `workspaceTrust` | Softov, 2026-10-16, chose "the owner's connection" for "Whose rules apply in a session that two clients drive" | 01 |
| A daemon setting picks the rules when no client pushed any; its default is VS Code's table, and the other value is none | Softov, 2026-10-16, chose "Setting, default VS Code's table" for "What applies when no client pushed rules" | 02 |
| `terminalAutoApproveEnabled`, `terminalAutoApproveRules` and `editAutoApprovePatterns` join `PER_CONNECTION` | (defaulted: a per-connection answer needs it, and a member can then push them without `config:change`) | 01 |
| The field is named `getAutoApproval`, after VS Code | (defaulted: upstream parity) | 01 |
| The setting is `terminalAutoApproveDefaults: 'vscode' \| 'none'` | (defaulted: a name beside the VS Code keys) | 02 |
| The check returns `not-needed` for `approved`, and nothing otherwise | (defaulted: as VS Code) | 01 |
| A pushed `/.../` key that is not one of VS Code's default keys needs `config:change`; a plain key and a default key need no grant | Softov, 2026-10-20, chose "Defaults pass, others need grant" for "VS Code pushes its ~50 default /.../ rules on every connect. How should a member's pushed regex rule be gated?" | 03 |

## Proposed architecture

- **Data flow** - `spawn.ts` builds `getAutoApproval` beside `trustedBy`. It reads the owner's connection each time it runs.
- **Layer responsibilities** - The sdk holds the field, the keys and the check. The server reads the daemon setting and passes it to the host.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The check reads the owner's connection](task-01-the-check-reads-the-owners-connection.md) | done | - |
| [02 - The daemon setting picks the default rules](task-02-a-daemon-setting-picks-default-rules.md) | done | 01 |
| [03 - A pushed regex rule needs config:change](task-03-a-pushed-regex-rule-needs-config-change.md) | done | 01 |

## Risks and tradeoffs

- With the default `vscode`, a client that pushes nothing gets commands approved. The setting `none` stops that.

## Resume state

- **Done so far:** planned 2026-10-16; tasks 01 and 02 implemented 2026-10-18; task 03 implemented 2026-10-20. Tests in `autoapproval.test.ts`, `root-config.test.ts`, `config-check.test.ts` and `users-gate-dispatch.test.ts`.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** host/101 task 01 builds on `getAutoApproval`; keep its answer open for a second kind of result.

## Final verification checklist

- [x] A session with two clients uses the owner's rules.
- [x] `pnpm -s build`, `pnpm -s typecheck` and `pnpm boundary` pass.
- [x] `plans/index.md` updated.
