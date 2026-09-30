---
title: A Claude option is declared once, and both the session schema and the preset schema are made from it
status: accepted
date: 2026-09-29
refs:
  - "[code://packages/agent-claude/src/claude.ts#L151-L332](../../packages/agent-claude/src/claude.ts#L151-L332) - `schema()` and `defaults()`, one literal per key"
  - "[code://packages/agent-claude/src/session.ts#L2009-L2153](../../packages/agent-claude/src/session.ts#L2009-L2153) - the `query()` call, where each value becomes an SDK option"
---

## Context

A preset is a named set of Claude options an operator writes in agent-claude's options.
The fields a preset holds (sandbox, thinking, output style) are today session keys, each with a schema literal in `schema()` and its own translation into `query()` options in `session.ts`.

## Decision

Each Claude option is one declaration: its JSON schema and how its value becomes `query()` options.
The preset schema lists them by name, a session key is made from the same declaration, and a value from a preset or from a session goes through the same translation.
A preset holds only declared fields; a new SDK option is a new declaration.

Source: Softov, 2026-09-29, asked "What can a Claude preset hold?": "Names fields... but could reuse something for structure of then... since parser etc are mostly the same for config params like those."

## Consequences

Moving a key between the composer and a preset is changing where it is listed, not rewriting it.
Every preset value is checked when the plugin loads.

## Options

- **Any `query()` option, spread in**: no ahpd change for a new SDK option, but nothing checks it and it can override what ahpd sets itself.
- **Named fields written separately from the session keys**: two schemas and two translations for one option.
