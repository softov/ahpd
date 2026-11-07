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
  - decisions/the-host-puts-each-tool-question-and-keeps-the-sessions-answer.md
  - decisions/pi-is-embedded-not-spawned.md
  - decisions/subagent-chats-are-restored-from-the-cli-meta-file.md
  - decisions/the-daemon-bundles-no-agent-and-starts-without-one.md
  - decisions/agent-package-only-when-it-brings-a-runtime.md
  - decisions/an-acp-agents-terminal-in-a-machine-runs-in-the-machine.md
refs:
  - "[code://packages/agent-claude/src/options.ts#L27-L36](../../packages/agent-claude/src/options.ts#L27-L36) - `Declaration`, one Claude option with its schema and its place"
  - "[code://packages/agent-claude/src/options.ts#L156](../../packages/agent-claude/src/options.ts#L156) - `DECLARED`, the options a session and a preset share"
  - "[code://packages/agent-claude/src/options.ts#L216-L232](../../packages/agent-claude/src/options.ts#L216-L232) - `presetSchema`, a preset held to the same declarations"
  - "[code://packages/agent-claude/src/catalog.ts#L33-L57](../../packages/agent-claude/src/catalog.ts#L33-L57) - `catalogue` and `findSession`, the SDK's store asked with no directory"
  - "[code://packages/agent-claude/src/catalog.ts#L170-L192](../../packages/agent-claude/src/catalog.ts#L170-L192) - `sharedCatalogue`, one listing run for all variants"
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

### The Claude catalogue is the CLI's whole store

WHEN the Claude backend lists its sessions
THEN it lists every session the CLI's store holds, wherever each ran, as VS Code's Claude agent lists them
AND a row is in the folder the store names for the session, and in none when the store names none.
WHEN the host asks the Claude backend for one session, its transcript or its subagents
THEN the backend asks the store by the session's id alone, whatever folder the host recorded.

### Claude variants share one listing

WHEN the Claude plugin registers more than one variant
THEN all variants list the same store
AND they share one run over the projects folder when the sessions are listed
AND the shared run is dropped when it ends, because the host keeps the catalogue.

### Claude approval modes

WHEN a Claude session shows its approvals
THEN the `permissionMode` property offers `default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions` and `dontAsk`
AND a new session starts on `default`.

### A Claude turn is written under its id

WHEN a Claude turn sends its prompt
THEN the prompt carries the turn's id as its `uuid` when the id is a UUID
AND it carries a new uuid otherwise, and the backend calls `onTurnRecorded` with the turn's id and that uuid.
WHEN a failed turn is sent again
THEN its prompt carries a new uuid, and the backend calls `onTurnRecorded` with the pair.
The reason: the CLI writes a prompt under the `uuid` it carries and sends no frame for it.
A read after a restart names the turn by that uuid.
See [`code://packages/agent-claude/src/session/turns.ts`](../../packages/agent-claude/src/session/turns.ts).

### A Claude conversation the CLI never wrote

WHEN the host starts a Claude session with `resume`
AND no project folder holds a transcript of that id with an entry of a conversation in it
THEN the backend sends no `resume`, no fork point and no rewind point
AND it starts a new conversation under the chat's own id, or under that id when the chat has none.
WHEN a project folder holds the transcript with an entry in it, the folder's own or another one
THEN the backend resumes it.
WHEN the backend starts a new conversation under an id
AND the project folder of the session's folder holds a transcript of that id with no entry of a conversation in it
THEN the backend waits until the CLI that could write that transcript has exited
AND it deletes the transcript through the SDK's `deleteSession` before the new CLI starts.
The reason: the CLI writes a conversation when its first message reaches it.
A CLI closed after its prompt arrived and before it wrote the prompt's entry leaves a transcript of its other lines alone.
The CLI ends at startup when it is told to resume an id with no entry.
It also ends at startup when it is told to start a conversation under an id that its folder's project holds a transcript for.
See [`code://packages/agent-claude/src/catalog.ts`](../../packages/agent-claude/src/catalog.ts).

### A Claude agent runs on several logins

