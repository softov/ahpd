---
title: GET /v1/models answers in Anthropic's shape when the caller sends anthropic-version, and in OpenAI's otherwise
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/server/src/proxy/providers.ts#L19-L23](../../packages/server/src/proxy/providers.ts#L19-L23) - the two dialects"
  - https://platform.openai.com/docs/api-reference/models/list - OpenAI's list shape
  - https://docs.anthropic.com/en/api/models-list - Anthropic's list shape
---

## Context

Both dialects list models at the same path, `GET /v1/models`, with different shapes.
The proxy serves both dialects under one `/v1`, so the one path has to answer two kinds of caller.
The Anthropic SDKs and Claude Code send `anthropic-version` on every request; the OpenAI SDKs never do.

## Decision

`GET /v1/models` answers in Anthropic's shape when the request carries `anthropic-version`, and in OpenAI's shape otherwise.
The ids listed are the `<maker>/<name>` model names, never a provider's own id.
Source: `(defaulted: the header is what tells the two callers apart at one path; Softov may erase it)`.

## Consequences

A caller of either dialect lists models with its own SDK and no configuration.
A hand-written request that wants Anthropic's shape has to send the header, as Anthropic's API itself requires.

## Options

- **Two paths, such as `/v1/anthropic/models`**: rejected, no SDK asks for it, so a tool would not find the list.
- **Only OpenAI's shape**: rejected, an Anthropic SDK listing models would fail to parse the answer.
