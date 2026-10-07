---
title: A session honours the folders VS Code trusts
domain: host
status: built
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires: []
decisions:
  - decisions/a-folder-is-untrusted-until-a-client-says-otherwise.md
  - decisions/the-sender-decides-on-a-host-with-no-people.md
  - decisions/a-worktree-inherits-its-repositorys-trust.md
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

A session loads no project hook, setting, MCP server or plugin from a folder VS Code has not trusted. A chat that moves a session into a new folder asks the client first, as VS Code's own agent host does.
On a host where several people sign in, one person's trust never opens another person's session.

## Reconnaissance

Each child holds its refs.
VS Code at `7516b04bc94` uses the key in one backend (Codex: project hooks) and in workspace conversion; its Claude backend does not read it.
What each ahpd backend loads from a project folder, checked in the code and the SDKs' typings:

- agent-claude: `query()` sets no `settingSources`, so the CLI loads user, project and local settings. That is `.claude/settings*.json` with their hooks, `CLAUDE.md`, `.claude/skills`, `agents`, `commands` and project plugins. ahpd itself reads `<dir>/.mcp.json` for every directory (`mcp.ts:22-43`). No switch.
- agent-pi: `projectTrust` (`trust` | `deny`) already turns off `.pi/settings.json`, `.pi/extensions`, skills, prompts, themes, project packages and `.pi/SYSTEM.md`; `AGENTS.md` and `CLAUDE.md` are loaded either way.
- agent-cofold: nothing from the project; its config is `~/.config/cofold/config.json` or `$COFOLD_CONFIG`.
- agent-acp: ahpd reads nothing, and passes `cwd` and the host's `mcpServers`. The external agent loads what it likes from `cwd`, and ACP has no trust field.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A folder is untrusted until a client has pushed workspaceTrust saying otherwise](../../../decisions/a-folder-is-untrusted-until-a-client-says-otherwise.md) | Softov, 2026-10-06, "Untrusted, as VS Code" |
| 2 | [The sender's push decides a folder's trust on a host with no people](../../../decisions/the-sender-decides-on-a-host-with-no-people.md) | Softov, 2026-10-06, "The sender's push" |
| 3 | [A worktree the host made is trusted when its repository is](../../../decisions/a-worktree-inherits-its-repositorys-trust.md) | Softov, 2026-10-06, "Inherit from its repository" |

| What | Source | Task |
| --- | --- | --- |
| Declare `workspaceTrust` and act on it | Softov, 2026-10-06, asked "What should 'expose workspaceTrust on config' cover?": "Declare and use it" | all |
| `enabled: false` means every folder is trusted; a folder is trusted when a trusted URI is it or its parent | VS Code `codexAgent.ts:8074-8090` | p1, p2 |
| Two folders are compared as the folders they name, so `..` and a symlink out of a trusted folder do not walk past it | Softov's review of p1, p2 and p3, 2026-10-06 | p1 |
| A `trustedUris` entry that names no folder here - the empty string, `file://`, another machine's host - vouches for nothing | Softov's review of p1, p2 and p3, 2026-10-06 | p1 |
| A window's yes to `vscode/requestWorkspaceTrust` is kept on its connection until it pushes a new `workspaceTrust` | Softov's review of p1, p2 and p3, 2026-10-06 | p1 |

## Tasks

| Child plan | Status | Depends on |
| --- | --- | --- |
| [p1 - The host declares workspaceTrust, keeps it per connection, and asks before a session moves](../66-a-session-honours-the-folders-vscode-trusts-p1-the-host-declares-keeps-and-asks/plan.md) | built | - |
| [p2 - Claude and pi load a project's files only when it is trusted](../66-a-session-honours-the-folders-vscode-trusts-p2-claude-and-pi-load-project-files-only-when-trusted/plan.md) | built | p1 |
| [p3 - An ACP agent in a folder nobody trusted](../66-a-session-honours-the-folders-vscode-trusts-p3-an-acp-agent-in-an-untrusted-folder/plan.md) | built | p1 |

## Risks and tradeoffs

- A client that never pushes `workspaceTrust` (ahpc, ahpapp, the HTTP API) and every automation is untrusted until those clients push it; see [deferred.md](deferred.md).

## Resume state

- **Done so far:** all three children are done. The review on 2026-10-06 found five faults in p1, and each one is fixed.
- **Next action:** none. ahpc and ahpapp push the key in their own plans; see [deferred.md](deferred.md).
- **Open questions:** none; Softov answered every fork on 2026-10-06, the two of this round included.
- **Watch out for:** host/45 task 01 no longer declares `workspaceTrust`; this plan does. On a host with no people directory the sender's push decides, so a backend started there by an automation is untrusted.

## Final verification checklist

- [ ] Every child built, each task's case failing first.
- [ ] By hand: VS Code with a folder not trusted; a Claude session there runs no project hook.
- [ ] `plans/index.md` updated.
