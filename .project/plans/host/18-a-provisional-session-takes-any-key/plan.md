---
title: A session takes any key until its first turn, and shows the fixed ones after
domain: host
status: active
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/host/02-session-config-and-titles/plan.md
changes: []
creates: []
decisions:
  - decisions/a-provisional-session-takes-a-fixed-key-by-restarting.md
  - decisions/a-fixed-key-is-shown-read-only-once-the-session-runs.md
refs:
  - "[code://packages/sdk/src/host.ts#L7477-L7560](../../../../packages/sdk/src/host.ts#L7477-L7560) - the live `session/configChanged`: `HOSTS_OWN` keys restart before the first turn, other fixed keys are refused"
  - "[code://packages/sdk/src/host.ts#L3157-L3167](../../../../packages/sdk/src/host.ts#L3157-L3167) - `propertyOf`, which reads only `agent.schema()` and so never sees a contributed key"
  - "[code://packages/sdk/src/host.ts#L3203-L3211](../../../../packages/sdk/src/host.ts#L3203-L3211) - `sessionSchema`, the backend's schema plus `options.sessionConfig`"
  - "[code://packages/sdk/src/host.ts#L3402-L3480](../../../../packages/sdk/src/host.ts#L3402-L3480) - `restart`, which re-spawns with `held.config`"
  - "[code://packages/sdk/src/host.ts#L2571-L2615](../../../../packages/sdk/src/host.ts#L2571-L2615) - `spawn`: `settings` from `held.config`, and the `schema` a backend publishes"
  - "[code://packages/sdk/src/host.ts#L6816](../../../../packages/sdk/src/host.ts#L6816) - `applyDispatch`, synchronous, with no per-session queue"
  - "[code://packages/sdk/src/host.ts#L7228-L7240](../../../../packages/sdk/src/host.ts#L7228-L7240) - config for a session with no agent yet, remembered and not checked"
  - "[code://packages/sdk/src/host.ts#L3097-L3127](../../../../packages/sdk/src/host.ts#L3097-L3127) - `hostSchema`, which keeps `isolation` pickable in the session's own schema"
  - "[code://packages/computer/src/plugin.ts#L297-L301](../../../../packages/computer/src/plugin.ts#L297-L301) - the `computer` key, which declares no `sessionMutable`"
  - "[code://packages/agent-pi/src/session.ts#L120-L133](../../../../packages/agent-pi/src/session.ts#L120-L133) - pi publishes its own `schemaOf()`, without contributed keys"
  - "[code://packages/agent-claude/src/session.ts#L2381-L2384](../../../../packages/agent-claude/src/session.ts#L2381-L2384) - Claude publishes `options.schema()`"
  - "[code://packages/agent-cofold/src/session.ts#L1076](../../../../packages/agent-cofold/src/session.ts#L1076) - cofold publishes `start.schema()`"
  - "[code://packages/agent-acp/src/session.ts#L230](../../../../packages/agent-acp/src/session.ts#L230) - the ACP bridge builds on `start.schema()`"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L2539 - `eagerCreate`, the session made when New opens
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L1935-L1947 - the first send dispatches the whole config, then the turn
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionConfigPicker.ts#L1586 - which keys a running session draws
---

## Goal

A computer, or any other fixed key, picked in VS Code's New view is the one the session runs with, and after the first turn the session shows it as a read-only chip.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -rn "sessionMutable" packages/*/src` - fixed keys today: Claude's `thinking`, pi's `projectTrust`; `computer` declares none.
- `grep -n "sessionSchema(" packages/sdk/src/host.ts` - three callers: `spawn` (L2615), a browsed row (L4504), `resolveSessionConfig` (L6709).
- `grep -n "queue\|pending" packages/sdk/src/host.ts` around `applyDispatch` - nothing holds a session's actions while it restarts.
- VS Code at `832cf23c5`: `getSessionConfig` returns the new-session config until the first send, so the running schema is not read in New.

### Runtime path

```
New opens -> createSession { computer: A }            -> spawn with A
picker -> B                                            -> stays in the window
first send -> session/configChanged { ..., computer: B } -> [new] fixed key differs, no turn yet -> restart with B
           -> chat turn                                   -> [new] waits for the restart, runs on B
running -> state.config.schema.computer                -> [new] sessionMutable: true, readOnly: true -> read-only chip
```

### Gaps

- `propertyOf` cannot see a contributed key, so the host treats `computer` as mutable and hands it to a backend that ignores it after spawn.
- The first send's `session/configChanged` and turn arrive back to back, and `restart` is async.
- Pi's session publishes its own schema, so a pi session shows no contributed key at all.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A session that has not started takes a fixed key by restarting](../../../decisions/a-provisional-session-takes-a-fixed-key-by-restarting.md) | 01 |
| [A fixed key is shown read-only once the session runs](../../../decisions/a-fixed-key-is-shown-read-only-once-the-session-runs.md) | 02 |

| What | Source | Task |
| --- | --- | --- |
| `computer` declares `sessionMutable: false` | its own description: "the computer://<id> this session runs in" | 01 |
| Only a value that differs from what the session holds restarts it | the existing `HOSTS_OWN` filter, since VS Code re-sends the whole config | 01 |
| Every fixed key, not only `computer` | (defaulted: Softov asked about `computer`; `thinking` and `projectTrust` vanish the same way) | 01, 02 |
| A browsed row's schema is unchanged | out of scope: a browsed row takes config through the unheld path and is resumed with it | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A fixed key restarts a session that has not started](task-01-a-fixed-key-restarts-an-unstarted-session.md) | implemented | - |
| [02 - A running session shows its fixed keys read-only](task-02-fixed-keys-are-read-only-chips.md) | implemented | 01 |

## Risks and tradeoffs

- A restart during the first send is one extra backend start; a Claude CLI start is the slow case.
- Holding actions during a restart is new; an action that waits on a restart that fails has to get the failure, not hang.
- `sessionMutable: true` on a key the host refuses is a flag bent for one client, recorded in the second decision.
- Another client that draws from the session's schema before the first send, as the `hostSchema` comment says some did, would see the fixed key read-only there; `ahpc` is the one to check.

## Resume state

- **Done so far:** task 01 and task 02 on 2026-09-26; `packages/sdk/src/host.ts`, `packages/computer/src/plugin.ts` and `packages/agent-pi/src/session.ts` changed; `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- **Next action:** verify the implementation, tick the checklist, then move both tasks to `done` and write `implemented.md`.
- **Open questions:** none.
- **Watch out for:** a fixed key is only restarted before the first turn. After it the change is refused, and a key re-sent with the value it already holds is not a change at all. The end-to-end cases in a real window are still unchecked.

## Final verification checklist

- [ ] VS Code: open New with computer A, pick B, send; the session runs on B.
- [ ] VS Code: after the first turn the computer shows as a read-only chip, and so does Claude's thinking.
- [ ] A change to a fixed key after the first turn is refused.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `plans/index.md` updated.
