---
title: The catalogue, a resume and the config schema
status: done
depends:
  - task-01-the-package-the-provider-and-a-turn.md
layer: agents
refs:
  - code://packages/sdk/src/types/agent.ts#L76-L87 - `Listed`, the row the catalogue returns
  - code://packages/sdk/src/types/agent.ts#L201-L314 - `list`, `transcript`, `probe` and `stateFile`
  - code://packages/agent-claude/src/catalog.ts - the catalogue this mirrors, read from the harness's own store
  - code://packages/agent-cofold/src/transcript.ts - a stored conversation turned into `WireTurn`s
  - npm://@agentclientprotocol/sdk@^1.4.0 - `listSessions`, `loadSession`, `setSessionMode` and the update variants that carry commands and modes
---

## Objective

A session a client opens shows the models, modes and commands the server offers, `list()` returns the sessions the server lists, and `transcript(id)` returns the turns this bridge watched for a session it recorded, so a catalogue row opens onto what was said rather than onto nothing.

## Files

- `CREATE: packages/agent-acp/src/catalog.ts` - `list()` over `listSessions` when the server advertises it, and the bridge's in-memory record otherwise; `stateFile` answers `undefined`, because the bridge keeps no per-session file.
- `CREATE: packages/agent-acp/src/transcript.ts` - the updates this bridge saw, kept per session and turned into `WireTurn`s.
- `UPDATE: packages/agent-acp/src/agent.ts` - the schema gains `permissionMode`; the model list is the session's, not the schema's, because ACP answers models only on `session/new` and AHP does not make a model a config property. `probe` states an empty offer without spawning, which is the honest answer ACP allows.
- `UPDATE: packages/agent-acp/src/session.ts` - `loadSession` on resume, `models()` from the server's model config option and `setConfig` mapping `model` and `permissionMode` onto `setSessionConfigOption` and `setSessionMode`.
- `UPDATE: packages/agent-acp/src/connection.ts` - `initialize` answers the held reply on a second call, and the connection gains `loadSession`, `listSessions`, `setSessionMode` and `setSessionConfigOption`.
- `CREATE: test/agent-acp-catalog.test.ts` - the catalogue, the schema and a resumed session.

## Steps

1. Keep the `initialize` reply on the connection so a second call answers it rather than negotiating twice. `probe()` states an empty offer and spawns nothing, because ACP names models and commands only on a session.
2. Read the session's modes from `current_mode_update` and the commands from `available_commands_update` into the session's customizations, which is where a client draws them.
3. Map `setConfig('model', …)` and `setConfig('permissionMode', …)` onto the server's own setters, and refuse a key this backend does not serve with a sentence naming it.
4. Implement `list()` through `listSessions` when `initialize` advertised it, and from the bridge's record when it did not; implement `transcript(id)` from the same record.
5. Write the fixture's catalogue and mode replies, and the test cases.

## Validation

- `test/agent-acp-catalog.test.ts` - an empty probe, a session's models and modes, its commands, a `listSessions` reply turned into catalogue rows, a transcript read back for a watched session and answered empty for one it did not watch, and a refused config key.
- `npx tsc -p tsconfig.json --noEmit`, `node scripts/boundary.mjs` and the full suite green.

## Resume

Done 2026-09-22.
`catalog.ts` holds a process-wide registry keyed by provider and server session id, `list()` over `session/list` with the registry as the fallback, and `stateFile` answering `undefined`; `transcript.ts` replays the watched updates through the same `mapUpdate` a live turn uses; the session learns its modes, model option and commands, resumes through `session/load` and maps `setConfig`; the agent registers all three.
Verified: `tsc --noEmit` and `boundary` green with `@ahpd/agent-acp: 2 declared, none undeclared`; the three ACP test files pass (19 tests) and the full suite is 61 files / 827 tests.
The plan was wrong in two places, both corrected above and in the plan: ACP answers models and commands only on a session and never on `initialize`, so the model list is `Session.models()` and not a schema property or a probe result; and a bridge that writes no per-session file answers `stateFile` with `undefined`.
Left for tasks 03 and 04: the `Start` ports and real approvals, the plugin entry, the docs and an end-to-end daemon run.
