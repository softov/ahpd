---
title: GET /v1/models lists the names a caller may use
status: implemented
depends: [task-02-a-caller-is-somebody.md, task-03-a-name-is-routed.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/proxy.ts#L74-L93](../../../../packages/server/src/commands/proxy.ts#L74-L93) - `proxy.list`, which lists the same table to an operator"
  - "[code://.project/decisions/the-models-list-answers-in-the-dialect-the-caller-sent.md](../../../decisions/the-models-list-answers-in-the-dialect-the-caller-sent.md) - the shape by `anthropic-version`"
---

## Objective

`GET /v1/models` answers the `<maker>/<name>` names the caller could call now, in Anthropic's list shape when `anthropic-version` is sent and OpenAI's otherwise.

## Files

- `UPDATE: packages/server/src/proxy/listener.ts` - the `/v1/models` route.
- `UPDATE: packages/server/src/proxy/dialects.ts` - the two list shapes.
- `UPDATE: packages/server/test/proxy-listener.test.ts`.

## Steps

1. The caller is checked as in task 02, with `proxy:read`.
2. A name is listed when at least one of its entries is a candidate in `route`'s sense for some dialect: its key is set or it has none, and with checks on a `model` policy allows it for the caller.
3. OpenAI: `{ object: 'list', data: [{ id, object: 'model', created: 0, owned_by: <maker> }] }`. Anthropic: `{ data: [{ type: 'model', id, display_name: id, created_at: '1970-01-01T00:00:00Z' }], has_more: false, first_id, last_id }`.
4. No provider id, endpoint, price or variable is in the answer.

## Validation

- Failing first: `GET /v1/models` is task 01's 404.
- Softov's table: all four names with every key set; `anthropic/claude-opus-5-5` gone with `ANTHROPIC_API_KEY` unset; a deny on `model:openai/*` drops `openai/gpt-5.5` for that person and not for root.
- Each shape parses with its SDK's list type; no credential is 401 in OpenAI's body.

## Resume

Implemented 2026-10-06.
The `/v1/models` route in `listener.ts` and `modelList` in `dialects.ts`; a refusal there follows `anthropic-version` too, and a method other than `GET` is 405 with `Allow: GET`.
Tests: `proxy-listener.test.ts` third describe.
