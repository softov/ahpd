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

**This host's own**, from `hostTools()`: the reference host's nine session tools, its three artifact tools, and this host's own three. They are the protocol's `serverTools`, reported on `SessionState.serverTools`, offered to every backend that can take tools, and replaced whole - which is what `session/serverToolsChanged` means.

**A plugin's**, through `host.registerTool(tool)`, which appends one to the same set. The computer plugin contributes three this way - [PLUGINS.md](../plugins/PLUGINS.md#what-you-can-register).

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
| `create_session` | Start another session, owned by the owner of the one it was called from, or by the person calling with no session |
| `create_chat` | A second conversation in a session |
| `rename_chat` | Title a chat. The session's title is its first chat's |
| `set_workspace` | Move the session to another directory, acted on when the turn ends rather than mid-turn |
| `delete_session` | Delete a session this host runs, refused for the one it was called from |

`create_session` takes two settings of its own. `agent` names the backend the new session runs, by provider id; absent, the choice is the provider of the `model` asked for, then the calling session's, then the first backend the host holds. A provider the host does not offer is refused, and the refusal names the providers it does. `config` is the new session's settings, as that backend's schema names them, checked the way `createChat` checks a chat's: a value the schema rules out is refused before anything starts, and the host's own `isolation` and `model` win over a key of the same name. With `relationship: currentSession`, both reach the new chat instead, so it runs on the named backend with those settings while the session keeps its own.

`set_workspace` is the one that cannot act when it is called: the agent is restarted in the new directory, and a restart mid-turn is a turn that never finishes, so the request waits for the turn to end. `delete_session` acts as the person whose turn it was called in, and as the owner of the session it was called from where no turn is running: it is never the model, and never whichever connection started the session it names.

The three artifact tools write the session's `_meta['agentHost/sessionArtifacts']` through the session store: `add_artifact_or_reference`, `remove_artifact_or_reference` and `list_artifacts_and_references`. An artifact is a deliverable - an issue or a pull request being created or fixed, a result somebody will reopen - and a reference is an existing thing somebody will want to look at. Adding one promotes a matching reference and keeps its id, so a reference that turns out to be a deliverable does not become a second entry.

This host's own three come after them. Two are read-only, and answer what an agent cannot reach for itself. `ahp_resource` reads a resource by URI, including one a connected client publishes ([RESOURCES.md](RESOURCES.md)), and `ahp_terminals` lists the terminals this host has open, as `uri`, `title`, `cwd` and `running` on a line each - the list a person can see, which is not the same as a shell run from a tool.

