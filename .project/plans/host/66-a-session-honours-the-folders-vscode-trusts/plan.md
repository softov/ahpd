---
title: A session honours the folders VS Code trusts
domain: host
status: planned
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires: []
decisions:
  - decisions/a-folder-is-untrusted-until-a-client-says-otherwise.md
refs:
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/agentHostSchema.ts#L507-L512 - `workspaceTrust`, `{ enabled, trustedUris }`
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/agentHostSchema.ts#L864-L877 - its property, `readOnly`, both fields required
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/browser/agentHostProtocolClient.ts#L1316-L1335 - the window pushes it to every host, `file:` URIs only
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/codex/codexAgent.ts#L8025-L8090 - project hooks granted only for a trusted cwd; absent is untrusted, `enabled: false` is trusted
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/chatContributions/sessionWorkspaceConversion/sessionWorkspaceConversionService.ts#L160-L200 - a conversion asks for trust, skipped under `globalAutoApproveEnabled` or a session on `autoApprove`
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/chatContributions/sessionWorkspaceConversion/sessionWorkspaceConversionService.ts#L322-L333 - `_requireWorkspaceTrust`: refused unless the client answers `trusted: true`
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/agentHostExtensionProtocol.ts#L55 - `vscode/requestWorkspaceTrust`
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1448-L1455 - the reverse request, no timeout; a disconnect rejects it
  - "[code://.project/research/vscode-host-wire-diff-2026-10-06.md#L82](../../../research/vscode-host-wire-diff-2026-10-06.md#L82) - the row this plan answers"
---

## Goal

A folder VS Code has not trusted does not get its project hooks, settings, MCP servers or plugins loaded by a session, and a chat that moves a session into a new folder asks the client first, as VS Code's own agent host does.
On a host where several people sign in, one person's trust never opens another person's session.

## Reconnaissance

Each child holds its refs.
VS Code at `7516b04bc94` uses the key in one backend (Codex: project hooks) and in workspace conversion; its Claude backend does not read it.
What each ahpd backend loads from a project folder, checked in the code and the SDKs' typings:

- agent-claude: `query()` sets no `settingSources`, so the CLI loads user, project and local settings (`.claude/settings*.json` with their hooks, `CLAUDE.md`, `.claude/skills`, `agents`, `commands`, project plugins); ahpd itself reads `<dir>/.mcp.json` for every directory (`mcp.ts:22-43`). No switch.
- agent-pi: `projectTrust` (`trust` | `deny`) already turns off `.pi/settings.json`, `.pi/extensions`, skills, prompts, themes, project packages and `.pi/SYSTEM.md`; `AGENTS.md` and `CLAUDE.md` are loaded either way.
- agent-cofold: nothing from the project; its config is `~/.config/cofold/config.json` or `$COFOLD_CONFIG`.
- agent-acp: ahpd reads nothing, and passes `cwd` and the host's `mcpServers`; the external agent loads what it likes from `cwd`, and ACP has no trust field.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A folder is untrusted until a client has pushed workspaceTrust saying otherwise](../../../decisions/a-folder-is-untrusted-until-a-client-says-otherwise.md) | Softov, 2026-10-06, "Untrusted, as VS Code" |

| What | Source | Task |
| --- | --- | --- |
| Declare `workspaceTrust` and act on it | Softov, 2026-10-06, asked "What should 'expose workspaceTrust on config' cover?": "Declare and use it" | all |
| `enabled: false` means every folder is trusted; a folder is trusted when a trusted URI is it or its parent | VS Code `codexAgent.ts:8074-8090` | p1, p2 |

## Tasks

| Child plan | Status | Depends on |
| --- | --- | --- |
| [p1 - The host declares workspaceTrust, keeps it per connection, and asks before a session moves](../66-a-session-honours-the-folders-vscode-trusts-p1-the-host-declares-keeps-and-asks/plan.md) | planned | - |
| [p2 - Claude and pi load a project's files only when it is trusted](../66-a-session-honours-the-folders-vscode-trusts-p2-claude-and-pi-load-project-files-only-when-trusted/plan.md) | planned | p1 |
| [p3 - An ACP agent in a folder nobody trusted](../66-a-session-honours-the-folders-vscode-trusts-p3-an-acp-agent-in-an-untrusted-folder/plan.md) | planned | p1 |

## Risks and tradeoffs

- A client that never pushes `workspaceTrust` (ahpc, ahpapp, the HTTP API) and every automation is untrusted until those clients push it; see [deferred.md](deferred.md).

## Resume state

- **Done so far:** nothing.
- **Next action:** p1 task 01.
- **Open questions:** none; Softov answered all four on 2026-10-06.
- **Watch out for:** host/45 task 01 no longer declares `workspaceTrust`; this plan does.

## Final verification checklist

- [ ] Every child built, each task's case failing first.
- [ ] By hand: VS Code with a folder not trusted; a Claude session there runs no project hook.
- [ ] `plans/index.md` updated.
