---
title: A session is listed under its provider's name, whatever a client created it as, so VS Code opens it
domain: host
status: draft
priority: high
created: 2026-09-29
revalidated: 2026-09-29
decisions:
  - decisions/a-session-is-held-under-its-providers-name.md
refs:
  - "[code://packages/sdk/src/host.ts#L7187-L7281](../../../../packages/sdk/src/host.ts#L7187-L7281) - `createSession`, which opens the session under the channel the client sent"
  - "[code://packages/sdk/src/host.ts#L408-L422](../../../../packages/sdk/src/host.ts#L408-L422) - `named`, which checks the client's URI and returns it unchanged"
  - "[code://packages/sdk/src/host.ts#L3164-L3382](../../../../packages/sdk/src/host.ts#L3164-L3382) - `spawn`, which keys `sessions`, `byChat`, `owners`, `births` by that URI and records `names.set(idOf(uri), uri)`"
  - "[code://packages/sdk/src/host.ts#L942-L958](../../../../packages/sdk/src/host.ts#L942-L958) - `names` and `nameOf`, the name a session is published under"
  - "[code://packages/sdk/src/host.ts#L3472-L3544](../../../../packages/sdk/src/host.ts#L3472-L3544) - `listing`, which names a disk row `<provider>:/<id>` and a live session by its held key"
  - "[code://packages/sdk/src/host.ts#L2055-L2122](../../../../packages/sdk/src/host.ts#L2055-L2122) - `summaryOf`, `root/sessionAdded` and `root/sessionSummaryChanged`, all under the held key"
  - "[code://packages/sdk/src/host.ts#L909-L941](../../../../packages/sdk/src/host.ts#L909-L941) - `heldAs`, which resolves any spelling of a session to the held one"
  - "[code://packages/sdk/src/host.ts#L1293-L1380](../../../../packages/sdk/src/host.ts#L1293-L1380) - `sessionOfChat`, `chatOf` and `meantBy`, the same for chat URIs"
  - "[code://packages/sdk/src/host.ts#L1484-L1613](../../../../packages/sdk/src/host.ts#L1484-L1613) - `spelledFor`, which respells a session snapshot into the name it was asked under"
  - "[code://packages/sdk/src/host.ts#L1623-L1633](../../../../packages/sdk/src/host.ts#L1623-L1633) - `broadcast`, which swaps only the envelope's channel for an aliased subscriber"
  - "[code://packages/sdk/src/host.ts#L6306-L6347](../../../../packages/sdk/src/host.ts#L6306-L6347) - `subscribe`, which records the alias and applies `spelledFor`"
  - "[code://packages/sdk/src/host.ts#L8401-L8434](../../../../packages/sdk/src/host.ts#L8401-L8434) - resuming a listed session, which already spawns it under `nameOf(id)`: the pattern task 01 mirrors"
  - "[code://packages/sdk/src/sessions.ts#L42-L52](../../../../packages/sdk/src/sessions.ts#L42-L52) - chat titles, kept by the exact chat URI"
  - "[code://packages/sdk/test/host.test.ts#L6387-L6520](../../../../packages/sdk/test/host.test.ts#L6387-L6520) - `a session asked for by the name a client computed`, the tests for the other spelling of a listed session"
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/session-channel.md - the provider is not in the session URI's scheme
---

## Goal

A session another client created shows its history and its pending approvals in VS Code's Agents Window, without a daemon restart.
Today a session ahpapp creates as `ahp-session:/<uuid>` is listed under that name, VS Code reads the scheme as the provider, and the session opens empty.
After this plan every session is listed as `<provider>:/<id>`, the way it already is after a restart, and the client that created it keeps using its own name.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `/tmp/ahpd-wire.jsonl` on 2026-09-29 - ahpapp's `createSession {channel: "ahp-session:/39c2…", provider: "claude"}`, and every frame for that session carrying `ahp-session:/39c2…` until the restart, then `claude:/39c2…` in `listSessions` while ahpapp kept subscribing as `ahp-session:/39c2…` and was answered.
- VS Code Agents Window log - `No harness descriptor found for session type remote-…-ahp-session` before the restart, `sessionType="claude"` after.
- `git -C /github/externals/vscode show origin/main:src/vs/platform/agentHost/common/agent.ts` - `AgentSession.provider()` returns the scheme; `agentHostSessionHandler.ts` `_resolveSessionUri` rebuilds `<provider>:/<id>`.
- `rg "ahp-session|idOf|nameOf|heldAs" packages/sdk/src` - the maps and helpers in the refs; `packages/sdk/src/nested.ts:232` mints `ahp-session:/` for a nested host's inner session.
- `rg "ahp-session|idOf" .project` - no decision covered the scheme; host 29 recorded that a not-running session is `<provider>:/<id>`.

### Runtime path

```
createSession(channel, provider) -> named() -> openSession(uri) -> spawn(): sessions/byChat/names keyed by uri
  -> sessionAdded(uri) and listing(): resource = uri -> VS Code: provider = scheme -> no handler -> empty view
```

