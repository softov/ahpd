# Configure

## First setup

```bash
ahpd configure
```

It asks for the backends and the web UI, then prints what it found on the machine. That is one line each for `node`, `bun` and `deno`, with the first line of their `--version`. It also prints a table of the agents on PATH. `ahpd` needs Node 22.18 or newer; Deno runs it, and each plugin Deno loads needs an `npm:` spec.

The agent table names each agent's version and whether this host already has an `acp` record for it. A `presets` entry a file still holds counts until the next start moves it to a record. It asks `<name>?` for each agent that is not configured, and Enter writes an `agents/<id>.json` record of the kind `acp`, owned by `host`, and names `@ahpd/agent-acp` in `plugins` and installs it when it is not there. An agent already configured is shown as configured and not asked about again. A record you wrote keeps its own `command`, `install` and `page`, and those win over the shipped row. Agents that are not on PATH are listed after the questions with the vendor's install line for your system. When the row has no line for that system, its page is shown instead. Nothing is asked about them. A `claude` or `pi` on PATH is listed under "Also found" and changes none of the backend questions.

Enter takes the web UI on a first run, and a later run keeps the answer the file holds.

Then it asks for the host, port, token and folders. Each question shows the current value, so Enter keeps it. Run it again to change a setting.

| Answer | Writes |
| --- | --- |
| Yes to a backend | Installs it and adds it to `plugins` |
| No to a backend you have | `enabled: false`, options kept |
| Yes to the web UI | Installs `@ahpd/web` and adds it to `plugins` |
| No to a web UI you have | `enabled: false`, options kept |
| Yes to a found agent | An `agents/<id>.json` record of the kind `acp`, and `@ahpd/agent-acp` named in `plugins` and installed when it is not there |
| No to a found agent | Nothing for that agent |
| An agent that is not on PATH | Its install line or page in the output; no question |
| Enter at the token | A new token in `connection-token`, mode 0600 |
| No to a folder | Leaves it out of `paths` |

`ahpd` and `ahpd start` offer to run it when there is no `config.json`. They never ask without a terminal.

## config.json

`~/.config/ahpd/config.json` (or `$XDG_CONFIG_HOME/ahpd/config.json`):

```json
{
  "port": 9187,
  "host": "127.0.0.1",
  "paths": ["/work/api", "/work/web"],
  "connectionTokenFile": "connection-token",
  "plugins": ["@ahpd/agent-claude"]
}
```

Every flag is a key, written in camelCase without the dashes: `--worktrees-root` is `worktreesRoot`. [Reference](REFERENCE.md) lists every key.

A relative path in `paths`, `worktreesRoot`, `users` or `connectionTokenFile` is relative to the file's folder.

## Which file wins

```
~/.config/ahpd/config.json   →   the file $AHPD_CONFIG names   →   flags
```

Each one overrides the one to its left, key by key. An object such as `httpApi` merges. A list such as `paths` or `plugins` is replaced whole.

| Want | Use |
| --- | --- |
| Settings for one project | `AHPD_CONFIG=./ahpd.json ahpd` |
| One file only, nothing else | `ahpd --config-file ./ahpd.json` |
| A change for one run | a flag |

::: warning No file is read from the working folder
Starting `ahpd` in a repository never reads an `ahpd.json` there. Use `$AHPD_CONFIG` or `--config-file`.
:::

## Check it

```bash
ahpd config          # files read, then each key and its value
ahpd config --json
```

A wrong value stops the start with exit code 2 and names the file and key:

```
/home/you/.config/ahpd/config.json: port must be an integer
```

An unknown key is logged and ignored:

```
/home/you/.config/ahpd/config.json: plugin is not a setting ahpd knows; ignored
```

## Common settings

