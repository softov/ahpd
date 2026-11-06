---
title: agent-cofold lists models under their provider id
domain: plugin
status: built
priority: high
created: 2026-10-24
revalidated: 2026-10-27
requires: []
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L171-L181](../../../../packages/agent-cofold/src/agent.ts#L171-L181) - `endpointOf`, which finds a provider only from a configured model"
  - "[code://packages/agent-cofold/src/agent.ts#L233-L269](../../../../packages/agent-cofold/src/agent.ts#L233-L269) - `connectionOf`, with the `ownRef` check, the key choice and the prefix"
  - "[code://packages/agent-cofold/src/agent.ts#L546-L559](../../../../packages/agent-cofold/src/agent.ts#L546-L559) - `listModels`, which writes `<prefix>/<id>`"
  - "[code://packages/agent-cofold/src/agent.ts#L561-L577](../../../../packages/agent-cofold/src/agent.ts#L561-L577) - `catalogueOf` and `knownCatalogue`, one endpoint each"
  - "[code://packages/agent-cofold/src/agent.ts#L733-L739](../../../../packages/agent-cofold/src/agent.ts#L733-L739) - `probe`, which lists one connection"
  - "[code://packages/agent-cofold/src/agent.ts#L833](../../../../packages/agent-cofold/src/agent.ts#L833) - `create`, which gives a session the catalogue of one connection"
  - "[code://packages/agent-cofold/src/agent.ts#L148-L162](../../../../packages/agent-cofold/src/agent.ts#L148-L162) - `resourceOf`, the origin a lent key belongs to"
  - "[code://packages/agent-pi/src/models.ts#L41](../../../../packages/agent-pi/src/models.ts#L41) - agent-pi writes `<provider>/<model>` with no name of its own"
  - "[code://packages/agent-cofold/test/agent-cofold-models.test.ts#L203-L216](../../../../packages/agent-cofold/test/agent-cofold-models.test.ts#L203-L216) - the test of an endpoint no file provider owns"
  - "file:///github/ahp-review/briefs/agent-cofold-vs-pi.md - the brief this plan answers"
---

## Goal

Each model that agent-cofold lists starts with the id of the provider that serves it, as agent-pi's do.
On Softov's machine, `cofold/moonshotai/kimi-k3.1-pro` becomes `open_router/moonshotai/kimi-k3.1-pro`.
Every provider in `~/.config/cofold/config.json` is listed, not only the first.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "prefix" packages/agent-cofold/src` - `Connection.prefix` is set in `connectionOf` and read only in `listModels`.
- `rg -n "providers\[0\]" packages/agent-cofold/src` - the base URL and the key both fall back to the first provider.
- `rg -n "cofold/" packages/agent-cofold/test` - one test expects `cofold/qwen/qwen3-8b` for an explicit `baseUrl`.

### Runtime path

```
probe / create -> connectionOf(strict=false) -> one Connection -> catalogueOf -> listModels -> `${prefix}/${id}`
turn -> modelOf -> connectionOf(strict=true) -> the provider the reference names -> providerOf(connection).model(...)
```

### Gaps

- With no `model` configured, `endpointOf` finds no provider, so the prefix is `own` (`cofold`), while the base URL falls back to the first provider.
- Only one connection is listed, so a second provider in the file is never asked for its models.
- The key is `lent ?? options.apiKey ?? provider.apiKey ?? providers[0].apiKey`. A lent key or the option key goes to whichever provider is named, and the first provider's key goes to an explicit `baseUrl`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The prefix of a listed model is the id of the file provider that serves it | Softov, 2026-10-24: "I want to solve the fucked cofold/ before the model name" | 01 |
| Every provider in the file is listed, each under its own id | Softov, 2026-10-24: "List every provider" | 01 |
| The `ownRef` check is removed, so `cofold/<id>` no longer resolves to a file provider and fails with the error that names the configured providers | Softov, 2026-10-24: "Remove it" | 02 |
| `own` stays the prefix only for an endpoint that no file provider owns: an explicit `baseUrl`, or the local endpoint when the file has no provider | (defaulted: those endpoints have no provider id, and the list must stay selectable) | 02 |
| A key goes only to the endpoint it belongs to. A file provider gets its own `apiKey`. The lent key and `options.apiKey` go only to the endpoint whose origin `resourceOf` names. The first provider's key never goes to another endpoint | (defaulted: listing every provider would otherwise send one provider's key to all of them) | 01 |
| The listing and a turn use the same key rule, so a listed model runs on the endpoint and key it was read from | (defaulted: `connectionOf` already serves both) | 01 |
| A provider that fails to list adds no rows, and the others still list | (defaulted: `listModels` already answers an empty list on any error) | 01 |
| The session schema has no `model` field, so a new session's picker draws the agent's `models`, as for Claude, pi and ACP agents | Softov, 2026-10-27: "Remove `model` from the schema" | 04 |

## Proposed architecture

- **Data flow** - `connectionsOf` gives one `Connection` per file provider, or the one explicit or local endpoint. `probe` and `create` merge their catalogues.
- **Event flow** - none.
- **State flow** - the catalogue cache stays keyed by base URL and key, so each provider has its own entry.
- **Layer responsibilities** - agent-cofold only. No other package changes.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/agent.ts`](../../../../packages/agent-cofold/src/agent.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - List every provider under its own id](task-01-list-every-provider-under-its-id.md) | done | - |
| [02 - The cofold prefix names only an unowned endpoint](task-02-cofold-prefix-only-unowned-endpoint.md) | done | 01 |
| [03 - The README says how models are listed](task-03-readme-says-how-models-are-listed.md) | done | 02 |
| [04 - A new Cofold session picks a model](task-04-a-new-session-picks-a-model.md) | done | - |

## Risks and tradeoffs

- A session saved with a `cofold/<id>` model on a file provider fails its next turn. Softov chose this.
- A file with many providers makes one `GET /models` call per provider at the first probe.

## Resume state

- **Done so far:** tasks 01 to 04 are implemented.
  Every provider in the cofold file is listed under its own id, each with its own key.
  The `cofold` prefix remains only for an explicit `baseUrl` or the local endpoint.
  The README says how models are named.
  The session schema has no `model`, so a new session's picker draws the agent's `models`.
  `pnpm -s typecheck`, the full `packages/agent-cofold` suite, `pnpm -s build`, `pnpm -s boundary` and `pnpm -s docs:build` pass.
- **Reopened:** 2026-10-27, a new Cofold session showed no Model picker in ahpw. Task 04 removes `model` from the session schema.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** `infoOf` searches every catalogue by reference already, so it needs no change. Keep the five-second catalogue limit per provider, and ask the providers in parallel.

## Final verification checklist

- [ ] On Softov's daemon, the agent-cofold model list shows `open_router/...` ids and no `cofold/...` id.
- [ ] One turn on a listed `open_router/...` model answers.
- [x] `plans/index.md` updated.
