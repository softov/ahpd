---
title: A session stored with the sandbox on keeps it on, whatever its preset says
status: superseded
superseded-by: decisions/a-preset-sandbox-off-wins-over-a-stored-on.md
date: 2026-10-06
refs:
  - "[code://packages/agent-claude/src/session.ts#L73](../../packages/agent-claude/src/session.ts#L73) - a session's values are the option defaults and its preset, nothing stored"
  - "[code://packages/agent-claude/src/options.ts#L46-L54](../../packages/agent-claude/src/options.ts#L46-L54) - `sandbox`, `on` becomes `settings.sandbox.enabled: true`"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L438-L466](../../packages/sdk/src/host/sessionconfig.ts#L438-L466) - `storedConfig`, which keeps an undeclared stored key"
---

## Context

claude/10 task 03 took `sandboxEnabled` off the session schema; the sandbox now comes only from the preset.
A session someone switched to Sandbox On before that change still has `sandboxEnabled: 'on'` in its stored config (the old control was the enum `default`, `on`, `off`), and host/31 keeps the key, but nothing reads it, so the session resumes unsandboxed unless its preset says `sandbox: 'on'`.

## Decision

On resume, a stored `sandboxEnabled` of `'on'` (or `true`) turns the CLI's sandbox on, as the preset's `sandbox: 'on'` would.
A stored `'off'`, `'default'`, `false` or no value changes nothing: the preset decides, as claude/10 says.
No session becomes weaker by upgrading.

Source: Softov, 2026-10-06, asked "claude/10: an old session switched to Sandbox On resumes unsandboxed unless its preset says sandbox on. Keep that?" and chose "Honour the stored value".

## Consequences

- A stored key the schema no longer declares still has one effect, and only in the safe direction.
- There is still no control to turn it off for such a session; a new session is the way out.

## Options

- **Keep as planned:** only the preset decides. Lost: an upgrade silently runs a sandboxed session's shell commands unsandboxed.
