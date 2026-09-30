---
title: A session is listed under its provider's name, whatever a client created it as, so VS Code opens it
domain: host
status: active
priority: high
created: 2026-09-29
revalidated: 2026-09-30
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
| URIs inside an action reach an aliased subscriber in its own spelling (task 03 in scope) | Softov, 2026-09-30, took the proposed answers to the open questions ("major accepted recommendations on questions") | 03 |
| The creating connection gets `root/sessionAdded` under the held name, not its own | same answer | 01 |
| A `reconnect` replay reaches a connection in its own spelling of the session, as every other action does | the decision above: the client keeps using its own name | 03 |
| Subscribing to a session under any provider scheme needs `session:read`, as `ahp-session:` does, not `file:read` | (defaulted: a session held as `claude:/…` is still a session) | 07 |
| A dispatch into a channel the host resolves to a session needs `session:write`, whatever the scheme, recognised the same way as a subscribe | Softov, 2026-09-30, asked how host/30 should close `dispatchNeeds` gating `claude:/<id>` as `file:read`: "New task 08, by session" | 08 |
| A channel the host cannot place after it has ruled out the root, its own `ahp-` channels, terminals, watches, relayed watches and `file:` needs a session's grants; the gate may only be stricter than the handler | Softov, 2026-09-30, asked "A channel the host can't place after reading the session list: what should the gate ask for?": "Session grant" | 08 |
| A terminal the host holds needs `terminal:read` to subscribe and `terminal:write` to dispatch, whatever its scheme | Softov, 2026-09-30, asked "The terminal hole (a file:read guest types into VS Code's agenthost-terminal: shells) is on main and in 0.8.0. How should it be fixed?": "host/30 task 09, this worktree" | 09 |
| Running an operation on a session's changeset needs `session:write` as well as `file:write` | Softov, 2026-09-30, asked how to handle `invokeChangesetOperation` needing only `file:write` on a session's changeset: "host/30 task 10, this worktree" | 10 |
| One name is one thing: every name the host holds (a session's held name and every name a client created it under, its chats, terminals, this host's watches and relayed ones) is claimed in one registry, a new session, chat, terminal or relayed watch is refused with `-32003` a name that is claimed, resolves to a session, or falls in a space kept for another kind, and the users gate reads a channel's kind from that registry | (defaulted: a channel is one thing, and its grants are read off what it is) | 01, 08 |
| A scheme that names a provider this host has is a session's space, so only a session takes a name in it, listed or not | (defaulted: a session a backend keeps on disk has its `<provider>:/<id>` name before any listing) | 01, 08 |
| A new session's held name and the name the client asked for are claimed before anything is made for it and let go if it is not made, and a session's chat names stay claimed while it starts again | (defaulted: a name is one thing for the whole of its life, including the windows a creation or a restart waits in) | 01 |
| Each family of client action belongs on one kind of channel (`session`, `chat`, `annotations`, `changeset` on a session's; `terminal` on a terminal; `automation` and `automationRun` on the automation channels; `root` on the root; `resourceWatch` on a watch); one on another kind is refused before the gate and any handler, and the grant asked is the strictest of the channel's and the action's | (defaulted: a handler acts on the action, so the channel must be the action's) | 08 |
| `initialize` and `reconnect` subscribe to a channel only through the gate a `subscribe` passes; a refused channel gets no snapshot, and `reconnect` names it in `missing` | (defaulted: a subscription is a subscription however it is asked for) | 08 |
| Under a users directory an unsigned `reconnect` is accepted: every subscription the connection may not read is in `missing` (on the snapshot path, whose result has no `missing`, it is left out of `snapshots`), only what anyone may read is replayed and watched, and the connection has no claim on the client id for routing until the person who holds it signs in on it; a person signed in resumes only an id that is theirs or nobody's | Softov, 2026-09-30, asked "Under --users, what should an unsigned reconnect get?": "Protocol's shape: missing" | 08 |
| Under a users directory a client id belongs to the first person who signs in under it: a connection that `initialize`s or `reconnect`s under an id another person holds gets no routing under it, and a different person signing in on it is refused `-32003`, since `InitializeResult` carries no client id to hand out a fresh one; a person signed in who `reconnect`s under an id nobody holds becomes its holder too | Softov, 2026-09-30, asked "`initialize` still accepts a client id another person already holds... Fix it in this worktree?": "Fix now" | 08 |
| A person removed from the directory while connected is routed nothing under the id they hold | (defaulted: a person who no longer stands holds nothing) | 08 |
| A connection that names no client id (`anonymous` or empty) is never bound to a person and is routed nothing, since a URI addresses a client by its id and every such connection shares one | (defaulted: a published resource needs an id of its own to be addressed) | 08 |
| A relayed watch's owner may dispatch only `resourceWatch/changed` onto it | (defaulted: that is the one action a client says about its own files) | 08 |
| `completions` on a channel needs that channel's read grant as well as `file:read` | (defaulted: completions in a session are its commands) | 08 |
| A dispatch that waits on a session being started again, or on a read of the catalogue, is refused after `WAIT_LIMIT` (60 s), and the connection's later dispatches go on | (defaulted: a backend or a catalogue that never answers must not hold every later dispatch of the connection) | 01 |
| A new session whose id a running or listed session already holds, under any scheme, is refused with `-32003` before anything is made for it | (defaulted: the id is what a session's flags, config, marks and titles are kept by, so two sessions under one id would share them) | 01 |
| A disposed session is dropped from `owners`, so its id can be created again until a listing finds it on disk | (defaulted: a disposed session is gone, and the check above would otherwise refuse its id for the life of the daemon) | 01 |
| A nested host's inner session keeps `ahp-session:/<uuid>` | same answer | - |
| The mismatch is reported upstream: an issue on the agent-host-protocol repository asking whether a session's scheme must be its provider, its text shown to Softov before it is posted | Softov, 2026-09-30, asked "should we also report upstream that VS Code reads a session's provider from its URI scheme?": "Yes, text shown first" | 06 |

## Proposed architecture

- **Data flow** - `createSession` computes the held name `<provider>:/<idOf(channel)>` and opens the session under it, as the resume path already does with `nameOf(id)`; the client's channel is resolved to it by `heldAs` and `meantBy` on every later request.
- **Event flow** - `dispatch` and `broadcast` keep addressing the held channel; a connection with an alias gets the envelope and, after task 03, the URIs inside the action respelled into its name.
- **State flow** - `sessions`, `byChat`, `owners`, `births`, `names` and every URI minted from the session use the held name; `kept` rows are by id and unchanged, except chat titles.
- **Layer responsibilities** - `packages/sdk`: all of it; no backend changes, since a backend is handed the id through `idOf`.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A session a client creates is held under its provider's name](task-01-a-created-session-is-held-under-its-providers-name.md) | implemented | - |
| [02 - Every request answers to either name of a session](task-02-every-request-answers-to-either-name.md) | implemented | 01 |
| [03 - An action reaches an aliased subscriber in its own spelling](task-03-an-action-reaches-an-aliased-subscriber-in-its-spelling.md) | implemented | 01 |
| [04 - A chat title survives the session's new name](task-04-a-chat-title-survives-the-new-name.md) | implemented | 01 |
| [05 - VS Code opens a session another client created](task-05-vs-code-opens-a-session-another-client-created.md) | doing | 02, 03, 04 |
| [06 - The mismatch is reported upstream](task-06-the-mismatch-is-reported-upstream.md) | todo | - |
| [07 - A session under its provider's scheme needs session:read](task-07-a-provider-scheme-session-needs-session-read.md) | implemented | 01 |
| [08 - A dispatch into a session needs session:write, whatever its scheme](task-08-a-dispatch-into-a-session-needs-session-write.md) | implemented | 07 |
| [09 - A terminal needs terminal grants whatever its scheme](task-09-a-terminal-needs-terminal-grants-whatever-its-scheme.md) | implemented | 08 |
| [10 - A changeset operation needs session:write as well as file:write](task-10-a-changeset-operation-needs-session-write.md) | implemented | 08 |

## Risks and tradeoffs

- The creating client sees `root/sessionAdded` for `<provider>:/<id>`, not the URI it sent, and could show the session twice - task 05 checks ahpapp and ahpc; both already see this for a session resumed after a restart.
- `connection.aliases` holds one alias per held channel, so a connection that uses both spellings of one session is answered in the last one - left as it is; no client does this.
- A client that sends a scheme that is not its provider (`codex:/<id>` with `provider: "claude"`) gets `claude:/<id>` - the provider it asked for wins, because that is what VS Code will route on.
- Persisted chat titles written under `ahp-chat://default/<b64 ahp-session:/…>` - task 04 reads the old key as a fallback.
- `holders` lives in memory, so a daemon restart forgets who holds each client id and the first person to sign in under one afterwards holds it - accepted: `reconnect` already refuses every id after a restart (`-32008`, not seen), so every client starts again with `initialize`, and the window is one sign-in.
- A restart that fails keeps its chats' names claimed with no chat behind them until the session is disposed - accepted: the names are the session's either way.

## Resume state

- **Done so far:** tasks 01 to 04 and 07 to 10 implemented, a `reconnect` replay included in 03, and the findings of seven passes of the 2026-09-30 review fixed in 01, 03, 08 and 09, among them one registry of names (`claims`) that the gate and every creation read, client ids bound to people, and each family of action kept to its kind of channel; task 05's automated case passes and its checks by hand are left for Softov; task 06 is the planner's; task 10, from the final review, is implemented, and a watch or terminal named like a session's marks stays what it is (task 08).
- **Next action:** the by-hand checks in [task-05-vs-code-opens-a-session-another-client-created.md](task-05-vs-code-opens-a-session-another-client-created.md), then review.
- **Open questions:** none.
- **Watch out for:** `idOf` is exported and used by `agent-claude` and `agent-pi` as the backend session id, so the id must never change, only the scheme; the resume path (`host.ts` 9129-9177) already re-keys under `nameOf(id)` and must end up with the same name as a newly created session.

## Final verification checklist

- [ ] A session created as `ahp-session:/<uuid>` with `provider: "claude"` is listed, added and removed as `claude:/<uuid>`.
- [ ] The creating client subscribes, dispatches, forks and disposes under `ahp-session:/<uuid>` and is answered in that spelling.
- [ ] The same session reads the same before and after a restart.
- [ ] `pnpm test` passes in `packages/sdk`, including `conformance.test.ts`.
- [ ] The Agents Window opens a session ahpapp created, with its history and its pending approval.
- [ ] `plans/index.md` updated.
