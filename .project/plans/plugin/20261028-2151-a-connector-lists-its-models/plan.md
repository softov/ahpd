---
title: A connector lists its models to a client
domain: plugin
status: built
priority: medium
created: 2026-10-28
revalidated: 2026-10-28
requires:
  - plans/plugin/71-a-connector-signs-in-with-its-provider/plan.md
refs:
  - git://817615bc:.project/briefs/a-connector-lists-its-models.md - the brief this plan covers
  - git://d6b282f9 - the commit of `origin/main` this plan branches from
  - "[code://packages/server/src/proxy/catalog.ts#L109-L163](../../../../packages/server/src/proxy/catalog.ts#L109-L163) - the catalog, which gets `listOf`"
  - "[code://packages/server/src/proxy/listener.ts#L560-L606](../../../../packages/server/src/proxy/listener.ts#L560-L606) - `firstCandidate`, lifted out of `GET /v1/models`, and `connectorModels`"
  - "[code://packages/sdk/src/connectors/channel.ts#L974-L1000](../../../../packages/sdk/src/connectors/channel.ts#L974-L1000) - the `models` command, beside `check`"
  - "[code://packages/server/src/commands/run.ts#L568-L590](../../../../packages/server/src/commands/run.ts#L568-L590) - the proxy options, now one value both the proxy and the channel read"
  - file:///github/ahpw/.project/plans/plugins/20261028-2151-a-connector-page-says-what-it-serves/plan.md - the ahpw plan that draws this answer
---

## Goal

A client asks the host for the models one provider connector serves, and shows them.
Softov signed in to OpenRouter and saw no model anywhere until he called `GET /v1/models` by hand.
The answer says, for each model, the name a caller sends and whether this caller may call it now.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "catalog" packages/*/src` - the catalog is read only by the proxy's routes and `GET /v1/models`.
- `rg -n "x-ahpd/connectors/" packages/sdk/src` - five commands, none of which answers models.

### Runtime path

```
client -> x-ahpd/connectors/models { id } -> channel: record, mayRead, open, providers()
       -> options.models(connector, reader) -> connectorModels: catalog.refresh, listOf, firstCandidate per name
       -> { models: [{ ...ProviderModel, model, callable }], at }
```

### Gaps

- No channel answers the catalog to a client.
- The catalog does not say when a list was read.
- A connector made after start is read only at the next `GET /v1/models` or the next hour.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Each model carries `model`, the `<prefix>/<id>` name a caller sends | Softov, 2026-10-28: "write the brief build both plans and implement", on the suggestion to send it | 01 |
| The answer lists every model the connector serves, each with a `callable` flag, rather than hiding refused ones | Softov, 2026-10-28, same message | 01 |
| `callable` is asked through the same routes and policies `GET /v1/models` uses | (defaulted: the two answers must never disagree) | 01 |
| A host that serves no proxy answers no `callable` | (defaulted: nobody can call a model there, and `false` on every row reads as a refusal) | 01 |
| The command needs `connector:all`, or `connector:list` and a connector the caller reads | (defaulted: the channel's own read rule) | 01 |
| The model picker does not list connector models in this plan | Softov, 2026-10-28, same message | - |

## Proposed architecture

- **Data flow** - the channel checks the reader and finds the open provider connector, then asks the server's `models` option. The server reads the catalog and asks the proxy's route and policy check for each name.
- **Event flow** - none. The answer is to one request.
- **State flow** - the catalog stays the one store. The command reads a connector it has not seen before it answers.
- **Layer responsibilities** - sdk: the types and the command · server: `listOf`, `connectorModels` and the wiring in `run.ts`.
- **Source-of-truth files** - [`code://packages/server/src/proxy/catalog.ts`](../../../../packages/server/src/proxy/catalog.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The connectors channel answers a connector's models](task-01-the-channel-answers-a-connectors-models.md) | done | - |

## Risks and tradeoffs

- An OpenRouter list has some hundreds of models, and each runs the route and the policy check. `GET /v1/models` does the same work today.
- The proxy options are now built when the API is off too. Only the handler reads `otherwise`, and the handler is built only with the API.

## Resume state

- **Done so far:** task 01, built on 2026-10-28 in `/github/ahpd.worktrees/connector-models`, branch `plugin/connector-models`, not committed.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** the ahpw plan reads this answer. A change of its shape changes ahpw's bridge.

## Final verification checklist

- [x] `pnpm typecheck` passes.
- [x] `packages/sdk/test/connectors-models.test.ts` passes.
- [x] `packages/server/test/proxy-listener.test.ts` passes.
- [x] The full `pnpm test` passes.
- [ ] Softov sees an OpenRouter connector's models on its ahpw page.
