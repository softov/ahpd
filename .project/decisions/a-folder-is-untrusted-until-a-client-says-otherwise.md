---
title: A folder is untrusted until a client has pushed workspaceTrust saying otherwise
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/sdk/src/host/gate.ts#L289-L302](../../packages/sdk/src/host/gate.ts#L289-L302) - `PER_CONNECTION`, where host/66 keeps the value"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/codex/codexAgent.ts#L8074-L8077 - no value is untrusted, `enabled: false` is trusted
---

## Context

host/66 has a session load a folder's project hooks, settings, plugins, MCP servers and `CLAUDE.md` only when the folder is trusted, and trust is the `workspaceTrust` value a client pushes into root config.
VS Code pushes it on every connect; ahpc, ahpapp and the HTTP API do not, and an automation has no client at all.
VS Code's own host reads a missing value as untrusted.

## Decision

A folder is trusted only under a pushed `workspaceTrust` that trusts it (`enabled: false`, or a trusted URI that is the folder or its parent).
No value means untrusted.
An automation's session reads no value and is untrusted `(defaulted: the host keeps trust per connection, not per person, so an automation has no value to read)`.

Source: Softov, 2026-10-06, asked "When no client has pushed workspaceTrust (ahpc, ahpapp, automations), is a folder trusted?" and chose "Untrusted, as VS Code".

## Consequences

- A session started from ahpc or ahpapp loads no project hooks, settings, plugins, MCP servers or `CLAUDE.md` until that client pushes `workspaceTrust`; until their own plans land, those clients behave differently from today.
- An automation never loads a project's files.
- A daemon reached only through the HTTP API is the same.

## Options

- **No value means trust is not enforced, as today.** Lost: a client that says nothing would open every folder, and Softov chose VS Code's reading.
