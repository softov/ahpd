# Tools

A **tool** is one thing a session's model can call. Four places contribute them: this host's own set, what a plugin registered, what the clients in the session announced they can run, and the MCP servers the deployment configured. All four end up in one list the model is offered, and the ones that are not the model's own are what this page is about - what a tool is on the wire is [AHP.md](AHP.md#a-clients-tools-are-the-clients-to-run).

Terms, one line each:

| Term | |
| --- | --- |
| a host tool | A `ToolDefinition` and a `run`, contributed to every session's model |
| `serverTools` | The host's tools as a session reports them, on its own state |
| a client tool | One a connected client announced on `SessionActiveClient.tools` and runs itself |
| an MCP server | A program or endpoint whose tools an agent reaches over MCP, configured under `mcpServers` |
| the tools endpoint | One MCP server per session, served by this host, for a backend that cannot call tools in process |
| advanced permission | A tool's own claim that it does more than a session's ordinary work |
| a tool's effects | The claim, `reads`, `writes`, `network` and `destructive`, a backend's policy reads |

## The four sources

**This host's own**, from `hostTools()`: the reference host's nine session tools, its three artifact tools, and this host's own two. They are the protocol's `serverTools`, reported on `SessionState.serverTools`, offered to every backend that can take tools, and replaced whole - which is what `session/serverToolsChanged` means.

**A plugin's**, through `host.registerTool(tool)`, which appends one to the same set. The computer plugin contributes three this way - [PLUGINS.md](PLUGINS.md#what-you-can-register).

**A client's**, announced on `SessionActiveClient.tools`. The protocol makes the client that announced one responsible for executing it and dispatching the result, so these carry an owner and no implementation.

**An MCP server's**, from `mcpServers` in the daemon's configuration. These are not this host's tools at all: an entry names a server the agent itself starts or reaches, and the agent's own harness turns its tools into calls.

## The host's own tools

The nine session tools are the reference host's, by name and by schema, so a skill written against it works here unchanged. Each is a thing an agent inside one session cannot see for itself: the sessions running beside it, the chats inside them, and the terminals a person is watching.

| Tool | What it does |
| --- | --- |
| `list_sessions` | The catalogue, the same rows `listSessions` answers from |
| `get_current_session` | Its own session, as `list_sessions` would describe it |
| `get_session_context` | A chat's turns, its active turn, and whether there is history before them |
| `send_message` | A message into any chat of any session this host runs: sent when the chat is free, queued when it is busy |
| `create_session` | Start another session, owned by the owner of the one it was called from |
| `create_chat` | A second conversation in a session |
| `rename_chat` | Title a chat. The session's title is its first chat's |
| `set_workspace` | Move the session to another directory, acted on when the turn ends rather than mid-turn |
| `delete_session` | Delete a session this host runs, refused for the one it was called from |

`set_workspace` is the one that cannot act when it is called: the agent is restarted in the new directory, and a restart mid-turn is a turn that never finishes, so the request waits for the turn to end. `delete_session` acts as the owner of the session it was called from, not as the model and not as whichever connection started the session it names.

The three artifact tools write the session's `_meta['agentHost/sessionArtifacts']` through the session store: `add_artifact_or_reference`, `remove_artifact_or_reference` and `list_artifacts_and_references`. An artifact is a deliverable - an issue or a pull request being created or fixed, a result somebody will reopen - and a reference is an existing thing somebody will want to look at. Adding one promotes a matching reference and keeps its id, so a reference that turns out to be a deliverable does not become a second entry.

This host's own two are read-only, and answer what an agent cannot reach for itself. `ahp_resource` reads a resource by URI, including one a connected client publishes ([RESOURCES.md](RESOURCES.md)), and `ahp_terminals` lists the terminals this host has open, as `uri`, `title`, `cwd` and `running` on a line each - the list a person can see, which is not the same as a shell run from a tool.

## A client's tools

A client announces them when it becomes active in a session, and this host offers them to the model beside its own. They are named `<clientId>__<name>`, because two clients in one session may both provide `openFile` and the model is offered one list. A client with no id, or a name that is not letters, digits, `_` or `-`, is dropped rather than offered as a tool the model will fail to call.

None of them runs here. The call is reported against the client that provides it, and only that client may complete it, which is what unblocks the agent. A client that never answers is one the call is failed on after `clientToolTimeoutMs`: ten minutes, or never when it is `0`. This host hands the number to the backend when the session starts rather than timing a call itself, so what a call waits is one number decided once.

## MCP servers

`mcpServers` is the host's own servers, by the name a person gave each, and every session is offered them whatever agent it runs. An entry is one of the two shapes VS Code uses.

