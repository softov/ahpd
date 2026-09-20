---
title: Claude - what exists today
domain: claude
revalidated: 2026-09-19
---

`packages/agent-claude` (`@ahpd/agent-claude`) is the backend the daemon ships: it implements the `Agent` interface of `packages/sdk` over the Claude Agent SDK, so a session here is an SDK session whose events become chat actions and whose own lists of skills, commands, agents and plugins become the session's customizations.
It is the only package that knows the SDK exists, and the daemon reaches it through the same port a third-party backend would.

## Packages

- `code://packages/agent-claude` - entry point `src/index.ts`; the `Agent` implementation `src/claude.ts`; a session, its event mapping and the translation of an SDK event into a chat action `src/session.ts`; the tool kinds `src/kinds.ts`; the MCP server the agent is given `src/mcp.ts`; the probe `src/probe.ts`; the catalogue `src/catalog.ts`; transcripts `src/transcript.ts`.

## Contracts

- `code://packages/sdk/src/types/agent.ts` - the interface this package implements, and the only contract it shares with the host.
- `code://packages/agent-claude/src/kinds.ts` - the tool kinds stamped on `_meta.toolKind`, which is the one well-known key this package owns.

## Runtime path

```
claude() -> Agent.start() -> a Claude Agent SDK session -> SDK events
  -> src/session.ts maps them to chat actions and tool calls -> host state through the session store
  -> the CLI's skills, commands, agents and plugins become the customizations a window lists
```

## Tests

- `code://test/host.test.ts`, `code://test/conformance.test.ts`, `code://test/wire.test.ts` - the host and the wire, driven with this backend attached.
- `code://test/diagnostics.test.ts`, `code://test/mcp.test.ts`, `code://test/toolauth.test.ts` - the diagnostics, the MCP surface and tool authorization against it.

## Known gaps

- The tools the artifact instruction names are not marked always-loaded, so a CLI with tool search on can defer the very tool the instruction tells the model to call; plan [01 - Host tools and customizations](01-host-tools-and-customizations/plan.md).
- Customizations are three synthesised `directory` containers with invented URIs rather than the reference's plugin and builtin containers, and how far that can be corrected is open in [research: customization attribution](../../research/claude-customization-attribution.md).
- A round that ends with no text and no tool calls is not announced, and whether the SDK exposes such an event is open in [research: the round-ended signal](../../research/response-round-ended-signal.md).
