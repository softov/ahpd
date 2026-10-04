---
title: A Claude tool call's toolInput is its whole input, and invocationMessage stays the short line
domain: claude
status: built
priority: high
created: 2026-09-29
revalidated: 2026-09-29
requires: []
refs:
  - "[code://packages/agent-claude/src/input.ts#L23-L36](../../../../packages/agent-claude/src/input.ts#L23-L36) - `summarize`: any tool without its own summary is `JSON.stringify(input).slice(0, 400)`"
  - "[code://packages/agent-claude/src/session.ts#L1737](../../../../packages/agent-claude/src/session.ts#L1737) - the live call puts that summary in `toolInput` too"
  - "[code://packages/agent-claude/src/transcript.ts#L361](../../../../packages/agent-claude/src/transcript.ts#L361) - the same cut on restored calls"
  - https://github.com/microsoft/agent-host-protocol - `ToolCallParameterFields.toolInput`: "Final tool input"
---

## Goal

A client reads a Claude tool call's complete input from `toolInput`, live and restored, so it can parse it; the row's text stays short.

## Reconnaissance

### Runtime path

```
tool_use input -> summarize (cut at 400 for unknown tools) -> invocationMessage and toolInput -> client
```

### Gaps

- `toolInput` carries the display summary, cut at 400 characters for any tool without its own summary, so a client cannot parse it.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `toolInput` is the whole input as JSON, uncut; Bash keeps its command, since a terminal row reads the command there; `invocationMessage` stays the summary | Softov, 2026-09-29, after the input was cut and could not be parsed, asked "What goes in toolInput?": "The full input as JSON" | 01 |
| A tool with no summary of its own has a row line of its display name plus a subject where one is obvious (AskUserQuestion's first question, WebFetch's `url`, an MCP tool's first string argument), otherwise the display name alone; never cut JSON | Softov, 2026-09-30, after the row line read as 400 characters of cut JSON, asked how it should read: "Name plus a subject" | 02 |
| A confirmation that arrives while its call streams gives the held call the whole `toolInput` and drops `partialInput` | Softov, 2026-09-30, asked "fix it in claude/08 before it is committed?": "Add to claude/08" | 03 |
| A row's `invocationMessage` and `pastTenseMessage` are the call's `description` when it has one; otherwise VS Code's line for a tool VS Code maps (Bash: ``Running `<first line, 80 chars>` `` / ``Ran `…` ``); otherwise task 02's name plus a subject | Softov, 2026-09-30, shown VS Code's Bash wording and asked "Should ahpd's Claude tool rows use VS Code's wording?": "Description first.. if none.. match vscode.. info already present in toolInput to format like client intent.. plan it then implement" | 04 |
| The description is used for the past tense too, and the task lives in claude/08, which is uncommitted and owns the row line | (defaulted: a row that changes from the description to a command when it ends loses what it was for) | 04 |
| "The call's description" is the `description` of Bash, Task, Agent and Monitor only, where the SDK documents it as describing the call; TaskCreate, TaskUpdate and MCP tools follow VS Code's line or name plus subject | Softov, 2026-09-30, asked "which tools' `description` counts as 'the call's description'?": "Only where it describes the call" | 04 |
| A failed call's past tense is the same line as a successful one; the failure shows through `success: false`, not VS Code's `"<display name>" failed` | Softov, 2026-09-30, asked "a failed call's past tense ... What should ours read?": "Description, failure shown elsewhere" | 04 |
| The confirmation card's `invocationMessage` follows the same rule as the row, replacing the CLI's own title | Softov, 2026-09-30, asked "Should [the confirmation card] follow the same rule?": "Same rule" | 04 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - toolInput is the whole input](task-01-tool-input-is-the-whole-input.md) | done | - |
| [02 - A row line is never cut JSON](task-02-a-row-line-is-never-cut-json.md) | done | 01 |
| [03 - A confirmation during streaming carries the input](task-03-a-confirmation-during-streaming-carries-the-input.md) | done | 01 |
| [04 - A row reads the call's description, or VS Code's line when it has none](task-04-a-row-reads-the-calls-description-or-vs-codes-line.md) | done | 02 |

## Resume state

- **Done so far:** built 2026-10-03, see [implemented.md](implemented.md).

## Final verification checklist

- [x] A live and a restored call of a tool with a long input carry it whole in `toolInput`.
- [x] An AskUserQuestion row reads its first question, not JSON.
- [x] A call confirmed while it streamed shows its arguments to a client that subscribes after.
- [x] A Bash row reads its description, and without one ``Running `<first line>` ``.
- [x] `plans/index.md` updated.
