---
title: A run is told what woke it, by placeholders and a summary block
status: accepted
date: 2026-10-07
refs:
  - "[code://packages/sdk/src/host/automations.ts#L204](../../packages/sdk/src/host/automations.ts#L204) - the message a run begins with"
---

## Context

An automation woken by an event has to know which session did what.
The protocol carries the event on the run's origin, but the agent reads only its message.

## Decision

The message can name `{{session}}`, `{{sessionTitle}}`, `{{event}}`, `{{count}}`, `{{trigger}}` and `{{at}}`.
The first message of a woken run also ends with a short block that names the event, the session, its title and the time.

Source: Softov, 2026-10-07, asked "How does the run learn what happened?" and chose "Placeholders + a summary block".

## Consequences

- An automation works with a plain message and no placeholders.
- The block names a session and its title, so the run's owner must be allowed to read that session.

## Options

- The summary block only.
- Placeholders only.