The third, `schedule_wakeup`, begins a new turn in the calling chat later. It takes `delaySeconds`, the seconds from now until the turn, from 60 to 2592000 (30 days), and `prompt`, the text the turn begins with, and answers when the wakeup is due. A chat holds one wakeup: a new call replaces it, and `stop: true` cancels it. The host keeps it on the chat's record in the session store, so it survives the session going to sleep and the daemon restarting. When it is due, the host wakes the session if it sleeps and begins the turn, or queues the prompt behind a turn that is running. A wakeup that fell due while the daemon was down begins once, when the daemon starts. The turn goes through the same checks as a client's message, and a wakeup whose turn is refused or whose session cannot resume stays stored and fires again when the daemon next starts. A pending wakeup does not keep the session awake - [SESSIONS.md](SESSIONS.md#sleep-and-wake).

## Tools that need no session

A tool with `sessionless: true` runs with no calling session. Its `run` is given a `ToolCall` whose `session` and `chat` may be absent, and `host.sessionlessTools(caller)` answers the tools a caller may see, each bound to that caller: the session a call reaches, the person it acts for, and the grants it asks are the caller's, not a turn's. A tool with no `sessionless` is never in that list, whichever grant it names.

The caller is this host's root connection, `{ root: true }`, or a person, `{ principal }`. `grant` is the grant a caller needs to see a tool in that list: root sees every listed tool, a principal sees the ones whose `grant` it holds, and a host with no users directory sees all of them. A tool that names no grant is one every caller sees.

Seven of the nine session tools are listed. `list_sessions` and `get_session_context` ask `session:read`, and `create_session`, `create_chat`, `rename_chat`, `send_message` and `delete_session` ask `session:write`, the same grants the table under Grants names for a turn. `get_current_session` and `set_workspace` are not listed, because each is about the session the call came from and about nothing else.

A call with no session is the agent's own, with no delegation `_meta`, so no turn above it can be named. It refuses what needs one: `create_session` refuses `relationship: currentSession` with `currentSession needs a calling session; use independent`, and `create_chat`, `rename_chat`, `send_message` and `get_session_context` refuse a call that names no session. What it makes is the caller's: a session `create_session` opens with `independent` is owned by the caller and has no parent, so it is no link in any chain, and a message `send_message` sends is a turn recorded as the caller's. A call with no session also spends none of the tree budgets under Limits, since there is no tree to charge. A `tool_call` event for one names the person and no session.

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

An entry that is neither shape, or that is missing the one its own `type` needs, is one warning in the log and is left out: one server nobody can reach is a gap in one agent's reach, where a wrong `port` is a daemon that would not run at all. A value in `env` or in `headers` is a credential, so each answers `<set>` wherever root config is shown.

The map is read at each session's start rather than once when the host was built, so a change reaches the next session opened and a running one keeps the servers it started with. It is absent rather than empty when the host holds none. A server a client plugin contributes is merged over the host's, a client plugin winning a name clash. The Claude backend hands the map to its CLI as the SDK's own servers, beside the ones the CLI's own files name: the person's `~/.claude.json`, and a trusted project's `.mcp.json`. A name both use is handed over as the host's, and the CLI's own precedence settles it against its files, as VS Code's agent host leaves it. A stdio server whose `cwd` is not the session's folder is left out there and logged, because the CLI starts a stdio server in the session's folder. An ACP agent is handed the map on its `session/new`. A backend that cannot take MCP servers ignores it, which is what pi and cofold do - they reach the same servers through their own configuration.

## Advanced permission

`advancedPermission` is a tool's own statement that it does more than a session's ordinary work, and `advancedTools` is the operator's answer to it. A tool that declares one is absent from every session unless the host permits them: not reported in `serverTools`, not bound for a call, so a model is never offered it rather than being refused at call time.

Off by default. Turned on with `advancedTools` in the configuration, `--advanced-tools` on the command line, or a root config push, which takes hold while the daemon runs./HOST.md).

The three that declare it are the computer's: `request_disposable_computer`, which makes a machine, `release_computer`, which destroys one, and `run_in_computer`, which runs a command inside one. `ahpd plugin list` is unaffected either way: it says what would load, which is a different question from what a session is offered.

`effects` is a different claim and is not a permission. `reads`, `writes`, `network` and `destructive` say what running the tool does, and a backend's policy reads them to decide what to ask a person about. The computer's three declare both: `effects` for the policy, `advancedPermission` for whether the host offers them at all.

## Which sessions are offered the session tools

An install can turn the nine session tools off, as one answer or per provider, with two daemon keys. `sessionTools` is the switch: `true`, the default, offers them; `false` offers them to no session. `sessionToolsProviders` is a list of provider ids and narrows the switch to those providers' sessions; empty, the default, narrows nothing.

They are two keys rather than one because a key carries one type, and one key cannot be both a boolean and a list: `sessionTools` is a control a settings screen draws, and `sessionToolsProviders` is a list it draws. The list narrows rather than replaces, so `false` with a list still offers the tools to nobody.

What it covers is the nine and nothing else. The three artifact tools, `ahp_resource`, `ahp_terminals` and `schedule_wakeup` are this host's own rather than the reference host's session tools, so they are offered whatever the option says - an install can keep a person's artifacts and wakeups without giving its agents the catalogue of the sessions beside them.

