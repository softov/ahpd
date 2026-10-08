---
title: Bot records live in a bot plugin, the way computers do
status: accepted
date: 2026-10-07
refs:
  - "[code://packages/computer/src/plugin.ts#L1053](../../packages/computer/src/plugin.ts#L1053) - the computer plugin registers `computer:`, the pattern this follows"
  - "[code://packages/server/src/commands/run.ts#L546-L549](../../packages/server/src/commands/run.ts#L546-L549) - the host-owned schemes, the option not taken"
---

## Context

A bot is a record a person makes, edits and deletes, with a slug, a body, a colour, an owner and a session.
Later a bot also gets a harness that wakes it.
The records can live in the host, beside `people:` and `policy:`, or in a plugin, beside `computer:`.

## Decision

`bot:` is served by a plugin, `@ahpd/bot` in `packages/bot`, which keeps its records in its own file store.
The bot harness joins the same package later.
Source: Softov, 2026-10-07, asked "Where does the bot:/ record provider live in ahpd?", answered "Plugin @ahpd/bot".

## Consequences

The host can run without bots, and a host that turns the plugin off has no `bot:` scheme.
The grants `bot:read` and `bot:write` need no edit to the host's grant table.
A scheme the table does not name takes the resource operations, as `computer:` does.
A bot as a principal, with roles and memberships, needs the host later; that plan adds a seam to the host, not the records.

## Options

- **Host-owned, like `people:`**: rejected, the harness then lives in a different package from the records it reads.
