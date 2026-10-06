---
title: The proxy is documented, and a real call goes through openrouter and LM Studio
status: todo
depends: [task-05-a-call-ends-when-either-side-does.md, task-06-policy-and-usage.md, task-07-the-models-list.md]
layer: "docs"
refs:
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - the HTTP API section, where `/v1` is named beside `/api`"
  - "[code://docs/POLICY.md](../../../../docs/POLICY.md) - \"What is checked, and where\", which gains the proxy call"
  - "[code://.project/plans/proxy/00-proxy.md](../00-proxy.md) - the domain reference, whose runtime path and gaps change"
---

## Objective

`docs/PROXY.md` says how to point a tool at the proxy, what it routes by and what a refusal means, and Softov's own config answers a real call through `openrouter` and through his local LM Studio.

## Files

- `CREATE: docs/PROXY.md` - base URLs per dialect, the credential, `X-AHP-Scope`, routing, the refusals, `/v1/models`, what is recorded, `proxy.sessionCalls`, what is not done yet. It says a session whose harness calls the proxy is recorded twice, once by the session meter (`source: 'agent'`) and once here (`source: 'proxy'`), linked by session and turn, and that `"proxy": { "sessionCalls": "skip" }` turns the proxy's half off.
- `UPDATE: docs/DAEMON.md` - `/v1` beside `/api`, one line and a link.
- `UPDATE: docs/POLICY.md` - a row for a proxy call in "What is checked, and where".
- `UPDATE: docs/USERS.md` - the `proxy` subject, `proxy:read` and `proxy:write`, and that `member` holds both.
- `UPDATE: .project/plans/proxy/00-proxy.md` - the listener in the runtime path, tests and gaps.

## Steps

1. Restart the daemon in Softov's terminal (it is his), with `OPENROUTER_API_KEY` set and LM Studio serving on `127.0.0.1:1234`.
2. `curl -N http://127.0.0.1:37537/v1/chat/completions -H "Authorization: Bearer $AHPD_TOKEN" -H 'content-type: application/json' -d '{"model":"openai/gpt-5.5","stream":true,"messages":[{"role":"user","content":"Say hi"}]}'` streams `data:` lines from OpenRouter.
3. The same with `"model":"local/default"` streams from LM Studio, with no key sent.
4. The same with `"model":"anthropic/claude-sonnet-5-5"` goes to OpenRouter, since `anthropic` does not accept `openai-chat`.
5. `curl http://127.0.0.1:37537/v1/models -H "x-api-key: $AHPD_TOKEN"` lists the names; with `anthropic-version: 2023-06-01` it is Anthropic's shape.
6. `ahpd usage` shows the three calls under Softov's pools.

## Validation

- Every name, path and refusal sentence in `docs/PROXY.md` matches the code.
- Steps 2 to 6 answered as written, recorded in this task's Resume with the date.

## Resume
