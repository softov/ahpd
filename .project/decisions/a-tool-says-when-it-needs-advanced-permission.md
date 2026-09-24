---
title: A tool says when it needs advanced permission, and the host says whether it has it
status: accepted
date: 2026-09-23
refs:
  - "[code://packages/sdk/src/types/host.ts#L243-L262](../../packages/sdk/src/types/host.ts#L243-L262) - `HostTool`, where the claim goes, beside `effects`"
  - "[code://packages/sdk/src/types/host.ts#L177-L186](../../packages/sdk/src/types/host.ts#L177-L186) - `HostOptions.tools`"
  - "[code://packages/sdk/src/host.ts#L3576](../../packages/sdk/src/host.ts#L3576) - `contributing`, the set a session's model is offered"
  - "[code://packages/sdk/src/host.ts#L3606-L3620](../../packages/sdk/src/host.ts#L3606-L3620) - `toolDefinitions`, what a session reports"
  - "[code://packages/sdk/src/host.ts#L3822-L3845](../../packages/sdk/src/host.ts#L3822-L3845) - `boundTools`, where a call is made"
  - "[code://packages/computer/src/tools.ts#L34-L132](../../packages/computer/src/tools.ts#L34-L132) - the three tools that declare it"
  - "[code://packages/sdk/src/tools.ts](../../packages/sdk/src/tools.ts) - `hostTools()`, which declares it nowhere and is untouched"
  - "[code://packages/server/src/config.ts](../../packages/server/src/config.ts) - the daemon key"
  - "[code://docs/PLUGINS.md](../../docs/PLUGINS.md) - where a plugin author reads the contract"
---

## Context

A host tool is offered to every session's model, in every session, and there is no way for a tool to say that it is more than a convenience.
The computer's three tools start and destroy containers and run commands in them, which is more than the reference host's twelve do, and today the only way to keep a model from them is to load the whole plugin without them, which also gives up the lifecycle.

An earlier reading of this made the switch a blanket over every plugin-contributed tool.
That reading was wrong twice: it was written into the question rather than said by the user, whose words were "if not permitted no session can run those tools"; and it would hide harmless plugin tools along with the dangerous ones.

The user, 2026-09-23: "A plugin tool could enforce to be off unless defined.. something like, `advancedPermission: true` on the tool. some important tools.. not all.."

What a tool does is already the tool's own claim: `effects` says whether it reads, writes, reaches the network or is destructive, and a backend's policy reads it.
This is the same kind of claim, for a different question: not "what does running this do" but "may this host offer it at all without being asked".

## Decision

`HostTool` gains `advancedPermission?: boolean`, the tool's own statement that it does more than a session's ordinary work.
A tool that declares it is not offered to a session unless the host permits advanced tools: it is left out of `SessionState.serverTools` and is not bound, so a model cannot call it and a client does not draw it.
A tool that does not declare it is unaffected, whoever contributed it, and the reference twelve are untouched because they declare nothing.

`HostOptions` gains `advancedTools?: boolean`, false unless set, and the daemon reads it from its `advancedTools` key or `--advanced-tools`.
So the claim is the tool's and the permission is the operator's, which is the split `effects` already has with a backend's policy.

The computer's three tools declare `advancedPermission: true`.
The plugin's own option still decides what that plugin registers, so a host that permits advanced tools can still load one plugin's lifecycle without its tools, and a host that does not permit them is not asked to trust a plugin's judgement.

`(defaulted: the host key is named `advancedTools`; the user named the tool's field and may prefer another key for the host's.)`

## Consequences

A plugin can contribute both a harmless tool and a dangerous one and only the dangerous one waits for permission, which is what "some important tools, not all" asks for.
The three computer tools change from offered to withheld by default, which is a behaviour change for anyone already running the plugin; it is the secure direction and it is one key to undo.
The marking is a public SDK type change, so every tool literal gains a field it may leave out, and the only one that sets it is the computer's.
A tool withheld this way is absent rather than refused at call time, so nothing has to answer a call that a model should not have been offered, and the failure mode is a tool the model never sees.
`ahpd plugin list` is unaffected: it says what would load, which is a different question from what a session is offered.

## Options

- **A blanket switch over every plugin-contributed tool.** Rejected: it hides a harmless tool along with a dangerous one, and it is not what was asked for.
- **A daemon list of permitted tool names.** Rejected for now: a boolean and the plugin's own option cover the cases here, and a list is a second configuration language to document; if a host wants one advanced tool and not another, this is the option to revisit.
- **Derive it from `effects.destructive`.** Rejected: a destructive tool is not always one that needs permission, and a tool may need permission for something that is not destructive at all, so the tool says this itself.
- **Leave it to each plugin's own option.** Rejected as the only control: the question is whether the host offers a tool, which is the operator's, not the plugin author's.
- **Mark the tool and let a backend's policy ask a person at call time.** Rejected as the only mechanism: a session whose client cannot answer would then have a tool it can never use, and the host-level answer is the one that can be given before a session starts.
