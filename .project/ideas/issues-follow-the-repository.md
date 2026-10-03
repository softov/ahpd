---
title: A session's issues follow its repository, on whichever tracker the repository uses
created: 2026-10-02
---

Softov, 2026-10-02: "since its a repo. something that could track its issue... a plugin for issues.. get the repo. check its kind, github gitlab, and work with issues, if configured enable tools for issues... tasker has something that could be copied."
And: "I want to go to a repo a see the issues it has. interact with it. using the ahpd via ahp. since major will be there... cli, http, api.. so tasker will be irrelevant when a plugin exists."

A plugin that looks at a session's repository, works out which forge it is on from the remote's URL (GitHub, GitLab, a self-hosted GitLab), and gives the session that repository's issues: a scheme a client browses, and, when configured, tools the agent uses to read, comment on, open and update them.
It pairs with [repositories are resources](repositories-are-resources.md): a session opened on a repository already knows which one it is, and a session on a folder has its `origin` remote.

## What it would offer

- **An `issue:` scheme**, read-only first: a client lists a repository's open issues and opens one, and a person attaches one to a new session as its brief (a session config key with a picker).
- **Tools, only when enabled**: search, read, comment, create and update, each declaring its effects so the agent's policy asks before a write.
- **Per repository, not per host**: the tracker, project and token come from the repository, so two sessions on two repositories reach two trackers.

The goal is to work a repository's issues from any ahpd client: open a repository, see its issues, read one, comment, change its state, and start a session on it.
Everything goes through AHP, so the CLI, the HTTP API and the apps get it at once, and tasker is no longer needed once this exists.

## What tasker already has

Tasker (`/brb_main/src/service_tasker`) solves the same problem for its CLI and MCP server. Its code is copied into ahpd, not depended on or called:

- One tracker-neutral interface (tasker's `Store`, `packages/core/src/store.ts`): `me`, `search`, `get`, `create`, `update`, `addNote` and `vocabulary`, with a GitLab and a Redmine implementation, no dependency beyond its own core. In ahpd it would be named for what it is, an issue tracker (`IssueTracker`, one per forge or instance), not a store.
- The project chosen from the working directory (`.tasker.json`, hierarchical), with credentials per person and outside the repository, which is the same split this host wants with the [vault](../plans/vault/01-secrets-live-in-a-vault/plan.md).
- A tracker's vocabulary read at runtime (types, statuses, priorities, labels, milestones), so the tools offer what the instance defines rather than a fixed list.
- Allow and deny filters on which projects an agent may see.

## Questions it leaves

- Whether the tracker is a host port (`registerIssues`, like `github` today) that a plugin fills per forge, or lives inside one issues plugin.
- Which tokens it uses: the person's own, from the vault, or the host's, and what a person without access to a repository's tracker sees.
- Whether GitHub Issues comes with GitLab from the start, and Redmine (tasker's other tracker, not tied to a forge) at all.
- Starting a session from an issue (an assignment or a label) is an [initiator](initiators-start-sessions.md), which needs an inbound webhook or polling.
