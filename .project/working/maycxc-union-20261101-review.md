---
title: Review of MayCXC's union at 5af4418d
---

# Review of MayCXC's `union` at `5af4418d`

Softov's review of the nine plans merged on `union` up to `fc4fe451`, on 2026-11-01. The suite passes on that tree (typecheck, 8092 tests, i18n-check). Each finding below was checked against the code at `fc4fe451`. The last `union`, `5af4418d`, rebuilds the read-state and cancel merges on the held-state branch; against `fc4fe451` it changes only plan records and `agent-cofold-turn.test.ts`, so every finding still holds there. That test file and the case driver pass on `5af4418d`, 685 tests. Fix the blockers and the bug on `union`; the notes can be fixes or follow-up plans, your call.

## Blockers

1. **The root state lost `ahpd.restartNeeded`** (host/20261101-0329, the host's state is the reducers' output).
   - On main, `rootFor` puts `'ahpd.restartNeeded': true` in the root state's `_meta` (`packages/sdk/src/host/root.ts`, line 627 on main). On `union` it is only in the handshake `_meta` (`handshake.ts:468`) and the `x-ahpd/restartNeeded` notify.
   - ahpw (`src/bridges/plugins.ts:171`) and ahpapp (`src/useRootConfig.ts:100`) read it from the root state, and read the root again after a change to pick it up. On `union`, neither shows the restart notice after a plugin switch or a daemon key save.
   - `rootFor` already builds `_meta` per connection (`root.ts:643`), so the mark can go back there with no action. Restore it, and make the two tests that now assert its absence (`root-config.test.ts` "says restartNeeded to every reader...", `plugins-channel.test.ts` "says a restart to every client...") assert it in the root state again.
2. **The root's daemon values are read once** (host/20261101-0329).
   - `snapshots.ts:268` calls `ctx.daemonValues()` only when the root is not held yet, and the root is never released.
   - `packages/server/src/pluginschannel.ts` writes the config when a plugin is enabled, disabled or installed, and sends no `root/configChanged`. The CLI does the same. Every later root snapshot shows the old `plugins.*` values and schema until the daemon restarts. On main, each subscribe read the port again.
   - Fix: send a `root/configChanged` for each write to the daemon's config that does not come from a client's own `root/configChanged`, or read the port again at each root subscribe. Add a test that switches a plugin through the plugins channel and then reads the root.
3. **The case driver no longer checks that a host-only action is refused** (host/20261101-0207, the protocol cases are the oracle).
   - `packages/sdk/test/ahp-test-cases.test.ts:703` skips every action that got no refusal, so a host-only action the host accepted passes. If `actions.ts` started taking `chat/responsePart` from a client, every case would still pass. The old driver checked `sendable(one)` on the 146 cases it ran.
   - Fix: when `hostOnly(action)` is true, expect `reason` to be defined before the `continue`.
4. **The read-state plan reverses an answer of Softov's** (host/20261101-0331, a chat's read state is its own).
   - Plan host/89 records Softov's 2026-10-14 answer "Mark every chat read" for what `session/isReadChanged` true does to unread chats (`.project/plans/host/89-chat-and-session-read-state-stay-in-step/plan.md:62`). This plan removes it, with the specification's "neither action implies the other" as its only source. The 2026-10-15 "Follow the protocol" answer it cites is about when a chat's bit clears, not this.
   - Softov, 2026-11-01, chose "Keep linking them, like VS Code": `session/isReadChanged` true marks every counted chat read, as plan 89 says and as VS Code's host does (`agentHostStateManager.ts#L2869-L3006`, already in your plan's refs).
   - Put that one link back. Keep the rest of the plan's per-chat changes. Add an Answers row with Softov's words and the date, and a test for it.

## Bug

- **A refused `chat/toolCallComplete` wipes another dispatch's owed answer** (host/20261031-2222, every client action is answered).
  - `chatactions.ts:1821` calls `ctx.owe('chat/toolCallComplete', toolCallId)` before `session.completeToolCall` checks who runs the call. The owed key is the type and the call id only. When the check fails, the refusal goes through `answeredBy`, which deletes that key (`host.ts:835`).
  - Scenario: client A completes call X, and the harness takes the result asynchronously. A second `toolCallComplete` for X arrives before the session says the completion, from A sending twice or from another client. It is refused, the refusal deletes A's entry, and the completion then goes out with no origin, so A's first dispatch is never answered.
  - Fix: call `owe` only after `completeToolCall` returns true. Add a test for the double send.

