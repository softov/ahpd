---
title: A plugin gets frozen copies of the host's values, never the host's own objects
status: accepted
date: 2026-10-08
refs:
  - "[code://packages/sdk/src/users.ts#L782-L810](../../packages/sdk/src/users.ts#L782-L810) - a principal is a plain writable object, and providers get the live one"
  - "[code://packages/sdk/src/host/spawn.ts#L468](../../packages/sdk/src/host/spawn.ts#L468) - an agent gets the host's own file store"
  - "[code://packages/sdk/src/plugins.ts#L381-L402](../../packages/sdk/src/plugins.ts#L381-L402) - the fold keeps the plugin's trigger object live"
---

## Context

Plugins run in the daemon's process, and every value the host hands one goes by reference.
Nothing is frozen today.
A plugin can change a principal that the gate checks, or another plugin's session-config schema.
It can change a host tool's definition, an MCP server's credentials, or the trigger types after the fold.
Softov, 2026-10-08: "a plugin cannot modify parent info."

## Decision

Every value the host hands a plugin is a copy that the host made and froze.
Every value a plugin hands the host, and the host keeps, is such a copy too.
The host never hands a plugin an object it reads again later.
Where the host must write onto something a plugin holds, it keeps its own record beside it instead.
Source: Softov, 2026-10-08, "a plugin cannot modify parent info", and his answer "Survey, then plan" to "How do we take on the plugin boundary?".

## Consequences

A plugin that writes to a value it was given throws, because ESM code is strict, so the mistake shows at once.
The host pays for one copy per crossing; the hot paths (principals, events) are small objects.
This guards host state against a plugin's writes.
It is not a sandbox: in-process code can still import `fs` or read `process.env`, so installing a plugin still means trusting it.

## Options

- **Freeze the host's own objects in place**: lost, because the host itself writes many of them later (`deliver` on triggers, the session record's `additional`).
- **Plain copies, not frozen**: lost, because a plugin's write then goes nowhere and nobody sees the bug.
- **Read-only proxies**: lost, more code and a cost on every read for the same result.
- **Run plugins out of process**: not taken now. It is the only real trust boundary, and a much larger change for a separate plan.
