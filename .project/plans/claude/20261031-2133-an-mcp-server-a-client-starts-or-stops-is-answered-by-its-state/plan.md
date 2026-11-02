---
title: An MCP server a client starts or stops is answered by its state
domain: claude
status: built
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
refs:
  - git://08b1d57a - the commit of ahpd this plan was checked at
  - "[code://packages/agent-claude/src/session/servers.ts#L455-L469](../../../../packages/agent-claude/src/session/servers.ts#L455-L469) - `startMcpServer`: the request said with the client's origin, then `reconnectMcpServer`, and false when it throws"
  - "[code://packages/agent-claude/src/session/servers.ts#L509-L523](../../../../packages/agent-claude/src/session/servers.ts#L509-L523) - `stopMcpServer`: the request said, then `toggleMcpServer(false)`, and false when it throws"
  - "[code://packages/agent-claude/src/session/servers.ts#L136-L221](../../../../packages/agent-claude/src/session/servers.ts#L136-L221) - `refreshMcp` says a server's state when it differs from the entry the session holds, and the held entry never took the request's effect"
  - "[code://packages/agent-claude/src/session/servers.ts#L407-L444](../../../../packages/agent-claude/src/session/servers.ts#L407-L444) - `setCustomizationEnabled`: a switch on lifts the CLI's disabled flag, then reconnects a server that was not ready"
  - "[code://packages/agent-claude/src/session/customizations.ts#L431](../../../../packages/agent-claude/src/session/customizations.ts#L431) - a server the CLI reports `disabled` reads switched off"
  - "[code://packages/sdk/src/host/chatactions.ts#L1422-L1431](../../../../packages/sdk/src/host/chatactions.ts#L1422-L1431) - the host refuses a start or a stop the backend answers false"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/mcp.md#L48-L51 - a start and a stop manage the process without changing the customization's enabled intent; after a start the host follows with `session/mcpServerStateChanged`"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/reducer.ts#L458-L479 - the reducer moves a server a client starts to `starting`, and one it stops to `stopped`, clearing its `channel`"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L23-L30 - a client holds its action until an envelope with its own origin, or a rejection, answers it"
---

## Goal

A client's `session/mcpServerStartRequested` and `session/mcpServerStopRequested` on a Claude session are each answered once, by the request said with the client's origin, and followed by the state the CLI reports for the server, whether or not it moved; a stop leaves the server's enablement as it was, and a start of a server a stop switched off switches it back on before it reconnects.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "startMcpServer|stopMcpServer" packages/*/src` - the Claude backend is the one that serves both; every other backend answers false before saying anything, and the nested proxy hands the request to the host inside.
- `rg "toggleMcpServer|reconnectMcpServer" packages/agent-claude/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` - the SDK's two calls, both "Throws on failure"; a stop is `toggleMcpServer(name, false)`, the CLI's own disabled flag.
- `rg "mcpServerStartRequested" packages/sdk/test` - `host-harness.test.ts` drives the dedicated start and stop through the host and the fake SDK.

### Gaps

- A start of a server that comes back as it was is followed by nothing, so every client keeps it `starting`.
- A start or a stop whose CLI call throws is refused after the request was said with the client's origin: two answers to one action.
- A stop switches the server off in every client, since the CLI reports `disabled` and that reads as the enablement.
- A start after a stop reconnects a server the CLI holds disabled.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The held entry takes each request's effect as it is said, so the refresh after the CLI call follows with the CLI's state | the reducer's start and stop cases; the guide's "follows with `session/mcpServerStateChanged`" | 01 |
| Once said, a request is answered by the state that follows, and false is the answer only for an id that names no server | reconciliation: one envelope with the client's origin answers it | 01 |
| A server switched off to serve a stop keeps the enablement it had and reads `stopped` | the guide: start and stop leave the enabled intent alone | 02 |
| A start of such a server lifts the CLI's disabled flag before it reconnects, as a switch on does; a switch of it is the client's decision | `setCustomizationEnabled` | 02 |

## Proposed architecture

- **Event flow** - a client's start or stop reaches the Claude session, which says the request with the client's origin and gives its own entry the request's effect; the CLI call follows, and the refresh says whatever the CLI then reports for the server.
- **Layer responsibilities** - the Claude backend: the request's effect, the CLI calls and the state after them; the host keeps refusing a request the backend answers false, which is now one that named no server.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/servers.ts`](../../../../packages/agent-claude/src/session/servers.ts), [`code://packages/agent-claude/src/session/customizations.ts`](../../../../packages/agent-claude/src/session/customizations.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A start or a stop is answered once and followed by the state](task-01-a-start-or-a-stop-is-followed-by-the-state.md) | done | - |
| [02 - A stop keeps the enablement, and a start after it switches the server on](task-02-a-stop-keeps-the-enablement.md) | done | 01 |

## Risks and tradeoffs

- none.

## Resume state

- **Done so far:** planned and built 2026-10-31. See [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a server the CLI reports `failed` reads switched off as well; that reading is left as it is here.

## Final verification checklist

- [x] Each new case fails on `08b1d57a` for the reason it names, and passes after the change.
- [x] The touched suites pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors.
