---
title: A host tool may run with no session
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/types/host.ts#L904-L991](../../../../packages/sdk/src/types/host.ts#L904-L991) - `HostTool`, which gets `sessionless` and `grant`"
  - "[code://packages/sdk/src/types/host.ts#L1008-L1012](../../../../packages/sdk/src/types/host.ts#L1008-L1012) - `ToolCall`, whose `session` and `chat` a sessionless tool may not get"
  - "[code://packages/sdk/src/types/host.ts#L1357](../../../../packages/sdk/src/types/host.ts#L1357) - `Host`, which gets `sessionlessTools`"
  - "[code://packages/sdk/src/host/tooling.ts#L1434-L1484](../../../../packages/sdk/src/host/tooling.ts#L1434-L1484) - `personOf`, `mayDo` and `refusalOf`, which a sessionless call answers from its caller"
  - "[code://packages/sdk/src/host/tooling.ts#L1635-L1780](../../../../packages/sdk/src/host/tooling.ts#L1635-L1780) - `toolContext`, with `send` and `create`, the shape the sessionless context copies"
  - "[code://packages/sdk/src/host/tooling.ts#L1983-L2016](../../../../packages/sdk/src/host/tooling.ts#L1983-L2016) - `offeredTools`, the binding and the `tool_call` event the sessionless list copies"
  - "[code://packages/sdk/src/host/tooling.ts#L414](../../../../packages/sdk/src/host/tooling.ts#L414) - the `advancedTools` filter, which the sessionless list keeps"
  - "[code://packages/sdk/src/tools/session.ts#L246-L260](../../../../packages/sdk/src/tools/session.ts#L246-L260) - `delegated` and `self`, which read the calling session"
  - "[code://packages/sdk/src/types/events.ts#L185-L197](../../../../packages/sdk/src/types/events.ts#L185-L197) - `ToolCallEvent`"
---

## Objective

A tool with `sessionless: true` runs with a `ToolCall` that may have no session and no chat.
The host answers `sessionlessTools(caller)`: those tools bound to a caller, and only the ones whose `grant` the caller holds.

## Files

- `UPDATE: packages/sdk/src/types/host.ts:904-991` - add `sessionless?: boolean` and `grant?: Grant` to `HostTool`, and type `run` for each case.
- `UPDATE: packages/sdk/src/types/host.ts:1008-1012` - add the sessionless call type, with `session?` and `chat?`. `ToolCall` keeps `session: string`.
- `UPDATE: packages/sdk/src/types/host.ts:1357` - add `sessionlessTools(caller)` to `Host`.
- `UPDATE: packages/sdk/src/host/tooling.ts:1635` - add the sessionless context beside `toolContext`.
- `UPDATE: packages/sdk/src/host/tooling.ts:1983-2016` - add `sessionlessTools`, which binds the tools and raises `tool_call` with `person`.
- `UPDATE: packages/sdk/src/host.ts` - serve `sessionlessTools` on the host.
- `UPDATE: packages/sdk/src/types/events.ts:185-197` - `session` and `chat` optional, and `person` added.
- `UPDATE: packages/sdk/src/tools/session.ts` - mark the seven tools `sessionless` with their `grant`, and refuse what needs a session.
- `UPDATE: packages/sdk/test/sessiontools.test.ts` - the sessionless cases.
- `UPDATE: docs/sdk/TOOLS.md` - `sessionless`, `grant`, and which session tools run with no session.

## Steps

