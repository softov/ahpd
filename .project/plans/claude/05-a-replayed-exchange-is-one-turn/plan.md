---
title: A replayed Claude exchange is one turn, as it was live
domain: claude
status: planned
priority: high
created: 2026-09-28
revalidated: 2026-09-28
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-claude/src/transcript.ts#L195-L365](../../../../packages/agent-claude/src/transcript.ts#L195-L365) - `buildTurns`"
  - "[code://packages/agent-claude/src/transcript.ts#L240](../../../../packages/agent-claude/src/transcript.ts#L240) - `if (!said) continue`, the only thing that tells a tool-result frame from a prompt"
  - "[code://packages/agent-claude/src/transcript.ts#L344-L361](../../../../packages/agent-claude/src/transcript.ts#L344-L361) - an assistant frame joins the previous turn only when it has no parts yet, and overwrites its usage; otherwise it is an agent turn of its own"
  - "[code://packages/agent-claude/src/transcript.ts#L54-L67](../../../../packages/agent-claude/src/transcript.ts#L54-L67) - `turnsOf`, the main transcript through the SDK's `getSessionMessages`"
  - "[code://packages/agent-claude/src/transcript.ts#L136-L180](../../../../packages/agent-claude/src/transcript.ts#L136-L180) - `subagentsOf`, the worker transcripts read raw"
  - "[code://packages/agent-claude/src/session.ts#L1175-L1206](../../../../packages/agent-claude/src/session.ts#L1175-L1206) - `openTurn`: live, every round joins the prompt's turn"
  - "[code://packages/agent-claude/test/agent-claude-subagent-restore.test.ts#L88-L101](../../../../packages/agent-claude/test/agent-claude-subagent-restore.test.ts#L88-L101) - a main transcript of three rounds, read today as three turns"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts - `ReplayBuilder`: an assistant message appends to the active turn, tool results never open one, and CLI echoes are dropped by `CLI_ECHO_MARKER_PATTERN`
---

## Goal

A Claude session read back after a restart shows each prompt and everything the agent did for it (thoughts, tool calls, replies) as one turn, as it looked live, with its usage.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `buildTurns` over u1, a1 (tool_use), u2 (tool_result), a2 (tool_use), u3 (tool_result), a3 (text) gives three turns; live gives one.
- The CLI writes one API message as several `assistant` frames, one per content block, each repeating the same `message.id` and usage (`claude-subagent.jsonl` has `msg_011CfS6Cc519jLc7pGvyYmnm` three times), so usage summed per frame counts it more than once.
- CLI echo frames (`<command-name>`, `<local-command-stdout>`, `<local-command-caveat>`) and the compact summary are user frames with text, so each opens a turn.
- The reference computes no usage on replay.

### Runtime path

```
getSessionMessages / readJsonl -> buildTurns -> turns -> host restore -> client
```

### Gaps

- Every assistant frame after a tool result opens an agent turn of its own.
- Usage is the last frame's, not the exchange's.
- CLI echoes and the compact summary are prompts.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Assistant frames append to the current turn until the next real prompt; a turn's usage is the sum over the exchange. | Softov, 2026-09-28: "Append assistant frames to the current turn until the next user message, summing usage." | 01 |
| Usage is taken once per `message.id` and summed across distinct ids. | the CLI repeats one message's usage on each of its frames | 01 |
| CLI echo frames and the compact summary open no turn. | Softov, 2026-09-28, asked whether they should stop opening turns as VS Code's replay mapper does: "Yes, drop them (Recommended)". | 02 |
| An assistant frame with no turn before it opens an agent-origin turn, as today. | a worker transcript starts with the agent | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An exchange's rounds are one turn, with the exchange's usage](task-01-an-exchanges-rounds-are-one-turn.md) | todo | - |
| [02 - A CLI echo or a compact summary opens no turn](task-02-an-echo-opens-no-turn.md) | todo | 01 |

## Risks and tradeoffs

- Summed `inputTokens` over-states the context size, as the live `result.usage` already does.
- The main transcript's `SessionMessage` has no timestamp, so a replayed turn's `startedAt` stays epoch 0; not this plan's.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-an-exchanges-rounds-are-one-turn.md](task-01-an-exchanges-rounds-are-one-turn.md).
- **Open questions:** none.
- **Watch out for:** tool results are paired through the shared `calls` map by mutating the call in place, so they land in whichever turn holds the call; a fork anchor or a turn id that names an agent turn's uuid today names nothing after the merge.

## Final verification checklist

- [ ] A restored Claude session in ahpapp shows one turn per prompt, with its tool calls and replies in order.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` green; `plans/index.md` updated.
