---
title: The host puts each tool question with VS Code's options and keeps an "Allow in this Session" answer in the session's permissions, and a host rule can make a tool call always ask
status: accepted
date: 2026-11-06
supersedes: decisions/each-backend-offers-its-options-unless-a-rule-asks.md
refs:
  - "[code://packages/sdk/src/host/permissions.ts](../../packages/sdk/src/host/permissions.ts) - the options, the operator's rule and how the session's `permissions` answer a question"
  - "[code://packages/sdk/src/host/spawn.ts](../../packages/sdk/src/host/spawn.ts) - `toolReady`, a backend's question as the host puts it"
  - "[code://packages/sdk/src/host/chatactions.ts](../../packages/sdk/src/host/chatactions.ts) - `chat/toolCallConfirmed`, where an Allow in this Session answer is kept"
  - "[code://packages/sdk/src/types/session.ts](../../packages/sdk/src/types/session.ts) - `confirm(toolCallId, approved, optionId)`, the answer a backend receives"
  - git://d391559e - the last commit that holds the superseded decision and the one it superseded
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L67-L76 - VS Code's options, in its words
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L619-L650 - an Allow in this Session answer kept as a rule in the session's `permissions`
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1684-L1766 - VS Code's host answers its agent's question from the session's rules
  - https://github.com/microsoft/vscode/blob/a959ba62444/src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts#L881 - `chat.tools.eligibleForAutoApproval`, the setting the rule is named after
  - https://github.com/microsoft/vscode/blob/a959ba62444/src/vs/workbench/contrib/chat/browser/tools/languageModelToolsService.ts#L1399-L1411 - in VS Code, the session's Auto-Approve level still skips the setting
---

## Context

The protocol lets a tool call offer confirmation options and carries the one the person picked back as `selectedOptionId`.
VS Code's host builds the options of every agent's question, one set in its words: Allow in this Session, Allow Once and Skip.
It keeps an Allow in this Session answer in the session's `permissions`, as a rule naming the tool.
It answers a later question about that tool itself.
The session's config is kept with the session, so a rule there lasts as long as the session does.
Some tools must ask a person on every call, whatever was allowed before.
Examples are a call that writes to a tracker, sends a message or moves money.

## Decision

The host puts every question a backend asks about a tool call.
Where the backend offers no options of its own, the question offers VS Code's three, in VS Code's words.
An Allow in this Session answer adds the tool's name to `allow` in the session's `permissions`, VS Code's session property.
The host answers a later question about a tool that `allow` names, and `ask` does not, itself.
It refuses a question about a tool that `deny` names.
One exception: a tool that the host root config key `eligibleForAutoApproval` sets to `false` asks on every call, in every backend.
Its question offers Allow Once and Skip alone, and no rule of the session answers it.
Every permission mode asks, `bypassPermissions` included, and `dontAsk` refuses the call.

Source: the audit's rows EJ-0046, EJ-0048, EJ-0051, EJ-0058, EJ-0164 and P2EJ-0101, 2026-11-06.
Each was judged by Aaron Paterson's test for a divergence from VS Code: whether it is "intentional AND necessary", with "no better more idiomatic pattern".
The rule's source: Softov, 2026-10-16, for host/101, chose "the rule wins over every mode" and "a host root config key".

## Consequences

Every backend's question offers the same options in the same words, as in VS Code.
What a person allowed is in the session's config, where a client reads it and can remove it.
Each backend must ask with no options of its own, except a tool's own choices, and must keep no "always" of its own.
Claude reads the session's `permissions` itself; the host answers the questions of the others.
A rule with a specifier, such as `Shell(npm run *)`, names no call, because a backend's question does not say what the call runs or touches.
The host reads the rule by each name a backend gives a tool, an MCP server's spelled as the Claude CLI spells it.
An ACP agent decides itself whether to ask, so the rule reaches only the MCP tools this host serves it.
This differs from VS Code, where the session's Auto-Approve level still skips `eligibleForAutoApproval`.

## Options

- **Each backend's own options, with the host keeping no answer.** Each agent's own choices are offered. But the options differ by backend, an answer one backend keeps is lost on another, and a person cannot see or remove it.
- **A store of answers of the host's own, per workspace.** It could keep an answer past one session. But the session's config already keeps an answer with its session, and VS Code keeps it there.
- **The rule as in VS Code, skipped by the Auto-Approve level.** It gives parity with the reference. But in `bypassPermissions`, a call that moves money would run without a question.