A tool left out is absent from `SessionState.serverTools` and is not bound for a call, the same shape as `advancedPermission`: a model is never offered it rather than being refused at call time. The answer is worked out per session, from the provider that session runs, so a list offers the tools to some sessions and not to others. A session whose provider this host is only browsing, with no agent of its own, is one a list does not name.

Both are daemon keys and apply while the daemon runs: a root config push to either rebuilds what every running session is offered and tells each of them. The command line takes both, each spelled as its key: `--session-tools` and `--no-session-tools` for the switch, and `--session-tools-providers claude --session-tools-providers echo` for the list, which is repeatable.

## The wording a session is given

Four things shape a tool per session, and none of them changes whether a tool that does not ask to be withheld is offered.

Every tool may carry an `instruction`, which a backend that can add to its system prompt adds while the tool is offered. A description says what a tool does; an instruction says when a tool nothing asks for is worth calling. The artifact tools carry the reference host's.

`compact` is the alternate wording a client's key selects: `artifactToolsCompactPrompts` replaces an artifact tool's `definition` and `instruction` and leaves the name, the position in the list and the count alone.

`forSession` is the shape a session's title strategy asks for, and the strategy comes from `deferredTitleGeneration`: `activeAgent`, the default, is the agent naming its own chats, and `deferred` is this host naming them, with `rename_chat` then offered without its `automatic` property, because the case that property covers is exactly the one this host handles. The type carries a third, `utility`, under which a tool is withheld from the list entirely; nothing on this host selects it, so it is a shape a tool has to answer for rather than one a session runs under. A session resolves its strategy when it opens, so a root change reaches the sessions opened after it and not one mid-turn.

`deferLoading` is a host-side hint and never on the wire: it says the harness may hide this tool behind tool search. The artifact tools set it the way the reference does - `add_artifact_or_reference`, which the instruction names, is never deferred, and removing and listing one are, because the model reaches them through the discovery that instruction points at. A tool that says nothing leaves the harness's own default in force.

Beside the tools' own wording, a session carries the rules of the clients in it. A client publishes a plugin on `SessionActiveClient.customizations`, and this host copies it; a rule in that copy is a `.mdc` or `.instructions.md` file, and only one whose frontmatter says `alwaysApply: true` applies. The rest are rules an agent reads where they apply, which is a decision this host has no turn to make. The body of each that applies joins `Start.instructions` after the host tools' own, with its frontmatter left behind. A body over 4096 characters is dropped, and the log names the rule.

Claude appends the instructions to its preset prompt, and pi and cofold add them to the prompt they start with. An ACP server keeps its own system prompt, so the chat's first prompt opens with the words as text instead. The rules are read when a chat starts, so a change reaches the next start, and a plugin set that moves restarts the chat between turns.

## How a model reaches them

A backend that can call the host's tools in process is handed them as `Start.tools`, and the harness's own server is what the model sees them through: by name they are all `mcp__ahp__*`, whether they came from this host or from a client.

A backend that cannot - an ACP agent, which asks its client for tools - is handed an endpoint instead. `start.toolsServer()` opens one MCP server per session on the host's own listener, under `/ahp-mcp`, with one path and one bearer token for that session, speaking streamable HTTP at revision `2025-06-18` and answering `initialize`, `tools/list` and `tools/call`. The same list as the in-process case, and a `tools/call` for a client's tool is handed to the backend's runner rather than run here. The endpoint is opened once per session and closed when the session goes. A daemon over stdio has nothing to serve on, so a session there is offered none. The shape that goes to an agent, and what a server that cannot take an `http` server is told, is [PLUGINS.md](../plugins/PLUGINS.md).

## Configuration keys

