---
title: People and policy are served by one record-store provider, and the value readers are one sdk module
domain: host
status: built
priority: medium
created: 2026-10-05
revalidated: 2026-10-05
requires:
  - plans/host/58-private-files-refused-cursors-and-decoded-file-uris/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/people.ts#L54-L69](../../../../packages/sdk/src/people.ts#L54-L69) - `Records`, the seven questions a scheme's records answer, which becomes the shared port"
  - "[code://packages/sdk/src/people.ts#L307-L398](../../../../packages/sdk/src/people.ts#L307-L398) - `providerFor`, the provider over `Records`, which moves out"
  - "[code://packages/sdk/src/people.ts#L88-L101](../../../../packages/sdk/src/people.ts#L88-L101) - `bodyOf`, the write body decoded and parsed"
  - "[code://packages/sdk/src/people.ts#L120-L130](../../../../packages/sdk/src/people.ts#L120-L130) - `asFile` and the epoch `moment`"
  - "[code://packages/sdk/src/policy.ts#L43-L72](../../../../packages/sdk/src/policy.ts#L43-L72) - `splitFor`, `moment` and `asFile`, people's written again"
  - "[code://packages/sdk/src/policy.ts#L119-L193](../../../../packages/sdk/src/policy.ts#L119-L193) - policy's `providerFor`, people's line for line over the `Policies` port"
  - "[code://packages/sdk/src/policy.ts#L202-L215](../../../../packages/sdk/src/policy.ts#L202-L215) - policy's `bodyOf`, people's with `scheme` fixed"
  - "[code://packages/sdk/src/usage.ts#L377-L397](../../../../packages/sdk/src/usage.ts#L377-L397) - usage's `split` with a query and a decoded pool, `absent` and `at`"
  - "[code://packages/computer/src/provider.ts#L102-L130](../../../../packages/computer/src/provider.ts#L102-L130) - computer's `split`, `absent`, `at` and `moment`"
  - "[code://packages/computer/src/provider.ts#L217-L218](../../../../packages/computer/src/provider.ts#L217-L218) - computer's `asFile`"
  - "[code://packages/computer/src/manifest.ts#L535-L552](../../../../packages/computer/src/manifest.ts#L535-L552) - `bodyText` and computer's `bodyOf`, whose first refusal names the manifest's fields"
  - "[code://packages/sdk/src/host/tooling.ts#L346](../../../../packages/sdk/src/host/tooling.ts#L346) - a read's body decoded by hand"
  - "[code://packages/sdk/src/host/common.ts#L17](../../../../packages/sdk/src/host/common.ts#L17) - `reason`, the error's message, not exported from the package"
  - "[code://packages/sdk/src/scheduled.ts#L57-L58](../../../../packages/sdk/src/scheduled.ts#L57-L58) - `owned`, the owner check"
  - "[code://packages/sdk/src/sessions.ts#L121-L122](../../../../packages/sdk/src/sessions.ts#L121-L122) - `ownerOf`, the same check"
  - "[code://packages/computer/src/runtime.ts#L640-L641](../../../../packages/computer/src/runtime.ts#L640-L641) - the same check, a third time"
  - "[code://packages/sdk/src/scheduled.ts#L72](../../../../packages/sdk/src/scheduled.ts#L72) - `bag`, as 16 of the 19 copies write it: any non-null object, arrays included, which the shared one does not keep"
  - "[code://packages/agent-claude/src/options.ts#L241](../../../../packages/agent-claude/src/options.ts#L241) - `bagOf`, one of the three that refuse arrays (with `agent-claude/src/plugin.ts:107` and `agent-acp/src/plugin.ts:94`)"
  - "[code://packages/agent-cofold/src/capabilities.ts#L121-L122](../../../../packages/agent-cofold/src/capabilities.ts#L121-L122) - a `bag` that answers `undefined`, which is `isRecord`"
  - "[code://packages/server/src/plugins.ts#L232-L236](../../../../packages/server/src/plugins.ts#L232-L236) - `messageOf` and `isRecord`, the server's copies"
  - "[code://packages/sdk/src/users.ts#L367-L369](../../../../packages/sdk/src/users.ts#L367-L369) - `strings`, the string list"
  - "[code://packages/sdk/src/index.ts#L59](../../../../packages/sdk/src/index.ts#L59) - where `secretRef` is exported, the line the new exports sit beside"
  - "[code://packages/agent-acp/package.json#L60](../../../../packages/agent-acp/package.json#L60) - `@ahpd/sdk` peer `>=0.9`, as in agent-claude, agent-cofold, agent-pi and computer"
  - "[code://scripts/boundary.mjs](../../../../scripts/boundary.mjs) - every non-relative import must be declared, so a plugin reaches the helpers only through `@ahpd/sdk`"
