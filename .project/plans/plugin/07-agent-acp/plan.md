---
title: The ACP bridge, so one package serves Copilot, Codex, Gemini and DeepSeek Harness
domain: plugin
status: built
priority: high
created: 2026-09-22
revalidated: 2026-09-22
requires: []
changes: []
creates: []
decisions:
  - decisions/acp-bridge-uses-the-protocol-sdk.md
  - decisions/acp-ports-come-through-start.md
refs:
  - code://packages/sdk/src/types/agent.ts#L90-L168 - `Start`, what a backend is handed, and where the two ports this plan adds would go
  - code://packages/sdk/src/types/agent.ts#L182-L314 - `Agent`, the contract this package implements
  - code://packages/sdk/src/types/session.ts#L159-L441 - `Session`, what `create` returns and what `begin`, `cancel`, `confirm` and `answer` do
  - code://packages/sdk/src/types/plugin.ts - `PluginHost` and `PluginContext`, which the entry implements
  - code://packages/agent-claude/src/claude.ts - the subprocess backend this package is shaped like, including `provider` and `displayName` per registration
  - code://packages/agent-claude/src/session.ts - a harness message stream turned into the chat actions a client already knows
  - code://packages/agent-cofold/src/agent.ts - an options object turned into an `Agent`, which is where `provider` and `displayName` are defaults rather than constants
  - code://packages/agent-cofold/src/plugin.ts - the plugin entry this one mirrors, options checked key by key and one agent registered
  - code://packages/server/src/plugins.ts - `loadPlugins`, which resolves and imports this package by spec
  - code://test/example.test.ts - the fake peer and the turn a backend test follows
  - code://.project/ideas/agents-as-extensions.md - the first-party order this plan is the next step of
  - code://.project/plans/plugin/01-plugins-load-from-configuration/deferred.md - where "ports through `Start`" was recorded as waiting on this package
  - npm://@agentclientprotocol/sdk@^1.4.0 - the ACP schema and the connection the bridge speaks
  - file:///github/deepseek-harness/packages/acp/acp/src/index.ts - the ACP server side of the same protocol, and the server the tests run against
  - file:///github/deepseek-harness/packages/acp/acp/src/updates.ts - the `session/update` variants that server emits
---

## Goal

