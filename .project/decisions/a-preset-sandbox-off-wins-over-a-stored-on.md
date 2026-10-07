---
title: A preset that says sandbox off wins over a session stored with it on
status: accepted
date: 2026-10-07
supersedes: decisions/a-stored-sandbox-on-survives-the-preset.md
refs:
  - "[code://packages/agent-claude/src/session.ts#L73](../../packages/agent-claude/src/session.ts#L73) - the stored value is spread after the preset"
  - "[code://packages/agent-claude/src/options.ts#L68-L71](../../packages/agent-claude/src/options.ts#L68-L71) - `storedSandbox`"
---

## Context

A session stored with `sandboxEnabled` on keeps the sandbox on whatever its preset says.
No client can change the stored value, because the session schema has no such key.
So a session that needs the sandbox off can only be edited by hand or deleted.

## Decision

A preset with `sandbox: "off"` wins over a stored `sandboxEnabled` on.
A preset that says nothing about the sandbox leaves a stored on in place.

Source: Softov, 2026-10-07, asked "A session stored with sandboxEnabled 'on' can never be turned off. Which way out?" and chose "Preset off wins".

## Consequences

- The person who configures the preset can turn the sandbox off for every session made from it.
- An upgrade still never runs a session less sandboxed unless a preset says so.

## Options

- Declare `sandboxEnabled` in the session schema again, so a client can switch it.
- Ignore the stored value, so the preset alone decides.
