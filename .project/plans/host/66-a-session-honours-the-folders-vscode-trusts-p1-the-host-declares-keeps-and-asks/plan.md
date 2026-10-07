---
title: The host declares workspaceTrust, keeps it per connection, and asks before a session moves
domain: host
status: built
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/66-a-session-honours-the-folders-vscode-trusts/plan.md
decisions:
  - decisions/a-folder-is-untrusted-until-a-client-says-otherwise.md
  - decisions/the-sender-decides-on-a-host-with-no-people.md
  - decisions/a-worktree-inherits-its-repositorys-trust.md
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

Root state declares `workspaceTrust` as VS Code does. Each connection's own value is kept on that connection, as `defaultShell` is. A session reads a trust that belongs to its own person, and a session moved or given a folder asks the client first.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "PER_CONNECTION" packages/sdk/src` - one set in `gate.ts`, read in `actions.ts` (where a push is kept) and `host.ts` (`seenBy`).
- `rg -n "moveSession\(|moving.set" packages/sdk/src/host` - the agent asks in `tooling.ts:339`; the move runs in `spawn.ts:647` after the turn ends.
- In VS Code, `requestWorkspaceTrust` is sent whatever the client advertised. A client that does not serve it answers an error, which rejects the request and refuses the move. There is no timeout, and a disconnect rejects it.

### Gaps

- `workspaceTrust` is neither declared nor kept apart; pushed today, it lands in the shared `rootConfig`, so the last window to connect sets every person's trust.
- Nothing asks a client before a session moves into a folder.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A folder is untrusted until a client has pushed workspaceTrust saying otherwise](../../../decisions/a-folder-is-untrusted-until-a-client-says-otherwise.md) | Softov, 2026-10-06, "Untrusted, as VS Code" |
| 2 | [The sender's push decides a folder's trust on a host with no people](../../../decisions/the-sender-decides-on-a-host-with-no-people.md) | Softov, 2026-10-06, "The sender's push" |
| 3 | [A worktree the host made is trusted when its repository is](../../../decisions/a-worktree-inherits-its-repositorys-trust.md) | Softov, 2026-10-06, "Inherit from its repository" |

| What | Source | Task |
| --- | --- | --- |
| The property is VS Code's, copied from `agentHostSchema.ts:864-877`, pulled forward from host/45 task 01 | Softov, 2026-10-06, "Declare and use it" | 01 |
| `workspaceTrust` is in `PER_CONNECTION`, kept on the connection and shown only to it | mirrors `defaultShell` (`gate.ts:289-302`) | 02 |
| A session reads the trust of the connection that sent the turn that starts or restarts its backend; that sender must also own the session, but only on a host that has people | decisions 2 and 3 above; the owner check is VS Code's `sentBy` reading | 03 |
| A session in a worktree the host made reads the trust of the repository it was cut from, and no window is asked about the worktree | decision 3 above | 03 |
| A move (`setWorkspace`) or a client's `session/workingDirectorySet` into a folder outside the asking connection's `trustedUris` sends `vscode/requestWorkspaceTrust` `{ workspace }` to that client; a move that names a repository asks about it, and nothing else | VS Code `sessionWorkspaceConversionService.ts:160-200,395-415`; decision 3 above | 04 |
| No request when `globalAutoApproveEnabled` is true in root config or the session's `autoApprove` is `autoApprove`; anything but `{ trusted: true }`, an error (a client without the method answers `-32601`) or a disconnect refuses it; no timeout | VS Code, the same file and `protocolServerHandler.ts:1448-1455` | 04 |
| Two folders are compared as the folders they name, so `..` and a symlink out of a trusted folder do not walk past it | Softov's review of p1, p2 and p3, 2026-10-06 | 01, 04 |
| A `trustedUris` entry that names no folder here - the empty string, `file://`, another machine's host - vouches for nothing | Softov's review of p1, p2 and p3, 2026-10-06 | 01 |
| A window's yes to `vscode/requestWorkspaceTrust` is kept on its connection until it pushes a new `workspaceTrust` | Softov's review of p1, p2 and p3, 2026-10-06 | 04 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - workspaceTrust is declared as VS Code declares it](task-01-workspacetrust-is-declared-as-vscode-declares-it.md) | done | - |
| [02 - workspaceTrust is kept per connection](task-02-workspacetrust-is-kept-per-connection.md) | done | 01 |
| [03 - A session reads its own person's trust](task-03-a-session-reads-its-own-persons-trust.md) | done | 02 |
| [04 - A session asks the client before it moves into a folder](task-04-a-session-asks-before-it-moves-into-a-folder.md) | done | 02 |

## Risks and tradeoffs

- Task 04 holds a move until the client answers, with no timeout, as VS Code does. A client that never answers holds it until it disconnects.

## Resume state

- **Done so far:** every task is done, reviewed on 2026-10-06.
- **Next action:** none.
- **Open questions:** none; the review's two forks are the decisions 2 and 3 above.
- **Watch out for:** `rootConfig` must not hold `workspaceTrust` after task 02; a push reaches only its sender, as `defaultShell` does.

## Final verification checklist

- [ ] Each task's case fails on the code before it and passes after.
- [ ] `pnpm exec vitest run packages/sdk/test/root-config.test.ts` and the move cases pass.
- [ ] `plans/index.md` updated.
