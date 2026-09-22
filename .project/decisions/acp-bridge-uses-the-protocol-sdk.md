---
title: The ACP bridge uses the published protocol SDK
status: accepted
date: 2026-09-22
refs:
  - npm://@agentclientprotocol/sdk@^1.4.0 - the schema and the connection the bridge will use
  - file:///github/deepseek-harness/packages/acp/acp/package.json - the ACP server that pins the same SDK at 1.4.0
  - code://.project/plans/plugin/07-agent-acp/plan.md - the plan this decides the shape of
  - code://packages/agent-claude/package.json - the backend that already takes a runtime SDK as a dependency
---

## Context

`@ahpd/agent-acp` speaks the Agent Client Protocol to a backend command over stdio.
The protocol is typed JSON-RPC: a client interface of `sessionUpdate`, `requestPermission`, `readTextFile`, `writeTextFile` and `createTerminal`, and an agent interface of `initialize`, `newSession`, `loadSession`, `prompt`, `cancel` and the session mode and config setters, with the `SessionUpdate` union already at sixteen variants.
A hand-written bridge would restate that schema and drift from it at every revision.

`@ahpd/agent-claude` already depends on its runtime's own SDK rather than re-declaring its messages, so a dependency on a protocol SDK is the established shape here.

## Decision

The package depends on `@agentclientprotocol/sdk` at `^1.4.0`, the line `@deepseek-ai/dsh-acp` pins, and uses its typed client and agent connections rather than a hand-written JSON-RPC layer.
The version is a range because the schema is additive and the servers this targets ship independently.

Source: the user, 2026-09-22, choosing "Depend on `@agentclientprotocol/sdk`" over hand-rolling the stdio JSON-RPC.

## Consequences

`packages/agent-acp/package.json` gains the dependency, and the lockfile moves.
The ACP client interface the bridge implements is checked against the SDK's own interface, so a variant added upstream is a type error here rather than a silently ignored message.
`@deepseek-ai/dsh-acp` is the server the tests run against, and it pins `1.4.0`, so the range has to stay satisfied by that version.
The workspace had no ACP dependency at all before this, so this is also the first package whose runtime counterpart is a separate program rather than an imported library.

## Options

- **Depend on `@agentclientprotocol/sdk`**, which is the direction taken.
- **Hand-roll the stdio JSON-RPC** over the methods and update variants the bridge maps.
  Rejected: it duplicates a published, typed schema and would silently miss any variant the bridge does not name.
