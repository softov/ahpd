# Changelog

What changed in each release of the `@ahpd/*` packages. Every package carries the same version. Releases before 0.11.0 are in the git history.

## 0.14.1 - unreleased

### Upgrading

- A terminal's `terminal/data` no longer carries the shell's OSC 133 and OSC 7 marks, as the protocol requires of a server. A client that read command boundaries or the directory from the marks reads `terminal/commandExecuted`, `terminal/commandFinished` and `terminal/cwdChanged`.
- `terminal/commandDetectionAvailable` goes out with the shell's first OSC 133 mark rather than when the terminal opens, and `supportsCommandDetection` is false until then. A shell that prints no marks never announces it.
- A tool call part is its `kind` and its `toolCall`, as the protocol declares one, from every agent. A client that found a call's part by an `id` beside them finds it by `toolCall.toolCallId`. A system notification part carries no `id` either.
- An ACP session's commands are the children of one read-only `commands` directory customization, as the protocol holds a prompt, and no longer customizations of their own.
- A pi `!` command's call is named `terminal` and shown as `Terminal`, with the command as its intention, its line and its input, as every other backend's is. It was named `shell`, shown as the command, with the command as JSON for its input.

### Daemon

- On Bun, a terminal is a pseudoterminal with OSC 133 command detection: Bun's own, through the `terminal` option of `Bun.spawn`, from Bun 1.3.5 on Linux and macOS and from Bun 1.3.14 on Windows, where it is ConPTY. `node-pty` is never loaded on Bun, where it loads but every shell it starts dies at once. Node and Deno keep `node-pty` where it loads. See [docs/sdk/TERMINALS.md](docs/sdk/TERMINALS.md#pipes-or-a-pseudoterminal).

### Terminals

