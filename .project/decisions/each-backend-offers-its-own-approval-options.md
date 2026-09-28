---
title: Each backend offers its own approval options, and the host remembers no approval
status: accepted
date: 2026-09-28
refs:
  - "[code://packages/sdk/src/types/session.ts#L382](../../packages/sdk/src/types/session.ts#L382) - `confirm(toolCallId, approved)`, the answer a backend receives"
  - "[code://packages/agent-claude/src/session.ts#L1765](../../packages/agent-claude/src/session.ts#L1765) - `canUseTool`, whose options carry the SDK's `suggestions`"
  - "[code://packages/agent-acp/src/session.ts#L388-L445](../../packages/agent-acp/src/session.ts#L388-L445) - the ACP agent's own `PermissionOption`s, reduced to once options today"
  - npm://@cofold/agents@^0.1.1 - `alwaysApprove` on an approve command, kept per session and tool name by cofold's runtime
  - npm://@microsoft/agent-host-protocol@0.9.0 - `ConfirmationOption` on `chat/toolCallReady`, `selectedOptionId` on `chat/toolCallConfirmed`
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/sessionPermissions.ts#L57-L66 - the reference's standard set, with "Allow in this Session" kept by the host per tool name
---

## Context

The protocol lets a tool call offer confirmation options and carries the one the person picked back as `selectedOptionId`.
The reference host offers one standard set for every agent (Allow in this Session, Allow Once, Skip) and keeps an "Allow in this Session" answer itself, per tool name, so later calls are approved without the agent knowing.
Each ahpd backend already has its own notion of "always": Claude's SDK hands `canUseTool` a set of `suggestions` to return as `updatedPermissions`, an ACP agent lists its own `allow_always` and `reject_always`, and cofold's runtime remembers `alwaysApprove` per session and tool.
The backend is what asks and what controls a call, and ahpd has no store for approvals per workspace.

## Decision

Each backend offers the options its own agent has, on its `chat/toolCallReady` and on its `toolConfirmation` entry, and acts on the `selectedOptionId` the person picked through its own mechanism.
The host passes the chosen option through and remembers no approval itself.
A backend whose agent has no "always" (pi) offers no options, and the client draws approve and deny.
Source: Softov, 2026-09-28, asked "host/24: which approval options, and who remembers an 'always' choice?", answered "each backend... since its the backend normally who ask calls and control right? maybe ahpd hook in the future... but for ahpd to save we will need to make a store for workspaces and others stuff. so each backend is native by default right?".

## Consequences

An "always" lands where the agent keeps it: Claude's settings or session rules, cofold's session store, the ACP agent's own.
Options differ from backend to backend, which is closer to each agent than to VS Code's one set.
A host-kept approval, for pi or across backends, waits for a store for workspace state and would be a hook over this.

## Options

- **VS Code's standard set, kept by the host per tool name.** One set everywhere and parity with the reference, but the host would keep approvals the agent does not know about, with no store to keep them in past a restart.
