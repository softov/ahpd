---
title: Agent backends
status: current
covers:
  - packages/agent-claude/src/**
  - packages/agent-pi/src/**
  - packages/agent-acp/src/**
  - packages/sdk/src/types/agent.ts
  - packages/sdk/src/types/terminals.ts
decisions:
  - decisions/claude-approvals-keeps-dont-ask.md
  - decisions/each-backend-offers-its-options-unless-a-rule-asks.md
  - decisions/pi-is-embedded-not-spawned.md
  - decisions/subagent-chats-are-restored-from-the-cli-meta-file.md
  - decisions/the-daemon-bundles-no-agent-and-starts-without-one.md
  - decisions/agent-package-only-when-it-brings-a-runtime.md
  - decisions/an-acp-agents-terminal-in-a-machine-runs-in-the-machine.md
refs:
  - "[code://packages/agent-claude/src/options.ts#L27-L36](../../packages/agent-claude/src/options.ts#L27-L36) - `Declaration`, one Claude option with its schema and its place"
  - "[code://packages/agent-claude/src/options.ts#L156](../../packages/agent-claude/src/options.ts#L156) - `DECLARED`, the options a session and a preset share"
  - "[code://packages/agent-claude/src/options.ts#L216-L232](../../packages/agent-claude/src/options.ts#L216-L232) - `presetSchema`, a preset held to the same declarations"
  - "[code://packages/agent-claude/src/catalog.ts#L115-L123](../../packages/agent-claude/src/catalog.ts#L115-L123) - `sharedCatalogue`, one listing run for all variants"
  - "[code://packages/agent-claude/src/plugin.ts#L173-L197](../../packages/agent-claude/src/plugin.ts#L173-L197) - the options every variant of one load shares"
  - "[code://packages/agent-claude/src/claude.ts#L246-L256](../../packages/agent-claude/src/claude.ts#L246-L256) - `permissionMode`, the six Claude modes"
  - "[code://packages/agent-claude/src/session/clienttools.ts#L492-L515](../../packages/agent-claude/src/session/clienttools.ts#L492-L515) - `setTools`, the `ahp` server removed and added again"
  - "[code://packages/agent-pi/src/agent.ts#L118-L131](../../packages/agent-pi/src/agent.ts#L118-L131) - `probe`, the models of the pi runtime"
  - "[code://packages/agent-pi/src/models.ts#L38-L75](../../packages/agent-pi/src/models.ts#L38-L75) - `idOf` and `modelFor`, a pi model as `<provider>/<id>`"
  - "[code://packages/agent-pi/src/replay.ts#L1-L36](../../packages/agent-pi/src/replay.ts#L1-L36) - a session from disk replayed through `mapEvent`"
  - "[code://packages/agent-acp/src/connection.ts#L168-L195](../../packages/agent-acp/src/connection.ts#L168-L195) - the client capabilities, taken from the handlers"
  - "[code://packages/agent-acp/src/catalog.ts#L302-L346](../../packages/agent-acp/src/catalog.ts#L302-L346) - `loadedSession`, a read on a connection of its own"
  - "[code://packages/agent-acp/src/session/opening.ts#L307-L317](../../packages/agent-acp/src/session/opening.ts#L307-L317) - the choice between `session/resume` and `session/load`"
  - "[code://packages/agent-acp/src/session/opening.ts#L465-L494](../../packages/agent-acp/src/session/opening.ts#L465-L494) - the resume or load request"
  - "[code://packages/sdk/src/types/agent.ts#L239-L283](../../packages/sdk/src/types/agent.ts#L239-L283) - `Start.resources`, `Start.terminals` and `Start.toolsServer`"
  - "[code://packages/sdk/src/types/terminals.ts#L256](../../packages/sdk/src/types/terminals.ts#L256) - `StartTerminals.open`"
  - "[code://packages/agent-acp/package.json#L66](../../packages/agent-acp/package.json#L66) - the `@agentclientprotocol/sdk` dependency"
  - "[code://packages/server/src/proxy/providers.ts#L173-L174](../../packages/server/src/proxy/providers.ts#L173-L174) - `MODEL_NAME`, the `<maker>/<name>` rule of the proxy"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-live-tool-change-removes-the-ahp-server-then-adds-it-again, a-model-is-named-by-its-maker-and-runs-on-a-provider, a-pi-session-from-disk-is-replayed-through-the-live-mapping, acp-bridge-uses-the-protocol-sdk, acp-ports-come-through-start, an-acp-read-and-the-turn-after-it-load-twice, claude-options-are-declared-once-for-sessions-and-presets, claude-variants-share-one-listing-inside-the-plugin, pi-models-are-probed-from-pis-model-runtime
---

The daemon has no agent of its own, and each backend is a plugin package: `@ahpd/agent-claude`, `@ahpd/agent-pi` and `@ahpd/agent-acp`.
The Claude backend runs the Claude CLI through the Claude Agent SDK, one agent for each preset variant.
The pi backend embeds the pi `AgentSession` in the daemon process.
The ACP backend starts an ACP server as a child process and speaks to it with `@agentclientprotocol/sdk` at `^1.5.0`.
Each backend gets the host's files, shells and tools through `Start`, and offers its own approval modes.
The cofold backend is in [Cofold backend](cofold-backend.md), and the host tools are in [Host tools](host-tools.md).

## Scenarios

### A Claude option is declared once

WHEN the Claude backend takes an option, such as `sandbox`, `thinking`, `outputStyle`, `env` or `extraArgs`
THEN one declaration gives its schema, its fallback and where its value goes
AND the value goes into the `query()` options at start, or into the flag settings that `applyFlagSettings` sends to a running session.
The reason: the same option is a session config key and a preset key, and two schemas for one option drift.

### A preset is checked against the declarations

WHEN the Claude plugin loads a preset
THEN each key is held to the schema of its declaration, or to the variant keys
AND a key that is neither makes the preset fail with a message that names it.

### Claude variants share one listing

WHEN the Claude plugin registers more than one variant
THEN all variants read the same paths
AND they share one run over the projects folder when the sessions are listed
AND the shared run is dropped when it ends, because the host keeps the catalogue.

### Claude approval modes

WHEN a Claude session shows its approvals
THEN the `permissionMode` property offers `default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions` and `dontAsk`
AND a new session starts on `default`.

### A live tool change in a Claude session

WHEN the tools a Claude session offers change while the session runs
THEN the backend sends `setMcpServers` without the `ahp` server
AND it sends `setMcpServers` again with the new `ahp` server, when the new list has tools
AND an unchanged list sends nothing
AND a session tool that is called between the two calls fails.
The reason: the SDK connects only a server name that it does not have, and `ahp` is registered when the session starts.
WHEN the SDK refuses one of the two calls
THEN the session keeps what the CLI has, and the next change tries again.

### pi models come from the pi runtime

WHEN a client asks what pi offers before a session exists
THEN the backend lists the models of the pi model runtime
AND each model id is `<provider>/<id>`
AND a runtime that cannot be built gives no models, not an error.

### A bare pi model id

WHEN a client names a pi model without a provider
THEN the backend takes it only when exactly one model has that id, or when it is the session's current model.
This is so that a turn does not go to a provider that nobody chose.

### pi thinking and approvals

WHEN a pi model has more than one thinking level
THEN its `configSchema` offers them under `thinkingLevel`.
WHEN a pi session shows its approvals
THEN it offers the pi `permissionMode` property.

### A pi session from disk

WHEN a client opens a pi session that this process did not watch
THEN the backend reads the pi session file and raises its entries as the events that pi raises live
AND it maps them through the same `mapEvent` as a live turn
AND each turn keeps the id of the entry where it ended, so a rewind can cut at a turn from disk.

### A pi chat is forked

WHEN a client forks a pi chat at a turn
THEN the backend copies the conversation through that turn into a new pi session.

### ACP capabilities come from the handlers

WHEN the ACP backend shakes hands with a server
THEN it says it can read files, write files or open terminals only when it has a handler for each
AND the file and terminal handlers use `Start.resources` and `Start.terminals`.
The reason: a capability without a handler is a request that nobody answers.

### Start carries the host's files, shells and tools

WHEN the host starts a session on a backend
THEN `Start.resources` is the store that the resource commands use, when the host has one
AND `Start.terminals.open` opens a host terminal that a client can watch
AND an ACP agent's terminal in a session placed in a machine runs in that machine, through `computers.how`
AND that terminal is still the host's to list and watch
AND `Start.toolsServer` opens an MCP endpoint for the host tools, when the host has a listener
AND `Start.terminalOutputs` keeps an output under a key of the backend, when the session store keeps a folder for the session.
The reason: a session that asked for a machine must not run the agent's commands on the host. A machine path is not a folder the host has - decision [an-acp-agents-terminal-in-a-machine-runs-in-the-machine](../decisions/an-acp-agents-terminal-in-a-machine-runs-in-the-machine.md).

### A terminal that a tool result names stays

WHEN a tool result names a terminal that the host opened, or an output that a backend kept with `Start.terminalOutputs`
AND no live terminal has that name
THEN a subscribe gets an exited terminal that the host makes from the output that it kept
AND the output goes with its turn, its chat and its session.
WHEN the host reads a transcript
THEN it gives the backend the outputs of the chat that it reads.
The reason: the protocol says that such a terminal stays subscribable while its chat lasts.

### An ACP read loads the session once

WHEN a client opens an ACP session that this process did not watch
THEN the backend spawns a server for the read and sends `session/load`
AND it uses the folder that the server last gave for the session, else the configured folder, else the daemon's folder
AND it keeps the replay and closes that connection.
The reason: a read has no session, so it has no file, terminal or permission handlers for the connection.

### The ACP turn after a read

WHEN the first turn of a resumed ACP session runs
AND the server says it can resume, and the host has turns for the session or the server died
THEN the backend sends `session/resume`, which replays nothing.
WHEN that is not so
THEN the backend sends `session/load` again on the turn's own connection.
WHEN the server can do neither
THEN the turn fails with a message that the session cannot be resumed.

### A model name in the proxy

WHEN the proxy names a model
THEN the name is `<maker>/<name>`, and the provider that runs it is a separate key.
WHEN a backend names a model
THEN it uses its own provider reference, such as the pi `<provider>/<id>`.
See [HTTP API and proxy](http-api-and-proxy.md).