| Field | Shape | What it is |
| --- | --- | --- |
| `type` | both | `stdio` or `http`, and it decides which of the two below an entry is |
| `command` | `stdio` | The program to run. Required |
| `args` | `stdio` | Its arguments, as an argv |
| `cwd` | `stdio` | The directory to start it in |
| `env` | `stdio` | Variables for the process, over the host's own |
| `url` | `http` | The endpoint to reach. Required |
| `headers` | `http` | Headers to send with every request |

```json
"mcpServers": {
  "files": { "type": "stdio", "command": "mcp-server-filesystem", "args": ["/srv"], "cwd": "/srv", "env": { "TOKEN": "..." } },
  "issues": { "type": "http", "url": "http://127.0.0.1:9310/mcp", "headers": { "Authorization": "Bearer ..." } }
}
```

An entry that is neither shape, or that is missing the one its own `type` needs, is one warning in the log and is left out: one server nobody can reach is a gap in one agent's reach, where a wrong `port` is a daemon that would not run at all. A value in `env` or in `headers` is a credential, so each answers `<set>` wherever root config is shown - decision [The host's MCP servers are the root config key `mcpServers`, as in VS Code, merged per session with its client plugins' servers](../.project/decisions/the-hosts-mcp-servers-are-root-config-as-in-vscode.md).

The map is read at each session's start rather than once when the host was built, so a change reaches the next session opened and a running one keeps the servers it started with. It is absent rather than empty when the host holds none. A backend that cannot take MCP servers ignores it, which is what the in-process backends do - they reach the same servers through their own configuration. A server a client plugin contributes is merged over the host's, a client plugin winning a name clash, but this host has no client plugin customizations to merge yet, so nothing overrides a name today.

## Advanced permission

`advancedPermission` is a tool's own statement that it does more than a session's ordinary work, and `advancedTools` is the operator's answer to it. A tool that declares one is absent from every session unless the host permits them: not reported in `serverTools`, not bound for a call, so a model is never offered it rather than being refused at call time.

Off by default. Turned on with `advancedTools` in the configuration, `--advanced-tools` on the command line, or a root config push, which takes hold while the daemon runs - decision [A tool says when it needs advanced permission, and the host says whether it has it](../.project/decisions/a-tool-says-when-it-needs-advanced-permission.md) and [A configuration change applies live where the key can, and otherwise on `ahpd restart`](../.project/decisions/a-configuration-change-applies-live-or-on-ahpd-restart.md).

The three that declare it are the computer's: `request_disposable_computer`, which makes a machine, `release_computer`, which destroys one, and `computer_exec`, which runs a command inside one. `ahpd plugin list` is unaffected either way: it says what would load, which is a different question from what a session is offered.

`effects` is a different claim and is not a permission. `reads`, `writes`, `network` and `destructive` say what running the tool does, and a backend's policy reads them to decide what to ask a person about - decision [A host tool says what running it does, so a policy can ask about it](../.project/decisions/host-tool-declares-what-it-does.md). The computer's three declare both: `effects` for the policy, `advancedPermission` for whether the host offers them at all.

## The wording a session is given

Four things shape a tool per session, and none of them changes whether a tool that does not ask to be withheld is offered.

Every tool may carry an `instruction`, which a backend that can add to its system prompt adds while the tool is offered. A description says what a tool does; an instruction says when a tool nothing asks for is worth calling. The artifact tools carry the reference host's.

`compact` is the alternate wording a client's key selects: `artifactToolsCompactPrompts` replaces an artifact tool's `definition` and `instruction` and leaves the name, the position in the list and the count alone.

`forSession` is the shape a session's title strategy asks for, and the strategy comes from `deferredTitleGeneration`: `activeAgent`, the default, is the agent naming its own chats, and `deferred` is this host naming them, with `rename_chat` then offered without its `automatic` property, because the case that property covers is exactly the one this host handles. The type carries a third, `utility`, under which a tool is withheld from the list entirely; nothing on this host selects it, so it is a shape a tool has to answer for rather than one a session runs under. A session resolves its strategy when it opens, so a root change reaches the sessions opened after it and not one mid-turn.

`deferLoading` is a host-side hint and never on the wire: it says the harness may hide this tool behind tool search. The artifact tools set it the way the reference does - `add_artifact_or_reference`, which the instruction names, is never deferred, and removing and listing one are, because the model reaches them through the discovery that instruction points at. A tool that says nothing leaves the harness's own default in force.

## How a model reaches them

