---
title: A pi agent takes a baseUrl and an apiKey
domain: pi
status: planned
priority: medium
created: 2026-11-10
revalidated: 2026-11-10
requires: []
changes: []
creates: []
refs:
  - git://7d76d5895 - the commit of ahpd this plan was checked at
  - "[code://.project/briefs/agent-settings-at-plugin-and-record.md#L95](../../../briefs/agent-settings-at-plugin-and-record.md#L95) - the brief's blue circle for pi's `baseUrl` and `apiKey`, which this plan covers"
  - "[code://packages/agent-pi/package.json#L81](../../../../packages/agent-pi/package.json#L81) - the plugin's options, with no `baseUrl` or `apiKey`"
  - "[code://packages/agent-pi/src/plugin.ts#L87](../../../../packages/agent-pi/src/plugin.ts#L87) - `RECORD_FIELDS`, the record fields a turn runs on"
  - "[code://packages/agent-pi/src/plugin.ts#L124-L136](../../../../packages/agent-pi/src/plugin.ts#L124-L136) - `kindSchema`, the record's form"
  - "[code://packages/agent-pi/src/backend.ts#L270-L280](../../../../packages/agent-pi/src/backend.ts#L270-L280) - a session's services, where its model runtime is made"
  - "[code://packages/agent-pi/src/backend.ts#L398-L415](../../../../packages/agent-pi/src/backend.ts#L398-L415) - `runtimeModels`, the probe's model list from pi's own files"
  - "[code://packages/agent-pi/src/backend.ts#L548-L570](../../../../packages/agent-pi/src/backend.ts#L548-L570) - `useEnv`, the per-session keys over pi's runtime, the seam a record's values reach a turn by"
  - "[code://packages/agent-cofold/src/agent.ts#L355-L380](../../../../packages/agent-cofold/src/agent.ts#L355-L380) - cofold's `providerOptionsOf`, the sibling: one endpoint from `baseUrl`, named by the record"
  - "[code://packages/agent-cofold/src/agent.ts#L749-L765](../../../../packages/agent-cofold/src/agent.ts#L749-L765) - cofold's `listModels`, which reads the endpoint's `/models` and names each `<provider>/<id>`"
  - npm://@earendil-works/pi-coding-agent@1.3.0 - `ModelRegistry.registerProvider(name, { baseUrl, apiKey, api, models, refreshModels })` over a session's `ModelRuntime` (`dist/core/model-registry.d.ts`, `provider-composer.d.ts`)
---

## Goal

A pi agent can run on any OpenAI-compatible endpoint, as a cofold agent can.
A person sets `baseUrl` and `apiKey` on the plugin or on the agent, and the agent lists that endpoint's models and runs on them.
Softov asked for it on 2026-11-10, after the pi resume check.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `grep -n registerProvider node_modules/@earendil-works/pi-coding-agent/dist/core/*.d.ts` - `ModelRegistry`, a facade over a session's `ModelRuntime`, registers and unregisters a provider; `ModelRuntime` has no public call for it.
- `grep -n "baseUrl\|apiKey" packages/agent-pi/src` - none; pi's providers come only from `auth.json` and `models.json`.

### Runtime path

```
record { baseUrl, apiKey } -> optionsOfRecord -> backend -> session runtime
  -> ModelRegistry(runtime).registerProvider(<record id>, { baseUrl, apiKey, api, refreshModels: GET /models })
  -> probe and picker list <record id>/<model> -> a turn streams through that provider
```

### Gaps

- Not checked: whether `registerProvider` on a `ModelRegistry` made over a session's runtime reaches that session's turns. Task 01 checks it first, with a test.
- The probe reads models from pi's own files, with no record; it has to list the endpoint's models for a record with `baseUrl`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `baseUrl` and `apiKey` on the plugin and the record, as cofold has them; the record wins | Softov, 2026-11-10, chose "As cofold: one endpoint" | 01, 02 |
| They register one OpenAI-compatible provider, named by the record's id | Softov, 2026-11-10, the same answer | 01 |
| Its models come from the endpoint's `/models`, each `<record id>/<model id>` | Softov, 2026-11-10, the same answer | 02 |
| The provider's `api` is OpenAI's chat completions | (defaulted: what an OpenAI-compatible endpoint serves, as cofold's adapter speaks) | 01 |
| `apiKey` is `secret: true`, so the vault keeps it | (defaulted: as cofold's record field) | 01 |
| A record with no `baseUrl` runs on pi's own providers, as now | (defaulted: nothing changes for an existing agent) | 01 |
| A record named like one of pi's providers, such as `openrouter`, replaces that provider for its own sessions | Softov, 2026-11-10, chose "The agent's provider wins" | 01 |

## Proposed architecture

- **Data flow** - the record's `baseUrl` and `apiKey` reach `BackendOptions`; the backend registers the provider on each session's runtime, and the probe lists its models.
- **Event flow** - an edit of the record reaches the next turn, and the host asks the probe again (#269).
- **State flow** - nothing is written to pi's `models.json` or `auth.json`; the provider lives in the session's runtime.
- **Layer responsibilities** - agent-pi: the options, the schema, the provider and the probe. docs: the README and the release notes.
- **Source-of-truth files** - [`code://packages/agent-pi/src/backend.ts`](../../../../packages/agent-pi/src/backend.ts), [`code://packages/agent-pi/src/plugin.ts`](../../../../packages/agent-pi/src/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A pi turn runs on the record's endpoint](task-01-a-pi-turn-runs-on-the-endpoint.md) | todo | - |
| [02 - The probe lists the endpoint's models](task-02-the-probe-lists-the-endpoint.md) | todo | 01 |

## Risks and tradeoffs

- If `registerProvider` over a session's runtime does not reach its turns, task 01 stops and asks. Another seam is an extension's `registerProvider`, which pi loads per session.
- A record named like one of pi's providers replaces it for that record's sessions only, as *Answers* says.

## Resume state

- **Done so far:** planned 2026-11-10.
- **Next action:** [task-01-a-pi-turn-runs-on-the-endpoint.md](task-01-a-pi-turn-runs-on-the-endpoint.md).
- **Open questions:** none.
- **Watch out for:** pi's `useEnv` already sets per-session keys on the runtime; the new provider must not be undone by it.

## Final verification checklist

- [ ] A pi agent with `baseUrl` `https://openrouter.ai/api/v1` and a key lists OpenRouter's models and answers a turn.
- [ ] A pi agent with no `baseUrl` lists pi's own models, as before.
- [ ] An edit of `baseUrl` reaches the next turn and the model list, with no restart.
- [ ] The key is in the vault, and no row, answer or log carries it.
- [ ] `pnpm typecheck` and the agent-pi suite pass, and Windows CI is green.
