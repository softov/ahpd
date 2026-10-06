---
title: A pasted image goes to the model as an image when it is jpeg, png, gif or webp and at most 5 MB, and by path otherwise
status: accepted
date: 2026-10-06
refs:
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudePromptResolver.ts - VS Code's Claude path names every attachment by path
  - https://docs.claude.com/en/docs/build-with-claude/vision - the four image types and the 5 MB limit per image
---

## Context

After the host writes an attachment to disk, a backend can name the image's path or send its bytes as an image block.
VS Code's Claude path names it, so the model sees a pasted screenshot only if it calls its read tool.
An image the provider refuses fails the turn, and stays in the conversation the next turn sends again.

## Decision

An image attachment whose type is `image/jpeg`, `image/png`, `image/gif` or `image/webp` and whose file is at most 5 MB is sent as an image: an image block in Claude, `images` in pi, an image part in cofold when the model's `features.images` is true, and an image block in ACP when the server's `promptCapabilities.image` is true.
Anything else is named by path.

Source: Softov, 2026-10-06, asked "How should a pasted image reach the model?" and chose "Image block when it fits".

## Consequences

- A pasted screenshot is seen in the same turn, with no tool call.
- A backend never sends an image its model or provider would refuse, so the conversation is never left holding one.
- This differs from VS Code's Claude path, which names every image.

## Options

- Path only, as VS Code: simplest and never refused, but the model may not look.
