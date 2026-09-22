---
title: The ACP bridge, so one package serves Copilot, Codex, Gemini and DeepSeek Harness - implemented
date: 2026-09-22
refs:
  - code://packages/agent-acp/src/index.ts
  - code://packages/agent-acp/src/agent.ts
  - code://packages/agent-acp/src/connection.ts
  - code://packages/agent-acp/src/session.ts
  - code://packages/agent-acp/src/mapping.ts
  - code://packages/agent-acp/src/catalog.ts
  - code://packages/agent-acp/src/transcript.ts
  - code://packages/agent-acp/src/plugin.ts
  - code://packages/sdk/src/types/agent.ts
  - code://packages/sdk/src/types/terminals.ts
  - code://packages/sdk/src/types/resources.ts
  - code://packages/sdk/src/host.ts
  - code://test/agent-acp.test.ts
  - code://test/agent-acp-turn.test.ts
  - code://test/agent-acp-catalog.test.ts
  - code://test/agent-acp-ports.test.ts
  - code://test/agent-acp-plugin.test.ts
  - code://test/fixtures/acp-server.mjs
  - code://docs/PLUGINS.md
  - npm://@agentclientprotocol/sdk@^1.4.0
---

`@ahpd/agent-acp` is an installed package, an embeddable `Agent` and a plugin a daemon loads by name.
A client creates a session on a provider the package registered, and that session spawns the ACP server the configuration named: one turn and its cancel, the server's catalogue, a resume, the models, modes and commands it offers, the transcript of what this process watched, and the file, shell and permission requests it makes back - each answered through the port the host already holds.

## What was built

- `code://packages/agent-acp/src/agent.ts` - `acpAgent(options)`, provider and display name defaults, the `permissionMode` schema, and a `probe` that states an empty offer because ACP has no pre-session catalogue.
- `code://packages/agent-acp/src/connection.ts` - `connectAcp`: the subprocess, `ndJsonStream` over its stdio, the handshake's cached reply, and the four session-config calls. `clientCapabilities` is derived from the handlers it was given, so a capability is advertised exactly when something answers it.
- `code://packages/agent-acp/src/session.ts` - the `Session`: the turn and its cancel, `session/load` on a resume, the learned modes, model option and commands, `setConfig`, the watched transcript, files and terminals through `Start.resources` and `Start.terminals`, and `session/request_permission` as a `chat/inputNeededSet` confirmation.
- `code://packages/agent-acp/src/mapping.ts` - `mapUpdate(turn, update)`, the one place a `session/update` becomes a chat action.
- `code://packages/agent-acp/src/catalog.ts` - the process-wide registry and `list()` over `session/list`, with the registry as the fallback.
- `code://packages/agent-acp/src/transcript.ts` - the watched updates rebuilt as `WireTurn`s.
- `code://packages/agent-acp/src/plugin.ts` - `name`, `title` and `apply`, one backend per spec.
- `code://packages/sdk/src/types/agent.ts` - `Start.resources` and `Start.terminals`, the two ports a backend reaches back through.
- `code://packages/sdk/src/types/terminals.ts` - `StartTerminals`, `OpenTerminal`, `OpenedTerminal`, `TerminalOptions.args`/`env` and `Terminal.waitForExit`.
- `code://packages/sdk/src/types/resources.ts` - `ResourceStore`, moved here from `host.ts` so a backend reads it from the concept file.
- `code://packages/sdk/src/host.ts` - `heldTerminals`, the host-owned terminal factory, and the `spawn` that hands both ports down.

## Verified

- `test/agent-acp.test.ts` - the provider, the display name, the schema and the defaults, and two providers from two options objects.
- `test/agent-acp-turn.test.ts` - the required action order, reasoning as `chat/reasoning`, a tool call opened and completed, a cancelled turn, and a cancel that provably reached the server.
- `test/agent-acp-catalog.test.ts` - an empty probe, the session's models and modes, its commands, `session/list` as catalogue rows, a transcript for a watched session and nothing for one it did not watch, and a refused config key.
- `test/agent-acp-ports.test.ts` - the capabilities the handshake advertises with both ports and with neither, a read and a write through the host's store, a terminal opened, waited on, read and released, and a permission approved as `allow_once` and refused as `reject_once`.
- `test/agent-acp-plugin.test.ts` - the loader resolving the package and serving a turn through the scripted server, a manifest listed as `ready` without importing its entry, two providers from two specs, and a spec with no `command` reported and skipped.
- `test/fixtures/acp-server.mjs` - the scripted server, which now sends requests of its own and awaits the answers.
- 63 files, 847 tests; `tsc -p tsconfig.json --noEmit`, `pnpm build` and `node scripts/boundary.mjs` green with `@ahpd/agent-acp: 2 declared, none undeclared`.

## Departures from the plan

- **Models are the session's, not the schema's or the probe's.** ACP names models only on `session/new`, so the plan's "the schema gains the model list, and `probe` reports them" was not implementable; the model list is `Session.models()` and the schema carries only `permissionMode`.
- **`stateFile` answers `undefined`.** The bridge keeps no per-session file, and the contract says undefined is the real answer for a backend that writes none.
- **`Start.terminals` is a factory, not the port.** The host owns a terminal's URI, its root-list row and its `emit`, so the raw `TerminalStore` was not usable by a backend; `StartTerminals.open` mints and registers one instead.
- **A permission is binary.** AHP's `confirm` is two-valued, so `allow_once`/`reject_once` are the only options this host returns and an `always` is never selected.
- **The ACP method is `terminal/wait_for_exit`**, not `terminal/wait_for_terminal_exit`; the fixture carried the wrong name first.

## Left for later

- **A daemon against a real ACP server.** The end-to-end run the plan's checklist names, against `@deepseek-ai/dsh-acp` with a configured model, has not been done here: the loader is exercised by `test/agent-acp-plugin.test.ts` and the server by the scripted fixture, and neither is a real harness answering a real model.
- **No `ran`.** An ACP session has no shell turn, so `!command` is refused by the host with the reason rather than asked of the model. Giving the bridge a `ran` is a task of its own.
- **A command named in the manifest's `ahpd.options`.** The required `command` is reported at apply and skipped; `ahpd plugin list` shows the spec as `unconfigured` only if the manifest declares it, which this one does not yet.
