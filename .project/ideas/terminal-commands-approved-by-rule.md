---
title: Terminal commands approved by rule
created: 2026-09-26
---

VS Code's host approves an agent's shell command without asking when every sub-command matches an allow rule and none matches a deny rule, and asks otherwise (`src/vs/platform/agentHost/node/commandAutoApprover.ts`). The rules are the person's `chat.tools.terminal.autoApprove` setting, forwarded by the window as the root config keys `terminalAutoApproveEnabled` and `terminalAutoApproveRules` once the host's root schema declares them (`src/vs/platform/agentHost/common/agentHostSchema.ts:470,611`). The parser splits a command line into sub-commands, treats `/dev/null` and fd redirects as safe, knows git and PowerShell specifics, and refuses to auto-approve what it cannot parse.

This host maps `autoApprove` and the session mode straight onto the Claude permission mode, so a person gets all or nothing. Declaring the two keys would make VS Code send the rules; the work is the matcher and calling it from the Claude backend's `canUseTool` for `Bash`, and from the ACP bridge's permission request.

Two things to settle before a plan. The rules are a person's, so they belong in `PER_CONNECTION` like `defaultShell`, but they decide what runs in a session that other people may be driving; whose rules apply to a session with two clients is the open question. And after `host/17`, a key outside `PER_CONNECTION` needs `config:write`, so a member's window forwarding them would be refused unless they are per connection.
