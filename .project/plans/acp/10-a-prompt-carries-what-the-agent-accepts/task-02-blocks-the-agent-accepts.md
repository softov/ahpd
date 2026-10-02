---
title: Blocks the agent accepts
status: done
depends: [task-01-begin-carries-attachments.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/connection.ts#L154-L157](../../../../packages/agent-acp/src/connection.ts#L154-L157) - `prompt`"
  - "[code://packages/agent-acp/src/session.ts#L527-L529](../../../../packages/agent-acp/src/session.ts#L527-L529) - the directories"
---

## Objective

Images become image blocks when `promptCapabilities.image`, files become resource blocks when `embeddedContext`, and `additionalDirectories` is sent only when `sessionCapabilities.additionalDirectories` is advertised.

## Files

- `UPDATE: packages/agent-acp/src/connection.ts:154-157`.
- `UPDATE: packages/agent-acp/src/session.ts:527-529`.

## Steps

1. Keep the handshake's `promptCapabilities`.

## Validation

- A fixture without image support gets the image named in text.
- Directories are not sent to a fixture that does not advertise them.

## Resume
