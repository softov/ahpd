---
title: A nested session's chat URIs are rewritten to the outer ones
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/nested.ts#L295-L332](../../packages/sdk/src/nested.ts#L295-L332) - `pump`, which emits every inner action unchanged"
  - "[code://packages/sdk/src/nested.ts#L233](../../packages/sdk/src/nested.ts#L233) - `innerChat`, the inner host's default chat URI"
  - "[code://.project/decisions/a-session-reaches-a-nested-host-through-a-generic-proxy.md](a-session-reaches-a-nested-host-through-a-generic-proxy.md) - the proxy presents the inner session as an outer one"
---

## Context

The proxy re-emits every inner session action on the outer session channel as it arrived.
Actions on the session channel name chats by URI, and the inner host names them with its own: its default chat is `ahp-chat://default/<base64 of the inner session URI>`, and a subagent chat is named under the inner session.
Driven against a real inner `ahpd --stdio`, 5 of the 11 `session/chatUpdated` actions a client received named the inner default chat, a channel that does not exist on the outer host.

## Decision

The proxy rewrites every inner chat URI to the outer one before it emits an action: the inner default chat becomes the session's `chatUri`, and any other inner chat becomes an outer chat URI the proxy names and serves.
Source: Softov, 2026-09-26, asked "Inner chat URIs: should the proxy (a) rewrite inner chat URIs to outer ones, (b) drop inner chat-list actions and let the outer host own the list, or (c) forward subagent chats as real outer chats?": "the proxy rewrites them to outer ones".

## Consequences

A client never sees a chat URI it cannot subscribe to.
The proxy keeps a map from inner chat URIs to outer ones, and rewrites every field that carries one (`chat`, `resource`, and a subagent chat's origin).
An inner chat other than the default needs its own outer subscription and its actions forwarded on the outer chat's channel, which the `Session` emit does not address today.

## Options

- **Drop inner chat-list actions and let the outer host own the list.** Simpler, and the outer host already announces its own default chat, but inner subagent chats would vanish.
- **Forward subagent chats as real outer chats through the host's `subagent` seam.** Reuses `openSubagent`, but ties the proxy to one kind of chat and still leaves the default chat's URI to rewrite.