## Notes

- **A steering message a client takes back is neither answered nor withdrawn.** `chatState()` now carries `steeringMessage`, so `chat/pendingMessageRemoved` with `kind: 'steering'` passes the held check (`chatactions.ts:1514-1534`) and calls `session.unqueue(id)`. cofold's `unqueue` (`packages/agent-cofold/src/turns.ts:787`) looks only in `queued` and returns, and pi's and Claude's do the same. The client gets no answer, and the message still runs later. Before the cofold plan, cofold refused it.
- **A worker chat's stop is never answered.** `stopWorker` (`chatactions.ts:1196-1199`) has no `owe` and no echo. The new subagent-chat test checks only that no refusal came back.
- **A stop sent while a turn is still starting is refused, and the turn then runs** (host/20261101-0331, a cancel with no turn running is refused). In the windows of a policy check, a Claude model switch, a machine answering or a wake, `chatState()` has no `activeTurn` yet. Before, the stop was echoed and lost the same way, so nothing regresses, but the plan does not name the gap.
- **Case 015** (a cancel finalizes the turn) moved to a `REFUSALS` entry because the driver runs no turn, so the protocol's finalize path is not tested.
- **The cost per action** (host/20261101-0329): every chat action that is not a delta runs `chatMoved`, `summaryMoved` and `factsMoved` (`host.ts:980-981`). Each describes the session, diffs JSON, stats each folder and walks every chat and subagent. Tool-heavy turns pay this per action.
- **A held state seeded from the record may survive a wake** (host/20261101-0329). `spawn.ts:1854` opens a chat state only when none is held, and `spawn.ts:1864` sends `chat/turnsLoaded` only for an empty chat. The live-only fields (the running config schema, customizations, provider meta) may then never reach a session a client read while it slept. Not confirmed by a test.
- **A failed `createSession` leaves kept flags, the chat title and origins behind** (`lifecycle.ts:1802-1804` moves them, and the catch at `lifecycle.ts:1828` calls only `forgetSent`).
- **`rootFor`'s override order changed**: the connection's own values now win over the daemon's and the account's.
- **`ahp-test-cases.test.ts`, `ALLOWED`** exempts whole keys: for 045-047 and 052 that is `activeTurn`, `status` and `queuedMessages`, so any other fault on those keys is hidden.
- **Negotiation cases**: for invalid rows, `owed` sets `closed: asked.closed`, so whether the connection closes is not checked.
- **`conformance.test.ts:906`** now sends `permissionMode` where it sent `mode`. The host still maps `mode` and `autoApprove` (`agent-claude/src/session/config.ts:290-293`), and only the `permissionFor` unit test covers that now.
- **Two test changes drop a check**: `host-turn.test.ts` no longer asserts that the session-level `error` clears, and `host-deltas.test.ts` no longer has a delta land while the snapshot read waits.
- **`spawn.ts:1477`**: `ctx.commandTurns` is keyed by the client's turn id across the host, and now decides whether the session is marked unread. Two chats that use the same turn id can skip the mark for each other.
- **A nested session's customization switch may reach outer clients twice** (host/20261031-2050). `nested.ts` `setCustomizationEnabled` sends it inside with no `handed`; the inner host now echoes it, and `pump` passes the echo out with no origin after the outer `said`. That copy carries only `[{kind:'session'}]`. Not traced to a client.
- **`stopMcpServer` race** (claude/20261031-2133): `stopRequested` is set only after `toggleMcpServer(false)` resolves. A start that arrives in between skips `toggle(true)`, and the stop's flag lands after it, so the server ends CLI-disabled though the last request was a start.
- **The background request's `declined`** (`chatactions.ts:1478-1486`) looks only at top-level customizations, not an MCP server nested in a plugin's `children` as the protocol reducer does. No backend reports `blocking` today.

## No blocker

host/20261031-2050 (customization switch), claude/20261031-2133 (MCP start and stop), cofold/20261031-2319 (turns and steering), usage/20261101-0158 (the usage case's clock) and host/20261101-0331 (cancel with no turn) have no blocker beyond the notes above.
