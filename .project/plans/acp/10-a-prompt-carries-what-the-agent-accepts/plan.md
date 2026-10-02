---
title: A prompt carries what the agent accepts, and only what it accepts
domain: acp
status: built
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-acp/src/connection.ts#L154-L157](../../../../packages/agent-acp/src/connection.ts#L154-L157) - `prompt` sends one text block"
  - "[code://packages/agent-acp/src/session.ts#L527-L529](../../../../packages/agent-acp/src/session.ts#L527-L529) - `additionalDirectories` sent without checking the capability"
  - "[code://packages/sdk/src/types/session.ts#L345](../../../../packages/sdk/src/types/session.ts#L345) - `begin(turnId, text, ...)`, which carries no attachments"
  - "[code://packages/sdk/src/host.ts#L6188](../../../../packages/sdk/src/host.ts#L6188) - where the host reads a message's attachments"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `Message.attachments`
---

## Goal

A message's image and file attachments reach an ACP agent as image and resource blocks when its `promptCapabilities` allow them, and extra directories are sent only to an agent that advertises them.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Gaps

- `begin` carries text only, so attachments never reach a backend.
- `additionalDirectories` is sent to every agent.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| An attachment the agent cannot take is named in the text rather than dropped | (defaulted: the agent still knows it exists) | 02 |

## Proposed architecture

- **Layer responsibilities** - `@ahpd/sdk`: `begin` carries attachments · `@ahpd/agent-acp`: blocks and the capability check.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - begin carries a message's attachments](task-01-begin-carries-attachments.md) | done | - |
| [02 - Blocks the agent accepts](task-02-blocks-the-agent-accepts.md) | done | 01 |

## Risks and tradeoffs

- Large images inflate a frame - the SDK frames by line, and a size cap is plan 12's concern.

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md).

## Final verification checklist

- [x] An image reaches an agent that takes images.
- [x] `pnpm test`, `pnpm typecheck` green.
- [x] `plans/index.md` updated.
