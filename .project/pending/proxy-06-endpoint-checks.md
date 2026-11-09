---
title: Check the proxy model endpoints
plans:
  - plans/proxy/06-the-proxy-serves-every-model-endpoint/plan.md
---

# Check the proxy model endpoints

proxy/06 is on main. The proxy answers every model endpoint of OpenAI and Anthropic. Its tests use fake providers.

## Results so far

On a test daemon at 8b5423b2, on 2026-11-04, with `openrouter`, `openai` and `anthropic` connectors that read their keys from the environment:

- Step 2, the Response create, passed through `openrouter/openai/gpt-4.1-nano`, with an id that starts with `resp_`.
- Step 5 passed: `{"input_tokens":8}`.
- Step 7 passed: the daemon's log and the usage records hold no key.
- Steps 1, 3 and 4 are left. OpenAI answered `insufficient_quota` for each, and the proxy passed that answer on. Step 3 is OpenAI's alone.
- Step 6 is left. The OpenRouter list has no rerank model.

## Set up

Claude runs this on the test daemon, `source .project/pending/test-daemon.sh`, on port 39200. Its config needs `"modelApi": true`, and the `openai`, `anthropic` and `openrouter` connectors with their keys. Then, in a second terminal:

```bash
export AHPD_TOKEN=check-token B=http://127.0.0.1:39200
```

## Steps

The model names are examples. Take another from `$B/models` when the proxy refuses one.

1. Embeddings through `openai`, and check that the answer has vectors:

```bash
curl -s $B/embeddings -H "Authorization: Bearer $AHPD_TOKEN" -H 'Content-Type: application/json' -d '{"model":"openai/text-embedding-3-small","input":"hello"}' | head -c 300
```

2. A Response, then a follow-up with its id in place of `<id>`:

```bash
curl -s $B/responses -H "Authorization: Bearer $AHPD_TOKEN" -H 'Content-Type: application/json' -d '{"model":"openai/gpt-4.1-mini","input":"Say ok."}' | head -c 300
curl -s $B/responses -H "Authorization: Bearer $AHPD_TOKEN" -H 'Content-Type: application/json' -d '{"model":"openai/gpt-4.1-mini","input":"Again.","previous_response_id":"<id>"}' | head -c 300
```

3. Get the Response, and check that its id starts with `resp_`:

```bash
curl -s $B/responses/<id> -H "Authorization: Bearer $AHPD_TOKEN" | head -c 300
```

4. An image, a speech file and a transcription:

```bash
curl -s $B/images/generations -H "Authorization: Bearer $AHPD_TOKEN" -H 'Content-Type: application/json' -d '{"model":"openai/gpt-image-1","prompt":"a red square","size":"1024x1024"}' | head -c 200
curl -s $B/audio/speech -H "Authorization: Bearer $AHPD_TOKEN" -H 'Content-Type: application/json' -d '{"model":"openai/gpt-4o-mini-tts","voice":"alloy","input":"hello"}' -o /tmp/speech.mp3 && ls -l /tmp/speech.mp3
curl -s $B/audio/transcriptions -H "Authorization: Bearer $AHPD_TOKEN" -F model=openai/whisper-1 -F file=@/tmp/speech.mp3
```

5. Count tokens through `anthropic`:

```bash
curl -s $B/v1/messages/count_tokens -H "x-api-key: $AHPD_TOKEN" -H 'anthropic-version: 2023-06-01' -H 'Content-Type: application/json' -d '{"model":"anthropic/claude-haiku-4-5","messages":[{"role":"user","content":"hello"}]}'
```

6. A rerank through `openrouter`, with a rerank model from `$B/models` in place of `<model>`:

```bash
curl -s $B/rerank -H "Authorization: Bearer $AHPD_TOKEN" -H 'Content-Type: application/json' -d '{"model":"<model>","query":"cat","documents":["a cat","a car"]}'
```

7. Check that the daemon's terminal and every answer show no key.

## Reply

Write "pass", or say which step stopped.
