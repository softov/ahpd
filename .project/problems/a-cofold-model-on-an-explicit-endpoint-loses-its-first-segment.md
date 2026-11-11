---
title: A cofold model with a slash on an explicit endpoint loses its first segment
status: open
date: 2026-11-11
severity: major
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L307-L349](../../packages/agent-cofold/src/agent.ts#L307-L349) - `adapterOptionsOf` sends `named.modelId` for any reference with a slash"
  - "[code://packages/agent-cofold/src/agent.ts#L229-L239](../../packages/agent-cofold/src/agent.ts#L229-L239) - `endpointOf` reads the first segment as a provider of the harness file"
  - "[code://packages/agent-cofold/README.md](../../packages/agent-cofold/README.md) - \"The backend's own id is the prefix for an explicit `baseUrl`\""
---

## Symptom

A test daemon at `7cf919e4b` on 2026-11-11 ran a cofold record with `"baseUrl": "https://openrouter.ai/api/v1"` and `"model": "deepseek/deepseek-chat"`.
OpenRouter answered 400: "Model ID 'deepseek-chat' is ambiguous".
cofold had sent `deepseek-chat`, not the id the record names.
A plugin option `model` of `deepseek/deepseek-chat` on the same `baseUrl` fails the same way.
The picker of that record lists the broken `deepseek/deepseek-chat` first, and `cf-or/deepseek/deepseek-chat` after it. A turn on the second runs.

## Cause

`adapterOptionsOf` splits every reference at its first slash and sends the part after it.
With an explicit `baseUrl`, the first segment is the backend's own id only when it is that id.
OpenRouter's ids have a slash of their own, so `deepseek/deepseek-chat` loses `deepseek/`.

## Impact

Every OpenRouter model named in a record or a plugin option fails, or runs on another model where the cut id matches one.
The default row of the picker is the broken one.

## Workaround

Name the model with the record's id first, such as `cf-or/deepseek/deepseek-chat`.

## Fix

Candidates, none chosen:

- With an explicit `baseUrl`, strip the first segment only when it names the backend or a harness provider. Send any other reference whole.
- Qualify the record's model with the backend's id when the record is written.
