---
title: A textual attachment is inlined up to 64 KiB, and named by path above that
status: accepted
date: 2026-10-06
refs:
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/codex/codexPromptResolver.ts - `renderTextualEmbeddedResource`, the labelled fenced block and the textual types
---

## Context

Pasted text and an unsaved editor arrive as `text/*` embedded resources, which the host now writes to disk.
VS Code's codex path inlines them whole as a labelled fenced block; its Claude path names them.
Inlining a pasted log of any size can fill the context and fail the turn.

## Decision

An attachment the host wrote to disk with a textual type (`text/*`, `application/json`, `application/xml`, `application/javascript`, `application/typescript`, `+json`, `+xml`) and at most 64 KiB is inlined as `<label> (lines a-b):` and a fenced block, as VS Code's codex does.
A larger one is named by path.
A file a user picked from disk is always named by path.

Source: Softov, 2026-10-06, asked "How should pasted text, or the content of an unsaved editor, reach the model?" and chose "Inline up to 64 KiB".

## Consequences

- A pasted snippet is in the prompt; a pasted log is a file the model can read.
- One limit for every backend.

## Options

- Path only: the model reads every pasted snippet with a tool call.