1. Add `sessionless?: boolean` to `HostTool`. Its comment says the tool runs with no calling session, and `/mcp` serves it.
2. Add `grant?: Grant` to `HostTool`, documented as the grant a caller needs to see the tool in a sessionless list.
3. Type `HostTool` so a tool with `sessionless: true` gets a `ToolCall` with `session?: string` and `chat?: string`.
4. Keep `session: string` and `chat: string` for every other tool, so a plugin's tool compiles unchanged.
5. Define the caller as `{ principal?: Principal; root?: boolean }`, exported from `types/host.ts`.
6. In `tooling.ts`, write the sessionless context from the caller, beside `toolContext`.
7. Answer `person()` with the principal's id, or `host` for root.
8. Answer `may(grant)` with `true` for root, else `principal.can(grant)`.
9. Answer `refusal(grant)` with `refusalReason` for the principal's id.
10. Answer `sessions()` with the rows when `may('session:read')`, else none.
11. Reuse `chats`, `models`, `context`, `rename` and `remove` as `toolContext` has them, with the caller as the person who asks.
12. In `send`, skip the tree budget, and record the caller as the sender of the turn it begins.
13. In `create`, skip the budget, the depth and `setParent`, and open the session for the caller.
14. Throw "This needs a session" from `setWorkspace`, `scheduleWake`, `cancelWake`, `artifacts`, `setArtifacts`, `terminals` and `read`.
15. Add `sessionlessTools(caller)`: the host's tools with `sessionless: true`, after the `advancedTools` filter, less `optIn` tools.
16. Keep a tool in that list only when it has no `grant` or the caller may do its `grant`.
17. Bind each one as `offeredTools` does, with a frozen definition.
18. Raise `tool_call` with `person`, `tool`, `ok` and `error`, and with no `session` or `chat`.
19. Make `session` and `chat` optional on `ToolCallEvent`, and add `person?: string`.
20. Mark `list_sessions` and `get_session_context` sessionless with `grant: 'session:read'`.
21. Mark `create_session`, `create_chat`, `rename_chat`, `send_message` and `delete_session` sessionless with `grant: 'session:write'`.
22. Make `delegated` give `origin: { kind: 'agent' }` with no delegation `_meta` when the call has no session.
23. Refuse `relationship: currentSession` with no session: "currentSession needs a calling session; use independent".
24. Refuse a missing `session` on `create_chat`, `rename_chat`, `send_message` and `get_session_context` with no session.
25. Write the sessionless half in `docs/sdk/TOOLS.md`.

## Validation

- `packages/sdk/test/sessiontools.test.ts` holds: `sessionlessTools` for a member lists the seven tools, and for a guest only the two read tools.
- The same file holds: `create_session` with `independent` makes a session owned by the caller, with no parent.
- The same file holds: `create_session` refuses `currentSession` with no session, and `create_chat` refuses a missing `session`.
- The same file holds: `send_message` begins a turn whose sender is the caller.
- The same file holds: `tool_call` carries `person` and no `session`.
- The same file holds: the list leaves out a tool without `sessionless`.
- The same file holds: the list leaves out an `advancedPermission` tool while `advancedTools` is off.
- `pnpm --filter @ahpd/sdk test -- sessiontools` passes.
- `pnpm typecheck` and `pnpm boundary` pass.

## Resume

Built. `HostTool` is now `SessionHostTool | SessionlessHostTool`, the second carrying `sessionless: true` and the first `sessionless?: false`, with `grant?: Grant` on the shared half. Only the sessionless branch types `run`'s second argument as `SessionlessToolCall`, which drops `session` and `chat` from `ToolCall` and adds them back optional. `ToolCaller` sits beside it, and `host.ts` serves `Host.sessionlessTools(caller)`.

In `tooling.ts`, `ownerOfCaller`, `callerMay` and `callerPerson` answer the caller's owner, grants and id. `sessionlessContext` mirrors `toolContext`: `turn` is absent, `sessions` is cut by `session:read`, `send` and `create` spend no tree budget, and `setWorkspace`, `scheduleWake`, `cancelWake`, `artifacts`, `setArtifacts`, `terminals` and `read` throw `This needs a session`. `sessionlessTools` keeps the `sessionless: true` tools that are not `optIn`, drops the ones whose `grant` the caller lacks, applies `forSession` with the default strategy as a session's list does, binds each with a frozen definition, and fires `tool_call` with `person` and neither `session` nor `chat`.

The seven session tools carry `sessionless` and their `grant`. `create_session` refuses `currentSession` with no calling session, and `create_chat`, `rename_chat`, `send_message` and `get_session_context` refuse a call with no session to fall back on. `delegated` gives `origin: { kind: 'agent' }` with no delegation `_meta` when there is no session. `docs/sdk/TOOLS.md` has a `Tools that need no session` section.

Departures. `SessionlessToolCall` keeps `session?: string` and `chat?: string` rather than typing them `undefined`, because the same seven tools are also called from a real session and read `at.session` there; a sessionless call simply has neither at runtime. `sessionlessContext` was added to the internal `Tooling` interface, and `chatsOf`, `modelsKnown` and `contextOf` were factored out of `toolContext` so both contexts share them. A `tool_call` with a caller that names nobody leaves `person` off the event. The prose lint on `docs/sdk/TOOLS.md` reports only the page's existing sentence-length findings, in the new paragraphs as in the rest of the page.

Gates: `pnpm -s build`, `pnpm exec tsc -p tsconfig.json --noEmit`, `pnpm -s boundary` and `pnpm -s schema` pass; `packages/sdk/test/sessiontools.test.ts` passes 38 of 38, the seven new cases included.
