---
title: The host decides each tool question with VS Code's chain and options and keeps a grant in the session's or the host's permissions, and a host rule or a managed rule can make a tool call always ask
status: accepted
date: 2026-11-06
supersedes: decisions/each-backend-offers-its-options-unless-a-rule-asks.md
refs:
  - "[code://packages/sdk/src/host/permissions.ts](../../packages/sdk/src/host/permissions.ts) - the chain, the options, the grants, the operator's rule and the managed check"
  - "[code://packages/sdk/src/access/permissionrules.ts](../../packages/sdk/src/access/permissionrules.ts) - VS Code's permission rules"
  - "[code://packages/sdk/src/vscode/](../../packages/sdk/src/vscode/) - VS Code's glob, URI, URL approval, managed rule grammar and domain matcher, vendored, which the rules are matched with"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/networkFilter/common/domainMatcher.ts#L208-L241 - how VS Code's network filter matches a domain, which a managed `Domain` rule is matched by
  - "[code://packages/sdk/src/host/spawn.ts](../../packages/sdk/src/host/spawn.ts) - `toolReady`, a backend's question as the host decides and puts it"
  - "[code://packages/sdk/src/host/chatactions.ts](../../packages/sdk/src/host/chatactions.ts) - `chat/toolCallConfirmed`, where a grant is kept"
  - "[code://packages/sdk/src/types/agent.ts](../../packages/sdk/src/types/agent.ts) - `PendingConfirmation`, a question's host-only fields, and `Start.managedSettings`"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L238-L650 - VS Code's chain, its options and its grants
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostPolicySupport.ts#L46-L56 - the enforcement VS Code records as partial, which the host's managed check carries
  - "[code://packages/sdk/src/types/session.ts](../../packages/sdk/src/types/session.ts) - `confirm(toolCallId, approved, optionId)`, the answer a backend receives"
  - git://d391559e - the last commit that holds the superseded decision and the one it superseded
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L67-L76 - VS Code's options, in its words
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L619-L650 - an Allow in this Session answer kept as a rule in the session's `permissions`
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1684-L1766 - VS Code's host answers its agent's question from the session's rules
  - https://github.com/microsoft/vscode/blob/a959ba62444/src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts#L881 - `chat.tools.eligibleForAutoApproval`, the setting the rule is named after
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L32-L42 - VS Code's planned per-tool translation of the setting, which the per-tool ask is
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L22-L26 - an approval setting's policy value alone, which is why the rule is the operator's daemon setting
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostSchema.ts#L530-L531 - the setting's id, the one name VS Code's agent host schema has for it
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

The host decides every question a backend asks about a tool call with VS Code's chain, for what this host has.
A backend says what the call asks for in host-only fields beside its question.
They are its kind, the path, the URL, the shell line and its language.
Two flags say the call asks to leave the sandbox, or a managed rule asks about it.
The host refuses a call its `permissions` deny before any client is asked.
It refuses a write to an attachment snapshot the same way.
Otherwise the host answers the question itself where VS Code's chain does.
That is Allow All, `allow` rules, reads inside the folders, allowed writes, and approved shell lines.
A question about a shell line, a fetch, a read or a write offers grants of what it asks for.
Each grant is offered in the session and always.
Any other question offers its backend's own options, else VS Code's three, in VS Code's words.
A session grant is kept in the session's `permissions`, VS Code's session property.
An Always grant is kept in the host's own `permissions`, root config.
A call that asks to leave the sandbox offers Allow and Skip and keeps nothing.
The host also checks the operator's managed rules on every question, each on the questions of its kind.
A managed deny is refused before any client is asked, and a managed ask asks.
A tool that the daemon setting `eligibleForAutoApproval` sets to `false` is the managed layer's per-tool ask.
VS Code's host declares no root config key for it, and takes the setting's policy value alone.
It asks on every call, in every backend.
Its question offers Allow Once and Skip alone, and nothing answers it but a person, Allow All and grants included.
That is VS Code's own planned translation of the setting.
VS Code maps it onto the Allow All lock only because its managed grammar has no tool-name family.
It says to replace that with a per-tool translation once the grammar gains one, and this host's rules match tool names.
Every permission mode asks, `bypassPermissions` included, and `dontAsk` refuses the call.
The managed lock takes Allow All away from every session.

Source: the audit's rows EJ-0046, EJ-0048, EJ-0051, EJ-0058, EJ-0164 and P2EJ-0101, 2026-11-06.
And C6's differences from VS Code, judged 2026-11-07, with the sandbox step and the managed layer Aaron approved.
Each was judged by Aaron Paterson's test for a divergence from VS Code: whether it is "intentional AND necessary", with "no better more idiomatic pattern".
The rule's source: Softov, 2026-10-16, for host/101, chose "the rule wins over every mode" and "a host root config key".

## Consequences

Every backend's question offers the same options in the same words, as in VS Code.
What a person allowed is in the session's config, where a client reads it and can remove it.
Each backend must ask with no options of its own, except a tool's own choices, and must keep no "always" of its own.
Claude reads the session's `permissions` itself; the host answers the questions of the others.
A rule with a specifier, such as `Shell(npm run *)`, names a call by what the question says it runs or touches.
A backend that leaves those fields out is answered by its tool's name alone.
The rules are matched with VS Code's own code, vendored: its glob, its URI and its URL approval.
A managed `Domain` rule names a URL's host alone, as VS Code's network filter matches a domain.
So it names that host whatever the URL's scheme, port or path.
The daemon refuses to start on a managed rule the managed grammar refuses.
The runtime that takes a managed document refuses the whole document for such a rule.
The host's check of managed rules is ahpd's own.
It carries the enforcement VS Code's policy inventory records as partial.
The managed settings are handed to every backend as well.
A runtime that enforces them itself does so for the calls it never asks the host about.
The host reads the operator's `eligibleForAutoApproval` rule by each name a backend gives a tool.
An MCP server's tool is `<server>/<tool>`, its server read from the call's `contributor`, the session's customization it names, as AHP names an MCP tool's server.
A call with no contributor is named by its full tool name alone.
An ACP agent decides itself whether to ask, so the rule reaches only the MCP tools this host serves it.

## Options

- **Each backend's own options, with the host keeping no answer.** Each agent's own choices are offered. But the options differ by backend, an answer one backend keeps is lost on another, and a person cannot see or remove it.
- **A store of answers of the host's own, per workspace.** It could keep an answer past one session. But the session's config already keeps an answer with its session, and VS Code keeps it there.
- **The rule as in VS Code, skipped by the Auto-Approve level.** It gives parity with the reference. But in `bypassPermissions`, a call that moves money would run without a question.
