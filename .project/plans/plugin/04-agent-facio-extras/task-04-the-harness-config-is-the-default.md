---
title: The harness's own configuration is the backend's default
status: done
depends: []
layer: packages/agent-cofold
refs:
  - code://packages/agent-cofold/src/config.ts - `harnessConfig`, the file it reads and what it keeps
  - code://packages/agent-cofold/src/agent.ts - `modelOf` and `resourceOf`, which consult it
  - code://packages/agent-cofold/src/session.ts - the instructions fallback
  - file:///github/cofold/packages/config/src/index.ts - `resolveConfig`, the harness's own layered reader
  - file:///github/cofold/packages/papo/src/config.ts - `userConfigPath`, `providersOf` and `splitModel`, the wiring this mirrors
  - file:///github/cofold/packages/model-openai-compat/src/index.ts - the adapter the provider builds
---

## Objective

`@ahpd/agent-cofold` reads facio's own configuration at `$XDG_CONFIG_HOME/facio/config.json` and uses its `providers`, `model` and `instructions` as the defaults under the plugin's options and the session's settings, so a daemon whose plugin names no model and is given no token still runs on the provider the harness was already pointed at.

## Files

- `CREATE: packages/agent-cofold/src/config.ts` - `harnessConfig`, `harnessConfigPath`, `splitModel` and their types.
- `UPDATE: packages/agent-cofold/src/agent.ts` - `modelOf` and `resourceOf` take the harness config, the model reference selects a provider, and `facioAgent` reads it once for the defaults, `probe` and the advertised resource.
- `UPDATE: packages/agent-cofold/src/session.ts` - the instructions fall back to the harness's, and the model factory is given the config.
- `UPDATE: packages/agent-cofold/src/index.ts` - export the config helpers.
- `CREATE: test/agent-cofold-config.test.ts` - the cases below.
- `UPDATE: docs/PLUGINS.md` - where the model and the key come from, and the precedence.

## Steps

1. Read only what a backend needs from the harness file: `providers` (id, baseUrl, apiKey, headers), `model` and `instructions`. A missing file answers an empty configuration rather than throwing, and one malformed provider is dropped rather than taking the file with it.
2. Split a model reference at its first slash, so `open_router/~deepseek/deepseek-chat` names provider `open_router` and model `~deepseek/deepseek-chat`, and a plain model id selects no provider.
3. Build the adapter from the selected provider: its endpoint, its key and its headers, with a session's explicit `baseUrl` winning and a lent token or the plugin's key winning over the provider's.
4. Refuse with a message naming the configured providers when a reference names one the file does not carry and no explicit endpoint was given, because that is a typo a person can fix.
5. Advertise the protected resource from the endpoint the harness names, so a client that does want to lend a token is offered the right one.
6. Let `defaults()`, `probe()` and the instructions fall back to the harness file under the plugin's own options.

## Validation

- `test/agent-cofold-config.test.ts`: the file is read and only its needed parts; a missing or partly wrong file answers an empty configuration; the split is at the first slash; the named model's endpoint and key are used; the advertised resource and the defaults follow from the file; the plugin and the session win over it; a provider the file does not carry is refused by name.
- `test/agent-cofold.test.ts`'s no-model case passes an explicit empty harness, so the suite does not depend on the machine it runs on.
- `pnpm test` green, `pnpm typecheck` green, `pnpm boundary` green.

## Resume

Done 2026-09-20.
`config.ts` holds `harnessConfig`, `harnessConfigPath` and `splitModel`; `agent.ts` reads the file once per backend and uses it for `modelOf`, `resourceOf`, `defaults` and `probe`; `session.ts` falls back to its instructions and passes it to the model factory; `index.ts` exports it; `docs/PLUGINS.md` gained a "The harness configuration is the default" section with the precedence.
Verified: the seven facio test files 51 passed, `pnpm typecheck` green.
By hand, through the daemon on the harness configuration alone: provider `facio` was registered, a session ran a turn that streamed `harness config works` and completed, the endpoint received `Bearer harness-key` for `test-model`, and after a restart the session was listed and its transcript read back - so the config path is exercised from `config.json` to a served conversation and not only through `modelOf`.
Departure from the plan: `@facio/config`'s layered `resolveConfig` is not used; the file is read directly, so the project file, `$FACIO_CONFIG` and `--config` layers are not consulted. That is enough for the case that prompted it and avoids a fourth linked facio package plus a store-relocating install; adopting the layered reader is a later task if the extra layers matter.
