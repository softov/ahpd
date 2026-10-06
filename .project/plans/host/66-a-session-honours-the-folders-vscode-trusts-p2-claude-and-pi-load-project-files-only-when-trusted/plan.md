---
title: Claude and pi load a project's files only when it is trusted
domain: host
status: planned
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/66-a-session-honours-the-folders-vscode-trusts-p1-the-host-declares-keeps-and-asks/plan.md
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L93-L171](../../../../packages/agent-claude/src/session/query.ts#L93-L171) - the `query()` options, with no `settingSources`"
  - "[code://packages/agent-claude/src/mcp.ts#L22-L43](../../../../packages/agent-claude/src/mcp.ts#L22-L43) - `serversFor`, which reads `<dir>/.mcp.json`"
  - "[code://packages/agent-claude/src/claude.ts#L578](../../../../packages/agent-claude/src/claude.ts#L578) - where it is called"
  - "[code://packages/agent-pi/src/backend.ts#L124-L131](../../../../packages/agent-pi/src/backend.ts#L124-L131) - `trustProject` to pi's `projectTrusted`"
  - "[code://packages/agent-pi/src/session.ts#L674](../../../../packages/agent-pi/src/session.ts#L674) - the session's `projectTrust` mapped to it"
---

## Goal

A Claude or pi session in a folder that is not trusted runs none of the project's hooks and loads none of its settings, MCP servers or plugins; in a trusted folder nothing changes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
The Claude SDK's `settingSources` (`sdk.d.ts:2141-2151`): unset loads user, project and local; `['user']` drops the project's settings, its hooks and plugins with them, and also its `CLAUDE.md` ("Must include 'project' to load CLAUDE.md files").
pi's `projectTrusted: false` drops `.pi/settings.json`, `.pi/extensions`, skills, prompts, themes, packages and `.pi/SYSTEM.md`, and keeps `AGENTS.md` and `CLAUDE.md`.
agent-cofold loads nothing from a project, so it has no task.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Untrusted Claude: `settingSources` without `project` and `local`, and no `<dir>/.mcp.json` read | the parent's row, "Declare and use it" | 01 |
| Untrusted Claude drops the project's `CLAUDE.md` too | Softov, 2026-10-06, asked "Claude's settingSources without 'project' also drops CLAUDE.md. In an untrusted folder, what happens to CLAUDE.md?": "Drop it" | 01 |
| Untrusted pi: `trustProject: false`, whatever the session's `projectTrust` says; a trusted folder keeps `projectTrust` as it is | the same | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An untrusted Claude session loads no project settings or MCP servers](task-01-an-untrusted-claude-session-loads-no-project-settings.md) | todo | p1 task 03 |
| [02 - An untrusted pi session does not trust the project](task-02-an-untrusted-pi-session-does-not-trust-the-project.md) | todo | p1 task 03 |

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01, once p1 task 03 is built.
- **Open questions:** none.
- **Watch out for:** `projectTrust` stays a pi session key; trust can only narrow it.

## Final verification checklist

- [ ] Each task's case fails on the code before it and passes after.
- [ ] `plans/index.md` updated.
