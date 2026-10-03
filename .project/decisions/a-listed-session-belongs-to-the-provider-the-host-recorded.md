---
title: A session two harnesses both list belongs to the provider the host recorded for it
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/host.ts#L3897-L3940](../../packages/sdk/src/host.ts#L3897-L3940) - `listing()`, which publishes every agent's rows"
  - "[code://packages/agent-claude/src/claude.ts#L438](../../packages/agent-claude/src/claude.ts#L438) - Claude's `list()`, which reads every transcript under `~/.claude/projects`"
---

## Context

Claude loaded twice (claude/12) gives two harnesses that read the same transcripts, so every session is listed once per harness, and reopening one under the wrong harness resumes it on the other's endpoint and key.
A transcript does not say which harness wrote it; only the host knows, at the moment a session is created or resumed.

## Decision

The host's session store records the provider a session runs on, and the listing gives each id to one provider: the recorded one when it is loaded, else the first loaded harness that lists it.
The fix is in the host, so any two plugins that share a store are told apart, and agent-claude keeps loading once per harness.
Source: Softov, 2026-10-02, asked "Two Claude harnesses list the same transcripts, so each session shows twice... What goes on top?": "host dedupe now... add a proposal of presets as harness". The first-loaded fallback is (defaulted: a session from before this, or one whose harness was removed, still opens somewhere).

## Consequences

A session made before this is recorded is listed under the first loaded harness until it is resumed under another.
Presets that are harnesses, one agent-claude load for all of them, are claude/15: [one load, each preset a variant](../plans/claude/15-one-load-and-each-preset-is-a-variant/plan.md).

## Options

- **One agent-claude load whose presets are harnesses**: not now, kept as the proposal above; it would still need the recorded provider to assign a transcript.
