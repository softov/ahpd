---
title: A commit and a pull request get their words as the host is configured
domain: host
status: planned
priority: medium
created: 2026-10-09
revalidated: 2026-10-09
refs:
  - "[code://packages/sdk/src/changes.ts#L687-L702](../../../../packages/sdk/src/changes.ts#L687-L702) - `words()`, the pull request title from the session title and the body from the branch's commits"
  - "[code://packages/sdk/src/changes.ts#L750-L766](../../../../packages/sdk/src/changes.ts#L750-L766) - `create-pr` commits a dirty tree with the session title as the message"
  - "[code://packages/sdk/src/changes.ts#L1069-L1111](../../../../packages/sdk/src/changes.ts#L1069-L1111) - `commit`, the message from `ahpd.commit`, else the session title, else a fixed line"
  - "[code://packages/sdk/src/host/changesets.ts#L109-L129](../../../../packages/sdk/src/host/changesets.ts#L109-L129) - `operationContext`, which hands the source the session title as `subject`"
  - "[code://packages/sdk/src/host/root.ts#L162-L230](../../../../packages/sdk/src/host/root.ts#L162-L230) - `ROOT_CONFIG_SCHEMA`, where a host setting is declared"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentHostPullRequestOperationHandler.ts#L395-L410 - the title and body: what the person submitted, else generated, else a fixed line
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentHostPullRequestOperationHandler.ts#L636-L700 - the generation prompt: branch, base, changed files and conversation; a title under 72 characters, a blank line, a markdown body
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentHostCommitOperationHandler.ts#L81-L150 - a commit message generated from the uncommitted diff
---

## Goal

A commit message, and a pull request's title and description, are written the way the host is configured when the person gives none.
Today ahpd uses the session title, which is often the first prompt cut short.
So PR #5 was titled "Build task 03 of .project/plans/usage/06-a-record-keeps-the-" with no description.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "subject" packages/sdk/src/changes.ts` - the session title is the only text source for `commit`, the `create-pr` commit and `words()`.
- `rg -n "complete|generate" packages/sdk/src/types/agent.ts` - an `Agent` has no call that writes text outside a turn.

### Gaps

- No setting chooses where the words come from.
- No path asks a model or an agent for text outside a chat turn.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Where the words come from is a host setting with four modes: forced (refuse when the person gives no text), a model, the session's agent, and the session title as today | Softov, 2026-10-09, asked "Who should write the pull request title and description, and the commit message, when the person leaves them empty?": "could be configurable. forced (reject if no text), a model, the agent, as today" | 01-04 |
| A model or an agent gets what VS Code's prompt gets: the branch, the base, the changed files and the conversation; it answers a title under 72 characters, a blank line and a markdown body | VS Code `agentHostPullRequestOperationHandler.ts#L636-L700` | 03, 04 |
| A model or an agent that fails falls back to the session title, and the operation says it fell back | VS Code `agentHostPullRequestOperationHandler.ts#L399-L409` | 03, 04 |
| The default mode is the session title, so nothing changes until someone sets the mode | Softov, 2026-10-09, asked about host/76: "when a person leaves the commit message or PR text empty, which mode should a fresh ahpd use by default?": "Session title" | 01 |
| One setting covers the commit message and the pull request title and description | Softov, 2026-10-09, asked about host/76: "should the commit message and the pull request text share one setting, or have one setting each?": "One setting" | 01 |
| Model mode names a provider and a model the host already lists | Softov, 2026-10-09, asked about host/76: "in model mode, how does the host know which model to call?": "Provider and model" | 01, 03 |
| Agent mode asks the session's agent in a side chat, so the main conversation is not touched | Softov, 2026-10-09, asked about host/76: "in agent mode, how is the session's agent asked for the text?": "Side chat" | 04 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host declares the setting](task-01-the-host-declares-the-setting.md) | todo | - |
| [02 - Forced and session-title modes](task-02-forced-and-session-title-modes.md) | todo | 01 |
| [03 - A model writes the words](task-03-a-model-writes-the-words.md) | todo | 02 |
| [04 - The session's agent writes the words](task-04-the-sessions-agent-writes-the-words.md) | todo | 02 |

## Risks and tradeoffs

- Forced mode refuses VS Code's Commit button, because VS Code sends no message with it.
- A model or an agent costs tokens on each commit and pull request.

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.
- An agent with no side chat falls back to the session title, and the operation says so.
- **Watch out for:** `create-pr` commits a dirty tree before it opens the request, so that commit message follows the same setting.

## Final verification checklist

- [ ] Each mode has a test for the commit, the `create-pr` commit and the pull request title and body.
- [ ] `pnpm test` passes.
- [ ] `plans/index.md` updated.