WHEN a Claude record's `logins` names open connectors of `claude-login` that the record's owner or the host owns
THEN a turn runs on the first of them in the record's order that is not resting
AND its CLI gets that login's token as `CLAUDE_CODE_OAUTH_TOKEN`, and no key and no cloud provider's switch.
WHEN the record names no login, or a client pushed a key
THEN the session runs on the agent's own credential, or on that key.
WHEN the record names logins and none of them is open
THEN the turn is refused, and the refusal names each one.
WHEN a request fails with `rate_limit`, `server_error` or `overloaded` before the turn showed anything
THEN the turn runs again on the next login it has not tried, with its prompt sent once more
AND a new CLI resumes the conversation at the end of the turn before it
AND with no turn before it, the conversation starts over under its id.
WHEN such a request fails after the turn showed something, or the turn before it has no end in `ends`
THEN the turn ends with the failure, and nothing runs again.
WHEN the conversation of a turn that starts over cannot be deleted
THEN it comes back as it was on the next login, and the turn ends with the failure.
WHEN a request fails with `authentication_failed`, `oauth_org_not_allowed` or `verification_required`, a 401 or a 403
THEN the turn ends with `Claude refused login <id> (<kind>)`, and no other login is tried.
WHEN a `rejected` `rate_limit_event` names a reset before the failure
THEN the login rests for every session until then, and a put of the login ends the rest.
WHEN no login is left to try
THEN the turn ends with the last failure and the first login back, with when
AND a turn that starts with every open login resting ends at once the same way.
WHEN a request fails with any other error, `billing_error` and `account_on_hold` among them
THEN the turn ends as it did before.
WHEN a login fails
THEN the plugin logs the CLI's words and asks the host to check that connector.

The reason: the model proxy hands a call to its next entry on no connection, a 429 or a 5xx.
Once a byte has reached the caller, it runs nothing again.
It tells a key's refusal and tries no other entry, and its caller backs off by the `retry-after` it returns.
See [`code://packages/agent-claude/src/session/logins.ts`](../../packages/agent-claude/src/session/logins.ts) and [`code://docs/server/PROXY.md`](../../docs/server/PROXY.md).

### A prompt sent while a new Claude CLI starts

WHEN a turn starts on a new CLI, for an agent the message picked, an edited record or another login
THEN its prompt goes to the new CLI, however late the SDK starts reading that CLI's input
AND the reader of the CLI it replaced takes nothing more and ends.
The reason: the SDK reads a new CLI's input only after its initialize request is written.
That request waits on the manifests of the in-process MCP servers.
And the SDK drops what a closed CLI's reader is handed.
See [`code://packages/agent-claude/src/session/query.ts`](../../packages/agent-claude/src/session/query.ts).

### A Claude steering message answered after the turn's last answer

WHEN a steering message reaches a running Claude turn
THEN the backend sends it under the steering message's id when that id is a UUID
AND under a new uuid otherwise.
WHEN the CLI answers it after the result of the turn's last answer
THEN the turn stays open, and that answer is part of it
AND the turn ends at the result that names the steering message.
WHEN a message waits in the queue meanwhile
THEN it starts only after that result.
WHEN a result names no prompt
THEN it ends the turn.
WHEN the turn is stopped while the CLI holds the steering message, which it has not taken into the turn
THEN a turn of its own opens at once, under the uuid the message was sent with, carrying the message
AND it names the message in `queuedMessageId`
AND the CLI's answer to the message is that turn's
AND the rest of the stopped turn's answer opens no turn and joins none.
WHEN the turn is stopped before the CLI was handed the steering message
THEN the message goes with the stop.
WHEN the turn fails while the CLI holds the steering message
THEN the message fails with it, and the CLI's answer to it opens no turn and joins none.
WHEN a client sends a turn while the turn of the steering message runs
THEN the backend runs it once that turn has ended.
WHEN that turn is stopped
THEN the message stops with it, and the CLI's answer to the message opens no turn and joins none.
WHEN a stopped turn's result comes while another turn runs
THEN it ends no turn.
WHEN the steered turn moves to another login
THEN the new CLI gets the turn's prompt again under a new uuid that `onTurnRecorded` tells the host
AND the turn's steering messages behind it, each under a new uuid, which the host reads back as a turn of its own
AND a turn opened for a steering message sends the message again as its prompt, under a new uuid that `onTurnRecorded` tells the host.
WHEN the turn ends with the refusal because its conversation could not start over
THEN the new CLI gets the steering messages the old one never took in
AND each is answered in a turn of its own.
WHEN the transcript is read back
THEN a message the SDK's reader marks `isQueuedCommand` joins the open turn
AND the CLI's stop text opens no turn and ends the open turn as cancelled
AND the host reads a steering message the CLI ran late back as a turn of its own
AND a steering message answered in a turn of its own reads back as that turn.
WHEN a session resumes a conversation whose turn the host read back as one turn run twice
THEN that turn ends where its later run ends, up to a rewind's point.
The reason: the CLI folds a steering message into a turn at its next tool call.
One that arrives after the last tool call runs as a turn of its own, which the CLI writes as a prompt.
VS Code's replay starts a turn at every prompt a transcript holds.
A prompt that reaches the CLI while such a message waits there runs with it, as one turn with one answer.
*A turn is read back as it began* in the sessions spec says how the host reads such a turn back.
See [`code://packages/agent-claude/src/session/query.ts`](../../packages/agent-claude/src/session/query.ts) and [`code://packages/agent-claude/src/transcript.ts`](../../packages/agent-claude/src/transcript.ts).

