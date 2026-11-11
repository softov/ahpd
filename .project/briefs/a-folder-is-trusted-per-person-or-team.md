---
title: A folder is trusted per person or team
created: 2026-11-11
refs:
  - git://6f4ee6ff6 - the commit of ahpd the facts were checked at
  - "[code://packages/sdk/src/host/trust.ts#L129](../../packages/sdk/src/host/trust.ts#L129) - `trusted`, which answers a folder from one `workspaceTrust` value"
  - "[code://packages/sdk/src/host/spawn.ts#L1218-L1225](../../packages/sdk/src/host/spawn.ts#L1218-L1225) - `trustedBy`, which a backend asks: the session's own trusted folder, then the host's one value"
  - "[code://packages/sdk/src/host/gate.ts#L298-L306](../../packages/sdk/src/host/gate.ts#L298-L306) - `dispatchNeeds`: a push of `workspaceTrust` alone needs `trust:push`"
  - "[code://packages/sdk/src/host/root.ts#L434](../../packages/sdk/src/host/root.ts#L434) - `workspaceTrust`, declared as one root config value"
  - "[code://packages/sdk/src/access/users.ts#L35](../../packages/sdk/src/access/users.ts#L35) - the built-in `member` role holds `trust:write`"
  - "[code://packages/sdk/src/sessions/sessions.ts#L108](../../packages/sdk/src/sessions/sessions.ts#L108) - a session's owner, kept with the session"
  - "[code://packages/sdk/src/sessions/sessions.ts#L127-L128](../../packages/sdk/src/sessions/sessions.ts#L127-L128) - a session's own trusted folder, which a plugin sets with `session:trust`"
  - "[code://.project/specs/workspace-trust.md](../specs/workspace-trust.md) - the host keeps one trust value for every session"
  - "[code://.project/specs/people-roles-and-grants.md](../specs/people-roles-and-grants.md) - people, teams, projects, and the owner of work"
  - "[code://.project/plans/host/20261102-1252-the-window-keys-are-one-value-for-the-host/plan.md](../plans/host/20261102-1252-the-window-keys-are-one-value-for-the-host/plan.md) - the plan that made trust one value for the host, from one value per connection"
  - https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostSessionPrewarmer.ts#L162 - VS Code's host reads one trust value for every session
  - https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/common/agentHostConfigurationSync.ts#L47-L55 - VS Code's root config is shared by every window, and the last push wins
  - https://code.claude.com/docs/en/security - Claude Code saves trust per folder for the person who runs it, read 2026-11-11
  - https://learn.chatgpt.com/docs/config-file/config-reference - Codex keeps `projects.<path>.trust_level` in the person's own `~/.codex/config.toml`, read 2026-11-11
---

# A folder is trusted per person or team

Softov wants to know whether ahpd can keep folder trust per person or per team, in place of one list for the whole host.
On a host with people, one person's yes to a folder now trusts it for every session on the host, of every person and team.
A trusted folder lets a backend load the folder's own settings, hooks and MCP servers.
So the yes of one person runs a folder's hooks in another person's session.
He asked on 2026-11-11, while he tested a user without `trust:write` on a folder the host already trusted.

## What others do

