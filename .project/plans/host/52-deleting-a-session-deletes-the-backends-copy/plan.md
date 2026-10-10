---
title: Deleting a session deletes the backend's copy, and a listed row can be deleted
domain: host
status: built
priority: high
created: 2026-10-04
revalidated: 2026-10-04
requires: []
changes: []
creates: []
decisions:
  - decisions/deleting-a-session-deletes-the-backends-copy.md
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts#L95-L98](../../../../packages/sdk/src/host/lifecycle.ts#L95-L98) - `removeSession` refuses a session the daemon is not holding with -32001"
  - "[code://packages/sdk/src/host/lifecycle.ts#L226](../../../../packages/sdk/src/host/lifecycle.ts#L226) - the stored row is forgotten, and with it the agent that ran the session"
  - "[code://packages/sdk/src/host.ts#L2693](../../../../packages/sdk/src/host.ts#L2693) - `disposeSession`"
  - "[code://packages/sdk/src/host/catalogue.ts#L345](../../../../packages/sdk/src/host/catalogue.ts#L345) - `owners`, the agent a listed row belongs to"
  - "[code://packages/sdk/src/host/routing.ts#L47-L56](../../../../packages/sdk/src/host/routing.ts#L47-L56) - `heldAs`, which already resolves a listed row's name"
  - "[code://packages/sdk/src/types/agent.ts#L474](../../../../packages/sdk/src/types/agent.ts#L474) - `Agent.list`, beside which `delete` goes"
  - "[code://packages/agent-claude/src/claude.ts#L411](../../../../packages/agent-claude/src/claude.ts#L411) - Claude's `list` over its `paths`"
  - "[code://packages/agent-pi/src/catalog.ts#L54](../../../../packages/agent-pi/src/catalog.ts#L54) - `stateFile`, pi's one file per session"
  - "[code://packages/agent-cofold/src/agent.ts#L625](../../../../packages/agent-cofold/src/agent.ts#L625) - cofold's `list` over its store"
  - "[code://packages/agent-acp/src/agent.ts#L94](../../../../packages/agent-acp/src/agent.ts#L94) - ACP's `list`, the server's `session/list`"
  - "[code://docs/AHP.md#L74](../../../../docs/AHP.md#L74) - the `disposeSession` row"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `deleteSession(sessionId, { dir })` removes `<id>.jsonl` and the `<id>/` subagent folder, and throws when neither exists
  - npm://@agentclientprotocol/sdk@^1.5.0 - `session/delete`, offered when the agent advertises `sessionCapabilities.delete`
  - git://90f4677 - the problem file this plan replaced, with the reproduction
  - npm://@cofold/store-file@0.1.1 - `store.sessions.delete({ sessionId })`
---

## Goal

A session deleted from any client stays deleted: the agent that owns it deletes its own copy, so no listing offers it again, and a row the daemon only lists can be deleted the same way as one it is running.

## Reconnaissance

### Searches performed

- `rg -n "deleteSession" packages --glob '*.ts'` - nothing in ahpd calls the SDK's `deleteSession`.
- `rg -n "list: |list\(\)" packages/agent-*/src` - four agents list sessions: claude, pi, cofold, acp.
- Shown on 2026-10-04 with `/github/ahpd` in Claude's `paths`: a `claude-openrouter` session deleted with `ahpc session rm` is listed again as `claude:/<id>`, and a second `rm` answers `-32001 No agent for session`.

### Runtime path

```
disposeSession(channel) -> heldAs -> removeSession(uri) [held: teardown] -> agent.delete(id, directory) -> kept.forget -> root/sessionRemoved
                                  -> listed only: owners.get(uri).delete(id, directory) -> kept.forget -> root/sessionRemoved
```

### Gaps