### A live tool change in a Claude session

WHEN the tools a Claude session offers change while the session runs
THEN the backend sends `setMcpServers` without the `ahp` server
AND it sends `setMcpServers` again with the new `ahp` server, when the new list has tools
AND an unchanged list sends nothing
AND a session tool that is called between the two calls fails.
The reason: the SDK connects only a server name that it does not have, and `ahp` is registered when the session starts.
WHEN the SDK refuses one of the two calls
THEN the session keeps what the CLI has, and the next change tries again.
WHEN a change comes while another is still being taken
THEN it is sent once the CLI has answered the one before it.
WHEN a turn begins while a change is being taken
THEN its prompt goes to the CLI once the CLI has answered that change
AND a turn with no change in hand starts at once.
The reason: the protocol applies a session's actions in one order.
So a turn a client sends after announcing its tools is a turn of a session that has them.
The host hands the tools over without waiting for them to land.

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

WHEN pi gives a model a thinking level
THEN its `configSchema` offers pi's levels under `thinkingLevel` in VS Code's property, a single level included
AND its default is the level pi starts a session on for that model, where offered.
WHEN a pi session shows its approvals
THEN it offers the pi `permissionMode` property.

### pi's customizations

WHEN pi has loaded skills, prompt templates and extensions for a session
THEN the session lists a directory for each folder pi loaded a kind from, holding that kind
AND an installed pi package as a plugin holding its kinds, each customization named by its URI.
WHEN a client switches one of them, or its folder or package
THEN pi is built again before the next turn and its loader leaves out what is off.

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

### An ACP server's options

WHEN an ACP server names its session config options
THEN the values of its model option are the agent's models, said again where they move
AND the values of its mode option are the session's `availableApprovalModes`
AND each other option is a session control under `<provider>.<id>`, with the values the server gave as the session opened
AND a value that the server moves is said with `session/configChanged`.
WHEN the server names a `thought_level` option for the model that it runs on
THEN that model's row has a `configSchema` with those levels as its `thinkingLevel`, in VS Code's property
AND the agent keeps those levels for its later sessions
AND a turn whose model selection names one of those levels runs at it
AND any other turn runs at the session's value of the control.
The reason: no action changes a schema that a client was served.
VS Code's Codex agent takes the effort of a turn from its model selection, and then from the setting of its session.

### Start carries the host's files, shells and tools

WHEN the host starts a session on a backend
THEN `Start.resources` is the store that the resource commands use, when the host has one
AND `Start.terminals.open` opens a host terminal that a client can watch
AND an ACP agent's terminal in a session placed in a machine runs in that machine, through `computers.how`
AND that terminal is still the host's to list and watch
AND `Start.toolsServer` opens an MCP endpoint for the host tools, when the host has a listener
AND `Start.terminalOutputs` keeps an output under a key of the backend, when the session store keeps a folder for the session.
The reason: a session that asked for a machine must not run the agent's commands on the host. A machine path is not a folder the host has - decision [an-acp-agents-terminal-in-a-machine-runs-in-the-machine](../decisions/an-acp-agents-terminal-in-a-machine-runs-in-the-machine.md).

### `ask_user` reaches every backend but Claude

WHEN the host contributes its `ask_user` tool
THEN a pi or ACP session is offered it, and a call puts the questions on the chat and waits for the person's answer
AND a cofold session is offered the host's `ask_user` in place of cofold's own tool of that name
AND a Claude session is not offered it, because this backend keeps its own question tool for now
The reason: a request the host holds is settled by the host, and only it can send `chat/inputRequested` for the chat the session runs in. Leaving Claude its own tool is a deferred change, in the plan `host/20261103-1620-an-agent-asks-the-person`.

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
