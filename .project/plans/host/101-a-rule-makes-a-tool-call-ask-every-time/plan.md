---
title: A rule makes a tool call ask every time
domain: host
status: active
priority: medium
created: 2026-10-16
revalidated: 2026-10-16
requires:
  - plans/host/100-terminal-commands-approved-by-rule/plan.md
  - plans/host/100-p2-a-session-gets-its-owners-command-check/plan.md
changes: []
creates: []
decisions:
  - decisions/each-backend-offers-its-options-unless-a-rule-asks.md
refs:
  - "[code://packages/sdk/src/types/policies.ts#L1-L20](../../../../packages/sdk/src/types/policies.ts#L1-L20) - the policy kinds `model`, `agent` and `computer`, which enforce nothing"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L112-L117](../../../../packages/sdk/src/vscoderootconfig.ts#L112-L117) - `globalAutoApproveEnabled`, a host key the operator sets"
  - "[code://packages/sdk/src/host/gate.ts#L274-L298](../../../../packages/sdk/src/host/gate.ts#L274-L298) - a host key needs `config:change`"
  - "[code://packages/sdk/src/types/agent.ts#L183](../../../../packages/sdk/src/types/agent.ts#L183) - `trusted` on `Start`, beside the check of host/100"
  - "[code://packages/agent-claude/src/session/asking.ts#L115](../../../../packages/agent-claude/src/session/asking.ts#L115) - the `canUseTool` signature"
  - "[code://packages/agent-claude/src/session/asking.ts#L174-L180](../../../../packages/agent-claude/src/session/asking.ts#L174-L180) - `settled` answers from the allow and deny lists"
  - "[code://packages/agent-claude/src/session/query.ts#L377-L379](../../../../packages/agent-claude/src/session/query.ts#L377-L379) - the `PreToolUse` hooks"
  - "[code://packages/agent-claude/src/session/config.ts#L95-L122](../../../../packages/agent-claude/src/session/config.ts#L95-L122) - `autoApprove` maps to `bypassPermissions`"
  - "[code://packages/agent-acp/src/session/handlers.ts#L285-L340](../../../../packages/agent-acp/src/session/handlers.ts#L285-L340) - `askPermission` offers the agent's options"
  - "[code://packages/agent-pi/src/session.ts#L396-L449](../../../../packages/agent-pi/src/session.ts#L396-L449) - `decide` by permission mode"
  - "[code://packages/agent-cofold/src/pauses.ts#L139-L180](../../../../packages/agent-cofold/src/pauses.ts#L139-L180) - `confirm` sends `alwaysApprove` for `allow-session`"
  - "[code://.project/decisions/each-backend-offers-its-options-unless-a-rule-asks.md](../../../../.project/decisions/each-backend-offers-its-options-unless-a-rule-asks.md) - each backend offers its own options; the host remembers no approval"
  - "[code://.project/decisions/claude-approvals-keeps-dont-ask.md](../../../../.project/decisions/claude-approvals-keeps-dont-ask.md) - the six Claude modes, `dontAsk` included"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `HookCallback`, `HookCallbackMatcher.timeout` and `PreToolUseHookSpecificOutput` with `permissionDecision`
  - https://github.com/microsoft/vscode/blob/a959ba62444/src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts#L881 - `chat.tools.eligibleForAutoApproval`, a map of tool name to boolean
  - https://github.com/microsoft/vscode/blob/a959ba62444/src/vs/workbench/contrib/chat/browser/tools/languageModelToolsService.ts#L1071-L1100 - an ineligible tool always confirms and offers no auto-confirm
  - https://github.com/microsoft/vscode/blob/a959ba62444/src/vs/workbench/contrib/chat/browser/tools/languageModelToolsService.ts#L1348-L1411 - `isToolEligibleForAutoApproval`, and the session level that skips it
  - https://github.com/microsoft/vscode/blob/a959ba62444/src/vs/workbench/contrib/chat/browser/tools/languageModelToolsService.ts#L1921-L1933 - `getToolFullReferenceName`: `<toolset>/<tool>`, and `<server>/*` for MCP
  - https://github.com/microsoft/vscode/blob/a959ba62444/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L229-L246 - the agent host maps the setting to `disableBypassPermissionsMode`
  - https://github.com/microsoft/vscode/blob/a959ba62444/src/vs/platform/agentHost/node/sessionPermissions.ts#L248 - `getAutoApproval`, the single entry point
---

## Goal

Some tool calls ask a person every time, whatever was allowed before.
Examples are a call that writes to a tracker, sends a message or moves money.
A rule names the tool, and a matching call asks in every backend.
The question offers no "always" option, so a person cannot turn it into an allow.
VS Code names the same thing `chat.tools.eligibleForAutoApproval`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `git grep -n "eligibleForAutoApproval" packages/ docs/` - nothing.
- `git grep -n "PolicyKind" packages/sdk/src` - three kinds, and the file says nothing enforces them.
- `git grep -n "canUseTool\|askPermission\|decide(\|alwaysApprove" packages/agent-*/src` - one place per backend where a call asks or is remembered.
- In VS Code, `isToolEligibleForAutoApproval` and the setting in `chat.shared.contribution.ts`.

### Runtime path

```
operator sets the rule -> root config -> Start.<check> (host/100) -> backend asks? -> rule matches: ask, no "always" option / no match: host/100 terminal check, then as now
```

### Gaps

- `Not found: a rule that forces a question - searched "eligible\|alwaysAsk\|forceAsk" in packages/`.
- Claude's `settled` answers from the allow list before any rule could run.
- ACP and cofold offer "always" options that a person can pick.
- An ACP agent that does not ask cannot be made to ask, except for the MCP tools the host serves.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The question for a matched call offers no "always" option | Softov, 2026-10-14, the idea: "the card offers no \"always\"" | 02-05 |
| A remembered allow does not apply to a matched call | Softov, 2026-10-14, the idea | 02-05 |
| Claude enforces it with a `PreToolUse` hook | Softov, 2026-10-14, the idea | 02 |
| For ACP, the host enforces it only on the MCP tools it serves | Softov, 2026-10-14, the idea | 03 |
| The name is VS Code's: `eligibleForAutoApproval`, where `false` means "always ask" | (defaulted: upstream parity) | 01 |
| An ask rule wins over a terminal allow rule | (defaulted: as VS Code, eligibility comes before auto-approval) | 01 |
| The host keeps no answer; the rule is read on each call | [decision](../../../decisions/each-backend-offers-its-options-unless-a-rule-asks.md) | 01 |
| The rule is a host root config key `eligibleForAutoApproval`, set under `config:change` | Softov, 2026-10-16, chose "a host root config key" for "Where the rule lives" | 01, 06 |
| A rule matches VS Code's map, with `<server>/<tool>` and `<server>/*` keys | Softov, 2026-10-16, chose "VS Code's map" for "What a rule matches" | 01 |
| A tool the host offers is `ahp/<name>` to the rule in every backend, the name Claude and ACP give it | (defaulted: the goal says one rule asks in every backend) | 04, 05 |
| The rule wins over every mode, `bypassPermissions` included, and `dontAsk` refuses the call | Softov, 2026-10-16, chose "the rule wins over every mode" for "What the permission mode does" | 02-05 |
| A new decision supersedes "each backend offers its own approval options" and holds the exception | Softov, 2026-10-16, chose "a decision that amends it" for "Whether a decision is needed"; [decision](../../../decisions/each-backend-offers-its-options-unless-a-rule-asks.md) | 01 |
| One check on `Start`, shared with host/100, with this rule first | Softov, 2026-10-16, chose "one check on `Start`" for "How this plan relates to host/100" | 01 |
| Claude's hook awaits the confirmation `canUseTool` uses and answers `allow` or `deny`, never `ask`; it offers no `allow-always` and drops `updatedPermissions` | Softov, 2026-10-16, chose "Fold into plans" | 02 |
| A session inside a machine waits for the computer work | Softov, 2026-11-03, chose "Defer to computer work"; [deferred.md](deferred.md) | - |
| The rule is held in memory only, as VS Code holds it, and the docs say it ends when the daemon stops | Softov, 2026-11-03, chose "Memory only, as VS Code" | 10 |
| cofold answers `approval` for a matched call, `deny` in `dontAsk`, and removes a remembered approval for that tool | (defaulted: cofold's own hook decision, the one way a matched call asks in every mode) | 07 |
| `/mcp` refuses a matched host tool | (defaulted: the door has no session to ask in, so a refusal is the safe answer) | 08 |
| The Claude hook names an MCP server by `mcp_server.name`, and asks a subagent's call on its chat | (defaulted: the SDK gives both fields, and the name split guesses wrong for some servers) | 09 |

## Proposed architecture

- **Data flow** - the operator sets the rule. `getAutoApproval`, which host/100 p2 puts on `Start`, reads it first. A match returns "ask, with no always option"; otherwise the terminal check of host/100 runs.
- **Layer responsibilities** - The sdk holds the rule, its matcher and its place in the check. In agent-claude, a `PreToolUse` hook awaits the confirmation of `canUseTool` and answers `allow` or `deny`, and `canUseTool` skips `settled`. The other backends ask and remove the "always" options. The docs give the rule and its limits.
- **Requires** - host/100 p2, task 01, for `getAutoApproval` on `Start`.
- **Matchers** - not shared with host/100. This rule matches tool names; host/100 matches command lines.
- **Source-of-truth files** - [`code://packages/sdk/src/vscoderootconfig.ts`](../../../../packages/sdk/src/vscoderootconfig.ts), and the [decision](../../../decisions/each-backend-offers-its-options-unless-a-rule-asks.md).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The rule is read in the approval check](task-01-the-rule-is-read-in-the-approval-check.md) | implemented | host/100 p2 task 01 |
| [02 - Claude asks for a matched tool](task-02-claude-asks-for-a-matched-tool.md) | implemented | 01 |
| [03 - ACP asks for a matched tool](task-03-acp-asks-for-a-matched-tool.md) | implemented | 01 |
| [04 - pi asks for a matched tool](task-04-pi-asks-for-a-matched-tool.md) | implemented | 01 |
| [05 - cofold asks for a matched tool](task-05-cofold-asks-for-a-matched-tool.md) | implemented | 01 |
| [06 - The docs name the rule](task-06-the-docs-name-the-rule.md) | implemented | 02, 03, 04, 05 |
| [07 - cofold asks for a matched tool in every mode](task-07-cofold-asks-in-every-mode.md) | implemented | 05 |
| [08 - The /mcp door refuses a matched tool](task-08-the-mcp-door-refuses-a-matched-tool.md) | todo | 01 |
| [09 - Claude names the server and the subagent](task-09-claude-names-the-server-and-subagent.md) | todo | 02 |
| [10 - The docs say where the rule holds](task-10-the-docs-say-where-the-rule-holds.md) | todo | 07, 08, 09 |

## Risks and tradeoffs

- An ACP agent decides itself whether to ask, so the rule holds only on the host's MCP tools. The docs say so.
- The Claude hook waits for a person, so its timeout must outlast the answer. Task 02 checks the timeout and the modes first, and stops if one fails.
- An `ask` from a hook could be skipped by auto mode or `allowedTools`, so the hook answers `allow` or `deny` itself.
- The plan touches five packages, so it may become a parent plan.
- This differs from VS Code, where the session's Auto-Approve level skips the setting. The decision says why.

## Resume state

- **Done so far:** drafted 2026-10-16 from `ideas/a-rule-makes-a-tool-call-ask-every-time.md`. Softov answered the five questions 2026-10-16. The decision is written. Task 02 changed 2026-10-16: the hook answers `allow` or `deny`. Task 01 implemented 2026-10-19: the root key, its matcher and the `'ask'` answer in the check. Task 02 implemented 2026-10-19: the Claude hook that asks for a matched tool in every mode. Task 03 implemented 2026-10-19: the ACP question offers only the once options, and the host's MCP server asks before it runs a matched tool. Task 04 implemented 2026-10-19: pi reads the rule first in `decide`, in every mode. Task 05 implemented 2026-10-19: cofold offers no session choice for a matched tool, and a restart consults no rules. Task 06 implemented 2026-10-19: `docs/sdk/AHP.md` names the rule, its reach and its limits. Task 07 implemented 2026-11-03: cofold answers `approval` for a matched call in every mode but `dontAsk`, which denies it. It deletes the remembered approval first.
- **Next action:** build tasks 08 to 10, which fix what the review of 2026-11-02 found. Then run the by-hand checks in *Final verification checklist* on a test daemon.
- **Open questions:** none.
- **Watch out for:** in VS Code a terminal deny rule also means "ask". It is not this rule: it is a match on the command line and it still offers "always".

## Final verification checklist

- [ ] A matched call asks in each backend, in every permission mode, and `dontAsk` refuses it. The review of 2026-11-02 found that cofold does not; task 07 fixes it.
- [x] No backend offers or remembers an "always" answer for a matched call.
- [x] An unmatched call behaves as before host/101.
- [x] `pnpm -s build`, `pnpm -s typecheck`, `pnpm boundary` and the vitest gate pass.
- [ ] By hand, on a test daemon: run steps 2 to 5 of task 02 against the Claude SDK.
  These cover `bypassPermissions`, `auto`, `allowedTools`, a Bash rewrite from `sourceFirst`, and a wait past one minute.
- [ ] By hand, on a test daemon: an ACP agent asks once, not twice, for a matched host tool.
