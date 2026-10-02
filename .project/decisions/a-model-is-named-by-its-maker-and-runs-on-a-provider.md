---
title: A model is named by its maker, and where it runs is a provider
status: accepted
date: 2026-10-01
refs:
  - "[code://packages/agent-pi/src/models.ts#L34](../../packages/agent-pi/src/models.ts#L34) - pi spells a model `<pi provider>/<model id>`"
  - "[code://packages/agent-cofold/src/agent.ts#L299-L328](../../packages/agent-cofold/src/agent.ts#L299-L328) - cofold spells it `<harness provider>/<model id>`"
---

## Context

The same model is written differently by each backend: pi and cofold prefix it with their own provider name, claude uses its CLI's values, ACP its server's.
A rule or a record that names a model would need one entry per spelling.

## Decision

A model is named `<maker>/<name>`, such as `anthropic/fable-5` or `deepseek/deepseek-v4.1-flash`, on the wire and in records.
Where it runs is a separate provider: `openrouter`, `anthropic`, `local-vllm`.
The proxy's model names use this form first; the backends move to it in their own plan, which supersedes [listed-models-are-provider-references](listed-models-are-provider-references.md).
Source: Softov, 2026-10-01, asked "How far does the common model id go?": "Wire + record.. also for the claude model.. is a plugin to run claude agent sdk. not necessary claude model only".

## Consequences

One rule and one record name a model once, whatever ran it.
Each backend needs a resolver from the common name to its own reference, and the claude backend's provider comes from its configured endpoint, not from the id.

## Options

- **Normalise only when recording**, keeping each harness's reference on the wire: rejected, switching harness would still change the name a client picks.