- The output a shell printed before a mark goes out before the mark's action, so the output between `terminal/commandExecuted` and `terminal/commandFinished` is the command's. A mark that arrives in two reads is still read and taken out. See [docs/sdk/TERMINALS.md](docs/sdk/TERMINALS.md#command-boundaries).
- On pipes, a character whose bytes arrive in two reads reaches the client whole rather than as two replacement characters: each pipe is decoded as one stream. See [docs/sdk/TERMINALS.md](docs/sdk/TERMINALS.md#pipes-or-a-pseudoterminal).

### Sessions and VS Code parity

- A `!` command's call names its terminal as soon as the terminal opens, with `chat/toolCallContentChanged`, so a client watches the output arrive, as VS Code's does. A backend hears the terminal from the second argument of `Session.ran`'s `run` (`RunCommand`, `CommandTerminal`), and `Ran` and the handle of a terminal a backend opens say `isPty`. See [docs/sdk/TERMINALS.md](docs/sdk/TERMINALS.md#who-opens-one).
- A terminal a tool call names opens for as long as its chat lasts. A `!` command's terminal and a terminal a backend opens are named `ahp-terminal://shell/<chat>/<key>`, and what each printed is kept in the session's folder when it exits. A subscribe that no live terminal answers gets the exited terminal back: after a client disposed it, after the backend released it, and after the daemon started again. What is kept goes with its turn on a truncation, with its chat and with its session, and moves with its chat. A backend keeps an output of its own with `Start.terminalOutputs`, and a transcript read is handed the outputs of the chat it reads. See [docs/sdk/TERMINALS.md](docs/sdk/TERMINALS.md#a-terminal-a-tool-result-names).

### Agents

- Claude: a `Bash` result too large to send shows the whole output Claude saved in a terminal on the call, as VS Code does. The call keeps Claude's notice as its text, and the terminal has exited, with 0 for a command that worked. The host keeps the output for as long as the chat lasts, and a call read back from the transcript names the terminal again.
- Claude: an answered `AskUserQuestion` reads back with its answers after a restart, in the session and in a subagent's chat. The answers are read from the transcript entry where the CLI writes them, which the SDK's reader leaves out. See [packages/agent-claude/README.md](packages/agent-claude/README.md#what-it-does).
- Claude, ACP, cofold, pi and the bot send only what the protocol declares: no `id` on a tool call part or a notice, live or read back from a transcript. Each is driven through a host in its suite, every frame it sends and the chat a late client reads checked with the protocol's own schema. The wire suite reads the chat again after its turn, where it read only the session.
- ACP and pi: a client that subscribes after a call ran reads the call a client that watched built, with its line, its confirmation and its result's content, as the protocol's reducer builds it.
- Every agent on the root channel has a `description`, which `AgentInfo` requires: the backend's own, or its display name.
- Claude, ACP, cofold and pi: a terminal a call names says `isPty` as the terminal's state does, so a client parses the VT sequences a pseudoterminal writes; it said `isPty: false` whatever ran the command. An ACP server's own terminal says it too.
- cofold: a `!` command's call is held as a client that watched it holds it, so a client that subscribes while the command runs reads the running call, and its ready says the command as its line.
- pi: a `!` command's call names the terminal it ran in, which a client opens to watch it and read it after.

## 0.14.0 - 2026-10-26

### Upgrading

- A webhook endpoint is now a `webhook` connector, and a hand-written `webhooks/<id>.md` file is no longer read. A call to an id that no open connector answers for answers 404. Make each endpoint again with `x-ahpd/connectors/put`, giving it the same id, the bot or the automation, and the token a caller already sends:

```json
{
  "id": "ci",
  "adapter": "webhook",
  "owner": "host",
  "config": { "bot": "bot://motion", "secret": "the token a caller sends", "reply": "sync" }
}
```

  The host writes the token to the vault as `host:connector/ci/secret`, so the caller's header does not change. A `host:<name>` secret the old record named can be taken out with `ahpd vault delete host:<name>`. See [docs/plugins/WEBHOOKS.md](docs/plugins/WEBHOOKS.md).
- A plugin registers **adapters**, not connector kinds: `registerConnector` is `registerAdapter`, `ConnectorKind` is `Adapter`, `connectorKinds` is `adapters`, and the contract key `connectors` is `adapters`. A stored connector that still says `kind` and not `adapter` reads as `unavailable`. A plugin whose manifest declares `connectors` no longer loads.
- `x-ahpd-adapters` lists the adapters, and `x-ahpd-connectors` lists only connectors. A connector row no longer carries an adapter row beside it, and its `adapter` field names the adapter it is one of.
- `x-ahpd-plugins`, `x-ahpd-adapters` and `x-ahpd-connectors` take their own grants rather than `config`. A role that read the plugins with `config:read` now needs `plugin:list`, and one that read the connectors now needs `connector:list`. One that enabled, disabled or edited a plugin with `config:write` now needs `plugin:enable`, `plugin:disable` or `plugin:options`. One that made or removed a connector now needs `connector:put` or `connector:remove`. Over HTTP, `plugin config`, `enable` and `disable` take the same grants and are no longer the deployment token's alone; install, update and remove still are.
- Every connector action takes a `connector:` grant, the caller's own connector included. A person needs `connector:put` to make their own connector and `connector:remove` to remove it. `connector:list` reads the caller's own connectors, their teams' and the host's, and no other person's; a role that reads every connector needs the new `connector:all`. A connector owned by `host` also needs the new `connector:host` to be made or removed. A team connector no longer takes `team:write`; it takes `connector:put` or `connector:remove` and a membership of the team.
- `x-ahpd-connectors` opens with `connector:list`, and a role holding `connector:all` subscribes without it and reads every row. A client that read the channel's grant from `ahpd.channels` now reads `connector:list`.
- A role that made or removed a host connector with `connector:put` or `connector:remove` alone now also needs `connector:host`.
- A webhook connector's `automation` is now the id of the automation a call starts, not `true`. A connector that names neither `automation` nor `bot` fires the `webhook` trigger. A stored `automation: true` opens as `invalid`, and `x-ahpd/connectors/put` refuses it until the id is given.
- A `webhook` trigger's `config` field is `connector`, not `endpoint`. An automation that still says `endpoint` is refused when it is saved, and a stored one does not fire.
- A run reads `{{event.body.<field>}}`, `{{event.headers.<field>}}` and `{{event.query.<field>}}`. `{{event.<field>}}` is empty, so an automation written for the old event data needs its placeholders rewritten.
- The default `reply` is `none`, not `callback`. A bot connector made with only `bot` and `secret` answers 202, a `reply` of `callback` needs a `callbackPrefix`, and `reply`, `callbackPrefix` and `syncTimeoutSeconds` are refused on a connector with no `bot`.
- Node 22.18 is the floor, because a `.ts` plugin entry loads only where Node strips types. `engines`, the install scripts and `ahpd configure` say 22.18.
- A model provider is a connector. `modelProxy.providers`, the three built-in providers and their environment keys are removed, and a file that still has `modelProxy.providers` is refused at start. Add each provider as a connector of the `openrouter`, `anthropic`, `openai` or `openai-compatible` adapter, with its key in the vault or `{ "fromEnv": "<NAME>" }`. Give it the old provider's name as its id, so `modelProxy.models` reads as before. See [docs/server/PROXY.md](docs/server/PROXY.md).
- An agent is a record, not a preset. At the first start, the `presets` in config.json become host agent records, and a plaintext key moves to the vault. The file is backed up to `config.json.bak-<stamp>` before it is rewritten. Presets set with `--plugin` or `--plugin-option` are not moved.
- A plugin's options schema is `ahpd.optionsSchema` in its package.json. A module that exports `optionsSchema` or `manifest` no longer loads. A bare `.ts` or `.js` file needs a `plugin.json`, or `id`, `name`, `version` and `source` in its config entry. See [docs/plugins/PLUGINS.md](docs/plugins/PLUGINS.md).
- A plugin entry in the config names its module with `source`, and `name` is the display name. An entry that still names its module with `name` loads, and is written back with `source` at its next change.
- `ahpd proxy list` prints the model names only.

### Webhooks

- A webhook connector names one `auth` scheme: `bearer` (the default), `header`, `query`, `hmac`, `github`, `stripe`, `slack`, `standard`, `meta` or `graph`. A timestamped scheme refuses a call more than 300 seconds from the host's clock, and every value is compared in constant time. A token in the URL can land in a proxy log.
- A call carries any body: JSON of any shape, a form, text or nothing, up to `maxBodyBytes` (5 MiB by default). A body over the limit answers 413.
- A run reads `event.connector`, `event.method`, `event.body`, `event.headers` and `event.query`. The proof header, `authorization`, `cookie` and the URL `token` are kept out.
- `match` on the connector selects the calls that reach its target, by a dotted path of the event data. A call it does not take answers 202 with `{ "skipped": true }`.
- A connector names an `automation`, and a call starts that one automation. A connector with neither `bot` nor `automation` fires the `webhook` trigger, and every automation whose trigger config names the connector runs if the owner rule passes.
- `meta` and `graph` answer their URL handshakes, and `slack` answers `url_verification`. Nothing fires on a handshake.
- A connector links to an automation only when both have the same owner or the connector is the host's, checked on save and again at a fire.
- `PluginHost.runAutomation(id, data, owner?)` starts one automation by its id, and `fireTrigger` takes the owner of the connector the event came from.
- An adapter schema marks a connector field with `x-ahpd-connector` and an automation field with `x-ahpd-automation`; the host checks both on save.

### Plugins and connectors

- `PluginHost.startSession(wanted, named)` takes a second argument: a function the host calls once, with the session's URI, before the tree is isolated and the backend spawns. A plugin that answers for that URI can answer from the start, so a bot's connector actions are in its session's first tool list. A `named` that throws is logged and the start goes on.
- `PluginHost.startChat(session, { provider, model, config, title, prompt })` starts a chat inside a session on a backend the plugin names, and answers the chat's URI. `ToolCall.createChat` takes the same `provider` and `config` beside its other options. The session keeps its own provider and its other chats; the chat's backend and config are recorded with it, so a session restart, `restartChat`, a rewind and a daemon restart start it on that backend again. The session's `computer` and contributed session keys reach the chat; the session backend's own keys do not. The session owner's `chat:create` is asked first, and an unknown provider is refused. A client reads the chat's backend in `_meta['ahpd.provider']`, on the chat's state and nowhere on the session's own chats.
- A plugin declares a manifest: a description, categories, links and contracts. A registration its contracts do not list fails that plugin, with a line naming the method and the name. A plugin with no contracts loads as before, and is listed as `undeclared`.
- A plugin registers adapters, each with a JSON Schema a client draws the form from and the capabilities a connector of that adapter has.
- `x-ahpd-plugins` lists the configured plugins, and `x-ahpd/plugins/enable`, `disable` and `options` change the file the daemon loads.
- A plugin row carries `version`, `loaded`, `optionsSchema` and `alerts`. The daemon reads every plugin's manifest with no import. A disabled plugin, and an enabled one that failed to load, still show what they provide and which options they take.
- A plugin raises an alert with `host.alert({ level, text, ref? })` and removes one with `host.clearAlert(ref)`. The levels are `notice`, `info`, `warning` and `error`. A failed load is an `error` alert, and `problem(line)` and the loader's other lines are `warning` alerts. An alert with the same `ref` replaces the old one, a plugin keeps at most 50, and a reload or unload clears them. An alert raised after the load sends the row again. Any URL userinfo and any `writeOnly` option value an alert quotes is answered `<set>`.
- A plugin installs an npm package into its own `installed/` folder with `host.install(spec)`, which answers `{ version }` or `{ error }`. npm runs with `--ignore-scripts`, one install at a time per plugin. A spec that starts with `-` or holds whitespace, a quote or `%` is refused.
- Enable, disable, options and install take effect while the daemon runs, and only a plugin with a port still asks for a restart. `ahpd plugin reload <name>` imports a plugin's code again, and `ahpd plugin update` reloads each package it moved. A reload ends the sessions of the agent it moves. A live change of adapters keeps the old adapter tools until a restart.
- A role holding `plugin:install` installs, removes and writes plugins from a client. `x-ahpd/plugins/install {source}` takes every source the CLI takes, `x-ahpd/plugins/remove {id, keep?}` takes the entry out, and `x-ahpd/plugins/write {id, source, packageJson}` writes a one-file TypeScript plugin that `x-ahpd/plugins/source {id}` reads back. `plugin:install` is in no group, so only admin holds it by default. A source that starts with `-` is refused before npm runs.
- A plugin manifest and an adapter name icons, with a light and a dark theme. The host sends each icon as a `data:` URI of at most 32 KB and an `image/` type. It reads the icon from inside the package or fetches it from `https:` at load, so a client never contacts a plugin's server. Each first-party plugin and the webhook adapter ship an icon.
- An adapter may have `check(connector)`, which answers ok, denied, unreachable or failed, and `x-ahpd/connectors/check` runs it with `connector:put`. A connector row carries `health`: the last check, the last call and the last failure.
- A connector the host started with a valid config is `ready`. `ConnectorState` is `ready`, `invalid` or `unavailable`.
- A host connector's secret can be `{ "fromEnv": "NAME" }`. A connector owned by a person or a team that names a variable is refused at put and opens `invalid`, so it never reads the daemon's environment.
- `enable`, `disable` and `options` mark `ahpd.restartNeeded` on the root state for every connection, and only a restart clears it. A connection watching the root is sent `x-ahpd/restartNeeded` with `{ channel: "ahp-root://" }` when the mark is set, once, so a client holding the state does not have to read it again.
- `x-ahpd-adapters` lists the adapters a host serves, keyed by adapter name, and read-only. `x-ahpd-connectors` lists the connectors, and `x-ahpd/connectors/put` and `remove` make and take them away. A field an adapter's schema marks `writeOnly` goes to the vault under the owner's scope, and is in no record and no snapshot.
- A `receive` capability may carry `path`, where its connectors receive on the daemon's HTTP root, with `{id}` for the connector id. `x-ahpd-adapters` sends it, and the `@ahpd/webhook` capability names `/plugins/webhook/{id}`.
- `@ahpd/webhook` registers the first adapter, so a client makes a webhook endpoint from the connector form.
- `@ahpd/activepieces` offers each Activepieces piece as an adapter, named `ap-<piece>`: the `pieces` option names the piece packages, a connector is one account, and each action runs as a host tool in a child process that pins `NODE_TLS_REJECT_UNAUTHORIZED`. The pieces are Resend, Telegram Bot, Slack, GitHub, Linear, Jira Cloud, Discord, WhatsApp Business, Notion, Airtable, SMTP, SendGrid, Stripe and HubSpot. See [docs/plugins/activepieces.md](docs/plugins/activepieces.md).
- An Activepieces piece may carry a version, as in `@activepieces/piece-postgres@0.5.1`. A piece that is missing, or not at the written version, installs when the options are saved. A written version runs from `installed/` even when the plugin ships the piece. Each install is an alert with ref `piece:<package>`: `info` with the version, or `error` with npm's reason.
- An adapter's `action` capability runs as a host tool: one `<adapter>_<action>` tool for every connector of an adapter that has `run`, offered only to a session that binds one of them. A session names its connectors by alias in the new `connectors` config key, set when it starts, or a bot names them in its record and the bot plugin answers them live through the new `registerBindings`. The host resolves the alias, checks the connector and its owner at every call, and never hands the model an id or a secret. See [docs/plugins/PLUGINS.md](docs/plugins/PLUGINS.md#an-action-offered-as-a-tool).

### Model proxy

- The host ships four provider adapters, `openrouter`, `anthropic`, `openai` and `openai-compatible`, each with a form, a key check and an icon. A provider is added in a client with no restart.
- A model entry's `provider` names an adapter or a connector id. A call uses the caller's own connector first, then the scope team's, then the host's, and the usage record names the connector that paid.
- A ready provider connector lists its own models, read again each hour, and a model is callable as `<prefix>/<id>` with no line in the proxy file. A fetched model takes the same policy and owner order as a table entry, and its fetched price is charged.
- `/models` carries OpenRouter's name, context length and pricing, and the OpenAI paths also answer at the root.

### Bots

- A bot chat that nothing runs carries its bot's mark in `_meta`, so a client draws it as a bot chat from the first frame. `Listed` takes an optional `_meta`, sent while nothing runs the session.
- A session a bot starts has the bot's connector actions from its first tool list. The host names the session's URI before the tree is made and before the backend spawns, the bot keeps the URI from then on, and its reader answers for it. A start that fails after the URI is named leaves no entry, so nothing binds a session that does not exist.
- A message sent in a bot chat while a turn runs shows as a turn of its own. The running turn ends `complete` with what it held, and the back session's answer after the steer lands under the new turn.
- A bot record has a `connectors` field: the connectors its sessions may use, by alias, such as `{ "work": "connectors://ap-resend/account-123" }`. Each session the bot started reads it live, so an edit reaches a session that is already running, and a bad alias or value is refused `-32602` when the bot is written.

### Agents

- An agent is a record on `x-ahpd-agents`, added, edited and removed the way a connector is. It is owned by the host, a team or a user, with the same owner rules. A caller sees only the agents it may use. A record is read live, so an edit reaches a running session at its next turn.
- An agent record names its engine in `engine`. `x-ahpd-engines` lists the engines, and needs `agent:list`. A row has the engine's name, title, plugin, icon, templates and the schema a record's `config` follows. It also lists the fields only a host record may set, and the key variables any record may set. agent-claude, agent-acp, agent-cofold and agent-pi register `claude`, `acp`, `cofold` and `pi` with `registerEngine` and the contract key `engines`.
- An engine's key fields and key variables go to the vault on put, and no row or log holds their values. Only a host record may set other env variables or `extraArgs`.
- `ahpd configure` writes an `acp` record instead of a preset.
- The four agent plugins are titled Agent Claude, Agent ACP, Agent Cofold and Agent pi in the plugin list.
- cofold: a transcript read while a rewind removes a run answers the turns that remain instead of failing. The removed run's turn carries no usage, ending or duration.
- A background task has one shape from every backend. A backend reports it through `Start.backgroundTasks`, and the host draws the row; a `chat/backgroundWork*` action a backend sends itself is dropped.
- Claude's background shells show their output in a terminal of their own, read once a second, and stop with `vscode/stopBackgroundWork`, which needs `chat:cancel`.
- An ACP terminal that still runs when its call ends is listed as a background shell, and its stop kills the process. A nested host lists its inner host's tasks.

### Sessions and VS Code parity

- A session row's counts move while a turn runs, at each finished tool call, rather than waiting for the turn to end. The reads are coalesced per session, so a burst of tool calls costs at most one read running and one waiting.
- A worktree session counts from the commit its tree was cut from, kept with the tree's record. A commit that was already on the local base and never pushed is no longer counted as the session's work. A record written before this keeps its old answer, counting from the base's name.

## 0.13.0 - 2026-10-20

### Upgrading

- `http` is now `httpApi`, and `proxy` is now `modelProxy`. A file with the old names still starts, with one warning for each key. A file that holds both names of one key is refused. See [docs/server/UPGRADE.md](docs/server/UPGRADE.md#renamed-keys).
- A shell command that the session owner's terminal rules approve now runs without a question, in Claude, ACP, pi and cofold. A window that pushed no rules gets VS Code's default table. Set `terminalAutoApproveDefaults` to `none` to keep every command asking.
- When the host offers `task_add`, Claude's own task tools are denied, and its plan goes to the host's task list. `hostTasks: false` in a preset keeps Claude's own tools.
- A JWT with no `exp` is refused.

### Install and update

- One line installs ahpd: `curl -fsSL https://ahpio.com/ahpd/install.sh | bash`, or `irm https://ahpio.com/ahpd/install.ps1 | iex` on Windows. It can install Node, then runs `ahpd configure`. `--uninstall` removes ahpd again. See [docs/server/INSTALL.md](docs/server/INSTALL.md).
- `ahpd configure` finds Node, Bun and Deno and the known ACP agents on the PATH, and offers a preset for each agent it finds.
- `ahpd update`, `POST /api/update` and `x-ahpd/update` install a newer `@ahpd/server`, move every plugin to the new sdk, and restart the daemon. See [docs/server/UPGRADE.md](docs/server/UPGRADE.md).
- `ahpd service install` hands the daemon to the service manager: a systemd user unit on Linux, a LaunchAgent on macOS. See [docs/server/RUN.md](docs/server/RUN.md).
- npm prints the packages it installs before it runs.

### Approvals

- `terminalAutoApproveEnabled`, `terminalAutoApproveRules` and `terminalAutoApproveDefaults` approve shell commands by rule. A command is split into its parts before the rules match it.
- `commandParser`, or a plugin's `registerCommandParser`, replaces the command splitter.
- `eligibleForAutoApproval` makes a tool ask on every call, in every backend and every permission mode.
- A client's rules reach the agent's system prompt.
- A pushed `/.../` rule that VS Code's default table does not carry needs `config:change`.

### Sessions and VS Code parity

- A session from VS Code keeps its owner, scope and config when a listing runs while it restarts.
- A remote session from VS Code 1.141 keeps its origin.
- A stopped Claude turn leaves the session idle, not failed.
- Each built-in Claude plugin is switched on and off by itself, and a session switch on one stays.
- A synced skill is named by its plugin.
- An automation is exported as VS Code's file, and VS Code's file is imported.
- An unchanged set and an idle cancel are echoed to the client that sent them.
- A client sees the agent account.
- A client that stops reading is bounded.
- A session row's diff stat counts the session's own work.
- A session recorded outside the served paths stays listed.
- A session whose folder was removed outside ahpd no longer names that folder.
- A push of another key keeps the session tools as they were set.
- ACP opens a session in the permission mode it asked for.

### Tasks and plans

- The host keeps one task list per session. Claude and ACP write their plans to it, and the host draws the Plan call.
- The plan channel announces a removed task with `x-ahpd-plans/taskRemoved`.

### Bots

- A person talks with a bot in a chat of its own. A message wakes the bot's back session, and `post_message` answers in the chat.
- A bot's persona is its `AGENTS.md`, and its data is one folder.

### Users and tokens

- A person mints up to `tokensPerPerson` tokens of their own, each with an optional label, expiry and a subset of their grants. See `ahpd token` and [docs/server/USERS.md](docs/server/USERS.md).
- A plain request with a refused token answers 401.
- A JWT is verified locally.
- Usage limits are charged per turn and per proxy call, and a client reads each limit at `usage://limits`.
- A put can clear a policy's `pool` and `cap`, and `@ahpd/sdk` exports `PolicyLimits`.

### Windows

- The checks run on Windows in CI, and a failure there blocks a merge.
- Terminals run on Windows.
- A spawn opens no console window.
- An ACP server stops on Windows.
- A host folder has a drive-style path inside a machine: `C:\Users\ana\proj` is `/c/Users/ana/proj`.
- A mount source can start with a drive letter.
- A file URI keeps its drive, and git never runs without a folder.
- An archive no longer deletes files through a junction.
- A redirect into `.git` asks on Windows, as it does elsewhere.

### Agents

- Claude is on the Agent SDK 0.3.301, ACP on the ACP SDK 1.8.0, and pi on pi 1.3.0.
- cofold: a client tool with `$comment` no longer fails the turn, and the first message of a session shows once.
- An ssh machine runs every agent.

### Daemon

- A failure is JSON under `--json`.

## 0.12.0 - 2026-10-15

### Upgrading

- A plugin id is a bare slug, such as `webhook` or `computer`. The npm package names stay `@ahpd/...`. The daemon skips a plugin whose exported `name` is not a slug, and `ahpd plugin list` shows it as `error`.
- Sessions, automations, wake senders and usage saved under an old owner, such as `plugin:@ahpd/webhook`, read as the new one. Nothing on disk is rewritten.
- `@ahpd/webhook` is published to npm for the first time.
- `docs/sdk/LIBRARY.md` is now [docs/sdk/BUILD-A-HOST.md](docs/sdk/BUILD-A-HOST.md), and upgrading has its own page, [docs/server/UPGRADE.md](docs/server/UPGRADE.md).

### Webhooks

- `@ahpd/webhook` keeps endpoints as records, each with its own vault secret, and passes a call only with that secret as its bearer token. See [packages/webhook](packages/webhook).
- A webhook talks to a bot by thread, or fires an automation whose run reads the event.
- Routes can listen on a public port of their own.
- A callback follows no redirect. A refused chat answers 409, and a failed sync turn answers 502.

### Sessions and VS Code parity

- A session and its chats are marked read and unread together, and a turn marks its chat unread, as the protocol does.
- Archiving a session shelves its worktree, and unarchiving restores it. `archiveDirtyWorktree` says what archiving does with uncommitted changes.
- A merged session archives and deletes itself. `pullRequestLookup` says how the host learns a pull request's state.
- A turn started on a busy chat is refused.
- Automations run with no client, so VS Code lists them. Every automation due at once fires, a run can be stopped, and each automation keeps its 50 newest runs.
- A customization switched off for every session, or for one folder, stays off in each new session there.
- The root state says what machine the host runs on, and the host sends its build.
- `#` completes a file, and `#chat:` completes a chat of the session. A chat attachment gives a pointer and an excerpt.
- A session tool acts as the person it works for, with VS Code's limits on spawning and messaging. The session tools can be switched off, and a running Claude session follows the switch.
- A host can take a remote session and keep its origin, and the agent is told to report back to it.
- A turn's end pushes the files of a watched changeset.
- `shellEnv` sets the environment of every shell the host starts, including Claude's Bash commands.
- A session record keeps its working folder, and Claude and pi look for a session there first.

### Agents

- Claude: a client tool's JSON Schema reaches the model whole, a cancelled call closes its confirmation, a spawn failure names its cause, and the handshake has a bound.
- ACP: a withdrawn question is removed, and a question can take a typed answer.
- cofold: `@cofold/agents` 0.4.0, cofold's slash commands are offered in a session, and `/compact` draws one notice.

### Bots

- A bot's first turn is its filled template, each new chat of a bot starts with the template, and a fork gets no preamble.
- An edit passes when its template is gone.

### Computers

- An ssh machine is listed from the options, and a session on it runs nested over ssh.
- A restart of this host leaves a nested session for the next one to resume.
- A profile names the OCI runtime its machines run under, such as `runsc`.

### Daemon

- On Windows, `ahpd stop` and `ahpd restart` reach the daemon through a named pipe, and `stop` waits for it to exit.
- The `shutdown` method stops the daemon gracefully, and the host closes each WebSocket with 1001.
- `ahpd paths` lists, adds and removes the served folders, and a change reaches the running daemon. `ahpd status` shows the start folder.
- `ahpd start` logs each stage, and npm installs a plugin on Windows.
- A plugin's late problem is logged.
- `session:write` holds `chat:write`.
- A 0.10.0 protocol offer is answered with 0.10.0.

### Documentation

- The docs are a site at https://softov.github.io/ahpd/.

## 0.11.0 - 2026-10-11

### Upgrading

- On first start, the daemon converts its stores to Markdown files and keeps each original with a `.migrated` suffix:
  - each bot in `<configDir>/bots/<slug>.json` becomes `<slug>.md`;
  - `automations.json` becomes one file per automation in `<configDir>/automations/<id>.md`, with run state in `automations-state.json`.
- Plugins now declare `@ahpd/sdk` with an upper bound: `>=0.10 <1`, and `>=0.8 <1` for `tunnel-devtunnel`.
- `@ahpd/bot` and `@ahpd/push` are published to npm for the first time.

### Bots

- A bot is a Markdown file: YAML frontmatter, with its instructions as the body. An edit to the file reaches the daemon without a restart. See [docs/BOTS.md](docs/BOTS.md).
- Making a bot starts its session, and a bot can be watched.
- Bots have a catalogue, served as a channel.
- An admin can make a bot for any owner.
- A bot's colour is a name or a hex colour.

### Automations

- An automation is a Markdown file, with its message as the body. A copy under a new name is a new automation, and an edit is reloaded at once. See [docs/AUTOMATIONS.md](docs/AUTOMATIONS.md).
- An automation can wake on what a session does, and can disable itself.
- An automation carries its template's client plugins.

### Plugins

- Plugins keep records in the host's record store, written as Markdown files. A plugin also gets YAML from the host.
- A plugin can serve a channel, and is a client of its own host.
- A plugin is known by its id.
- `ahpd plugin install` picks the newest version that fits the daemon's sdk, and `plugin update --force` installs each package on its own.

### Sessions and VS Code parity

- A quiet session sleeps and wakes when something needs it.
- Stage, unstage, discard and commit take one file or the whole changeset. The working tree is the first changeset.
- A chat can be reordered, moved to another session, read or archived on its own. A peer chat survives a restart.
- A chat lists the shells and subagents running in its background, and an MCP server startup can be sent to the background.
- Attachments reach Claude, pi, ACP and cofold turns.
- The ACP bridge resumes without replay, forks where the server can, and asks the server's questions.
- Root config declares VS Code's keys and refuses the rest.

### Daemon and API

- The host serves `x-` commands; people, policies and computers are channels; usage is read through commands.
- The API answers only the origins a deployment names.
- Each plugin config field can be overridden by a recorded flag.

### Usage

- A usage record keeps the provider's cost beside the charged one, split into sent and received tokens.
- A usage list shows what a reader may read, by range and group.
- A reset conversation starts the cost baseline again.

### Push

- A session's devices are told when it finishes a turn, as well as when it needs a person.
