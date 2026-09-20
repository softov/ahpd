---
title: An agent backend over facio, so every model is one provider - implemented
date: 2026-09-20
refs:
  - git://07683df
  - code://packages/agent-facio/src/agent.ts
  - code://packages/agent-facio/src/session.ts
  - code://packages/agent-facio/src/mapping.ts
  - code://packages/agent-facio/src/tools.ts
  - code://packages/agent-facio/src/transcript.ts
  - code://packages/agent-facio/src/plugin.ts
  - code://packages/server/src/plugins.ts#L323-L370
  - code://test/agent-facio-turn.test.ts
  - code://test/agent-facio-approval.test.ts
  - code://test/agent-facio-store.test.ts
  - code://test/agent-facio-plugin.test.ts
  - code://docs/PLUGINS.md
---

`@ahpd/agent-facio` is an installed package and a plugin that runs the facio agent runtime as an AHP backend, so every model an OpenAI-compatible endpoint serves is a model inside one provider rather than a package of its own.
A client creates a session on provider `facio`, the session config chooses the model and the endpoint, and the conversation, the tools, the approvals, the catalogue and the transcript behave the way a backend is expected to.
The rule it implements is [agent-package-only-when-it-brings-a-runtime](../../decisions/agent-package-only-when-it-brings-a-runtime.md): a package for a runtime, a configuration for a model.

## What was built

- `code://packages/agent-facio/src/agent.ts` - `facioAgent(options)`: provider `facio` (overridable), the `model`/`baseUrl`/`apiKey`/`instructions` schema, defaults for what it was given, `modelOf` building an `openaiCompat` adapter, one `storeOf` store shared by every session, `list()` and `transcript(id)` over the facio store, and `probe()`.
- `code://packages/agent-facio/src/session.ts` - `facioSession`: `begin` starts a facio run and emits `chat/turnStarted` first, `cancel`, `steer`, the queue and draft, `confirm`/`answer` routed back through `submit`, the two channel snapshots, and a resume that rejoins an `awaiting` run through `resume({ afterSeq })`.
- `code://packages/agent-facio/src/mapping.ts` - `mapTurn`, the one place a `RunEvent` becomes a `chat/*` action, including the three tool-call actions, reasoning as `chat/reasoning`, usage and duration at the end, a failure as `chat/error`, and the approval and question pauses.
- `code://packages/agent-facio/src/tools.ts` - the host's `BoundTool`s as facio tools through `createTool`, so `sessionTools` and `artifactTools` reach the model and their results come back.
- `code://packages/agent-facio/src/transcript.ts` - `turnsOf`, a facio conversation as `WireTurn<Turn>[]`, in the recorded order with text, reasoning and tool calls.
- `code://packages/agent-facio/src/plugin.ts` - `name`, `title` and `apply(host, options)` registering the backend; `index.ts` re-exports them, so the module the manifest names is the plugin.
- `code://packages/server/src/plugins.ts#L323-L370` - `loadOne` fixed so a manifest's `ahpd.entry` overrides a file spec only when the package was resolved as a package, which is what plan 01's task 03 said and what lets the end-to-end test load the source.

## Verified

- `test/agent-facio.test.ts` - 8 tests: the provider and schema, the defaults, a second provider, `probe`, the model factory and a caller's adapter, the no-model refusal and the store.
- `test/agent-facio-turn.test.ts` - 7 tests: the required turn order, a delta as its own action, reasoning as `chat/reasoning`, a host tool called with its result back to the model, two turns under one facio session, and a cancelled turn.
- `test/agent-facio-approval.test.ts` - 6 tests: the `toolConfirmation` entry with no completion, a wrong call id settling nothing, approve running the tool and finishing, deny carrying the reason, two approvals answered independently, and a question answered and declined.
- `test/agent-facio-store.test.ts` - 6 tests: the listing, a transcript's part order and tool call, unknown against empty, a paused run reopened without replaying its input, a finished session resumed as a new run, and a deleted session gone.
- `test/agent-facio-plugin.test.ts` - 5 tests: the loader serving a turn through the file spec, the manifest listed as `ready` without importing, two providers, an incompatible peer refused, and a resumed paused run seen once.
- `pnpm test` green: 53 files, 763 tests; `pnpm typecheck`, `pnpm boundary` and `pnpm build` green with four packages.
- By hand: a daemon started from a `config.json` naming the package loaded `@ahpd/agent-facio`, offered `claude, facio`, and answered a session through a local OpenAI-compatible endpoint with `hello from facio` as streamed deltas and then `chat/turnComplete`.
- Substituted for by hand: a confirmation asked and answered is `test/agent-facio-approval.test.ts` and a restart listing and resuming is `test/agent-facio-store.test.ts`, because a configuration file is JSON and cannot carry the policy function a pause comes from.
- `test/host.test.ts`'s `create-pr` cases flaked intermittently through this work and passed on re-runs; the code here does not touch that path.

## Departures from the plan

- Facio is linked, not published: the three `@facio/*` packages are `link:` dependencies of the package and of the root, and their `dist/` is built in the facio checkout first. `@facio/agents` is `0.0.1` and unpublished, so the package is `private: true` and the dependency becomes a range when facio publishes.
- `chat/turnStarted` is emitted from `begin` rather than mapped from `run.started`, because the host has already dispatched it and AHP requires it before any part or delta.
- A `failed` outcome ends with `chat/error`, and `tool.denied` closes a proposed call as failed, beyond the endings the plan named.
- The loader test uses a source file spec rather than the package directory, because the manifest names the build and `pnpm test` does not build; `describePlugin` exercises the directory without importing.
- A resume lets the seed give way to the replay: `reopen` drops the recorded copy of the open turn before rebuilding it live, so a resumed paused run is seen once.
- `packages/agent-facio` gained a `workspace:*` dev dependency on `@ahpd/sdk`, because with only a peer the package build resolved the published `0.6.0` and `PluginHost` did not exist there.

## Left for later

- `Start.forkAt` and `rewindAt` are unmapped; facio has the slots and mapping them is a task of its own.
- A non-streaming adapter (`features.streaming: false`) produces no text, because `model.completed` is not mapped; the shipped `openaiCompat` streams by default.
- AHP host tool definitions carry no destructive hint, so a pause is configured through the plugin's `policy` option rather than inferred, and a configuration file cannot carry it.
- `@ahpd/agent-acp` remains the next agent package, and `@deepseek-ai/dsh-acp` is one of the servers it will cover.
