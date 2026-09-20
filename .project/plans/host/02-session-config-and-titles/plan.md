---
title: The root config grows two keys, and a chat keeps its title
domain: host
status: built
priority: medium
created: 2026-09-19
revalidated: 2026-09-19
requires: []
changes: []
creates: []
decisions:
  - decisions/root-config-grows-two-keys.md
refs:
  - code://.project/review/2026-09-19-upstream-pass-4.md#L32-L38 - the two items this plan takes: the compact artifact wording and deferred title generation with the title that survives
  - code://packages/sdk/src/host.ts#L3352-L3369 - `rootConfig` and `ROOT_CONFIG_SCHEMA`, which declare `defaultShell` and nothing else
  - code://packages/sdk/src/host.ts#L3370-L3384 - `rootState`, which reports the schema and the values a client pushed
  - code://packages/sdk/src/host.ts#L5713-L5739 - the `root/configChanged` handler, where a pushed key is kept and said back
  - code://packages/sdk/src/host.ts#L3118-L3135 - `contributing` and `toolDefinitions`, one flat set reported to every session
  - code://packages/sdk/src/host.ts#L3168-L3174 - `retool`, which hands a session's chats their tools again
  - code://packages/sdk/src/host.ts#L3330-L3335 - `boundTools` and `instructions`, which take every tool's definition and instruction
  - code://packages/sdk/src/host.ts#L3608-L3610 - the session snapshot's `serverTools`
  - code://packages/sdk/src/host.ts#L3872-L3887 - `setTools`, which replaces the set and tells every running session
  - code://packages/sdk/src/sessiontools.ts#L496-L528 - `rename_chat`, always offered and always carrying `automatic`
  - code://packages/sdk/src/artifacttools.ts#L150-L172 - the one artifact instruction and the ADD description
  - code://packages/sdk/src/host.ts#L2231-L2244 - the in-memory chats map and `held.chats.set`, where a chat is created
  - code://packages/sdk/src/host.ts#L3198-L3214 - `renameChat`, which sets the title and dispatches it
  - code://packages/sdk/src/host.ts#L3302-L3308 - the tool context's `rename` and `setArtifacts`
  - code://packages/sdk/src/sessions.ts#L16-L29 - `memorySessions`, the slots a store holds
  - code://packages/sdk/src/sessions.ts#L45-L49 - `Saved`, the persisted shape
  - code://packages/sdk/src/sessions.ts#L118-L153 - the load and the store a restart reads
  - code://packages/sdk/src/types/sessions.ts#L27-L57 - `SessionStore`, the port
  - code://test/host.test.ts#L2872-L2902 - the title cases on the wire
  - code://test/host.test.ts#L4440-L4461 - the `rename_chat` tool cases
  - code://test/sessions.test.ts#L78-L124 - the restart tests the title joins
  - code://test/sessiontools.test.ts#L196-L208 - the nine names and the required fields
  - code://test/conformance.test.ts#L438-L467 - the root config test that names the schema's keys
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/agentHostSchema.ts#L549-L575 - the root keys the reference declares, including both of these
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/artifactToolsConfiguration.ts#L1-L40 - the window setting mapped onto the compact key
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/shared/artifactServerTools.ts#L113 - `useCompactPrompts` on the accessor
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/shared/artifactServerTools.ts#L152-L153 - `getDefinitions` chooses the wording
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/shared/artifactServerTools.ts#L251-L259 - the compact instruction and `getArtifactToolsInstruction`
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L1520-L1532 - `isEnabled` and `getDefinitionForSession` shape `rename_chat` by strategy
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L56-L92 - a title persisted per chat and restored when it hydrates
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostSessionTitleController.ts#L905-L921 - the strategy snapshotted per session
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostSessionTitleController.ts#L104-L118 - the controller surface the strategy is read from
---

## Goal

The two window settings stop being inert: `artifactToolsCompactPrompts` chooses a short artifact instruction, and `deferredTitleGeneration` gives a session a title strategy the tool layer can see, under which `rename_chat` is not offered for a utility strategy and loses its `automatic` argument when generation is deferred.
A title given to a chat is kept by the session store, so a renamed chat comes back named after a host restart.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "ROOT_CONFIG_SCHEMA" packages/sdk/src` - one declaration, with `defaultShell` its only property.
- `rg -n "compact|deferLoading|alwaysLoad" packages/` - nothing; there is one artifact wording and no deferral.
- `rg -n "deferredTitleGeneration|strategy|utility" packages/sdk/src` - nothing; a title comes from the catalogue or a client.
- `rg -n "rename_chat" packages/sdk/src` - one definition and one `automatic` property, with no per-session variation.
- `rg -n "chatUpdated|setTitle" packages/sdk/src/host.ts` - `renameChat` calls `found.setTitle` and dispatches; `chats` is a `Map`.
- `rg -n "artifacts\\(|setArtifacts\\(" packages/sdk/src/sessions.ts` - the slot pattern a kept title follows.

### Runtime path

```
root/configChanged { artifactToolsCompactPrompts, deferredTitleGeneration } -> rootConfig
  -> the artifact instruction, short or long
  -> a session's title strategy: activeAgent | utility | deferred
     -> utility: rename_chat absent from serverTools and from what the backend is handed
     -> deferred: rename_chat without `automatic`, re-described
client session/titleChanged | rename_chat -> renameChat -> chat.setTitle + dispatch
  -> kept by the session store -> the row and the chat come back named after a restart
