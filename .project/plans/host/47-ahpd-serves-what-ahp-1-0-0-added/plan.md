---
title: ahpd serves what AHP 1.0.0 added
domain: host
status: planned
priority: medium
created: 2026-10-03
revalidated: 2026-10-04
requires:
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
refs:
  - "[code://UPSTREAM.md](../../../../UPSTREAM.md) - Pass 5's \"The wire, beside the features\", the list these plans take"
  - "[code://packages/sdk/src/host/gate.ts#L232-L242](../../../../packages/sdk/src/host/gate.ts#L232-L242) - `ACTION_HOMES`, today's grant for a client action, by family"
  - "[code://packages/sdk/src/host.ts#L1021-L1026](../../../../packages/sdk/src/host.ts#L1021-L1026) - a method with no handler is `-32601`"
  - "[code://packages/sdk/src/host/chatactions.ts#L1126-L1127](../../../../packages/sdk/src/host/chatactions.ts#L1126-L1127) - a client action with no case is refused as `not served yet`"
  - "[code://.project/plans/host/46-built-in-surfaces-are-advertised-for-role-control/task-02-every-method-and-action-needs-one-operation.md](../../../../.project/plans/host/46-built-in-surfaces-are-advertised-for-role-control/task-02-every-method-and-action-needs-one-operation.md) - the operation each method and client action asks once host/46 lands"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `ACTION_INTRODUCED_IN` registers every action these plans emit as `0.9.0` and only `chat/canvasesChanged` and `canvas/stateChanged` as `0.10.0`; `isActionKnownToVersion(action, '0.9.0')` is true for all of them (`src/types/version/registry.ts:21-142`)"
  - "https://github.com/microsoft/vscode/tree/7516b04bc94/src/vs/platform/agentHost - the reference host at UPSTREAM.md's Pass 5 checkpoint, read for each child"
  - "file:///home/softov/.local/cache/tmp/claude-1000/-home-softov/f22339a5-d379-4c13-91e4-d62f169fefc8/scratchpad/ahp-1.0.0/ - the unpacked 1.0.0 package and `types.diff` against 0.9.0; scratch, so it may be gone"
---

## Goal

