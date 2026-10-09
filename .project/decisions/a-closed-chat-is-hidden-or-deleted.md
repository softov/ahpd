---
title: A closed chat's conversation is hidden by default, and deleted only when the daemon is told to
status: accepted
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L750-L799](../../packages/sdk/src/host/sessionmethods.ts#L750-L799) - `disposeChat`, where a chat leaves the session"
  - "[code://packages/sdk/src/host/chatrecord.ts#L142-L176](../../packages/sdk/src/host/chatrecord.ts#L142-L176) - `dropChat`, which marks the row closed or drops it"
  - "[code://packages/sdk/src/host/lifecycle.ts#L343-L363](../../packages/sdk/src/host/lifecycle.ts#L343-L363) - `deleted`, the `Agent.delete` call a disposed session goes through"
  - "[code://packages/sdk/src/types/sessions.ts#L47-L73](../../packages/sdk/src/types/sessions.ts#L47-L73) - `StoredChat`, whose `closed` mark carries the claim"
---

## Context

A chat of a session is a conversation of its own, and a client that closes one drops it from the session.
What the backend holds of that conversation is a separate question: the chat is gone from every list either way, and the conversation is a transcript the backend keeps under an id this host chose or the backend minted.
Two answers both work, and they differ in what a client that closed a tab by mistake can get back.

## Decision

Closing a chat keeps the conversation in the backend by default, and this host keeps claiming the chat's backend id, so the conversation is never listed as a session of its own.
A daemon set to `delete` asks the backend to remove the conversation instead, through the same `Agent.delete` call a disposed session goes through.

Source: Softov, 2026-10-09, asked "host/50: when a client closes one chat of a session, what happens to that chat's conversation in the backend?": "configurable with default to keep hidden".

## Consequences

Under the default, a backend accumulates conversations nothing lists, and each one is a row in the store marked closed.
The mark is what carries the claim across a restart, so the record is read for it before anything is listed.
Under `delete`, the claim goes with the row, and a backend that cannot delete keeps the conversation and says so in the log.

## Options

- **Delete always**: a client that closed the wrong tab destroys a conversation. The backend's copy is the only one there is.
- **Hide always**: an operator with a backend whose store must not grow has no way to have a closed chat's conversation removed.
