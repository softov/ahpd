---
title: A cofold session's memory is per workspace, shared by the sessions in it
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-cofold/src/capabilities.ts#L109-L111](../../packages/agent-cofold/src/capabilities.ts#L109-L111) - memory under `<store root>/memory/<workspace slug>/`"
  - "file:///github/cofold/packages/tools/src/memory.ts - `memory`, which carries the head of `MEMORY.md` into every run's instructions"
---

## Context

Memory lives under `<store root>/memory/<workspace slug>/`, so every session opened in one folder reads and writes the same files.
The head of `MEMORY.md` is in every run's instructions, so what one session writes there is read by the next.

## Decision

Memory stays per workspace, under `<store root>/memory/<workspace slug>/`, as papo keeps it.
Source: Softov, 2026-09-26, asked "Memory scope: (a) per workspace, as now. (b) per session. (c) per workspace, but with memory off by default.": "per workspace".

## Consequences

A fact a session learns about a project is there for the next session in it, which is what memory is for.
Anything written to memory, by a person or a model, reaches every later session in that folder through the instructions.

## Options

- **Per session.** Nothing carries between sessions, which is what memory exists to do.
- **Per workspace, off by default.** Safer, but a session would not have the four tools the plan's goal names.
