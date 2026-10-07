---
title: A trigger rule is one event with an optional count, follow-up and state check
status: accepted
date: 2026-10-07
refs:
  - "[code://packages/sdk/src/automations.ts#L94](../../packages/sdk/src/automations.ts#L94) - the store lists no event triggers today"
---

## Context

An automation can wake on a pattern in a session, not only on one event.
Softov named four patterns: a count, a follow-up, a missing follow-up, and a check on the session.

## Decision

A rule is one event, plus an optional count over a window, an optional follow-up after a delay, and optional state checks.
The follow-up is an event, a quiet period, or the absence of an event.
A JavaScript predicate is an idea for later, not part of this shape.

Source: Softov, 2026-10-07, asked "How expressive is a trigger rule?" and chose "fixed shape, and as a future idea a js predicate".

## Consequences

- A client can draw every rule as a form.
- A rule that needs a sequence of three or more steps does not fit, and waits for the predicate idea.

## Options

- A list of steps of any length: more power, a harder form, more rules that never fire.
- An expression language or a JavaScript predicate: most power, but it needs a sandbox and is not a form.
