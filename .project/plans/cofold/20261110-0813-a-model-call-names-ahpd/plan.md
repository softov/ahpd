---
title: A cofold model call names ahpd
domain: cofold
status: planned
priority: medium
created: 2026-11-10
revalidated: 2026-11-10
requires: []
changes:
  - specs/cofold-backend.md
creates: []
refs:
  - git://7d76d5895 - the commit of ahpd this plan was checked at
  - git://962cdc23e:.project/briefs/ahpd-runs-copapo-and-names-itself.md - the brief this plan covers, with the names and the copapo preset in the other two plans
  - "[code://packages/agent-cofold/src/agent.ts#L527](../../../../packages/agent-cofold/src/agent.ts#L527) - `openaiCompat`, a turn's model when the backend holds no provider for it"
  - "[code://packages/agent-cofold/src/agent.ts#L721-L733](../../../../packages/agent-cofold/src/agent.ts#L721-L733) - `providerOf`, which builds each provider with `openaiCompatProvider` and no app"
  - "[code://packages/agent-cofold/src/agent.ts#L29-L131](../../../../packages/agent-cofold/src/agent.ts#L29-L131) - `CofoldOptions`, where the app is passed in"
  - "[code://packages/agent-cofold/src/plugin.ts#L241](../../../../packages/agent-cofold/src/plugin.ts#L241) - `apply`, which has the plugin host"
  - "[code://packages/sdk/src/types/plugin.ts#L709-L710](../../../../packages/sdk/src/types/plugin.ts#L709-L710) - `PluginContext.version`, the version of `@ahpd/sdk` in use"
  - "[code://packages/agent-cofold/package.json#L72](../../../../packages/agent-cofold/package.json#L72) - `@cofold/model-openai-compat` `^0.2.1`, which has no app option"
  - npm://@cofold/model-openai-compat@^0.3.0 - the `app: { name, version, url }` option, `appHeaders` and the OpenRouter host test
  - https://github.com/softov/cofold/blob/3551a23/packages/model-openai-compat/src/app.ts - `User-Agent` on every request, `HTTP-Referer` and `X-OpenRouter-Title` to `openrouter.ai` only, a provider's own headers winning
  - https://openrouter.ai/docs/app-attribution - `HTTP-Referer` makes an app page, and `X-OpenRouter-Title` names it
---

## Goal

Every model call of a cofold agent says it comes from ahpd.
OpenRouter attributes the usage to an app page named ahpd, at `https://ahpio.com`.
Other endpoints see `User-Agent: ahpd/<version>` in place of Node's.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git grep -n "openaiCompat" -- packages/agent-cofold/src` - two constructions: `openaiCompat` at `agent.ts:527` and `openaiCompatProvider` at `agent.ts:725`.
- `npm view @cofold/model-openai-compat version` - `0.3.0`, with the app option; ahpd is on `^0.2.1`.
- `grep -n version packages/sdk/src/types/plugin.ts` - a plugin reads `host.version`, the version of `@ahpd/sdk`, which every ahpd package shares.

### Runtime path

```
apply(host) -> cofoldAgent({ app }) -> providerOf / openaiCompat({ app }) -> each request
  -> User-Agent: ahpd/<version>; to openrouter.ai also HTTP-Referer and X-OpenRouter-Title
```

### Gaps

- With `0.3.0` and no app, cofold sends `User-Agent: cofold/0.3.0` and names cofold to OpenRouter. ahpd passes its own app.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The app is `{ name: 'ahpd', version, url: 'https://ahpio.com' }` | the brief, from Softov's words of 2026-11-10 | 01 |
| The version is `host.version`, the version of `@ahpd/sdk` in use, which the daemon and agent-cofold share | (defaulted: the brief's open point; a plugin reads it, and every ahpd package has one version) | 01 |
| A provider's own `headers` in the harness file still win over the app's | https://github.com/softov/cofold/blob/3551a23/packages/model-openai-compat/src/app.ts | 01 |
| agent-cofold takes `@cofold/model-openai-compat` `^0.3.0` | (defaulted: the first version with the option) | 01 |

## Proposed architecture

- **Data flow** - `apply` reads `host.version` and passes `app` in `CofoldOptions`; `providerOf` and `openaiCompat` pass it to cofold.
- **Event flow** - none.
- **State flow** - none; the provider cache key is unchanged, since one backend has one app.
- **Layer responsibilities** - agent-cofold: the option and the two constructions. docs: the release notes.
- **Source-of-truth files** - [`code://packages/agent-cofold/src/agent.ts`](../../../../packages/agent-cofold/src/agent.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Each model call names ahpd](task-01-each-model-call-names-ahpd.md) | todo | - |

## Risks and tradeoffs

- A bump of `@cofold/model-openai-compat` can change more than the app. Run the whole agent-cofold suite, and read the package's changes from `0.2.1` to `0.3.0` first.

## Resume state

- **Done so far:** planned 2026-11-10.
- **Next action:** [task-01-each-model-call-names-ahpd.md](task-01-each-model-call-names-ahpd.md).
- **Open questions:** none.
- **Watch out for:** a test that stubs `fetch` reads the headers; the `answering` helpers in `agent-cofold-models.test.ts` keep `init.headers`.

## Final verification checklist

- [ ] A request to an endpoint carries `User-Agent: ahpd/<version>`.
- [ ] A request to `openrouter.ai` also carries `HTTP-Referer: https://ahpio.com` and `X-OpenRouter-Title: ahpd`.
- [ ] A provider whose harness entry sets `user-agent` keeps its own.
- [ ] `pnpm typecheck` and the agent-cofold suite pass, and Windows CI is green.
