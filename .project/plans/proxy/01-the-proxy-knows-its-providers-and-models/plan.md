---
title: The proxy knows its providers and model names
domain: proxy
status: built
priority: high
created: 2026-10-01
revalidated: 2026-10-01
requires: []
decisions:
  - decisions/a-model-is-named-by-its-maker-and-runs-on-a-provider.md
refs:
  - "[code://packages/server/src/config.ts#L32-L130](../../../../packages/server/src/config.ts#L32-L130) - `Config`"
  - "[code://packages/server/src/commands/options.ts#L143-L295](../../../../packages/server/src/commands/options.ts#L143-L295) - `serverFields` and `configSchema`"
  - "[code://packages/server/src/commands/registry.ts#L48-L59](../../../../packages/server/src/commands/registry.ts#L48-L59) - a command declared once"
  - "[code://packages/agent-cofold/src/config.ts#L21-L30](../../../../packages/agent-cofold/src/config.ts#L21-L30) - `HarnessProvider { id, baseUrl, apiKey?, headers? }`, the closest shape"
---

## Goal

The daemon's configuration names proxy providers, some built in and more added by the user, and model names that point to them; a command lists both.
Nothing listens yet: this is the table the proxy will route by.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
config.json proxy.providers + proxy.models -> checked at start -> ahpd proxy list (CLI and /api)
```

### Gaps

- No provider or model name in config or code.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A model is named by its maker, and where it runs is a provider](../../../decisions/a-model-is-named-by-its-maker-and-runs-on-a-provider.md) | Softov, 2026-10-01 |

| What | Source | Task |
| --- | --- | --- |
| Providers are built in, and the user can add more: an endpoint and what it accepts | Softov, 2026-10-01: "Some preregistered.. but user could add one. Like the endpoint and what is accepts." | 01 |
| What a provider accepts is an API dialect (`anthropic-messages`, `openai-chat`); calls pass through in that dialect, no translation yet | Softov, 2026-10-01, asked which client APIs: "passthought now.. space for translation in a future" | 01 |
| A model name lists the providers that serve it, each with that provider's own model id and an optional price | Softov, 2026-10-01: "saying that model. servers as that name... when calling that name call that provider with those keys" | 01 |
| A key is referenced by environment variable name, never stored in config | (defaulted: keeps secrets out of the config file until [a secret store](../../../ideas/a-secret-store.md) exists) | 01 |
| A listing never shows a key, only whether it is set | (defaulted) | 02 |

## Proposed architecture

- **Data flow** - `proxy.providers.<id> = { endpoint, accepts, key: { env } }`, built-ins merged under the user's; `proxy.models.<maker/name> = [{ provider, id, price? }]`.
- **Layer responsibilities** - `packages/server`: config, schema, built-ins, command.
- **Source-of-truth files** - `CREATE: packages/server/src/proxy/providers.ts`

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Providers and model names in config](task-01-config.md) | done | - |
| [02 - ahpd proxy list](task-02-list.md) | done | 01 |

## Risks and tradeoffs

- Which provider a model name uses when several serve it is the proxy plan's, with prompt cache affinity (rules draft, open question 15).
- Built-in endpoints change upstream; they are defaults the user can override.

## Resume state

- **Done so far:** built 2026-10-01; see [implemented.md](implemented.md).
- **Next action:** the proxy listener plan.
- **Open questions:** none.

## Final verification checklist

- [x] A config adding a provider and a model name starts and lists both; one pointing at a missing provider refuses to start.
- [x] `plans/index.md` updated.