ahpd serves the parts of AHP 1.0.0 that host/44, host/43 p3 and host/45 do not: moving a chat, a chat's background work, a blocking MCP server startup sent to the background, the named file edit types, client plugins on an automation, and a changeset that says it is being recomputed.
Each one is served the way VS Code's agent host serves it, under the same names, and where VS Code does not serve it ahpd answers what VS Code answers until Softov says otherwise.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -n "^+export\|^+  [a-zA-Z_]*?\?:" types.diff` - every addition 1.0.0 makes over 0.9.0; each is either in a child here, in host/44, host/43 p3 or host/45, or listed under Gaps.
- `rg -n "moveChat|backgroundWork|mcpServerBackgroundRequested|recomputing|FileEditSide" packages docs` - none of them exists in ahpd yet.
- `git -C /github/externals/vscode log -1` - the clone is at `7516b04bc94`, the Pass 5 checkpoint, so every VS Code reference below is that commit.
- `git -C /github/externals/agent-host-protocol log -1 <sha>` - `2265e2e` is the chat move contract (#484), `edef8d8` the blocking MCP startup (#471), `9f94039` the automation plugins (#474), and #482 merged as `4248be7` is background work.

### Gaps

- 1.0.0 also adds per-chat changesets (`ChatState.changesets`, `chat/changesetsChanged`, `changes` on `ChatState` and `SessionChatSummary`) and `AuthenticateParams.expiresIn`; neither is in Pass 5's wire list, and neither is planned here.
- The per-chat changesets are their own box under Pass 5's multi-folder sessions.

## Decisions locked in

| What | Source | Plan |
| --- | --- | --- |
| The items are the ones Pass 5 lists under "The wire, beside the features" that no plan covers, one child per group | the request, 2026-10-03 | p1-p6 |
| Each child serves its item as VS Code's agent host does at `7516b04bc94`, with VS Code's names, except where a row below goes past it | Softov's standing goal, upstream parity: "map VS Code's features with the same names" | p1-p6 |
| `McpServerStartingState.blocking` is served in p3 with `session/mcpServerBackgroundRequested`, and p6 is the changeset's `recomputing` alone | (defaulted: the action exists only to clear that flag, and neither is testable without the other) | p3, p6 |
| Every action these plans emit goes to a 0.9.0 connection as well: `ACTION_INTRODUCED_IN` registers them as `0.9.0`, so `isActionKnownToVersion` says a 0.9.0 client knows them, and ahpd keeps no per-connection filter | AHP 1.0.0 `src/types/version/registry.ts:21-142`; host/44's own watch-out | p1-p6 |
| A client action these plans accept asks today's family grant from `ACTION_HOMES`, and the operation in host/46's table once host/46 lands; whichever lands second writes the row | host/46 task 02's table | p1, p3, p5 |
| p1 goes past VS Code: it builds reordering and moving between sessions of the same agent and machine, where VS Code answers `moveChat` with `MethodNotFound` | Softov, 2026-10-03, asked "VS Code refuses moveChat (MethodNotFound) and never marks a chat movable. Stop at parity, or build reorder and move-between-sessions anyway?": "build both" | p1 |
| p5's client plugins are planned now, as host/49 | Softov, 2026-10-03: "Plan client plugins now" | p5 |
| Canvas (`chat/canvasesChanged`, `canvas/stateChanged`, the `ahp-canvas:` channel) is left out | Softov, 2026-10-03, asked "Canvas is experimental in 1.0.0 (registered as 0.10.0, only sent to connections that know it). Include it in host/47?": "Leave out for now" | - |

## Tasks

| Plan | Status | Depends on |
| --- | --- | --- |
| [p1 - A chat is reordered in its session, or moved to another session of the same agent and machine](../47-ahpd-serves-what-ahp-1-0-0-added-p1-moving-a-chat/plan.md) | planned | host/50 |
| [p2 - A chat lists the shells and subagents running in its background](../47-ahpd-serves-what-ahp-1-0-0-added-p2-a-chat-lists-its-background-work/plan.md) | planned | - |
| [p3 - A blocking MCP server startup can be sent to the background](../47-ahpd-serves-what-ahp-1-0-0-added-p3-an-mcp-server-startup-can-be-backgrounded/plan.md) | planned | - |
| [p4 - A file edit is the protocol's type, and a Claude write confirmation previews its edit](../47-ahpd-serves-what-ahp-1-0-0-added-p4-a-file-edit-is-the-protocols-type/plan.md) | planned | - |
| [p5 - An automation carries the client plugins its template names](../47-ahpd-serves-what-ahp-1-0-0-added-p5-an-automation-carries-client-plugins/plan.md) | planned | host/49 (task 02) |
| [p6 - A changeset being recomputed says so, and keeps its files](../47-ahpd-serves-what-ahp-1-0-0-added-p6-a-changeset-says-it-is-recomputing/plan.md) | planned | - |

Every child requires host/44 p1, which is built (`1eb8c8f`); p1 also requires host/50, and p5's task 02 requires host/49.

## Risks and tradeoffs

- A client on the published 0.9.0 package receives `chat/backgroundWorkSet` and the other new actions; its reducer has no case for them and returns the state unchanged, which is what VS Code's host relies on too.
- host/46 rewrites the gate while these land; a row written under `ACTION_HOMES` is rewritten as an operation, not lost.

## Resume state

- **Done so far:** nothing.
- **Next action:** [p2](../47-ahpd-serves-what-ahp-1-0-0-added-p2-a-chat-lists-its-background-work/plan.md), the one with the most for a person to see; the others are independent.
- **Open questions:** none; the three asked were answered by Softov on 2026-10-03.
- **Watch out for:** `node_modules` on `main` may still hold 0.9.0 after `1eb8c8f`; run `pnpm install` before any child, or the new types do not exist.

## Final verification checklist

- [ ] p1 to p6 built.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] UPSTREAM.md Pass 5's boxes ticked by the commits that land them.
- [ ] `plans/index.md` updated.
