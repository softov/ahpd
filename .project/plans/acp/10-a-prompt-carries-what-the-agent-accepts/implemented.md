---
title: A prompt carries what the agent accepts, and only what it accepts - implemented
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts)"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/agent-acp/src/session.ts](../../../../packages/agent-acp/src/session.ts)"
---

A client's message attachments reach `Session.begin`, and the ACP bridge sends each as the block the server's `promptCapabilities` allow, naming in the text what it cannot take; `additionalDirectories` is sent only to a server that advertises it.

## What was built

- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - `begin(..., attachments?)`; `MessageAttachment` re-exported.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `messageAttachments` reads `Message.attachments` on `chat/turnStarted` and the resume dispatch.
- [`code://packages/agent-acp/src/session.ts`](../../../../packages/agent-acp/src/session.ts) - `blocksFor`: an image block under `image`, a resource block under `embeddedContext` (a `resource` attachment read through the session's store), a simple attachment's `modelRepresentation` as text, anything else `[label]`.
- `agent-acp-blocks.test.ts`, 6 cases; two cases in `sdk/test/sessions.test.ts`.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm boundary` clean, `pnpm test` 162 files and 2394 tests.
- The host rendered no attachments before, so no backend lost a text rendering.

## Departures from the plan

- Review added the `modelRepresentation` text for simple attachments, which the build named only by label.

## Left for later

- See [deferred.md](deferred.md).
