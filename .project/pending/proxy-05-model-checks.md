---
title: Call a provider's own model and the root paths
plans:
  - plans/proxy/05-a-providers-own-models-are-callable/plan.md
---

# Call a provider's own model and the root paths

proxy/05 is on main (#88). Every model of a provider is callable as `<provider>/<id>`, and the OpenAI paths answer at the root too.

## Set up

Do [proxy-04-move-config-dev.md](proxy-04-move-config-dev.md) first: its *Set up* restarts the daemon with `httpApi` on. Then, in a second terminal:

```bash
export AHPD_TOKEN=$(cat /home/softov/.vscode/cli/agent-host-token)
```

## Steps

1. List the models, and check that an `openrouter/` row has `name`, `context_length` and `pricing`:

```bash
curl -s http://127.0.0.1:37537/models -H "Authorization: Bearer $AHPD_TOKEN" | head -c 3000
```

2. Call an `openrouter/` model that is not in `modelProxy.models`, with its name in place of `<model>`:

```bash
curl -s http://127.0.0.1:37537/v1/chat/completions -H "Authorization: Bearer $AHPD_TOKEN" -H 'Content-Type: application/json' -d '{"model":"<model>","messages":[{"role":"user","content":"Say ok."}]}'
```

3. Call the same model on the root path, as an OpenAI SDK with no `/v1` does:

```bash
curl -s http://127.0.0.1:37537/chat/completions -H "Authorization: Bearer $AHPD_TOKEN" -H 'Content-Type: application/json' -d '{"model":"<model>","messages":[{"role":"user","content":"Say ok."}]}'
```

4. Send one message as an Anthropic SDK does, to a `claude` model from the list:

```bash
curl -s http://127.0.0.1:37537/v1/messages -H "x-api-key: $AHPD_TOKEN" -H 'anthropic-version: 2023-06-01' -H 'Content-Type: application/json' -d '{"model":"<claude model>","max_tokens":50,"messages":[{"role":"user","content":"Say ok."}]}'
```

## Reply

Write "pass", or say which step stopped.
