---
title: A session and a chat have one URI - implemented
date: 2026-11-02
refs:
  - git://e4db65aa - the change
  - git://67cb6532 - the docs
  - "[code://packages/sdk/src/host/routing.ts](../../../../packages/sdk/src/host/routing.ts)"
  - "[code://packages/sdk/src/host/handshake.ts](../../../../packages/sdk/src/host/handshake.ts)"
---

A session and a chat are answered under the URI they are held by, for every client.
No road reads a session's id out of another spelling.
A subscribe and a wake under another scheme of the id are refused as no session here.
A dispatch there is answered as one naming a session that does not exist.
An older VS Code window is identified at `initialize` and `reconnect`, and shown only the sessions and chats it can address.
A session a client creates is held under the channel it named.
A session an agent's tool makes during an older window's turn is named in its provider's scheme.
A default chat URI is its session's only while the session's record agrees, and `ahp-chat:/<id>` is a chat of its own URI.
A row has one name whichever road reached it, and keeps it once the store holds a record for it.

## What was built

- [`code://packages/sdk/src/host/routing.ts`](../../../../packages/sdk/src/host/routing.ts) - `nameOf` with the store's kept name, and `keepName`. `sessionOfChat` for a canonical default or worker URI, and `meantBy` for the host's own channels. `visible`, `sessionVisible` and `chatShown`.
- [`code://packages/sdk/src/host/channels.ts`](../../../../packages/sdk/src/host/channels.ts) - `shapedSession`, the session a shaped chat URI names.
- [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts) - the two marks at `initialize` and `reconnect`, and a first or resumed subscription an older window may not see.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `seenBy` and `broadcast` filter the envelopes, the chat list actions and the root notifications for an older window.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - `subscribe`, `listSessions`, `createSession` under the named channel, `moveChat` to a session the client may see.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - a tool's new session in the provider's scheme for an older window's turn.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) and [`code://packages/sdk/src/host/sleep.ts`](../../../../packages/sdk/src/host/sleep.ts) - a flag, a config change, a mark, a draft and a wake reach a session only under its published name.
- [`code://packages/sdk/src/host/history.ts`](../../../../packages/sdk/src/host/history.ts) - a row found by id is named as a listing names it.
- [`code://packages/sdk/src/host/snapshots.ts`](../../../../packages/sdk/src/host/snapshots.ts) and [`code://packages/sdk/src/host/automations.ts`](../../../../packages/sdk/src/host/automations.ts) - a row's name is read once the catalogue has named it.
- [`code://packages/sdk/test/host-names.test.ts`](../../../../packages/sdk/test/host-names.test.ts) - the one-URI cases, the dispatch case and the older window's cases.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the chat URIs and session URIs sections, the older window's section, and the `fetchTurns`, `authenticate` and `auth/required` rows.

## Verified

- On `89ebe4d5`'s `packages/sdk/src` 18 cases fail for the behavior they name, as assertions:
  - `host-names`: the five older window cases, the dispatch case and five one-URI cases.
  - `host-tools`: a tool's new session in the provider's scheme for an older window's turn.
  - `host-catalogue-held`: the listed session under its one URI, and its name kept after a mark across a restart.
  - `host-past-open`: a stored row found by id said under the name a listing gives it.
  - `host-snapshots`: a marked row keeps its listed name through the next pass.
  - `users-gate-sessions`: two cases, and `plugin-session-owner`: one.
- With `e4db65aa` the unit test set passes, 7481 tests in 451 files. Nine timed out at 5 s in one run and pass in their files alone.
- The computer-session and nested-process files of the process suite pass, 27 tests.
- `pnpm run typecheck`, `pnpm run boundary` and `pnpm run i18n` report no errors, and the prose lint is clean.

## Departures from the plan

- The dispatch roads join task 01. A flag, a config change, a mark, a draft and a wake read a session's id from its published name alone. Each reads the catalogue first. Under another spelling of the id they reached the session held under its own name.
- A row found by id is named as a listing names it, and `nameOf` reads the name the store kept before any listing. A stored row found by id was `ahp-session:/<id>`, and the next listing named it `<provider>:/<id>`.
- `keepName` stores a row's listed name beside the first record written for it. A mark on an `ahp-session:` row made the next listing read it as an old row and add it as `<provider>:/<id>`.

## Left for later

- Left as it is: another spelling of a waiting row's id is answered `-32002` with the missing agent's name, before the row's name is read. VS Code's host answers a URI no session is held under as not found ([agentService.ts#L14083](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L14083)). The check is by id, [`waitingFor`](../../../../packages/sdk/src/host/catalogue.ts#L1417), and runs before `past` because `past` reads the transcript through whichever harness answers. Nothing of the session is read or changed.
- Left as it is: a config change, a draft or a turn on a URI no session is held under is refused with a reason. This host refuses each of them on a session nobody has. The protocol has a server ignore an action naming a session or a chat that does not exist, with no echo ([session-channel.md#L166](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/session-channel.md#L166), [chat-channel.md#L351](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L351)). A read or archive flag and a mark there are dropped, as it says. A VS Code window dispatches only on URIs it was given, so no VS Code client sends one.
- Left as it is: a row whose only record is a mark keeps its name while the mark is held. The store keeps no row that holds a name alone ([sessions.ts#L457-L474](../../../../packages/sdk/src/sessions/sessions.ts#L457-L474)). So a row listed as `<provider>:/<id>` loses its name with its last bit. The next listing names it `ahp-session:/<id>`. A row named `ahp-session:/<id>` keeps that name either way.
