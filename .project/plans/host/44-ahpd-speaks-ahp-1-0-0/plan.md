---
title: ahpd speaks AHP 1.0.0, and keeps 0.9.0
domain: host
status: built
priority: high
created: 2026-10-03
revalidated: 2026-10-04
requires: []
refs:
  - "[code://package.json#L38](../../../../package.json#L38) - the workspace's `^0.9.0`"
  - "[code://packages/sdk/package.json#L57](../../../../packages/sdk/package.json#L57) - the published sdk's dependency"
  - "[code://packages/agent-claude/package.json#L62-L69](../../../../packages/agent-claude/package.json#L62-L69) - the published plugin's peer and dev ranges"
  - "[code://packages/sdk/src/host/handshake.ts#L132-L152](../../../../packages/sdk/src/host/handshake.ts#L132-L152) - `initialize` takes the first supported version in the client's order"
  - "[code://packages/sdk/src/nested.ts#L372-L375](../../../../packages/sdk/src/nested.ts#L372-L375) - an inner host must answer exactly `PROTOCOL_VERSION`"
  - "[code://packages/sdk/src/automations.ts#L95-L125](../../../../packages/sdk/src/automations.ts#L95-L125) - a definition is stored as sent, `disableConditions` included"
  - "[code://packages/sdk/src/host/catalogue.ts#L173-L191](../../../../packages/sdk/src/host/catalogue.ts#L173-L191) - `summaryOf`, a catalogue row with no `chats`"
  - "[code://UPSTREAM.md](../../../../UPSTREAM.md) - Pass 5's \"The wire, beside the features\", where what 1.0.0 adds and this plan does not take waits"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - additive over 0.9.0: nothing removed, renamed or made required; `SUPPORTED_PROTOCOL_VERSIONS` is `['1.0.0', '0.9.0']` and `negotiateProtocolVersion` picks the highest caret-compatible offer (`src/types/version/registry.ts:21-82`)"
  - "file:///home/softov/.local/cache/tmp/claude-1000/-home-softov/f22339a5-d379-4c13-91e4-d62f169fefc8/scratchpad/ahp-1.0.0/ - the two tarballs, `types.diff`, `cmpschema.mjs` and a trial tree with 1.0.0 installed (`v.log`, `v2.log`); scratch, so it may be gone"
---

## Goal

ahpd builds against `@microsoft/agent-host-protocol@1.0.0` and answers a client offering 1.0.0 or 0.9.0, the highest it offers winning, so ahpapp and ahpc can move to the 1.0.0 package without losing the daemon.
Then ahpd meets what 1.0.0 asks of a host that it does not yet do: automations that disable themselves, and a session catalogue row that lists its chats with their status.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `node cmpschema.mjs` over the two packages' JSON schemas - no definition removed, no property removed or made required; additions only, and `ChangesetStatus` gains `recomputing`.
- `pnpm exec tsc --noEmit` in the trial tree with 1.0.0 installed - passes with no change.
- `vitest run` in the trial tree - 435 failures, every one traced to an `initialize` offering `['0.8.0']` (40 literal offers in 22 test files and 92 `hello(['0.8.0'])` calls in `host-handshake.test.ts`), to the handshake tests in `packages/sdk/test/host-handshake.test.ts:12-34`, or to the two version tests in `packages/sdk/test/nested-proxy.test.ts:302-335`.
- `rg -n "protocolVersions" /github/ahpapp/node_modules/@microsoft/agent-host-protocol/dist` - the package's `MultiHostClient` offers only `[PROTOCOL_VERSION]` (`client/hosts/runtime.js:494`, `:510`), so ahpapp on 1.0.0 offers `['1.0.0']` alone.
- `/github/ahpc/src/ahp/live.ts:207` - ahpc offers `['0.9.0', '0.8.0', '0.7.0']`.

### Gaps

- ahpd on 0.9.0 refuses a client that offers only 1.0.0, which is what ahpapp will offer once it moves.
- A `session/chatUpdated` that changes a chat's status is not projected into `SessionSummary.chats`, which 1.0.0 makes a MUST.
- An automation's `disableConditions` is kept and never honoured, and a definition with a kind twice is accepted, which 1.0.0 says a host MUST refuse.

## Decisions locked in

| What | Source | Plan |
| --- | --- | --- |
| ahpd accepts 1.0.0 and 0.9.0, the package's own list; the highest compatible version offered wins; 0.8.0 and older are refused | Softov, 2026-10-03, asked "For now, which protocol versions does ahpd accept once it moves to the 1.0.0 package?": "1.0.0 and 0.9.0" | p1 |
| p1 is small and lands first, before ahpapp moves to the 1.0.0 package | the request, 2026-10-03: "Small and first; it must land before ahpapp bumps" | p1 |
| ahpc and ahpapp move to 1.0.0 in their own repositories; these plans change ahpd only | the request, 2026-10-03: "Softov does the client migration to 1.0.0 himself" | - |
| Automations honour `disableConditions`, refuse a kind given twice, and report `runCount` | AHP 1.0.0 `AutomationDefinition.disableConditions`, `AutomationEntry.runCount` (`channels-automation/state.ts:377-393`, `:418-430`) | p2 |
| A session's catalogue row lists its chats with their status and names its default chat, and a chat is marked read or archived on its own | AHP 1.0.0 `SessionChatUpdatedAction` (`channels-session/actions.ts:87-89`), `SessionSummary.chats` (`channels-session/state.ts:521-527`), `ChatIsReadChangedAction`, `ChatIsArchivedChangedAction` (`channels-chat/actions.ts:859-894`) | p3 |
| What 1.0.0 adds and these plans do not take is listed in `UPSTREAM.md` Pass 5, beside the items already waiting there for this package | (defaulted: `UPSTREAM.md` already keeps the protocol backlog, so a `deferred.md` here would be a second list) | - |

## Tasks

| Plan | Status | Depends on |
| --- | --- | --- |
| [p1 - ahpd speaks 1.0.0 and 0.9.0](../44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md) | built | - |
| [p2 - An automation disables itself as its definition says](../44-ahpd-speaks-ahp-1-0-0-p2-an-automation-disables-itself/plan.md) | built | p1 |
| [p3 - A session's row lists its chats, and a chat is read or archived on its own](../44-ahpd-speaks-ahp-1-0-0-p3-a-sessions-row-lists-its-chats/plan.md) | built | p1 |

## Risks and tradeoffs

- A client on 0.8.0 or older is refused after p1; VS Code 1.140 and ahpc both offer 0.9.0, and nothing in this workspace offers less.
- host/43 was written against 0.9.0 and now requires p1, so the wire test checks frames against the 1.0.0 schema.

## Resume state

- **Done so far:** p1, p2 and p3 built.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** 1.0.0 registers most of its new actions as introduced in `0.9.0` (`ACTION_INTRODUCED_IN`), so a 0.9.0 connection is not a reason to hold them back; only the canvas actions are `0.10.0`.

## Final verification checklist

- [ ] p1 to p3 built.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