---

## Goal

A record directory served as a resource scheme is written once: people's four schemes and the policy scheme are the same provider over a different store, and computer and usage reuse its URI split, refusal, file answer and body decoder.
The one-line value readers that every package redefines (an object or `{}`, a string or nothing, a list of strings, an error's message, an owner reference) are one exported sdk module.
Nothing a client sees changes.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `diff <(sed -n 307,398p packages/sdk/src/people.ts) <(sed -n 119,193p packages/sdk/src/policy.ts)` by eye - the same six members, the same refusals, the same sentences with `what` for `scheme`; policy merges the stored row into the body and runs `checkPolicy`, people's `put` merges inside each `Records`.
- `rg -n "^const (bag|bagOf) =" packages/*/src` - 19 copies: agent-acp 3, agent-claude 6, agent-cofold 7, agent-pi 2, sdk 1; `bagOf` in `agent-claude/src/options.ts:241`, `agent-claude/src/plugin.ts:107` and `agent-acp/src/plugin.ts:94` refuse arrays and the other 16 do not; `agent-cofold/src/capabilities.ts:121` answers `undefined`.
- `rg -n "^const str =" packages/*/src` - 9 copies in agent-claude and agent-cofold.
- `rg -n "is string => typeof [a-z]+ === 'string'" packages/*/src` - 30 inline string-list filters in 22 files, plus `strings` in `users.ts:368` and `words` in `computer/src/plugin.ts:130` (which answers `undefined` for a non-array).
- `rg -n "instanceof Error \? [a-z]+\.message : String\(" packages/*/src` - 101 in 56 files; named copies `host/common.ts:17`, `agent-acp/src/session/common.ts:8`, `server/src/plugins.ts:232`, `server/src/config.ts:319`.
- `rg -n "user\|team\|project\|root\):\.\+" packages/*/src` - the owner regex at `scheduled.ts:58`, `sessions.ts:122`, `computer/src/runtime.ts:641`.
- `rg -n "isObject|isRecord" packages/server/src` - `plugins.ts:235`, `proxy/providers.ts:160`, `commands/options.ts:205`, all refusing arrays.
- `rg -n "trim\(\) !== ''" packages/*/src` - the non-empty readers split: `agent-cofold` `agent.ts:97`, `config.ts:63`, `capabilities.ts:125` answer the value untrimmed; `computer` `tools.ts:42`, `manifest.ts:463` and `people.ts:104` trim it.

### Runtime path

```
resourceRead user://ana | policy://M1 -> storeFor(scheme) -> the provider -> split -> Records.find -> asFile(JSON)
resourceWrite policy://M1 -> split -> jsonBody(content, 'policy') -> Records.put(id, body, was) -> checkPolicy -> Policies.put
```

### Gaps

- policy.ts is people's provider written a second time, about a hundred lines.
- computer and usage carry their own split, absent refusal and file answer.
- A plugin package cannot import a helper the sdk does not export, so every package keeps its own `bag` and `str`.

## Decisions locked in

No decision file: every row below is either Softov's answer or a choice anyone would make.

| What | Source | Task |
| --- | --- | --- |
| Code repeated in more than one place is replaced by one shared helper, with no new dependency | Softov, 2026-10-05, asked which of the survey's findings become plans: all four | 01-07 |
| `recordsProvider(scheme, records)` is people's `providerFor` lifted as it is, over people's `Records`; `put` gains the row already there as a third argument so policy can merge | the survey's item 1 and Softov's brief for this plan, 2026-10-05 | 02, 03 |
| `packages/sdk/src/values.ts` holds `isRecord`, `bag`, `str`, `strings`, `reason` and `ownerOf`, exported from the package | the survey's item 2 and Softov's brief for this plan, 2026-10-05 | 01 |
| The shared `bag` reads an object only and answers `{}` for an array; every call site is checked, and one that expects a list reads it with a list reader instead | Softov, 2026-10-06, asked whether one `bag` should refuse arrays: "the problem is not changing the bag call, but checking where we need an array and where we need an object; a validator for something that is an object cannot return an array as valid" | 01 |
| The non-empty string readers stay where they are | (defaulted: three answer the value untrimmed and three trim it, and merging them changes one side) | - |
| The wrong-scheme refusal inside the shared splitter is `-32602` | host 58 task 06 | 02 |
| The agent packages' and computer's `@ahpd/sdk` peer range moves to the sdk version that first exports these helpers, in the same change as the first import | (defaulted: a plugin installed beside sdk 0.9.0 would fail at import time otherwise) | 05 |
| The agents' and computer's `@ahpd/sdk` peer range names the release that first ships these helpers, decided when that release is cut | Softov, 2026-10-06, asked "which version for the peer range?": "The release that ships it" | 07 |

## Proposed architecture

- **Data flow** - a resource command reaches `recordsProvider`, which splits the URI, refuses what is not a record, and asks `Records`; people hands it four stores over `Users` and policy one over `Policies`.
- **Event flow** - unchanged.
- **State flow** - unchanged; no store and no file moves.
- **Layer responsibilities** - sdk `records.ts` (new): `Records`, `recordsProvider`, `splitResource`, `absentResource`, `asFile`, `jsonBody`, `bodyText`, `EPOCH` · sdk `values.ts` (new): the value readers · sdk `people.ts`, `policy.ts`: their `Records` only · sdk `usage.ts` and computer `provider.ts`: their own leaves, query and `watch` over the shared parts · every package: imports instead of copies.
- **Source-of-truth files** - [`code://packages/sdk/src/people.ts`](../../../../packages/sdk/src/people.ts), [`code://packages/sdk/src/index.ts`](../../../../packages/sdk/src/index.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The value readers are one sdk module](task-01-the-value-readers-are-one-sdk-module.md) | done | - |
| [02 - The record-store provider is its own file, and people uses it](task-02-the-record-store-provider-is-its-own-file.md) | done | 01 |
| [03 - Policy is a Records over the Policies port](task-03-policy-is-a-records-over-the-policies-port.md) | done | 02 |
| [04 - Usage and the host's resource read use the shared parts](task-04-usage-and-the-hosts-resource-read-use-the-shared-parts.md) | done | 02 |
| [05 - The plugins' sdk peer range names the sdk that exports the helpers](task-05-the-plugins-sdk-peer-range-names-the-sdk-that-exports-the-helpers.md) | done | 01, 02 |
| [06 - Computer uses the shared parts and value readers](task-06-computer-uses-the-shared-parts-and-value-readers.md) | done | 05 |
| [07 - The agent packages use the shared value readers](task-07-the-agent-packages-use-the-shared-value-readers.md) | done | 05 |

## Risks and tradeoffs

- Computer's provider keeps its leaves (`/status`, `/capabilities`, `/stats`), its owner-aware writes, its `watch` and its `moment` from a creation date; it takes the split, the refusal, `asFile` and `bodyText` and nothing else, so a builder must not try to make it a `recordsProvider`.
- Computer's `bodyOf` says the manifest's fields in its first refusal (`manifest.ts:546`); `jsonBody` takes the two sentences' subject, so computer either keeps its own `bodyOf` over `bodyText` or passes its wording, and its sentence does not change.
- Usage's split decodes a pool with colons and keeps a query; `splitResource` returns the raw id and the query, and usage decodes as it does now.
- The peer bump means a daemon on sdk 0.9.0 refuses the new agent plugins at load, which is what the range is for; the daemon installs its own sdk with every plugin (daemon 09), so an updated daemon loads them.
- `configvalues.ts` and `validate.ts` stay hand validators and are not touched: the sdk takes no runtime dependency, so `@cofold/commands` `check` is not an option there.
- The 101 inline error messages shorten to `reason(error)` where a file is already being edited; a sweep of the rest is not this plan.

## Resume state

- **Done so far:** tasks 01 to 07 built; 07 on 2026-10-10.
- **Next action:** none; see [implemented.md](implemented.md).

## Final verification checklist

- [x] `rg -n "^(export )?const (bag|bagOf|str|isRecord|isObject) =" packages/*/src` finds only `values.ts`.
- [x] `policy.ts` and `people.ts` hold no `split`, `asFile`, `moment` or `providerFor` of their own.
- [x] Every plugin package that imports from `values.ts` or `records.ts` has the new peer range, and `pnpm boundary` passes.
- [x] `pnpm exec tsc --noEmit`, `pnpm test` pass.
- [x] `plans/index.md` updated.
