---
title: A new `@ahpd/agent-*` package exists only when the target brings its own agent runtime
status: accepted
date: 2026-09-20
refs:
  - code://packages/sdk/src/types/plugin.ts - the contract every agent package implements
  - code://packages/server/src/plugins.ts - the loader that turns an installed package into a backend
  - file:///github/cofold/packages/agents/src/index.ts - the harness that already exists, so a model-backed backend is not a new one
  - file:///github/cofold/packages/model-openai-compat/src/index.ts - the `/chat/completions` adapter, which is why OpenAI-compatible and DeepSeek are model configs and not packages
  - file:///github/deepseek-harness/packages/acp/acp/package.json - deepseek-harness ships an ACP server, so it arrives through the ACP package
  - code://.project/ideas/agents-as-extensions.md - the first-party list this corrects
---

## Context

`@ahpd/agent-claude` proved a backend is a package the host knows nothing about, and `ideas/agents-as-extensions.md` then named `@ahpd/agent-acp` and `@ahpd/agent-openai` as the next ones.
That list treated every provider as a package, and the second half of it is wrong: a backend is not a package because it talks to an API, it is a package because there is a *runtime* on the other side to translate.

A runtime is everything an agent needs to exist: the loop, the conversation and its persistence, the workspace, memory, skills, tools and their confirmation, and the pause and resume of a run.
Writing one is exhaustive, which is why facio exists: `@facio/agents` is that runtime once, `@facio/model-openai-compat` is a `/chat/completions` adapter for it, and the model is the only thing that changes between OpenRouter, Ollama, vLLM, LM Studio and any other compatible server.
DeepSeek is the same case, and `deepseek-harness` is the opposite one: it is a full harness that already ships `@deepseek-ai/dsh-acp`, an Agent Client Protocol server, so the way to talk to it is ACP and not a package of its own.

## Decision

A new `@ahpd/agent-*` package is written only when the thing being integrated brings its own agent runtime and the way to talk to it is a new one.
A model, an endpoint or a transport is not a package: it is a facio `ModelAdapter` reached through `@ahpd/agent-cofold`, or configuration of one.
Concretely, the first-party backends are `@ahpd/agent-claude` (Claude Code has its own runtime), `@ahpd/agent-acp` (any ACP server, `@deepseek-ai/dsh-acp` included) and `@ahpd/agent-cofold` (every model-backed provider, with DeepSeek, OpenRouter, Ollama, vLLM and LM Studio as model configs inside one provider).
`@ahpd/agent-openai` and an API-only DeepSeek package are not made.

## Consequences

One package covers every model instead of one package per vendor, so a new model is a facio adapter or a configuration value rather than an ahpd release.
The work in `@ahpd/agent-cofold` is the AHP half: session config to `createAgent`, `RunEvent` to `chat/*`, approval and questions to `inputNeededSet` and `confirm`, and `transcript()` and `list()` read from a facio `Store`.
A harness that gains an ACP server later needs no new package, which is the path `deepseek-harness` already took.
A new runtime with a genuinely new way to talk to it still gets a package, so the rule refuses duplication and not integration.
`Agent.provider` is per registered agent rather than per package, so `agent-cofold` can put two model-backed providers side by side to exercise the register surface.
`@facio/agents` is not published yet, so the bridge is developed against a linked checkout and its dependency becomes a range when facio is on npm.

## Options

- **`@ahpd/agent-openai` as a complete harness**, the earlier idea.
  Rejected: it reimplements sessions, memory, workspace, skills, tools, the loop and the store, which is exactly the exhaustive work facio exists to do once, and it leaves two harnesses to keep in step.
- **A preset package per provider**, `@ahpd/agent-deepseek` as a baseUrl and a key.
  Rejected: a package whose whole content is a default URL, and it makes a model list or an endpoint change an ahpd release.
- **Model adapters inside the agent packages, bypassing facio.**
  Rejected: the harness is the expensive half and it already lives in facio, so ahpd would own the half that is already written.
- **Embedding `deepseek-harness` in process as a library instead of through ACP.**
  Not rejected forever: a second way to talk to a runtime would justify its own package, but `dsh-acp` already exists, is designed to be driven over JSON-RPC, and ACP is one bridge for several backends.