`@ahpd/agent-acp` is an installed package and a plugin that speaks the Agent Client Protocol to any ACP server, so `copilot --acp`, `codex-acp`, `gemini --experimental-acp` and `@deepseek-ai/dsh-acp` are one backend loaded once per command rather than a package each.
A client creates a session on a provider the package registered, the session config chooses the model and the mode the server offers, and the conversation, the tools, the approvals, the catalogue and a resume behave the way a backend is expected to.
A new ACP server is a configuration line, and never an ahpd release.
It matters more than its size suggests: it exercises the loader and the `Agent` contract against a runtime that is not cofold, which is what proves the contract is general rather than shaped around one harness.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -rhoE "sessionUpdate: '[a-zA-Z_]+'" src` in `/github/deepseek-harness/packages/acp/acp` - the variants that server emits: `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update` and `usage_update`.
- `grep -n "readTextFile|writeTextFile|createTerminal|requestPermission" dist/acp.d.ts` in the published `@agentclientprotocol/sdk@1.5.0` - the client interface the bridge implements, and the four capabilities it may advertise.
- `npm view @agentclientprotocol/sdk version` - `1.5.0` is current; `@deepseek-ai/dsh-acp` pins `1.4.0`, so the package takes `^1.4.0`.
- `find /github -maxdepth 6 -type d -name '@agentclientprotocol'` - the SDK is not installed anywhere in this workspace, so the package brings its own copy and the lockfile moves.
- `grep -rn "acp|agent-client-protocol" packages/*/package.json` in ahpd - nothing, so this plan adds the first ACP dependency and the first backend whose runtime is a command rather than an imported library.
- `Not found: any ACP client, server or fixture in this repository - searched "acp" and "agent-client-protocol" in packages/ and test/.`

### Runtime path

```
ahpd --plugin @ahpd/agent-acp
  -> loadPlugins resolves it, checks its manifest, imports it, apply(host) registers one Agent per configured command
  -> createSession -> the bridge spawns the command and speaks ACP over its stdio
       initialize (client capabilities: fs and terminal only when the ports are there)
       newSession({ cwd, mcpServers }) -> the ACP session id
  -> Session.begin(turn) -> prompt({ sessionId, prompt })
       session/update agent_message_chunk  -> chat/responsePart + chat/delta
       session/update agent_thought_chunk  -> chat/reasoning
       session/update tool_call / tool_call_update -> chat/toolCallStart / chat/toolCallContentChanged / chat/toolCallComplete
       session/update current_mode_update / available_commands_update -> the session state and customizations
       session/request_permission -> chat/inputNeededSet + confirm; the answer -> the ACP request's reply
       PromptResponse stopReason end_turn -> chat/turnComplete, cancelled -> chat/turnCancelled
  -> cancel -> the ACP cancel notification
  -> Agent.list() reads the server's own session list; Agent.transcript(id) replays the stored updates
```

### Gaps

- Nothing spawns a subprocess as a backend. `@ahpd/agent-claude` imports a library that does its own process handling, so the stdio transport, its framing and its shutdown are new.
- Nothing maps ACP `session/update` onto the chat actions, and nothing turns `session/request_permission` into the `inputNeededSet` and `confirm` pair the host already serves.
- `Start` carries no `resources` and no `terminals`, so a bridge cannot answer `fs/read_text_file`, `fs/write_text_file` or `terminal/create` through the host's own checks.
- Nothing reads a server's modes or commands into the session's controls, and nothing reads the model config option into `models()`, so a session would run on whatever the server defaults to. ACP answers none of them before `session/new`, so the model list is the session's and not a pre-session probe's.
- `Not found: a persisted ACP transcript - searched the SDK's schema for a stored history; `loadSession` replays updates rather than returning turns, so `transcript(id)` has to be recorded by this bridge or answered empty.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [The bridge speaks ACP through the published protocol SDK](../../../decisions/acp-bridge-uses-the-protocol-sdk.md) | the user, 2026-09-22, over hand-rolling the stdio JSON-RPC |
| 2 | [An ACP backend reaches files and a shell through `Start`](../../../decisions/acp-ports-come-through-start.md) | defaulted from [agents as extensions](../../../ideas/agents-as-extensions.md), which orders "ports through `Start`" and rejects building the access twice |

| What | Source | Task |
| --- | --- | --- |
| One provider per registration, with `provider`, `displayName` and the command as options | `code://packages/agent-cofold/src/plugin.ts` and decision [agent-package-only-when-it-brings-a-runtime](../../../decisions/agent-package-only-when-it-brings-a-runtime.md) | 04 |
| `MessageStream` chunks become `chat/responsePart` and `chat/delta`; thought chunks become `chat/reasoning` | `code://packages/agent-claude/src/session.ts`, the same translation for a different stream | 01 |
| `session/request_permission` is a `chat/inputNeededSet` and its answer is the ACP reply | `code://packages/sdk/src/types/session.ts#L321-L369` | 03 |
| The host's `BoundTool`s are offered to the server as an in-process MCP server | `code://packages/agent-claude/src/mcp.ts`, which already does this for the Claude SDK | 01 |
| The catalogue is the server's own session list where it has one, and this bridge's record where it does not | `code://packages/sdk/src/types/agent.ts#L76-L87` | 02 |

## Proposed architecture

- **Data flow** - an options object becomes an `Agent`; a session spawns the configured command and speaks ACP over its stdio; each `session/update` becomes the chat action a client already knows, and each client answer becomes the ACP reply or notification the server is waiting for.
- **Event flow** - none of AHP's own; this package subscribes to nothing. It is the consumer of a server's notifications and the producer of `chat/*` actions, which is what a backend is.
- **State flow** - the ACP session id is the backend's own id for the session, and the bridge keeps only what the server does not: the turns it watched and the pending permission requests. A `loadSession` replays updates, so the host's transcript for a session this process never watched is answered empty rather than invented.
- **Layer responsibilities** - `packages/agent-acp`: the `Agent`, the `Session`, the ACP connection, the update mapping, the config schema and the plugin entry · `packages/sdk`: gains `resources` and `terminals` on `Start` · `docs/PLUGINS.md`: a second worked example and the `--acp` commands.
- **Source-of-truth files** - `code://packages/agent-acp/src/agent.ts`, `code://packages/agent-acp/src/session.ts`, `code://packages/agent-acp/src/connection.ts`, `code://packages/agent-acp/src/mapping.ts`, `code://packages/agent-acp/src/plugin.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The package, the provider and a turn](task-01-the-package-the-provider-and-a-turn.md) | done | - |
| [02 - The catalogue, a resume and the config schema](task-02-the-catalogue-a-resume-and-the-config-schema.md) | done | 01 |
| [03 - The host's files and shell reach the server](task-03-the-hosts-files-and-shell-reach-the-server.md) | done | 01 |
| [04 - The plugin entry, the docs and a daemon that serves it](task-04-the-plugin-entry-the-docs-and-a-daemon.md) | done | 02, 03 |

## Risks and tradeoffs

- A fourth backend duplicates what `@ahpd/agent-claude` does for another protocol - the duplication is the point, because two bridges over one contract is what shows the contract does not leak, and a shared seam invented before the second case is a seam shaped by the first.
- An ACP server is a subprocess this daemon starts - the command is a configuration line, so naming one is the trust decision, and a server that dies is reported on its session rather than taking the daemon down.
- The protocol is at 1.5.0 and every server pins its own copy - the SDK is a range, the mapping lives in one file so a variant change is one edit, and `@deepseek-ai/dsh-acp` at `1.4.0` is the version the tests hold to.
- `loadSession` replays updates rather than returning turns - the catalogue answers what the server lists and the transcript is answered from what this process watched, which is honest about the gap rather than reconstructing a conversation.
- A permission request has a session-scoped lifetime and the client may disconnect - an unanswered request is refused when the session closes, because a subprocess waiting on a promise nothing can settle is a hung turn.

## Resume state

- **Done so far:** all four tasks, done 2026-09-22, and [implemented.md](implemented.md) written.
- **Next action:** none; the plan is built. Every checklist row is ticked. The ACP bridge implements `ran`, so `!command` runs in the host's shell; the daemon binary itself was not used for the by-hand run.
- **Open questions:**
  1. Whether `transcript(id)` should record updates to the file store so a session browsed in a later daemon opens with its history - proposed: no for this plan, because the ACP server owns the conversation and `loadSession` is the way it is read back.
- **Watch out for:** the workspace's pnpm store is outside the checkout, so `pnpm install` needs `PNPM_HOME` unset and `HOME` writable, and because `CI=true` implies a frozen lockfile a manifest change needs `pnpm install --no-frozen-lockfile`; a test must not spawn a real `copilot`, so the scripted `test/fixtures/acp-server.mjs` is what the tests run against; the protocol has no `chat/toolCallUpdate`, so tool updates map to `chat/toolCallContentChanged` and `chat/toolCallComplete`; and ACP names neither models nor commands before a session, so the schema has no `model` property and `probe` states an empty offer.

## Final verification checklist

- [x] `pnpm test` green, with a mapped turn, a permission answered, a cancelled turn, a `!command` in the host's shell and a catalogue read in it: 63 files, 849 tests.
- [x] `pnpm typecheck` and `pnpm boundary` green, with `packages/agent-acp` declaring what it imports.
- [x] By hand: `scripts/acp-smoke.mts` drove one real turn against `copilot --acp` (GitHub Copilot CLI 1.0.87) through a host built from this package - provider `copilot`, its three modes mapped into `permissionMode`, `PONG` streamed for a one-word prompt, and no error. It was not the daemon binary and not `@deepseek-ai/dsh-acp`; the script is manual because it needs a signed-in Copilot and spends a model call.
- [x] `docs/PLUGINS.md` names the package, its options and the commands it is known to work with.
- [x] `plans/index.md`, `plans/plugin/00-plugin.md` and `plugin/01`'s deferred row updated.
