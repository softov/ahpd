---
title: A chat's activity is only a wait before its turn can run, and a backend names no running tool there
status: accepted
date: 2026-11-05
refs:
  - "[code://packages/agent-claude/src/session.ts#L202-L208](../../packages/agent-claude/src/session.ts#L202-L208) - the Claude backend says no activity"
  - "[code://packages/agent-cofold/src/session.ts#L293-L299](../../packages/agent-cofold/src/session.ts#L293-L299) - the cofold backend says no activity"
  - "[code://packages/agent-cofold/src/mapping.ts](../../packages/agent-cofold/src/mapping.ts) - the cofold mapping, which returns actions only"
  - git://ecc7700a - MayCXC's commit that removes the activity of a thinking turn, a running tool and a question from the Claude, cofold and ACP backends
  - git://51ce3c7a - the commit of main that named each running cofold tool, which the merge leaves out
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L11709-L11724 - VS Code's host sets a chat's activity for a wait before a turn can run
---

## Context

A chat's activity is the one line a client shows beside the chat, such as "Thinking" or "read_file a.txt".

The plan `host/20261104-0534-a-wait-leaves-the-activity-as-it-was` made cofold name each running tool in that line, and say `Thinking` when the tool ends. Its source was "Yes, name every running tool" (Softov, 2026-11-04), and its pattern was the line Claude said for a running tool.

MayCXC's branch `host/20261104-1647-the-backends-follow-the-audit` removes that line from the Claude, cofold and ACP backends. VS Code's host sets the activity only for a wait before a turn can run. A turn's thinking, tools and questions are in its own parts.

A later reader can see a running tool in the parts but not in the chat's row, and put the line back.

## Decision

A chat's activity says only a wait before its turn can run, as VS Code's host says one. The Claude, cofold and ACP backends say no activity while a turn thinks, runs a tool, waits on a client or asks a question.

Source: Softov, 2026-11-05: "VS Code's, no tool activity. make a decision."

## Consequences

A client row shows no tool name while a Claude, cofold or ACP turn runs. The turn's parts show the running tool.

Task 02 of `host/20261104-0534-a-wait-leaves-the-activity-as-it-was` is undone. Its code and its tests are not in the merge of `host/20261104-1647-the-backends-follow-the-audit`.

The pi backend and the example agent in `examples/notes` still say their own activity, and this decision does not change them.

## Options

- **Name the running tool.** Claude and cofold say the tool in the activity, as main did. It shows more in a row, but VS Code shows none, and the reason for cofold's line was that Claude said one.
- **A setting, with VS Code's rule as the default.** Both behaviours stay behind one host setting. It is more code and more tests for a line no reference client draws.