```

### Gaps

- `Not found: a per-session tool set - searched "toolDefinitions" and "getDefinitionForSession" in packages/sdk/src; contributing is one flat list reported to every session.` This is what the `rename_chat` gating needs.
- `Not found: a title strategy - searched "strategy", "utility" and "deferred" in packages/sdk/src.`
- `Not found: a title kept anywhere - searched "setTitle" and "title" in packages/sdk/src/sessions.ts; renameChat sets it on a chat in a Map and nothing writes it down.`
- `Not found: a compact artifact wording - searched "compact" in packages/; ARTIFACT_TOOLS_INSTRUCTION is the only one.`
- No utility model exists in this host, so deferred generation here is the strategy and the tool gating, not a title generated from a utility model.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [The root config grows the artifact prompt switch and deferred title generation](../../../decisions/root-config-grows-two-keys.md) | Softov, 2026-09-19: "Both, and implement deferred title generation too." |

| What | Source | Task |
| --- | --- | --- |
| `ROOT_CONFIG_SCHEMA` declares `artifactToolsCompactPrompts` and `deferredTitleGeneration`, both booleans and both false when unset | decision 1 and reference `agentHostSchema.ts#L553-L562` | 01 |
| The compact wording is the reference's short instruction with the "List/remove (discover if needed)" sentence, and changes no availability | reference `artifactServerTools.ts#L251-L259` | 02 |
| A session's strategy is `activeAgent` unless `deferredTitleGeneration` is on, which makes it `deferred`; a utility strategy is what withholds the tool | reference `agentHostSessionTitleController.ts#L905-L921` | 03 |
| Under `utility`, `rename_chat` is not offered; under `deferred`, its `automatic` property goes and its description changes | reference `sessionServerTools.ts#L1520-L1532` | 03 |
| The strategy is snapshotted when a session opens, so a later root change affects sessions opened after it | reference controller comment, `agentHostSessionTitleController.ts#L104-L118` | 03 |
| A chat's title is written to the session store on rename and on creation, and applied when the chat is created again | reference `sessionTitleContribution.ts#L56-L92` | 04 |

## Proposed architecture

- **Data flow** - `rootConfig` is already kept whole and only its schema gates what is acted on. Two properties join the schema; `artifactTools()` gains a compact wording selected by the key, and a per-session `toolDefinitions(uri)` shapes `rename_chat` from `strategyOf(uri)`.
- **Event flow** - a client pushes `root/configChanged`; the artifact wording is read where the instruction list is built and the tool set is shaped, and the title strategy is snapshotted into a map when a session opens, so a running turn is not handed a changed set.
- **State flow** - a chat title lives in `chat.setTitle` and is mirrored into the session store by `renameChat`, which is the one path a client's `session/titleChanged` and the `rename_chat` tool both take. `spawn` applies a stored title as it creates the chat, before any client sees it.
- **Layer responsibilities** - packages/sdk: the two keys and the per-session tool shapes in `host.ts`, the strategy map, the store slots in `sessions.ts` and `types/sessions.ts`, the two artifact wordings in `artifacttools.ts`, the gated `rename_chat` in `sessiontools.ts` · test/: the keys, the wording, the gating and the restart.
- **Source-of-truth files** - `code://packages/sdk/src/host.ts`, `code://packages/sdk/src/sessions.ts`, `code://packages/sdk/src/artifacttools.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The root config keys](task-01-root-config-keys.md) | done | - |
| [02 - The compact artifact wording](task-02-compact-artifact-wording.md) | done | 01 |
| [03 - Deferred title generation](task-03-deferred-title-generation.md) | done | 01 |
| [04 - A chat keeps its title](task-04-persist-chat-title.md) | done | - |

## Risks and tradeoffs

- A per-session tool set is the largest change here, because `contributing` is one flat list reported everywhere; the definitions are shaped at the three report sites and where the backend is handed its tools.
- Declaring a key is a promise that pushing it changes something, so both keys have behaviour behind them and neither is a stub (decision 1).
- A strategy snapshotted at open means a root change does not retitle a running session, which matches the reference and keeps a running chat's name stable.
- Deferred generation here is the strategy and the gating and not a generated title, since this host has no utility model; the first open question records that.
- A stored title is applied when the chat is created, so a host that only browses a session it is not running still shows the catalogue's title.

## Resume state

- **Done so far:** all four tasks are done; the root config declares and acts on both keys, the artifact wording is compact or long by the client's choice, a session's title strategy is snapshotted when it opens and shapes `rename_chat`, and a chat's title is kept by the session store and applied when the chat is created again. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built.
- **Open questions:**
  1. Is a generated title wanted without a utility model, for instance seeded from the first message? - answered: no; this plan builds the strategy and the gating the decision names and leaves generation to a later decision.
  2. Does the window forward both keys to a host that declares them? - answered: yes once declared; `artifactToolsCompactPrompts` is acted on where the tools are built and `deferredTitleGeneration` where a session opens.
- **Watch out for:** under `utility` the tool is absent rather than present with an empty schema; under `deferred` it stays offered without `automatic`, and the run refuses an `automatic` the schema no longer carries.

## Final verification checklist

- [x] `pnpm test` green, with new cases in `test/conformance.test.ts`, `test/host.test.ts`, `test/artifacttools.test.ts`, `test/sessiontools.test.ts` and `test/sessions.test.ts`.
- [x] `pnpm typecheck` and `pnpm boundary` green.
- [ ] By hand: pushing `artifactToolsCompactPrompts: true` changes the artifact instruction, and `deferredTitleGeneration: true` gives a new session a `rename_chat` without `automatic`, while a utility strategy withholds it.
- [ ] By hand: rename a peer chat, restart the host on the same session file, and the chat comes back with its title.
- [x] `plans/index.md` updated.