| Key | Flag | Default | |
| --- | --- | --- | --- |
| `port` | `--port` | `9187` | `0` picks a free port |
| `host` | `--host` | `127.0.0.1` | `0.0.0.0` needs a token. See [Remote access](REMOTE.md) |
| `paths` | `--path` | the start folder | Folders to serve. See [Run](RUN.md#served-folders) |
| `worktreesRoot` | `--worktrees-root` | `<repo>.worktrees` beside each repo | Where session worktrees go |
| `connectionTokenFile` | `--connection-token-file` | | See [Remote access](REMOTE.md#the-connection-token) |
| `sleepAfterMinutes` | `--sleep-after-minutes` | `30` | Unload a quiet session after this |
| `sessionResidencyLimit` | `--session-residency-limit` | `10` | Most sessions resident at once, running or with their state held |
| `attachmentFetchLimitBytes` | `--attachment-fetch-limit-bytes` | `33554432` | The largest file a client is asked for when a message attaches one the daemon has no copy of; `0` sets no limit |
| `toolResultResourceLimitBytes` | `--tool-result-resource-limit-bytes` | `8388608` | The most bytes kept of one content a tool result or an agent's message carries inline, which a client reads back by a `session-db-resource` URI; larger content is left out, as VS Code keeps nothing over its bound; `0` sets no limit |
| `closedChats` | `--closed-chats` | `hidden` | `delete` removes a closed chat from the backend |
| `unofferedModel` | `--unoffered-model` | `fail` | `keep` keeps a chat's model when a turn names one its agent does not offer, as VS Code does |
| `workspacelessFolder` | `--workspaceless-folder` | `first` | `scratch` works a session that names no folder in a folder of its own, `~/.copilot/chats/<session id>`, made with the session and removed with it, and makes it VS Code's workspace-less session, as VS Code does |
| `rootOwner` | `--root-owner` | `host` | Whose work a session a root connection starts is, under a users directory: `host` is the host itself, `root:<hostName>`, the owner the usage rules charge; `none` is no one, as VS Code's host records no principal for a session made without a validated identity |
| `turnSenders` | `--turn-senders` | `said` | `kept` keeps each turn's sender on the host and says it in no action, as VS Code does |
| `backendBackgroundWork` | `--backend-background-work` | `drop` | `say` says a backend's own background work actions as the host's, as VS Code does |
| `agentOrchestrationLimitsScope` | `--agent-orchestration-limits-scope` | `sessionTree` | `session` keeps the session tools' counts per session, as VS Code does |
| `automations` | `--automations` | `file` | `memory` keeps automations until exit, and fires no schedule |
| `terminalAutoApproveDefaults` | `--terminal-auto-approve-defaults` | `vscode` | The rules for a session whose window pushed none; `none` approves no command. See [Terminal rules](#terminal-rules) |
| `managedSettingsPermissions` | (file only) | none | VS Code's managed permissions: `deny` and `ask` rules in the managed grammar (`Shell`, `Read`, `Write`, `Domain`), `disableBypassPermissionsMode: "disable"` to take Allow All away, and `limitTo`, the `Domain` and `Domain(<host>)` rules a fetch stays within. A `Domain` rule names its host whatever a URL's scheme, port or path. A rule the managed grammar refuses stops the start. Under `managedRules: "checked"` the host checks each rule on the tool questions of its kind; it hands the whole to every backend, and the lock holds, under either value. See [A question about a tool call](../plugins/PLUGINS.md#a-question-about-a-tool-call) |
| `eligibleForAutoApproval` | (file only) | none | VS Code's `chat.tools.eligibleForAutoApproval`: a tool's name to `true` or `false`, where `false` makes the tool's call ask every time, with Allow Once and Skip alone. A tool this host offers is `ahp/<name>`, an MCP server's tool `<server>/<tool>`, and every tool of a server `<server>/*`. A value that is not `true` or `false` stops the start. Under `managedRules: "checked"` the host reads it on every tool question, and `/mcp` refuses a host tool set `false`, having no session to ask in; under `handed` the host reads it on no question and `/mcp` runs the tool. It is handed to every backend beside the managed permissions under either value. See [A question about a tool call](../plugins/PLUGINS.md#a-question-about-a-tool-call) |
| `managedRules` | (file only) | `checked` | Who checks `managedSettingsPermissions` and `eligibleForAutoApproval` on a tool question. `checked` is this host's own check: each managed family on every question of its kind from every backend, a `deny` refusing the call and an `ask`, or a tool set `false`, putting the question with Allow Once and Skip alone, and `/mcp` refusing a host tool set `false`. `handed` is VS Code's: the host checks no managed rule and marks nothing, hands the rules to the backends for the runtimes that take them, and puts a question a backend marked managed with Allow Once and Skip, never a grant or Allow All; `/mcp`, which has no runtime to hand a rule to, runs a host tool set `false`. The start's check of the managed document and the Allow All lock hold under both |
| `wire` | `--wire` | | Log every frame to this file, for debugging |

Keys with no flag: `httpApi`, `mcpTools`, `modelProxy`, `usage`, `policies`, `service`, `mcpServers`, `commandParser`, `tunnelHosts`, `onPath`, `daemonRecord`. Flags with no key: `--no-plugins`, `--no-cwd`, `--plugin-option`, `--stdio`, `--config-file`.

`daemonRecord` is how `ahpd stop`, `ahpd status` and the other verbs read `daemon.json`, the record of the running daemon. `fields`, the default, reads each field as it is there, so a record an older daemon wrote still names its daemon in the middle of an upgrade. `schemaVersion` ignores a record of another `schemaVersion` and leaves it where it is, as VS Code's CLI ignores a registry entry of another version.

`rootConfigWrite` is how an object a client writes to root config is written. `merged`, the default, writes it over what the key holds: `null` takes a key back, and `<set>`, which is what a client is shown for a credential, leaves that credential as it is. `replaced` writes each top-level key's value whole, as the protocol's reducer applies a root config change; a `<set>` sent back is then taken out with the credential it stood for.

`onPath` is how `ahpd configure` and `ahpd doctor` find a command on PATH. `runnable`, the default, takes a regular file with an execute bit, tries each `PATHEXT` extension and then the name as written on Windows, and skips an empty entry, so a setup reports what the machine installs and not what the folder it ran in holds. `findExecutable` is VS Code's lookup: any file that is not a folder, with every entry that is not absolute, the empty one among them, read against the working directory.

`service.name` names the service a daemon runs under beside another on the same machine. See [More than one daemon](RUN.md#more-than-one-daemon).

`modelProxy` holds the model names only: a provider is a connector now, added as [The model proxy](PROXY.md#adding-a-provider) says. A file that still writes `modelProxy.providers` stops the start.

`httpApi` serves the HTTP API under `/api`, on the daemon's own listener or on a listener of its own with a `port`. `mcpTools` says what `/mcp` serves on that same listener: `none`, the default, answers 404, and `all` serves the host's tools that need no session to a person's MCP client. See [MCP](MCP.md).

`tunnelHosts` lets the HTTP API answer to the host name of each tunnel on the list. The plugin routes answer to those names either way, because a webhook usually arrives through a tunnel. Off, the API takes only the names the deployment configured. A tunnel's name is fresh on every start, so there is nothing to write but `true`.

[Reference](REFERENCE.md) has every key.

## Terminal rules

`terminalAutoApproveDefaults` says which rules a session's shell commands are matched against when no window pushed any. `vscode`, the default, is VS Code's terminal auto-approve table, so the commands it approves by default run without a question. `none` approves no command, so every one asks. A pushed empty table approves nothing, and it is not folded into this default.

A window pushes the rules with `terminalAutoApproveRules`, one value for the whole host, which the last push sets and every turn reads, whoever sent it. A key written `/.../` that VS Code's default table does not carry needs `config:change`. A slow expression would stall the daemon for every person. A plain key and a default expression need a sign-in and no grant.

`commandParser` names a `.js` or `.ts` module whose default export reads a shell command before the rules match it. It answers `(line, shell) => ({ subCommands, writeDests, unanalyzable })`, or `undefined` for a line it cannot read, which asks. The sdk's own splitter is used when the key is absent. A path is relative to the configuration file. The module is imported by file URL as a plugin is. A file that does not import, or whose default export is not a function, stops the start. As with `plugins`, naming a module runs its code in the daemon with the daemon's permissions. A `.ts` module needs Node 22.18 or newer, Bun, or Deno, which strip types as they load.
