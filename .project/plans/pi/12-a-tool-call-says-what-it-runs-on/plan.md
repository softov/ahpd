---
title: A tool call says what it runs on, on pi, cofold and Claude live
domain: pi
status: built
priority: medium
created: 2026-09-28
revalidated: 2026-09-28
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-pi/src/mapping.ts#L171-L178](../../../../packages/agent-pi/src/mapping.ts#L171-L178) - `readyRow`: `invocationMessage` is the display name"
  - "[code://packages/agent-pi/src/mapping.ts#L281-L327](../../../../packages/agent-pi/src/mapping.ts#L281-L327) - `tool_execution_end`: `pastTenseMessage` is the display name"
  - "[code://packages/agent-pi/src/types.ts#L100-L104](../../../../packages/agent-pi/src/types.ts#L100-L104) - `PiCall`, which keeps no input"
  - "[code://packages/agent-pi/src/session.ts#L369-L405](../../../../packages/agent-pi/src/session.ts#L369-L405) - `askBefore`, the asked call's ready action"
  - "[code://packages/agent-pi/src/replay.ts#L160-L163](../../../../packages/agent-pi/src/replay.ts#L160-L163) - replay's `readyRow` with the call's arguments"
  - "[code://packages/agent-claude/src/session.ts#L129-L135](../../../../packages/agent-claude/src/session.ts#L129-L135) - `summarize`, the pattern: the command, path or pattern of a call"
  - "[code://packages/agent-claude/src/transcript.ts#L295-L333](../../../../packages/agent-claude/src/transcript.ts#L295-L333) - claude's transcript: `invocationMessage` and `pastTenseMessage` are `summarize ?? name`"
  - "[code://packages/agent-claude/src/session.ts#L1545-L1602](../../../../packages/agent-claude/src/session.ts#L1545-L1602) - claude live: `invocationMessage` is the name"
  - "[code://packages/agent-cofold/src/tools.ts#L267-L296](../../../../packages/agent-cofold/src/tools.ts#L267-L296) - cofold's ready and complete actions, both the name"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - tools `bash`/`powershell` (`command`), `read`/`edit`/`write` (`path`), `grep`/`find` (`pattern`), `ls` (`path?`)
  - npm://@cofold/tools@^0.1.1 - tools `shell_exec` (`command`), `read_file`/`write_file`/`edit_file` (`path`), `search_files`/`list_files` (`pattern`), `web_fetch` (`url`), `web_search` (`query`), `memory_write` (`path`)
---

## Goal

A tool call on pi, on cofold, and in a live Claude turn is drawn with what it runs on (the command, the file, the pattern), while it runs and after it finishes, live and after a reload, as Claude's replayed calls already are.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- agent-claude has no `commandOf`; `summarize` is the function, defined in `session.ts` and again in `transcript.ts`, and gives the bare argument with no verb.
- pi's `!command` path already draws the command (`session.ts:835-876`).
- `agent-pi.test.ts:1698-1719` expects `invocationMessage: 'read'` and `pastTenseMessage: 'read'` on a replayed call.

### Runtime path

```
tool call args -> [new] describe(name, args) -> chat/toolCallReady.invocationMessage, chat/toolCallComplete.result.pastTenseMessage
```

### Gaps

- pi and cofold draw every call by its tool name.
- Claude's live calls are drawn by name while its replayed ones are drawn by their argument.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `invocationMessage` and `pastTenseMessage` are the call's bare argument, as claude's `summarize` gives, falling back to the tool name. | Softov, 2026-09-28, asked how pi should describe a call: "Bare argument, like claude (Recommended)". | 01-03 |
| pi, cofold and Claude's live path are covered. | Softov, 2026-09-28, asked which backends: "pi, cofold and claude live (Recommended)". | 01-03 |
| pi: `bash` and `powershell` by `command`; `read`, `edit`, `write` by `path`; `grep` and `find` by `pattern`; `ls` by `path`, or `.` when none. | pi's tool parameters | 01 |
| cofold: `shell_exec` by `command`; the file tools and `memory_write` by `path`; `search_files` and `list_files` by `pattern`; `web_fetch` by `url`; `web_search` by `query`. | `@cofold/tools`' parameters | 02 |
| A tool with none of these keeps its name. | claude's `summarize` falls back to JSON, which reads worse as a title; (defaulted) | 01, 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A pi call says what it runs on, live and replayed](task-01-a-pi-call-says-what-it-runs-on.md) | done | - |
| [02 - A cofold call says what it runs on, live and replayed](task-02-a-cofold-call-says-what-it-runs-on.md) | done | - |
| [03 - A live Claude call says what it runs on](task-03-a-live-claude-call-says-what-it-runs-on.md) | done | - |

## Risks and tradeoffs

- A long command makes a long title; it is sent whole, as claude's transcript does, and the client clips it.

## Resume state

- **Done so far:** every task done 2026-09-28 (`373253e`), approved by Softov; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** pi's `tool_execution_end` has no arguments, so `PiCall` must keep what the call was described as.

## Final verification checklist

- [ ] In ahpapp, a pi, a cofold and a Claude turn draw `ls -la` and `src/a.ts` rather than `bash` and `read`, live and after a reload.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` green; `plans/index.md` updated.