| Key | Values | Default | What changes |
| --- | --- | --- | --- |
| `advancedTools` | `true` or `false` | `false` | Offer the tools that declare `advancedPermission` to every session's model. Applies live |
| `sessionTools` | `true` or `false` | `true` | Whether the nine session tools are offered at all. Applies live, and is worked out per session |
| `sessionToolsProviders` | a list of provider ids | none | Offer the session tools to the sessions of these providers alone. Empty offers them to every provider. Applies live, and is worked out per session |
| `mcpServers` | an object of server entries | none | The MCP servers every session is offered. Applies live, and is read again for each session opened |
| `clientToolTimeoutMs` | integer, milliseconds | `600000` (ten minutes) | How long a tool call a client runs may wait for that client. `0` waits for ever |
| `artifactToolsCompactPrompts` | `true` or `false` | `false` | Use the short artifact instruction and tool description. Root config, one setting for the host |
| `deferredTitleGeneration` | `true` or `false` | `false` | Give a session a deferred title strategy, and reshape `rename_chat` with it. Root config |
| `plugins.<name>.hostTools` | `true` or `false` | `true` | Whether a plugin's sessions are offered this host's own tools as one MCP server |

The first four are the daemon's keys and apply while it runs; a root config push of any needs `config:write`. `clientToolTimeoutMs` is a daemon key and needs `ahpd restart`. The two root config keys are one setting for the whole host rather than a connection's own, so both need `config:write` - decision [The root config declares every key VS Code pushes, as the reference declares it, and refuses a key nobody declares](../../.project/decisions/root-config-declares-what-vscode-pushes-and-refuses-the-rest.md). Every key with its values and its default is [HOST.md](HOST.md#configuration-keys) and [HOST.md](HOST.md#root-config).

## Commands

There is no `ahpd tools`: the set is the host's own, and a deployment changes it by configuring what is loaded rather than by typing a verb. What does change it is this.

| What | What it does |
| --- | --- |
| `setTools(tools)` | Replace the host's contributed set whole, for a host built from the SDK. Dispatches `session/serverToolsChanged` with the new definitions |
| `registerTool(tool)` | A plugin appending one, before or after the host is running |
| `plugins.<id>` and `plugins.<id>.hostTools` | `ahpd plugin list` says what would load; the option says whether that plugin's sessions take the host's own tools |
| a client becoming active | Its announced tools join the list, and one that stops being active takes its own away |

## Grants

A session tool is reached from a turn and not from a socket, and the turn says whose it is: under a users directory each one asks the grants of the person who sent that turn. A refusal is the host's own words, the sentence a client is told on the wire, naming that person: `reader may not session:write here`. Where nobody is behind the call there is no id to name, and the refusal is about the turn instead: `this turn may not session:write here`. `send_message` from inside a session is the same operation `chat/turnStarted` is, arrived at from the model instead of the network, so a person who may not send a turn may not send one this way either - and nothing is reachable from a tool that is not reachable from a client. A host with no users directory has nobody to ask, and its tools act as they always did.

| Tool | Grant |
| --- | --- |
| `list_sessions` | None, because the listing is already cut to that person: `session:read` is what decides whether it answers the catalogue or nothing |
| `get_current_session` | `session:read` |
| `get_session_context` | `session:read` |
| `set_workspace` | `session:write` |
| `create_session` | `session:write` |
| `create_chat` | `session:write` |
| `rename_chat` | `session:write` |
| `send_message` | `session:write` |
| `delete_session` | `session:write`, and then the owner's own say: only the session's owner, or a person holding `session:*`, may delete one |
| `schedule_wakeup` | None, because it acts on the calling chat alone |
| `add_artifact_or_reference`, `remove_artifact_or_reference`, `list_artifacts_and_references` | None: they write the calling session's own record |
| `ahp_resource`, `ahp_terminals` | None: they answer what the calling session may already reach |

A call nobody is behind holds the read half alone: a turn this host began for itself, a turn a rule nobody owns started, a turn whose sender has not signed in since this process started, whose grants the host cannot name, and a call reached with no turn running at all, which is a window outliving the turn it sent. Each reads the sessions and is refused every write with `this turn may not session:write here`. A turn a session tool or a wake begins carries the person of the turn that began it, so a session opened by `create_session` acts as the person who asked for it and never as more.

A client's tool is reported and answered over the wire like any other call.

| What | Grant |
| --- | --- |
| Complete a call a client provides | `chat:tool` |
| Confirm one, or answer a question a turn is waiting on | `chat:answer` |
| Read a chat's turns | `chat:turns` |

`member` holds `session:read` and `session:write`, so the session tools answer it, and it may answer a tool call without a `chat:` grant of its own, since `session:write` covers every chat operation in the write group - [SESSIONS.md](SESSIONS.md#grants). `guest` holds `session:read` and nothing else a session tool asks for, so it reads what is there and writes none of it; and because a chat's write group is its session's, a guest can never send a turn for a tool to run in.

## Limits

The session tools are bounded the way the reference host bounds its own, with its numbers and its words, so a runaway agent stops where it stops there.

| Bounded | Limit | The refusal |
| --- | --- | --- |
| Spawn depth | 3 links below the session a chain began in | `Refusing to create a session: recursion limit reached (max spawn depth 3). This session was itself created 3 level(s) deep.` |
| Sessions | 50 per session tree, made by `create_session` with `independent` | `Refusing to create more than 50 sessions from server tools in this session tree.` |
| Chats | 50 per session tree, made by `create_chat` or by `create_session` with `currentSession` | `Refusing to create more than 50 chats from server tools in this session tree.` |
| Messages | 100 per session tree, sent by `send_message` | `Refusing to send more than 100 messages from server tools in this session tree.` |

Depth is per session, and a chain rather than a tree: it is how many `create` links sit above the session making the call, so a session nothing started is at 0 and one the tool made inside another is one link deeper. A session three links down may not make one of its own, so a chain is four sessions long at most. The number in `created 3 level(s) deep` is the depth of the session that was refused, which is 3 or more.

The three counts are kept per session tree: a session nothing started, and everything the `create` tool grew from it, read through the parent links the store keeps. This is the one place the bounds differ from the reference host's, whose counters belong to its tool group and are therefore shared by every session and every person on one daemon; a tree here spends its own budget instead, so one session's runaway agent leaves what another session may make untouched. A count is taken against the session the tool runs in, and not against whatever the call makes or reaches. A message is counted in the tree of the session that sent it, however many sessions it is sent to. A chat or a session is counted in the tree whose tools made it. Counting the target instead would give one runaway a fresh hundred messages for every session it can name, and fifty more chats in each. Each is taken only once the thing it counts has happened, so a call refused for any other reason - a link naming a chat the session does not run, a turn whose person does not hold `session:write` - is not counted against the budget.

Only the tools are counted. A client's own `createSession`, and a message it sends with `chat/turnStarted`, are unbounded here: a count is a bound on what an agent may start on its own, and a person at a window is answerable for what they start.

The counters live in memory, as the reference host's do, so a restart is a new process with new counters. This bounds a runaway rather than metering a tree's work: an install that wants a tree to make fifty more sessions restarts the daemon.

## See also

| | |
| --- | --- |
| [AHP.md](AHP.md) | What a tool call is on the wire: `chat/toolCall*`, contributors and `_meta.toolKind` |
| [RESOURCES.md](RESOURCES.md) | `ahp_resource`, and the schemes a resource URI may name |
| [TERMINALS.md](TERMINALS.md) | `ahp_terminals`, and the shells it lists |
| [PLUGINS.md](../plugins/PLUGINS.md) | Registering a tool, and the endpoint a backend without in-process tools is handed |
| [BUILD-A-HOST.md](BUILD-A-HOST.md#the-tools) | `hostTools()`, and building a host with a set of its own |
| [COMPUTERS.md](../plugins/COMPUTERS.md) | The three tools that declare advanced permission |
