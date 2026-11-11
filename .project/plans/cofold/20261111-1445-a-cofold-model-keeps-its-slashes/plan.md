---
title: A cofold model on an explicit endpoint keeps its slashes
domain: cofold
status: planned
priority: high
created: 2026-11-11
revalidated: 2026-11-11
requires: []
changes: []
creates: []
refs:
  - git://af15608ab - the commit of ahpd this plan was checked at, and the last one that holds `problems/a-cofold-model-on-an-explicit-endpoint-loses-its-first-segment.md`
  - "[code://packages/agent-cofold/src/agent.ts#L307-L349](../../../../packages/agent-cofold/src/agent.ts#L307-L349) - `adapterOptionsOf`, which sends the part after the first slash for every reference"
  - "[code://packages/agent-cofold/src/agent.ts#L229-L239](../../../../packages/agent-cofold/src/agent.ts#L229-L239) - `endpointOf`, the harness provider a first segment names"
  - "[code://packages/agent-cofold/test/agent-cofold-models.test.ts#L549-L561](../../../../packages/agent-cofold/test/agent-cofold-models.test.ts#L549-L561) - the case where the backend's own prefix is stripped, which stays"
  - "[code://packages/agent-cofold/README.md#L47-L49](../../../../packages/agent-cofold/README.md#L47-L49) - \"The backend's own id is the prefix for an explicit `baseUrl`\""
---

## Goal

A cofold agent on an explicit `baseUrl` sends the endpoint the model id it was given.
On 2026-11-11 a record on OpenRouter with `deepseek/deepseek-chat` sent `deepseek-chat`, and OpenRouter refused it.
The picker's first row, the record's own model, was that broken one.
After this plan, the first segment goes only when it names this backend or a provider of the harness file.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "named.modelId|splitModel" packages/agent-cofold/src` - one cut, in `adapterOptionsOf`.
- `rg "modelOf\(" packages/agent-cofold/test` - the cases on an explicit `baseUrl` name a bare model or the backend's own prefix.
- Test daemon at `7cf919e4b`: `ahpc exec --agent cf-or` gave the 400. `--model cf-or/deepseek/deepseek-chat` ran.

### Runtime path

```
record model -> modelReferenceOf -> adapterOptionsOf -> splitModel -> adapter model id -> POST /chat/completions body.model
```

### Gaps

- With an explicit `baseUrl`, a reference whose first segment is neither the backend's id nor a harness provider is still cut.

## Answers

| What | Source | Task |
| --- | --- | --- |
| With an explicit `baseUrl`, the first segment is cut only when it is the backend's own id or a harness provider | [code://packages/agent-cofold/README.md#L49](../../../../packages/agent-cofold/README.md#L49) | 01 |
| Any other reference on an explicit `baseUrl` is sent whole | `(defaulted: an endpoint's own id with a slash is the id it lists)` | 01 |
| With no explicit `baseUrl`, the rule is unchanged: a reference names a harness provider, or the turn is refused | [code://packages/agent-cofold/src/agent.ts#L319-L329](../../../../packages/agent-cofold/src/agent.ts#L319-L329) | 01 |

## Proposed architecture

- **Data flow** - `adapterOptionsOf` picks the model id from `named` only when `provider` is defined or `named.provider` is the backend's own id. Otherwise it keeps `reference`.
- **Event flow** - unchanged.
- **State flow** - unchanged.
- **Layer responsibilities** - agent-cofold only.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/agent.ts`](../../../../packages/agent-cofold/src/agent.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An endpoint gets the id it was given](task-01-an-endpoint-gets-the-id-it-was-given.md) | implemented | - |

## Risks and tradeoffs

- A record that relied on the cut now sends its id whole, such as `open_router/x`. The endpoint then refuses it, and its error names the id.

## Resume state

- **Done so far:** task 01 implemented, 2026-11-11; see [implemented.md](implemented.md).
- **Next action:** Softov reviews the PR. The plan closes as `built` on his word.
- **Open questions:** none.
- **Watch out for:** the backend's own id is `options.provider`, the record's id in the plugin, and `cofold` for an embedder.

## Final verification checklist

- [x] `modelOf({ baseUrl, provider: 'cf-or' }, { model: 'deepseek/deepseek-chat' }).modelId` is `deepseek/deepseek-chat`.
- [x] `cofold/qwen/qwen3-8b` on an explicit `baseUrl` still gives `qwen/qwen3-8b`.
- [x] `pnpm typecheck` and the agent-cofold suite pass.
