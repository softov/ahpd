---
title: A session honours the folders VS Code trusts - implemented
date: 2026-10-06
refs:
  - "[code://packages/sdk/src/host/trust.ts](../../../../packages/sdk/src/host/trust.ts) - the one reader of a pushed `workspaceTrust` value"
---

A session now loads a project's own files only in a folder a window trusts.
The host declares `workspaceTrust`, keeps each window's value, and asks a window before a session moves into a new folder.
Claude and pi load project settings only when the folder is trusted, and an ACP agent is refused in an untrusted folder.

## What was built

- [p1](../66-a-session-honours-the-folders-vscode-trusts-p1-the-host-declares-keeps-and-asks/implemented.md) - the key, the value per connection, the question before a move.
- [p2](../66-a-session-honours-the-folders-vscode-trusts-p2-claude-and-pi-load-project-files-only-when-trusted/implemented.md) - Claude and pi load project files only when trusted.
- [p3](../66-a-session-honours-the-folders-vscode-trusts-p3-an-acp-agent-in-an-untrusted-folder/implemented.md) - an ACP agent is refused in an untrusted folder.

## Verified

- Each child's `implemented.md` lists its tests.
- The review on 2026-10-06 found five faults in p1, and each fix has a test.
- The sdk, Claude, pi and ACP suites pass: 2067 of 2067 tests.

## Departures from the plan

- [The sender decides on a host with no people](../../../decisions/the-sender-decides-on-a-host-with-no-people.md) and [a worktree inherits its repository's trust](../../../decisions/a-worktree-inherits-its-repositorys-trust.md) came from the review.

## Left for later

- See [deferred.md](deferred.md): ahpc and ahpapp must push `workspaceTrust`.