- No agent has a delete, so every store keeps a deleted session.
- `removeSession` throws for a row in `owners` and not in `sessions`.
- The row that returns goes to the first agent reading its directory, because the stored owner was forgotten.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [Deleting a session deletes the backend's own copy of it](../../../decisions/deleting-a-session-deletes-the-backends-copy.md) | 01, 02, 03 |

| What | Source | Task |
| --- | --- | --- |
| A listed row is deleted through `disposeSession` too, by its owner in `owners`, under the same `session:write` grant | Softov, 2026-10-04, asked "How should deleting a session work?": "Backend deletes, listed too" | 01 |
| `Agent.delete?(id, directory)` is optional; the host calls it after a running session's teardown, so the backend's process has stopped before its store is touched | (defaulted: a transcript deleted under a running CLI is written again by it) | 01 |
| `Agent.delete?(id: string, directory: string \| undefined)` takes the directory as `dirOf` answered it, `undefined` included | Softov, 2026-10-04, asked how a listed row with no working directory is deleted (cofold's `list` emits `workingDirectories: []`): "Widen to `directory: string \| undefined` and pass `dirOf(uri)` through" | 01, 02, 03 |
| A store that says the session is not there counts as deleted | (defaulted: the SDK throws when neither file exists, and a session deleted twice is deleted) | 01, 02, 03 |
| Any other delete failure is answered to the client as the request's error, after the teardown, and logged; the row may then be listed again | (defaulted: a delete that silently failed is the bug this plan fixes) | 01 |
| An agent with no `delete` keeps today's behaviour, and the host logs once per such agent that its deleted sessions can return | (defaulted: refusing the delete would leave a running session nobody can close) | 01 |
| pi's session is deleted by removing the file `stateFile` names | (defaulted: pi 0.87.1's `SessionManager` has no delete, and pi writes one file per session) | 03 |
| An ACP agent sends `session/delete` only when the server advertises `sessionCapabilities.delete`; otherwise it has no delete | (defaulted: the method is capability-gated in the ACP schema) | 03 |
| The ACP capability is read from the handshake `catalogueOf` already makes and `delete` is a getter over it, so the property is absent until the server has advertised `session/delete`; a dispose before the first listing takes the old path and is logged | Softov, 2026-10-04, asked how a conditionally absent `delete` is spelled on a plain `Agent` object: "present only when the server supports session/delete, through a getter over the capability cached from the handshake; a dispose before the first `list()` takes the old path and logs it" | 03 |
| A deleted session's worktree is still kept when dirty, as `removeSession` does today | (defaulted: unchanged behaviour, see `docs/AHP.md`) | 01 |
| A caller who is neither the session's owner nor a holder of `session:*` is refused, not given a host-only dispose | (defaulted: refusing is the safe choice; Softov may change it) | 05 |

## Proposed architecture

- **Data flow** - `disposeSession` resolves the name with `heldAs`; a held session goes through `removeSession`, which ends by calling its agent's `delete`; a row only in `owners` skips the teardown and goes straight to the delete, the `kept.forget` and the broadcast.
- **Layer responsibilities** - `types/agent.ts`: the hook · `host/lifecycle.ts`: when it is called and what is answered · each `agent-*`: what deleting means in its store.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host deletes through the agent, held or listed](task-01-the-host-deletes-through-the-agent.md) | done | - |
| [02 - Claude deletes its transcript](task-02-claude-deletes-its-transcript.md) | done | 01 |
| [03 - pi, cofold and ACP delete theirs](task-03-pi-cofold-and-acp-delete-theirs.md) | done | 01 |
| [04 - The docs say a delete is permanent](task-04-docs.md) | done | 02, 03 |
| [05 - Only the owner, or a session:* holder, may delete a session](task-05-only-the-owner-may-delete-a-session.md) | implemented | 01 |

## Risks and tradeoffs

- A delete cannot be undone: the transcript, pi file or cofold record is gone.
- An ACP server that does not offer `session/delete` keeps the old gap, and the log says so.
- A session another tool still has open (Claude Code in a terminal on the same id) may write its transcript again.

## Resume state

- **Next action:** task 05 waits on Softov. Tasks 01-04 were reviewed against main on 2026-10-10 and are `done`.

## Final verification checklist

- [ ] The 2026-10-04 reproduction: a `claude-openrouter` session in a listed path, deleted, is not listed again and its `.jsonl` is gone.
- [ ] A listed-only row of each agent is deleted with `ahpc session rm`.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
