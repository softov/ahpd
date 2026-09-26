---
title: A plugin hears a session's input needed set and removed, although a client receives the same actions
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/sdk/src/types/events.ts#L18-L24](../../packages/sdk/src/types/events.ts#L18-L24) - the rule this bends: an event that only repeats a state action a client already receives is refused"
  - "[code://packages/sdk/src/host.ts#L2992-L3007](../../packages/sdk/src/host.ts#L2992-L3007) - `emit`, where `turn_start` and `turn_end` already repeat `chat/turnStarted` and `chat/turnComplete`"
  - "[code://.project/decisions/plugin-events-are-observed-not-answered.md](plugin-events-are-observed-not-answered.md) - why an in-process client is not the only route to what a plugin observes"
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/session-channel.md#aggregated-input-requests - `session/inputNeededSet` and `session/inputNeededRemoved`, the roll-up of every block across a session's chats
---

## Context

A plugin that tells a person their session is waiting on them has to know two moments: a session started waiting, and it stopped.
The host knows both, because every backend reports them as `session/inputNeededSet` and `session/inputNeededRemoved` through the host's `emit`.
The event file says an event that only repeats a state action a client already receives is refused, so the moment is not an event.

The rule is already bent.
`turn_start` and `turn_end` are raised in the same `emit`, from `chat/turnStarted`, `chat/turnComplete` and `chat/turnCancelled`, which every subscribed client also receives.
They were added because a plugin wanted a turn's two ends without subscribing to every chat, which is the same need.

## Decision

The host raises `input_needed_set` and `input_needed_removed` where a backend's `session/inputNeededSet` and `session/inputNeededRemoved` pass through `emit`.
The names follow the spec's actions, the way `turn_start` and `turn_end` follow the turn's.
The rule in the event file changes to what it now means: an event that repeats a state action is added only for a moment a plugin acts on without watching the session, and never for a per-token delta.

Source: Softov, 2026-09-26, accepted this when it was proposed in answer to his brief.

## Consequences

A notifier is a few lines over `on`, and does not wait on how a plugin acts as a client.
The event union grows by two, which is a change to `@ahpd/sdk`.
The payload carries what the spec's entry carries: the session, the chat and the request's identifiers, so a plugin can say which session and link to it.
Who started the session, and whether a client is watching it, are not on the event; a notifier that wants either waits on a later plan.

## Options

- **Keep the rule and have a notifier be a client of its own daemon.** Rejected: it ties the smallest plugin to the undecided question of how a plugin acts as a client, and a client subscribes to every session to learn one bit per session.
- **One `input_needed` event carrying a boolean.** Rejected: the spec has two actions, and a handler that switches on a flag is two handlers written as one.
