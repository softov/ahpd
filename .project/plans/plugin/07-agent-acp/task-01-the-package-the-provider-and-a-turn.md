---
title: The package exists, registers a provider, and runs one turn over ACP
status: done
depends: []
layer: agents
refs:
  - code://packages/sdk/src/types/agent.ts#L90-L168 - `Start`, what the session factory is handed
  - code://packages/sdk/src/types/session.ts#L159-L441 - `Session`, what `create` returns
  - code://packages/agent-claude/src/claude.ts - the options-to-`Agent` factory this mirrors
  - code://packages/agent-claude/src/session.ts - the message stream turned into chat actions
  - npm://@agentclientprotocol/sdk@^1.4.0 - `ClientSideConnection`, the `Client` interface and the schema
  - file:///github/deepseek-harness/packages/acp/acp/src/index.ts - the ACP server the fixture is shaped like
---

## Objective

`@ahpd/agent-acp` exists as a workspace package, exports `acpAgent(options)` returning an `Agent`, and runs one prompt turn against a scripted ACP server over its stdio: the handshake completes, `newSession` names a session, `agent_message_chunk` becomes `chat/delta`, `agent_thought_chunk` becomes `chat/reasoning`, tool calls become the three tool-call actions, and `cancel` reaches the server.

## Files

- `CREATE: packages/agent-acp/package.json` - the manifest, with `@ahpd/sdk` as a workspace dependency, `@agentclientprotocol/sdk: ^1.4.0` and the `prepack` build.
- `CREATE: packages/agent-acp/tsconfig.json` - extending `../../tsconfig.base.json`, as every other package does.
- `CREATE: packages/agent-acp/README.md` - what the package is and the options it takes.
- `CREATE: packages/agent-acp/LICENSE` - MIT, copied from a sibling package.
- `CREATE: packages/agent-acp/src/types.ts` - `AcpOptions` and the connection's own shapes.
- `CREATE: packages/agent-acp/src/connection.ts` - `connect(command, args, env)`, spawning the program and wrapping `ClientSideConnection` over its stdio.
- `CREATE: packages/agent-acp/src/mapping.ts` - `mapUpdate(update)`, the one place a `session/update` becomes a chat action.
- `CREATE: packages/agent-acp/src/session.ts` - `acpSession(...)`, the `Session` implementation over an open ACP session.
- `CREATE: packages/agent-acp/src/agent.ts` - `acpAgent(options)`, provider and display name defaults, the schema, `create`.
- `CREATE: packages/agent-acp/src/index.ts` - the package's exports.
- `CREATE: test/fixtures/acp-server.mjs` - a scripted ACP server the tests spawn, one `session/update` per line it is told to emit.
- `CREATE: test/agent-acp.test.ts` - the provider, the schema, the defaults and the two-option refusal.
- `CREATE: test/agent-acp-turn.test.ts` - one whole turn through `createHost`.
- `UPDATE: package.json:15` - the `build` script gains `tsc -p packages/agent-acp`.
- `UPDATE: tsconfig.json` - `paths` gains `@ahpd/agent-acp`.
- `UPDATE: vitest.config.ts` - the alias map gains `@ahpd/agent-acp`.

## Steps

1. Add the manifest and the three build-wiring edits, then `pnpm install` so the ACP SDK is in the lockfile.
2. Write `connection.ts`: `spawn(command, args, { env: { ...process.env, ...options.env }, cwd })`, take `stdin` and `stdout`, and build a `ClientSideConnection` whose `Client` implements `sessionUpdate` now and `requestPermission`, `readTextFile`, `writeTextFile` and `createTerminal` as later tasks add them.
3. Write `mapping.ts` with `mapUpdate(turn, update)` covering `agent_message_chunk`, `agent_thought_chunk`, `tool_call` and `tool_call_update`, each returning the `chat/*` action the host already serves; an unknown variant returns nothing rather than throwing, so a 1.5 server does not fail a 1.4 bridge. There is no `chat/toolCallUpdate` in `@microsoft/agent-host-protocol@0.9.0`, so a terminal update is `chat/toolCallComplete` and a content-bearing one is `chat/toolCallContentChanged`.
4. Write `session.ts`: on `begin`, send `prompt` and translate each notification as it arrives, opening a `chat/responsePart` before the first delta into it; a `PromptResponse` of `end_turn` emits `chat/turnComplete` and `cancelled` emits `chat/turnCancelled`.
5. Answer any `requestPermission` with `{ outcome: { outcome: 'cancelled' } }` for this task, which refuses rather than silently allowing; task 03 replaces it with the host's `confirm`.
6. Write `agent.ts` with `provider` defaulting to `acp`, `displayName` defaulting to `ACP`, a schema carrying only `model` as `scope: 'chat'` for now, and `create` returning `acpSession`.
7. Write the scripted server fixture and the two test files.

## Validation

- `test/agent-acp-turn.test.ts` - the required action order, a delta as its own action, reasoning as `chat/reasoning`, a tool call opened and completed, a cancelled turn, and `cancel` reaching the server.
- `test/agent-acp.test.ts` - the provider and display name, the schema, the defaults, and a second provider from a second options object.
- `npx tsc -p tsconfig.json --noEmit` and `node scripts/boundary.mjs` green with `packages/agent-acp` declaring what it imports.
- `node node_modules/vitest/vitest.mjs run` green with no regression in the other 58 files.

## Resume

Done 2026-09-22.
`packages/agent-acp` builds and exports `acpAgent(options)`; `connectAcp` spawns a configured command and speaks ACP over its stdio through `@agentclientprotocol/sdk@1.4.0`; `mapUpdate(turn, update)` turns a `session/update` into chat actions; `acpSession` runs one turn and cancels one.
Verified: `pnpm build`, `tsc -p tsconfig.json --noEmit` and `node scripts/boundary.mjs` green with `@ahpd/agent-acp: 2 declared, none undeclared`; the two new test files pass (8 tests) and the full suite is 60 files / 816 tests.
The plan did not know two things, both recorded above and in the plan: `@microsoft/agent-host-protocol@0.9.0` has no `chat/toolCallUpdate`, so a terminal tool update is `chat/toolCallComplete` and a content update is `chat/toolCallContentChanged`; and `mapUpdate` needs the turn it is filling, so it takes `(turn, update)` rather than an update alone.
Left for tasks 02 to 04: the catalogue, `loadSession`, the config setters, the `Start` ports, real approvals and the plugin entry.
