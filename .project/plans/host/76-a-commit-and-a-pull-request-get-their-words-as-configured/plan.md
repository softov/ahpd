---
title: A commit and a pull request get their words as the host is configured
domain: host
status: built
priority: medium
created: 2026-10-09
revalidated: 2026-10-09
refs:
  - "[code://packages/sdk/src/changes.ts#L687-L702](../../../../packages/sdk/src/changes.ts#L687-L702) - `words()`, the pull request title from the session title and the body from the branch's commits"
  - "[code://packages/sdk/src/changes.ts#L750-L766](../../../../packages/sdk/src/changes.ts#L750-L766) - `create-pr` commits a dirty tree with the session title as the message"
  - "[code://packages/sdk/src/changes.ts#L1069-L1111](../../../../packages/sdk/src/changes.ts#L1069-L1111) - `commit`, the message from `ahpd.commit`, else the session title, else a fixed line"
  - "[code://packages/sdk/src/host/changesets.ts#L332-L356](../../../../packages/sdk/src/host/changesets.ts#L332-L356) - `operationContext`, which hands the source the session title as `subject`"
  - "[code://packages/sdk/src/host/root.ts#L178-L263](../../../../packages/sdk/src/host/root.ts#L178-L263) - `ROOT_CONFIG_SCHEMA`, where a host setting is declared"
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
| The host hands the source an ask on `ChangesetOperationContext`, as it hands `github.ask`; the source builds the prompt, calls the ask, splits the answer and falls back | Softov, 2026-10-09, asked about host/76: "in model and agent mode, where is the text asked for?": "Host passes an ask" | 01, 03, 04 |
| Model mode opens a session on the named provider with the named model, runs one turn with no tools, reads the answer and closes the session | Softov, 2026-10-09, asked about host/76: "in model mode, how does the named provider and model write the text?": "Throwaway session" | 03 |
| Agent mode asks a protocol `sideChat` from the session's newest turn, made through the path a client's `createChat` takes | Softov, 2026-10-09, asked about host/76: "in agent mode, which chat writes the commit and pull request text?": "Protocol sideChat" | 04 |
| The side chat stays in the session after it answers | Softov, 2026-10-09, asked about host/76: "after the side chat writes the text, does it stay in the session?": "It stays" | 04 |
| A model or an agent that has not answered after 2 minutes is cancelled, and the words fall back to the session title as for a failure | Softov, 2026-10-09, asked about host/76: "the commit or pull request waits for a turn to end... What should ahpd do?": "time limit, fallback"; (defaulted: 2 minutes) | 03, 04 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host declares the setting](task-01-the-host-declares-the-setting.md) | done | - |
| [02 - Forced and session-title modes](task-02-forced-and-session-title-modes.md) | done | 01 |
| [03 - A model writes the words](task-03-a-model-writes-the-words.md) | done | 02 |
| [04 - The session's agent writes the words](task-04-the-sessions-agent-writes-the-words.md) | done | 02 |

## Risks and tradeoffs

- Forced mode refuses VS Code's Commit button, because VS Code sends no message with it.
- A model or an agent costs tokens on each commit and pull request. A pull request asks twice: once for the commit it makes of a dirty tree, and once for its own title and description.
- A model or an agent that has not answered in two minutes has its turn cancelled. A model slower than that loses the words to the session title. `changeWordsTimeoutMs` moves the limit, and zero there is no limit at all.
- A client subscribed to the root channel sees the throwaway session of `model` mode arrive and go. A `root/sessionAdded` comes first, then a `root/sessionRemoved`, and the backend is asked to delete its own copy of the session. Hiding either is a change this plan does not ask for.
- `agent` mode leaves its side chat in the session, so a pull request leaves two: one from the commit's ask and one from its own. They stay because the plan decides they stay.

## Resume state

- **Done so far:** tasks 01, 02, 03 and 04, implemented on `build/agents/016ab0b2` on 2026-10-09 and left uncommitted for review.
- Task 01: root config carries `changeWords`, with four modes and a default of `session-title`, and the host refuses a `model` mode it cannot ask.
- Task 02: the three places that write a commit message or a pull request's words go through one `wordsFor`, and `forced` refuses a commit with no message.
- Task 03: `model` mode opens a session on the named provider and model in the changeset's own directory, runs one turn with no tools, reads the answer and disposes of the session. The turn is waited for under `CHANGE_WORDS_MOST`, two minutes, or `changeWordsTimeoutMs`; past it the turn is cancelled and the words fall back as for a failure.
- Task 04: `agent` mode asks a side chat of the session's newest turn, and the chat stays afterwards, whether the turn ended or was stopped at the same limit.
- Tests: every mode has one for the commit, the `create-pr` commit and the pull request title and body. `packages/sdk/test/changewords.test.ts` (22) drives all four through a real host over a real repository, `commit.test.ts` (30) covers forced and the session title from the source, and `root-config.test.ts` (25) covers the key.
- **Next action:** none; see [implemented.md](implemented.md).
- **Gates:** `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass. `npx vitest run --maxWorkers=2 --testTimeout=10000` is 266 files and 4,716 tests, green.
- **Open questions:** none.
- **Watch out for:** `create-pr` commits a dirty tree before it opens the request, and that commit now follows the same setting. A pull request asks twice, so `model` mode opens two throwaway sessions and `agent` mode two side chats. `packages/sdk/test/fixtures/wire.jsonl` is rewritten by the full suite - the endpoint line and 39 `ahpd.` `_meta` lines - and is left modified here; the suite owns that file and it is not this plan's work.

## Final verification checklist

- [x] Each mode has a test for the commit, the `create-pr` commit and the pull request title and body.
- [x] `pnpm test` passes.
- [x] `plans/index.md` updated.
