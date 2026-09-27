---
title: The commit operation asks first, naming its subject line and the files it will take
status: accepted
date: 2026-09-27
refs:
  - "[code://packages/sdk/src/changes.ts#L121-L129](../../packages/sdk/src/changes.ts#L121-L129) - `COMMIT`, declared with no `confirmation`"
  - file:///github/externals/vscode - `src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionChangesets.ts` shows an operation's `confirmation` before invoking it; `src/vs/platform/agentHost/node/agentHostCommitOperationProvider.ts` declares the reference host's `commit` with none
  - file:///github/externals/agent-host-protocol/types/channels-changeset/state.ts - `ChangesetOperation.confirmation`: the client MUST show it and invoke only after the user accepts
---

## Context

The `commit` operation on an `uncommitted` changeset commits on one click in VS Code, as the reference host's does.
The reference host writes the message with Copilot from the diff; this host commits under the session title, or "Changes from an agent session", and the session's directory can hold work that is not the session's.
On 2026-09-27 one click committed another session's uncommitted files under "Changes from an agent session".

## Decision

`commit` carries a `confirmation` that names the subject line it will use and the files it will take, counting the untracked ones, for example "Commit 4 files, 1 untracked, as 'Changes from an agent session'?".
When the changeset's files or the session title change, the operation is re-declared so the sentence stays true.

Source: Softov, 2026-09-27, asked "ahpd's Commit ran on one click. Should it ask first, through the operation's confirmation (VS Code shows it)?": "Ask, naming what".

## Consequences

A commit is a deliberate act in every client that honours `confirmation`, which the protocol requires.
The protocol reads a `confirmation` as marking a destructive operation, so VS Code styles the button as a warning.
The operation list changes whenever the changeset does, which is more `changeset/operationsChanged` traffic.

## Options

- **A fixed sentence** ("Commit every change in this directory, untracked files included?"): no re-declaring, but it does not say what is about to happen.
- **No confirmation, as the reference host**: parity, and the click that committed another session's work stays one click.
