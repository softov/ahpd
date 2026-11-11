---
title: A pi model named with its provider runs on another provider that has the same id
status: open
date: 2026-11-11
severity: major
refs:
  - "[code://packages/agent-pi/src/models.ts#L91-L110](../../packages/agent-pi/src/models.ts#L91-L110) - `modelFor` matches a qualified id against bare ids when no exact id answers"
  - "[code://packages/agent-pi/src/session.ts#L1074-L1076](../../packages/agent-pi/src/session.ts#L1074-L1076) - a record's model is set at the session's start, and a refusal is not logged"
  - "[code://packages/agent-pi/src/session.ts#L1300-L1310](../../packages/agent-pi/src/session.ts#L1300-L1310) - a turn's model pi does not offer keeps the session's model and logs it, as VS Code does"
  - "[code://packages/agent-pi/README.md](../../packages/agent-pi/README.md) - the record example names `deepseek/deepseek-chat`, which pi 1.3.0 does not list"
---

## Symptom

A test daemon at `7cf919e4b` on 2026-11-11 ran a pi record with `"model": "deepseek/deepseek-chat"` and `DEEPSEEK_API_KEY` in its `env`.
The turn ran on `openrouter/deepseek/deepseek-chat`, on the OpenRouter key in the daemon's environment.
A second record with the same model and a bad DeepSeek key also answered, so the DeepSeek key was never sent.
`ahpc exec "..." --agent pi-ds --json` shows the turn's model.

## Cause

pi 1.3.0 lists `deepseek/deepseek-flash` and `deepseek/deepseek-v4-pro` for its `deepseek` provider, and no `deepseek-chat`.
`modelFor` finds no exact id, and then looks for a model whose bare id is `deepseek/deepseek-chat`.
OpenRouter's model has that bare id, and it is the only one, so `modelFor` returns it.
The first segment names a provider that pi has, so the id was qualified, not bare.

## Impact

A record runs on a provider and a paid account that it does not name.
A key test passes when the key is bad, because the key is not used.
The README's own example record does this on pi 1.3.0.

## Workaround

Name a model that pi lists for the provider, such as `deepseek/deepseek-flash`.

## Fix

Candidates, none chosen:

- Treat an id whose first segment is one of pi's providers as qualified, and never match it as another provider's bare id. The session then keeps its model and logs the refusal, as a turn's refused model does.
- Refuse the turn with a sentence that names the missing model, in place of a log line.
