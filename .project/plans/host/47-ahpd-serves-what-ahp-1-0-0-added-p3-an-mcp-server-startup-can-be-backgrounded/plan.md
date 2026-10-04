---
title: A blocking MCP server startup can be sent to the background
domain: host
status: planned
priority: low
created: 2026-10-03
revalidated: 2026-10-04
requires:
  - plans/host/47-ahpd-serves-what-ahp-1-0-0-added/plan.md
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L890-L899](../../../../packages/sdk/src/host/chatactions.ts#L890-L899) - `session/mcpServerStartRequested` and `StopRequested`, handed to the session's backend"
  - "[code://packages/sdk/src/host/chatactions.ts#L1126-L1127](../../../../packages/sdk/src/host/chatactions.ts#L1126-L1127) - where `session/mcpServerBackgroundRequested` lands today: `is not served yet`"
  - "[code://packages/sdk/src/host/gate.ts#L232-L242](../../../../packages/sdk/src/host/gate.ts#L232-L242) - `ACTION_HOMES`: a `session/` action needs `session:write`"
  - "[code://packages/sdk/src/types/session.ts#L513-L516](../../../../packages/sdk/src/types/session.ts#L513-L516) - `startMcpServer` and `stopMcpServer` on `Session`"
  - "[code://packages/sdk/src/nested.ts#L498-L505](../../../../packages/sdk/src/nested.ts#L498-L505) - a nested host forwards start and stop to its inner host"
  - "[code://packages/agent-claude/src/session.ts#L405-L428](../../../../packages/agent-claude/src/session.ts#L405-L428) - the CLI's MCP status as a protocol state, `{ kind: 'starting' }` with no `blocking`"
  - "[code://packages/agent-claude/src/session.ts#L3293-L3305](../../../../packages/agent-claude/src/session.ts#L3293-L3305) - `startMcpServer`: the backend emits the action, then the state, the shape a background call copies"
  - "[code://packages/agent-acp/src/session.ts#L2046](../../../../packages/agent-acp/src/session.ts#L2046) - ACP, like pi and cofold, starts no MCP server it could report"
  - "[code://packages/sdk/test/host-harness.test.ts#L483-L585](../../../../packages/sdk/test/host-harness.test.ts#L483-L585) - `turning a customization on and off`, with the Claude backend's MCP servers on a fake SDK"
  - "npm://@anthropic-ai/claude-agent-sdk@^0.3.278 - MCP startup \"is otherwise non-blocking by default\"; only a server with `alwaysLoad` blocks, for at most the 5s connect timeout, and the SDK has no call to move a startup to the background (`sdk.d.ts:1120-1123`)"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `McpServerStartingState.blocking`, which a host SHOULD set while a startup holds new messages back (`channels-session/state.ts:1382-1395`); `session/mcpServerBackgroundRequested`, client-dispatchable, reducer sets `blocking: false` only on a `starting` server with `blocking: true` and is a no-op otherwise, and the host MAY reject by restoring `blocking: true` (`channels-session/actions.ts:546-574`, reducer `channels-session/reducer.ts:469-475`)"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentSideEffects.ts#L1869-L1875 - VS Code hands the action to the provider's optional `backgroundMcpServerStartup` and says nothing when it has none"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/agent.ts#L1491-L1492 - `backgroundMcpServerStartup?(session, id)`: \"Releases turns waiting for MCP startup while the provider continues connecting servers\""
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L4755-L4771 - only the Copilot backend implements it, and only Copilot sets `blocking: true` (`:7823`)"
  - "https://github.com/microsoft/agent-host-protocol/commit/edef8d8 - blocking MCP server startup and `session/mcpServerBackgroundRequested` (#471)"
---

## Goal

A client that asks for a blocking MCP server startup to go to the background is heard, as VS Code's agent host hears it: the session's backend is asked when it can do it, and when it cannot the request changes nothing and is not refused.
No ahpd backend holds messages back on a starting MCP server today, so none reports `blocking`; a nested ahpd passes the request and its inner host's answer through.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "blocking: true|backgroundMcpServerStartup|McpServerBackgroundRequested" src/vs/platform/agentHost` in the VS Code clone, generated protocol excluded - the side effect, the optional provider method and the Copilot backend; nothing in `node/claude/`.
- `grep -n -i "alwaysLoad\|non-blocking" sdk.d.ts` in the installed Claude Agent SDK - startup is non-blocking unless a server sets `alwaysLoad`; `rg -n "alwaysLoad" packages/agent-claude/src` finds it only on host tools' `_meta`, never on a server's config.
- `rg -n "startMcpServer" packages/agent-*/src` - ACP, pi and cofold answer `false`; they report no MCP server.

### Gaps

- A client sending the action today gets `session/mcpServerBackgroundRequested is not served yet` back, where VS Code says nothing.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| `Session` gains the optional `backgroundMcpServerStartup(id): Promise<boolean>`, VS Code's name, and the host calls it for the action | (defaulted: upstream parity, VS Code's provider seam) | 01 |
| A backend without it, or a server that is not blocking, makes the action a no-op with no refusal | VS Code `agentSideEffects.ts:1869-1875`; AHP 1.0.0: the reducer "is a no-op otherwise" | 01 |
| A backend that backgrounds emits `session/mcpServerBackgroundRequested` then `session/mcpServerStateChanged` with `blocking: false`, and one that cannot emits `session/mcpServerStateChanged` restoring `blocking: true` | AHP 1.0.0 `SessionMcpServerBackgroundRequestedAction`; the backend-emits pattern of `startMcpServer` | 01 |
| The Claude backend implements nothing and never reports `blocking` | Claude Agent SDK: startup non-blocking by default, no background call; ahpd sets no `alwaysLoad` on a server | 01 |
| A nested host forwards the action to its inner host and answers `true` | [`code://packages/sdk/src/nested.ts#L498-L505`](../../../../packages/sdk/src/nested.ts#L498-L505), the start and stop it already forwards | 01 |
| The action asks `session:write` today and `session:configure` once host/46 lands, and goes to a 0.9.0 connection too | host/46 task 02's table, row `session/mcpServerBackgroundRequested`; AHP 1.0.0 `ACTION_INTRODUCED_IN`: `0.9.0` | 01 |

## Proposed architecture

- **Event flow** - `dispatchAction session/mcpServerBackgroundRequested` -> gate -> `session.backgroundMcpServerStartup?.(id)` -> the backend's own `session/mcpServerBackgroundRequested` and `session/mcpServerStateChanged` -> subscribers.
- **Layer responsibilities** - sdk: the `Session` method, the host case, the nested forward · agent-claude: nothing · docs: the action row.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts), [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A request to background an MCP startup reaches the backend that can do it](task-01-a-background-request-reaches-the-backend.md) | todo | - |

## Risks and tradeoffs

- Until a backend blocks, the action has no visible effect on a direct ahpd; the work is the seam and the end of the refusal, which is what VS Code's Claude backend has too.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-background-request-reaches-the-backend.md](task-01-a-background-request-reaches-the-backend.md).
- **Open questions:** none.
- **Watch out for:** the host must not dispatch the action itself; on a backend that cannot background, an echo would tell every other client the server stopped blocking when it did not.

## Final verification checklist

- [ ] The action is no longer refused, and reaches a backend that implements the method.
- [ ] `pnpm exec tsc --noEmit`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
