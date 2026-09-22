---
title: A listed model is selected by the reference the harness already writes
status: accepted
date: 2026-09-20
refs:
  - code://packages/agent-facio/src/agent.ts - `probe` and `modelOf`, which is where a listed id is built and resolved
  - code://packages/agent-facio/src/config.ts#L111-L115 - `splitModel`, the first-slash rule every reference goes through
  - file:///github/cofold/packages/papo/src/types/config.ts - the harness's own `model`, always spelled `<provider>/<model>`
  - file:///github/cofold/packages/papo/README.md - the configuration example, `"model": "or/qwen/qwen3-8b"`
---

## Context

The facio backend's `probe` offers one model: the one the harness configuration names.
Its endpoint serves hundreds - OpenRouter publishes a catalogue of every model it routes to - and the reference client draws a picker from what the probe offers, so a person on OpenRouter sees one row where the harness itself would let them choose.

The configured `model` is a *default*, not a constraint: the harness spells it `<provider>/<model>`, `splitModel` splits it at the first slash, and the provider half is what selects an endpoint and a key.
What a picker sends back is a model id, and the backend resolves it through that same rule, so whatever id a listed model is offered under has to be something `splitModel` can take.

OpenRouter's own model ids contain slashes - `deepseek/deepseek-chat`, `openai/gpt-4o-mini` - which is the same shape as a reference.

## Decision

A model the endpoint lists is offered as the reference `<provider>/<model id>`, where `<provider>` is the harness provider that owns the endpoint the catalogue was read from, or this backend's own provider id when no harness entry owns it.
This is the same spelling the harness writes into `model`, so a choice from the picker is resolved by the rule that already exists and selects the same endpoint, key and headers the list came from.
The configured `model` stays the default a new session starts on, and it is offered first when the endpoint's list does not carry it, so a default that is an alias or a typo is still selectable.
When the endpoint cannot be asked, the offered list is the configured model alone, which is what every machine that has never run the harness saw and is still the honest answer.
Source: Softov, 2026-09-20: "the config facio was suppose to be the default model. not the only one" (defaulted: the reference form, because papo's own `model` is written the same way).

## Consequences

The picker lists what the endpoint serves, and picking one changes the endpoint, key and headers together with the model, which is what a provider reference already means.
A bare OpenRouter id is never offered on its own, because `splitModel` would read its first segment as a provider name; the prefix is what removes that ambiguity.
The backend's own provider id becomes a second accepted prefix, resolving to the endpoint this backend was configured with, so a catalogue read from an endpoint no harness entry names is still selectable.
Resolution for every listed id is tested against `modelOf`, because an id a picker can send but the backend refuses is worse than no row.

## Options

- **Offer the endpoint's raw model ids**, teaching resolution to treat an unmatched first segment as part of the model id.
  Rejected: `open_router/...` and `openai/...` would then be indistinguishable from a misspelled provider, and the refusal that names the providers the file does carry would have to go.
- **Offer the model ids with no catalogue at all**, keeping the one configured row.
  Rejected: it is the behaviour reported as wrong; the client draws the picker from this list and the endpoint publishes one.
- **Fetch the catalogue per turn or per session creation.**
  Rejected: it is one `GET /models` for the whole backend, so it is fetched once, cached by endpoint and key, and re-asked only for an endpoint that answered nothing.
