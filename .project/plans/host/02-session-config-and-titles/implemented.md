---
title: The root config grows two keys, and a chat keeps its title - implemented
date: 2026-09-20
refs:
  - code://packages/sdk/src/host.ts
  - code://packages/sdk/src/types/host.ts
  - code://packages/sdk/src/artifacttools.ts
  - code://packages/sdk/src/sessiontools.ts
  - code://packages/sdk/src/types/sessions.ts
  - code://packages/sdk/src/sessions.ts
  - code://test/conformance.test.ts
  - code://test/host.test.ts
  - code://test/artifacttools.test.ts
  - code://test/sessiontools.test.ts
  - code://test/sessions.test.ts
---

The two root keys a client can push now do something: `artifactToolsCompactPrompts` selects a short artifact instruction and ADD description, and `deferredTitleGeneration` gives a new session a deferred title strategy under which `rename_chat` is offered without its `automatic` argument.
A session's title strategy is snapshotted when it opens, a utility strategy withholds `rename_chat` entirely, and a title given to a chat is written to the session store so a chat created again after a restart comes back under that name.

## What was built

- `code://packages/sdk/src/host.ts` - `ROOT_CONFIG_SCHEMA` declares `artifactToolsCompactPrompts` and `deferredTitleGeneration` as booleans with titles and descriptions; `compactPrompts()` reads the first; `strategies` and `strategyOf(uri)` resolve the second, snapshotted in `openSession` before `spawn`; `shapedDefinition(one, uri)` merges the compact variant and then the session's `forSession` answer and drops a tool the strategy withholds; `toolDefinitions(uri)`, `boundTools(uri, chatUri)` and `instructions(uri)` all read it; the `root/configChanged` handler re-dispatches `session/serverToolsChanged` and calls `retool` for every running session when the compact key moves.
- `code://packages/sdk/src/types/host.ts` - `TitleStrategy` is `activeAgent` or `utility` or `deferred`; `HostTool` gains `compact` and `forSession`.
- `code://packages/sdk/src/artifacttools.ts` - `COMPACT_ARTIFACT_TOOLS_INSTRUCTION` is the reference's short instruction with the discovery sentence, a short ADD description names the tool, and the ADD tool carries both under `compact`.
- `code://packages/sdk/src/sessiontools.ts` - `rename_chat` reads its arguments from `RENAME_CHAT_PROPERTIES`, and `forSession` withholds the tool under `utility`, offers it with `DEFERRED_RENAME_CHAT_DESCRIPTION` and the `automatic` property dropped under `deferred`, and leaves it alone under `activeAgent`.
- `code://packages/sdk/src/types/sessions.ts` - `SessionStore` gains `chatTitle(id, chatUri)` and `setChatTitle(id, chatUri, title)`.
- `code://packages/sdk/src/sessions.ts` - `memorySessions` holds a title map per session id and an internal `chatTitlesOf(id)` so the file store can write the whole slot at once; `Saved.sessions[]` gains `chatTitles`; `save` writes a non-empty one; `load` takes only string values; `forget` drops the slot.
- `code://packages/sdk/src/host.ts` - `spawn` applies `kept.chatTitle` before a chat is announced, `renameChat` writes the title beside `setTitle`, and `openSession` and the `create_chat` tool write a title given at creation.

## Verified

- `test/conformance.test.ts` - 18 tests, the root config case now asserts the three declared keys.
- `test/host.test.ts` - 277 tests, three new: the compact key swaps the artifact instruction and still advertises all three artifact tools, a deferred session's `rename_chat` has no `automatic` property and still answers an explicit rename in the same words, and a renamed peer chat comes back with its title after a restart on the same file.
- `test/artifacttools.test.ts` - 9 tests, one new: the ADD tool's `compact` instruction and description differ from the long ones and both name `add_artifact_or_reference`.
- `test/sessiontools.test.ts` - 16 tests, one new: `forSession` answers `offered: false` for `utility`, `undefined` for `activeAgent`, and a definition without `automatic` and with the deferred description for `deferred`.
- `test/sessions.test.ts` - 12 tests, one new for this plan: two chat titles are written, read back by a second `fileSessions` on the same file, an unrelated chat answers `undefined`, and `forget` drops them.
- `pnpm test` green: 35 files, 635 tests, the schema check included.
- `pnpm typecheck` and `pnpm boundary` green.

## Departures from the plan

- The compact ADD description is a genuinely short sentence that names `add_artifact_or_reference`, rather than the reference's compact definition text. The reference's compact and long ADD descriptions are the same string and differ only in the `isArtifact` property wording, which this host has no separate variant for; the plan asked for a description that differs from the long one and names the tool, and this is that.
- `memorySessions` returns `SessionStore & HeldChatTitles`, an internal interface with `chatTitlesOf(id)`. The port answers one chat at a time by design, and `save` needs the whole slot to write it down, so the extra reader is internal to `sessions.ts` and not part of `SessionStore`.
- The deferred test drives `session/titleChanged` on a subscribed peer-chat channel and reads the `session/chatUpdated` action, because that is the path a client's rename takes and the action the reference window draws a chat row from.
- The compact re-dispatch is triggered with `Object.prototype.hasOwnProperty` on `artifactToolsCompactPrompts`, so a client taking the key back with a `null` value re-shapes the tools too.

## Left for later

- The two by-hand checklist items in [plan.md](plan.md) were not run as manual sessions; the same behaviours are covered by `test/host.test.ts`, `test/artifacttools.test.ts` and `test/sessiontools.test.ts`.
- Deferred generation is the strategy and the tool gating, not a title generated from a utility model, because this host has no utility model. That is the plan's first open question and no task promised the generation itself.