A backend that can call the host's tools in process is handed them as `Start.tools`, and the harness's own server is what the model sees them through: by name they are all `mcp__ahp__*`, whether they came from this host or from a client.

A backend that cannot - an ACP agent, which asks its client for tools - is handed an endpoint instead. `start.toolsServer()` opens one MCP server per session on the host's own listener, under `/ahp-mcp`, with one path and one bearer token for that session, speaking streamable HTTP at revision `2025-06-18` and answering `initialize`, `tools/list` and `tools/call`. The same list as the in-process case, and a `tools/call` for a client's tool is handed to the backend's runner rather than run here. The endpoint is opened once per session and closed when the session goes. A daemon over stdio has nothing to serve on, so a session there is offered none. The shape that goes to an agent, and what a server that cannot take an `http` server is told, is [PLUGINS.md](PLUGINS.md) - decision [The host's tools are an MCP server the host serves, and each agent plugin says whether its sessions take it](../.project/decisions/the-hosts-tools-are-an-mcp-server-each-backend-may-take.md).

## Configuration keys

| Key | Values | Default | What changes |
| --- | --- | --- | --- |
| `advancedTools` | `true` or `false` | `false` | Offer the tools that declare `advancedPermission` to every session's model. Applies live |
| `mcpServers` | an object of server entries | none | The MCP servers every session is offered. Applies live, and is read again for each session opened |
| `clientToolTimeoutMs` | integer, milliseconds | `600000` (ten minutes) | How long a tool call a client runs may wait for that client. `0` waits for ever |
| `artifactToolsCompactPrompts` | `true` or `false` | `false` | Use the short artifact instruction and tool description. Root config, one setting for the host |
| `deferredTitleGeneration` | `true` or `false` | `false` | Give a session a deferred title strategy, and reshape `rename_chat` with it. Root config |
| `plugins.<name>.hostTools` | `true` or `false` | `true` | Whether a plugin's sessions are offered this host's own tools as one MCP server |

The first two are the daemon's keys and apply while it runs; a root config push of either needs `config:write`. `clientToolTimeoutMs` is a daemon key and needs `ahpd restart`. The two root config keys are one setting for the whole host rather than a connection's own, so both need `config:write` - decision [The root config declares every key VS Code pushes, as the reference declares it, and refuses a key nobody declares](../.project/decisions/root-config-declares-what-vscode-pushes-and-refuses-the-rest.md). Every key with its values and its default is [HOST.md](HOST.md#configuration-keys) and [HOST.md](HOST.md#root-config).

## Commands

There is no `ahpd tools`: the set is the host's own, and a deployment changes it by configuring what is loaded rather than by typing a verb. What does change it is this.

| What | What it does |
| --- | --- |
| `setTools(tools)` | Replace the host's contributed set whole, for a host built from the SDK. Dispatches `session/serverToolsChanged` with the new definitions |
| `registerTool(tool)` | A plugin appending one, before or after the host is running |
| `plugins.<name>` and `plugins.<name>.hostTools` | `ahpd plugin list` says what would load; the option says whether that plugin's sessions take the host's own tools |
| a client becoming active | Its announced tools join the list, and one that stops being active takes its own away |

## Grants

What the host's own tools do is not gated by a grant, because a tool is reached from a turn and not from a socket: `send_message` from inside a session is the same operation `chat/turnStarted` is, arrived at from the model instead of the network, and what confines it is the session's own owner plus whatever a backend's policy asks on `effects`. Nothing is reachable from a tool that is not reachable from a client.

A client's tool is reported and answered over the wire like any other call.

| What | Grant |
| --- | --- |
| Complete a call a client provides | `chat:tool` |
| Confirm one, or answer a question a turn is waiting on | `chat:answer` |
| Read a chat's turns | `chat:turns` |

`member` holds `session:write`, which covers every chat operation in the write group, so it may answer a tool call without a `chat:` grant of its own - [SESSIONS.md](SESSIONS.md#grants).

## See also

| | |
| --- | --- |
| [AHP.md](AHP.md) | What a tool call is on the wire: `chat/toolCall*`, contributors and `_meta.toolKind` |
| [RESOURCES.md](RESOURCES.md) | `ahp_resource`, and the schemes a resource URI may name |
| [TERMINALS.md](TERMINALS.md) | `ahp_terminals`, and the shells it lists |
| [PLUGINS.md](PLUGINS.md) | Registering a tool, and the endpoint a backend without in-process tools is handed |
| [LIBRARY.md](LIBRARY.md#the-tools) | `hostTools()`, and building a host with a set of its own |
| [COMPUTER.md](COMPUTER.md) | The three tools that declare advanced permission |