### Gaps

- A live session a client created is published under the client's URI, while the same session after a restart is published as `<provider>:/<id>`.
- `broadcast` swaps only the envelope's channel for an aliased subscriber; URIs inside an action (`session/chatAdded`, `session/inputNeededSet`, `_meta.subagentChatUri`) keep the held spelling.
- `createChat` and `disposeSession` look a session up by the exact string, `initialize`'s `initialSubscriptions` skip `meantBy`, and `reconnect` sets the alias without `spelledFor`.
- A chat title is stored by the exact chat URI, which embeds the session's spelling, so a rename loses it.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A session is held under `<provider>:/<id>`, and the name a client created it under is an alias](../../../decisions/a-session-is-held-under-its-providers-name.md) | Softov, 2026-09-29: "I thinking supporting aliases also is the correct approach to avoid future problems." |

| What | Source | Task |
| --- | --- | --- |
| Every request that names a session or chat resolves any spelling of it | decision 1 | 02 |
| A chat title survives the session being held under a new name | decision 1 | 04 |

## Proposed architecture

- **Data flow** - `createSession` computes the held name `<provider>:/<idOf(channel)>` and opens the session under it, as the resume path already does with `nameOf(id)`; the client's channel is resolved to it by `heldAs` and `meantBy` on every later request.
- **Event flow** - `dispatch` and `broadcast` keep addressing the held channel; a connection with an alias gets the envelope and, after task 03, the URIs inside the action respelled into its name.
- **State flow** - `sessions`, `byChat`, `owners`, `births`, `names` and every URI minted from the session use the held name; `kept` rows are by id and unchanged, except chat titles.
- **Layer responsibilities** - `packages/sdk`: all of it; no backend changes, since a backend is handed the id through `idOf`.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A session a client creates is held under its provider's name](task-01-a-created-session-is-held-under-its-providers-name.md) | todo | - |
| [02 - Every request answers to either name of a session](task-02-every-request-answers-to-either-name.md) | todo | 01 |
| [03 - An action reaches an aliased subscriber in its own spelling](task-03-an-action-reaches-an-aliased-subscriber-in-its-spelling.md) | todo | 01 |
| [04 - A chat title survives the session's new name](task-04-a-chat-title-survives-the-new-name.md) | todo | 01 |
| [05 - VS Code opens a session another client created](task-05-vs-code-opens-a-session-another-client-created.md) | todo | 02, 03, 04 |

## Risks and tradeoffs

- The creating client sees `root/sessionAdded` for `<provider>:/<id>`, not the URI it sent, and could show the session twice - task 05 checks ahpapp and ahpc; both already see this for a session resumed after a restart.
- `connection.aliases` holds one alias per held channel, so a connection that uses both spellings of one session is answered in the last one - left as it is; no client does this.
- A client that sends a scheme that is not its provider (`codex:/<id>` with `provider: "claude"`) gets `claude:/<id>` - the provider it asked for wins, because that is what VS Code will route on.
- Persisted chat titles written under `ahp-chat://default/<b64 ahp-session:/…>` - task 04 reads the old key as a fallback.

## Resume state

- **Done so far:** nothing; this is a proposal.
- **Next action:** Softov answers the open questions, then [task-01-a-created-session-is-held-under-its-providers-name.md](task-01-a-created-session-is-held-under-its-providers-name.md).
- **Open questions:**
  1. Is task 03 in scope, or is the envelope's channel enough for now? - proposed: in scope; a subagent chat announced as `ahp-chat://subagent/<b64 claude:/…>` to a client that knows the session as `ahp-session:/…` is the same mismatch one level down.
  2. Should the creating connection get `root/sessionAdded` in its own spelling? - proposed: no; the root channel is one list for every client, and clients already match rows by id after a restart.
  3. Does a nested host's inner session (`packages/sdk/src/nested.ts:232`, `ahp-session:/<uuid>`) change too? - proposed: no; only this host reads it, and it never reaches VS Code.
  4. Is the mismatch reported to VS Code as well? - proposed: yes, separately, with the text shown to Softov before it is posted.
- **Watch out for:** `idOf` is exported and used by `agent-claude` and `agent-pi` as the backend session id, so the id must never change, only the scheme; the resume path (`host.ts` 8401-8434) already re-keys under `nameOf(id)` and must end up with the same name as a newly created session.

## Final verification checklist

- [ ] A session created as `ahp-session:/<uuid>` with `provider: "claude"` is listed, added and removed as `claude:/<uuid>`.
- [ ] The creating client subscribes, dispatches, forks and disposes under `ahp-session:/<uuid>` and is answered in that spelling.
- [ ] The same session reads the same before and after a restart.
- [ ] `pnpm test` passes in `packages/sdk`, including `conformance.test.ts`.
- [ ] The Agents Window opens a session ahpapp created, with its history and its pending approval.
- [ ] `plans/index.md` updated.
