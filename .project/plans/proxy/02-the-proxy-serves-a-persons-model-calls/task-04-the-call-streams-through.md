---
title: The call goes out with the provider's key and streams back unchanged
status: todo
depends: [task-01-v1-answers-in-each-dialect.md, task-03-a-name-is-routed.md]
layer: "server"
refs:
  - "[code://packages/server/src/proxy/providers.ts#L25-L39](../../../../packages/server/src/proxy/providers.ts#L25-L39) - a provider's endpoint, dialects and key variable"
  - npm://@cofold/remote@0.4.0 - `toNodeListener` writes a `Response` body as a stream and copies its headers
---

## Objective

A routed call is sent to the upstream URL with the body's `model` replaced by the entry's id and the provider's key in the dialect's header, and the provider's status, its safe headers and its body come back as they came, SSE included, with nothing of the caller's credential sent and nothing of the key written anywhere.

## Files

- `UPDATE: packages/server/src/proxy/listener.ts` - the forward, replacing task 01's stub.
- `UPDATE: packages/server/src/proxy/dialects.ts` - the key header per dialect: `Authorization: Bearer <key>` for `openai-chat`, `x-api-key: <key>` for `anthropic-messages`.
- `CREATE: packages/server/test/proxy-forward.test.ts` - a local fake provider on `127.0.0.1:0` that records what it was sent and answers JSON or an SSE stream.

## Steps

1. The body is parsed, `model` set to the entry's id, and serialised; no other field is touched.
2. Request headers sent: the caller's own minus `authorization`, `x-api-key`, `x-ahp-scope`, `cookie`, `host`, `content-length`, `origin`, `forwarded`, `x-forwarded-*`, `proxy-*` and the hop-by-hop set (`connection`, `keep-alive`, `te`, `trailer`, `transfer-encoding`, `upgrade`); then the provider's key header when it has a key. `anthropic-version`, `anthropic-beta`, `accept` and `content-type` pass.
3. Response: the status as it came; headers minus the hop-by-hop set, `set-cookie`, `content-encoding` and `content-length` (`fetch` has already decoded the body); the body as the stream `fetch` gives, never buffered.
4. A provider that answers an error answers it in its own words, passed through as it came: that is its dialect already.
5. A provider that cannot be reached is 502 in the dialect's body naming the provider, not its URL's credentials or its key.
6. One log line per call that failed: caller id, model name, provider, status; never a header.

## Validation

- Failing first: a call to the fake provider through the daemon gets the 501 stub.
- The fake records: `model` is the entry's id, `authorization` is `Bearer <marker key>` for `openai-chat` and `x-api-key` the marker for `anthropic-messages`, the caller's token and `x-ahp-scope` are absent, `anthropic-version` is present.
- An SSE answer of several events written with delays arrives event by event (the first event is read before the fake writes the second) and byte-identical.
- A 429 from the fake comes back 429 with its own body; an unreachable provider is 502 in the dialect's body.
- The marker key is absent from the daemon's stdout and stderr, the refusal bodies and the answers.

## Resume
