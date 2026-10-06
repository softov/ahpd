---
title: The sdk holds a client call, raises it for the client, and runs one for the tool server - implemented
date: 2026-10-06
refs:
  - git://build/agents/bc650427
  - "[code://packages/sdk/src/clientcalls.ts](../../../../packages/sdk/src/clientcalls.ts)"
  - "[code://packages/sdk/src/mcpcontent.ts](../../../../packages/sdk/src/mcpcontent.ts)"
  - "[code://packages/sdk/src/toolserver.ts](../../../../packages/sdk/src/toolserver.ts)"
  - "[code://packages/sdk/test/host-tools.test.ts](../../../../packages/sdk/test/host-tools.test.ts)"
---

A backend can now hold a call a client runs in one place, instead of growing the third copy of a waiting map: the call is raised on the session as the protocol's `toolClientExecution` entry so a client watching only the session finds it, the turn blocks on one promise, and the call ends exactly once - answered by the client that owns it, released with a turn, failed when that client goes, or failed when the time the host allows runs out. A client's answer carries its whole content rather than only its words, and the tool server runs a client's tool through a runner the backend hands it, answers with MCP content, serves the tools a session has now rather than the ones it was born with, and can tell an agent the list changed.

## What was built

- [`code://packages/sdk/src/clientcalls.ts`](../../../../packages/sdk/src/clientcalls.ts) - `createClientCalls`: `open` raises the entry and starts the clock, `wait` is the promise the harness blocks on, `complete` settles it for the owner alone, `gone` fails one client's calls naming who else provides the tool, `release` fails the rest, `entries` is what a backend puts in its snapshot's `inputNeeded`, and `methods` is the `toolCallOwner` / `completeToolCall` / `clientGone` triple a backend spreads onto its `Session`.
- [`code://packages/sdk/src/mcpcontent.ts`](../../../../packages/sdk/src/mcpcontent.ts) - `toMcpContent`: an answer's blocks as MCP content, an image as an image, another embedded resource as a resource blob under `ahp-tool-result:<callId>/<index>`, and anything else as its JSON in a text block.
- [`code://packages/sdk/src/toolserver.ts`](../../../../packages/sdk/src/toolserver.ts) - `RunClientTool`, `ToolsChanged`, `ToolsEndpoint.setTools`, and a `tools/call` for a tool with an `owner` handed to the backend's runner with the request's `_meta`; with `toolsChanged: 'notify'` the capability, the `GET` stream and `notifications/tools/list_changed`.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a client's `chat/toolCallComplete` reaches the backend with its content blocks whole, beside the joined text and an error's message.
- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts), [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts), [`code://packages/sdk/src/types/agent.ts`](../../../../packages/sdk/src/types/agent.ts) - `completeToolCall` takes `ClientCallAnswer`; `HostOptions.clientToolTimeoutMs` is ten minutes when unset and no limit at zero; `Start.clientToolTimeoutMs` is the resolved number.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - the option resolved once and handed to every backend, and the runner and list-change choice passed to `toolsServer`.
- [`code://packages/sdk/src/types/events.ts`](../../../../packages/sdk/src/types/events.ts) - `input_needed_set` says that its `kind` is what tells a person being asked from work a client runs.
- [`code://packages/server/src/config.ts`](../../../../packages/server/src/config.ts), [`code://packages/server/src/commands/options.ts`](../../../../packages/server/src/commands/options.ts), [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the daemon key `clientToolTimeoutMs`, from `config.json` or `--client-tool-timeout-ms`, handed to the host only when the deployment set it.

## Verified

- `packages/sdk/test/clientcalls.test.ts` 13, `packages/sdk/test/toolserver.test.ts` 25, `packages/sdk/test/host-tools.test.ts` 34 - 72 passing together.
- `pnpm test`: 223 files, 3245 tests, all passing. An earlier run of the same command failed 14 to 19 cases in `packages/computer/test`, `packages/agent-acp/test/agent-acp-machine.test.ts`, `packages/sdk/test/wire.test.ts` and `packages/sdk/test/nested-proxy.test.ts`, all of them 5-second timeouts under the parallel load; each file passes on its own, and the same command is green now.
- `pnpm typecheck`, `pnpm boundary` and `pnpm build` (all eight packages) green.
- The daemon key read at runtime off the built `packages/server/dist`: `optionsFrom({ clientToolTimeoutMs: 1500 })` answers 1500, `0` answers 0, and unset answers `undefined`, which is what leaves the host's own ten minutes in force.
- `pnpm wire` was not run: it validates a capture from a real daemon (`tools/validate.mjs` takes a `.jsonl`), and this work may not start one. What stands in for it is the same check against the frames the suite produces - `node tools/schema.mjs` and `wire.test.ts`'s "sends nothing the protocol does not declare, and nothing short of what it requires" - both green, and both carrying the new `session/inputNeededSet` entry the tests emit.

## Departures from the plan

- `Start.clientToolTimeoutMs` is a required number rather than an optional one, because the plan's own validation asks that `Start` answer 600000 ms when the deployment said nothing. Every test that builds a `Start` by hand therefore had to carry it: the `opening` helper in six `agent-acp` files, four `agent-cofold` files, three `agent-pi` files, and two answers in `agent-pi-asking.test.ts` that now carry `content`.
- The daemon key reaches the host and the config file, and is not one a client edits through root config: `advancedTools` is in `rootconfig.ts`'s `DAEMON_KEYS` and this is not, because the task names `config.ts` and `options.ts` and `server-root-config.test.ts:67` pins that list to exactly eight keys on purpose. Named in the plan's Resume state as an open question rather than decided here.
- Two things task 02 left open were resolved from what it does say: `toolsChanged` is a property of the endpoint (`Start.toolsServer({ runClient?, toolsChanged? })` is per session), and a resource blob's URI is `ahp-tool-result:<callId>/<index>` with the call id being the JSON-RPC id of the `tools/call`.

## Left for later

- `pnpm wire` against a real capture, whenever a daemon is run for it.
- The backends: p2, p3 and p4 are where `claude`, `pi` and `cofold` stop keeping their own waiting maps and start opening and waiting through this holder, and where a client call is raised through the tool server rather than in process.
