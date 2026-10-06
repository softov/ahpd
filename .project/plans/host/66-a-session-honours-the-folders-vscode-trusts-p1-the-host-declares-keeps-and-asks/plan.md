---
title: The host declares workspaceTrust, keeps it per connection, and asks before a session moves
domain: host
status: planned
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/66-a-session-honours-the-folders-vscode-trusts/plan.md
decisions:
  - decisions/a-folder-is-untrusted-until-a-client-says-otherwise.md
refs:
  - "[code://packages/sdk/src/host/root.ts#L162-L184](../../../../packages/sdk/src/host/root.ts#L162-L184) - `ROOT_CONFIG_SCHEMA`"
  - "[code://packages/sdk/src/host/gate.ts#L289-L302](../../../../packages/sdk/src/host/gate.ts#L289-L302) - `PER_CONNECTION`, the person's keys, `defaultShell` today"
  - "[code://packages/sdk/src/host/actions.ts#L263-L296](../../../../packages/sdk/src/host/actions.ts#L263-L296) - a person's keys kept on the connection, the host's in `rootConfig`"
  - "[code://packages/sdk/src/host.ts#L465-L525](../../../../packages/sdk/src/host.ts#L465-L525) - `seenBy`: a person's keys reach only the sender"
  - "[code://packages/sdk/src/host/terminals.ts#L290-L291](../../../../packages/sdk/src/host/terminals.ts#L290-L291) - how `defaultShell` is read back off the connection"
  - "[code://packages/sdk/src/host/owners.ts#L94-L97](../../../../packages/sdk/src/host/owners.ts#L94-L97) - who sent each running turn"
  - "[code://packages/sdk/src/host/tooling.ts#L338-L340](../../../../packages/sdk/src/host/tooling.ts#L338-L340) - the agent's `setWorkspace`, recorded in `moving`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L531-L553](../../../../packages/sdk/src/host/lifecycle.ts#L531-L553) - `moveSession`, after the turn"
  - "[code://packages/sdk/src/host/chatactions.ts#L335-L337](../../../../packages/sdk/src/host/chatactions.ts#L335-L337) - `session/workingDirectorySet`, a client adding a folder"
  - "[code://packages/sdk/src/host/relay.ts#L63](../../../../packages/sdk/src/host/relay.ts#L63) - a request sent to a client through its `peer`"
  - "[code://packages/sdk/test/root-config.test.ts](../../../../packages/sdk/test/root-config.test.ts) - root config cases"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/agentHostSchema.ts#L864-L877 - the property to copy
---

## Goal

Root state declares `workspaceTrust` as VS Code does, each connection's own value is kept on that connection as `defaultShell` is, a session reads a trust that belongs to its own person, and a session moved or given a folder asks the client first.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "PER_CONNECTION" packages/sdk/src` - one set in `gate.ts`, read in `actions.ts` (where a push is kept) and `host.ts` (`seenBy`).
- `rg -n "moveSession\(|moving.set" packages/sdk/src/host` - the agent asks in `tooling.ts:339`; the move runs in `spawn.ts:647` after the turn ends.
- In VS Code, `requestWorkspaceTrust` is sent whatever the client advertised; a client that does not serve it answers an error, which rejects the request and refuses the move; there is no timeout, and a disconnect rejects it.

### Gaps

- `workspaceTrust` is neither declared nor kept apart; pushed today, it lands in the shared `rootConfig`, so the last window to connect sets every person's trust.
- Nothing asks a client before a session moves into a folder.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A folder is untrusted until a client has pushed workspaceTrust saying otherwise](../../../decisions/a-folder-is-untrusted-until-a-client-says-otherwise.md) | Softov, 2026-10-06, "Untrusted, as VS Code" |

| What | Source | Task |
| --- | --- | --- |
| The property is VS Code's, copied from `agentHostSchema.ts:864-877`, pulled forward from host/45 task 01 | Softov, 2026-10-06, "Declare and use it" | 01 |
| `workspaceTrust` is in `PER_CONNECTION`, kept on the connection and shown only to it | mirrors `defaultShell` (`gate.ts:289-302`) | 02 |
| A session reads the trust of the connection that sent the turn that starts or restarts its backend, and only when that sender is the session's owner; otherwise the folder is untrusted | `(defaulted: one person's trust never opens another's session, and the turn's sender is the one connection the start has in hand)` | 03 |
| A move (`setWorkspace`) or a client's `session/workingDirectorySet` into a folder outside the asking connection's `trustedUris` sends `vscode/requestWorkspaceTrust` `{ workspace, trustedParent? }` to that client; for an isolated move, the repository first, then the worktree with the repository as `trustedParent` | VS Code `sessionWorkspaceConversionService.ts:160-200,395-415`; the coordinator's scope, 2026-10-06 | 04 |
| No request when `globalAutoApproveEnabled` is true in root config or the session's `autoApprove` is `autoApprove`; anything but `{ trusted: true }`, an error (a client without the method answers `-32601`) or a disconnect refuses it; no timeout | VS Code, the same file and `protocolServerHandler.ts:1448-1455` | 04 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - workspaceTrust is declared as VS Code declares it](task-01-workspacetrust-is-declared-as-vscode-declares-it.md) | todo | - |
| [02 - workspaceTrust is kept per connection](task-02-workspacetrust-is-kept-per-connection.md) | todo | 01 |
| [03 - A session reads its own person's trust](task-03-a-session-reads-its-own-persons-trust.md) | todo | 02 |
| [04 - A session asks the client before it moves into a folder](task-04-a-session-asks-before-it-moves-into-a-folder.md) | todo | 02 |

## Risks and tradeoffs

- Task 04 holds a move until the client answers, with no timeout, as VS Code does; a client that never answers holds it until it disconnects.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-workspacetrust-is-declared-as-vscode-declares-it.md](task-01-workspacetrust-is-declared-as-vscode-declares-it.md).
- **Open questions:** none.
- **Watch out for:** `rootConfig` must not hold `workspaceTrust` after task 02; a push reaches only its sender, as `defaultShell` does.

## Final verification checklist

- [ ] Each task's case fails on the code before it and passes after.
- [ ] `pnpm exec vitest run packages/sdk/test/root-config.test.ts` and the move cases pass.
- [ ] `plans/index.md` updated.