- **VS Code's host** keeps one `workspaceTrust` value for every window, and the last push wins ([`agentHostConfigurationSync.ts`](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/common/agentHostConfigurationSync.ts#L47-L55)). Every session reads that one value ([`agentHostSessionPrewarmer.ts`](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostSessionPrewarmer.ts#L162)). VS Code's host has no people, so one value is one person's.
- **Claude Code** shows a trust dialog in a folder the person has not trusted, and saves the answer per folder ([security](https://code.claude.com/docs/en/security)). The answer is the person's own, kept in their own files.
- **Codex** keeps `projects.<path>.trust_level`, `"trusted"` or `"untrusted"`, in the person's own `~/.codex/config.toml` ([config reference](https://learn.chatgpt.com/docs/config-file/config-reference)). An untrusted project skips the project's `.codex/` config, hooks and rules.

The two agents keep trust per person. The host that ahpd follows keeps it per host, because it serves one person.

## What ahpd has today

- `workspaceTrust` is one root config value for the whole host ([`code://packages/sdk/src/host/root.ts`](../../packages/sdk/src/host/root.ts#L434)). The last push from any client sets it, as [`workspace-trust.md`](../specs/workspace-trust.md) says.
- Before 2026-11-02 the value was kept per connection. Plan [`host/20261102-1252-the-window-keys-are-one-value-for-the-host`](../plans/host/20261102-1252-the-window-keys-are-one-value-for-the-host/plan.md) made it one value, as VS Code's host keeps it.
- `trusted` answers a folder from that one value: the folder or a folder above it is in `trustedUris`, or `enabled` is `false` ([`code://packages/sdk/src/host/trust.ts`](../../packages/sdk/src/host/trust.ts#L129)).
- A backend asks `trustedBy`. It reads the session's own trusted folder first, then the host's one value, and a worktree under its repository takes the repository's trust ([`code://packages/sdk/src/host/spawn.ts`](../../packages/sdk/src/host/spawn.ts#L1218-L1225)).
- A session's own trusted folder exists already: a plugin sets it with `session:trust`, and it is kept with the session ([`code://packages/sdk/src/sessions/sessions.ts`](../../packages/sdk/src/sessions/sessions.ts#L127-L128)). It is one folder, not a tree.
- A session keeps its owner ([`code://packages/sdk/src/sessions/sessions.ts`](../../packages/sdk/src/sessions/sessions.ts#L108)). The owner is `user:<id>`, `team:<id>`, `project:<id>`, `root:<host>` or `plugin:<name>`, as [`people-roles-and-grants.md`](../specs/people-roles-and-grants.md) says.
- The users file names people, their teams and projects, and their roles.
- A push of `workspaceTrust` alone needs `trust:push` ([`code://packages/sdk/src/host/gate.ts`](../../packages/sdk/src/host/gate.ts#L298-L306)). The built-in `member` role holds `trust:write`, which covers it ([`code://packages/sdk/src/access/users.ts`](../../packages/sdk/src/access/users.ts#L35)).
- So a member who trusts a folder trusts it for every session on the host. A person without `trust:write` cannot trust a folder for their own sessions either.

## Who writes

- No pull request of ahpd is open.
- The fork's branches from 2026-10-31 to 2026-11-02 change `actions.ts` and `spawn.ts`. Their plans, such as `host/20261101-0329-the-hosts-state-is-the-reducers-output`, are `built` on `main`.
- `origin/debug/windows-timing` changes `spawn.ts`, for timing only.
- No branch changes `trust.ts`, `gate.ts`, `users.ts` or `workspace-trust.md`.

## The change

It is possible, because the host knows the owner of each session and the people file knows each person's teams. The change would be:

- The host keeps trusted folders per owner: per person, and per team or project.
- A push of `workspaceTrust` from a signed-in person writes that person's list. The host's one value stays for the host's own owner, `root:<host>`, and for a host with no people.
- A backend's `trustedBy` reads the folders of the session's owner. For a person, it reads their own list, then the lists of the teams and projects they belong to.
- `trust:push` covers a push to one's own list. A push to a team's or a project's list needs a grant on that team or project.
- A client reads the folders that apply to it, so it does not ask about a folder its owner already trusts.
- A host with no people keeps today's one value, as VS Code's host does.

## Open points

- Whether the host's one value still trusts a folder for every owner, as a floor under each person's list, or only for `root:<host>`.
- Whether a team's trust is written by any member with `trust:write`, or only by a grant on the team.
- Where the lists are kept: in the users file beside the memberships, or in a file of their own.
- What a person's own list means for a session they share with a team: the session's owner decides, or the sender of the turn.
- How the root state shows per-owner trust, since `workspaceTrust` is one value that VS Code's windows push and read.
