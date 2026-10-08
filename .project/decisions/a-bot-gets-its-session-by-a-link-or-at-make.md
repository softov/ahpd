---
title: A bot gets its session by a link to one its owner has, or a new one at make
status: accepted
date: 2026-10-07
refs:
  - "[code://packages/sdk/src/types/sessions.ts#L100-L102](../../packages/sdk/src/types/sessions.ts#L100-L102) - a session's owner, which a link is checked against"
---

## Context

Bots are to be tried before the bot harness and before channels exist.
A bot needs a session to talk to.
It can point at a session that exists, or the host can make one when the bot is made.

## Decision

A bot's `session` is a session its maker owns, set on the record.
Without one, the host starts a new session when it makes the bot.
The new session runs the bot's preset, or its harness and model, in its folder or computer.
Its first turn is the bot's instructions.
Talking to the bot is talking in that session.
Source: Softov, 2026-10-07, asked "How does a bot get a session in this first plan, so you can test with it before the harness and channels?", answered "Link one, or make one".

## Consequences

A bot can be tried today with any harness the host runs.
When the bot harness comes, its own session replaces this one, and the record keeps the field.

## Options

- **Link an existing one only**: rejected, a person makes every session by hand.
- **No session yet**: rejected, nothing can be tried until the harness exists.
