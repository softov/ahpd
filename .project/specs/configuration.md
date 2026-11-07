---
title: Configuration
status: current
covers:
  - packages/server/src/config.ts
  - packages/server/src/rootconfig.ts
  - packages/server/src/commands/config.ts
  - packages/server/src/commands/options.ts
decisions:
  - decisions/root-config-declares-what-vscode-pushes-and-keeps-every-key.md
refs:
  - "[code://packages/server/src/config.ts#L618-L643](../../packages/server/src/config.ts#L618-L643) - `loadConfig`, the user file, `$AHPD_CONFIG` or one named file"
  - "[code://packages/server/src/commands/options.ts#L858-L877](../../packages/server/src/commands/options.ts#L858-L877) - `checkConfig`, which warns on an unknown key and stops on a bad value"
  - "[code://packages/server/src/commands/options.ts#L951-L1123](../../packages/server/src/commands/options.ts#L951-L1123) - `optionsFrom`, where the defaults are applied"
  - "[code://packages/server/src/rootconfig.ts#L32-L40](../../packages/server/src/rootconfig.ts#L32-L40) - `DAEMON_KEYS` and `LIVE`"
  - "[code://packages/server/src/rootconfig.ts#L216](../../packages/server/src/rootconfig.ts#L216) - `daemonRootConfig`, the daemon's keys in the root config"
  - "[code://packages/server/src/rootconfig.ts#L319-L413](../../packages/server/src/rootconfig.ts#L319-L413) - `write`, which applies a key live or answers `restartNeeded`"
  - "[code://packages/sdk/src/host.ts#L565-L590](../../packages/sdk/src/host.ts#L565-L590) - the daemon keys of `root/configChanged` go only to `config:read`"
  - "[code://packages/server/src/commands/config.ts#L27-L84](../../packages/server/src/commands/config.ts#L27-L84) - `<set>`, URL userinfo and the `writeOnly` mask"
  - "[code://packages/server/src/commands/config.ts#L150-L197](../../packages/server/src/commands/config.ts#L150-L197) - `withoutSecrets` and `daemon.config`"
  - "[code://packages/sdk/src/host/tooling.ts#L1609-L1634](../../packages/sdk/src/host/tooling.ts#L1609-L1634) - `mcpFor`, the MCP servers a session is offered"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-configuration-change-applies-live-or-on-ahpd-restart, a-project-config-file-is-trusted-like-the-users, an-unknown-config-key-warns-and-starts, config-file-replaces-every-other-layer, root-config-grows-two-keys, root-config-shows-daemon-keys-to-config-read-and-never-a-write-only-value, served-answers-hide-plugin-option-values-and-url-credentials, the-config-command-hides-its-secrets, the-config-command-hides-the-connection-token, the-daemon-reads-no-project-config-file, the-hosts-mcp-servers-are-root-config-as-in-vscode
---

The daemon reads its settings from a JSON file through `resolveConfig` of `@cofold/config`.
Without `--config-file`, it reads the user file `config.json` in the config folder, with the file that `$AHPD_CONFIG` names merged over it.
With `--config-file`, it reads that file alone.
There is no project layer, so a folder the daemon starts in adds no settings.
A flag on the command line has priority over the file.
The daemon's own keys are also in the AHP root config, where a client can read them and change them.

## Scenarios

### The daemon reads the user file

WHEN the daemon starts without `--config-file`
THEN it reads the user file and the file `$AHPD_CONFIG` names, the second one over the first
AND a user file that does not exist is not an error.

WHEN the daemon starts in a folder that holds a config file
THEN it does not read that file.
The reason: a project file is written by whoever wrote the repository, not by the person who runs the daemon.

### One named file replaces every layer

WHEN a person passes `--config-file <file>`
THEN the daemon reads that file and no other
AND it refuses to start when that file does not exist.

### A relative path in the file

WHEN a key holds a relative path
THEN the daemon resolves it against the folder of the file that set the key.

### An unknown key warns and starts

WHEN the file holds a key that ahpd does not know
THEN the daemon writes `<file>: <key> is not a setting ahpd knows; ignored` on stderr, with a time stamp
AND it starts.

WHEN a known key holds a value of the wrong type or shape
THEN the daemon refuses to start and names the file and the key.

### The daemon's keys in the root config

WHEN a client reads the root config
THEN the daemon's keys are there, from `paths` and `port` to `wire` and `mcpServers`
AND the connection token, the users file, `stdio` and the config file are not.

WHEN a connection does not hold `config:read`
THEN the daemon's keys are taken out of each `root/configChanged` it gets, its own change included.

### A change applies live or on restart

WHEN a client changes `advancedTools`, `sessionTools`, `sessionToolsProviders`, `closedChats`, `archiveDirtyWorktree`, `pullRequestLookup`, `wire` or `mcpServers`
THEN the daemon checks the value, writes it to the file and applies it at once.
A new `wire` opens the traffic log, and new `mcpServers` go to the next session that starts.

WHEN a client changes any other daemon key or a key under `plugins`
THEN the daemon checks the value and writes it to the file
AND the answer carries `restartNeeded`, also in `_meta["ahpd.restartNeeded"]`.
The reason: the listeners and the plugins are built only when the daemon starts.

### A served answer hides secrets

WHEN the config, the root config or a plugin's options go out over HTTP or AHP
THEN the connection token is `<set>`
AND an option that its plugin's schema marks `writeOnly` is `<set>`, at any depth
AND the userinfo of a URL a plugin installs from is `<set>`.

WHEN a plugin is off or did not load, so ahpd has no schema for its options
THEN each of its option values is `<set>`.
A secret reference is shown as written, because it names a vault entry and is not a secret.
Each other value is shown as the file holds it.

### The config command

WHEN a person runs `ahpd config` at the terminal
THEN ahpd prints each file it reads, then each key with its value unmasked
AND it names the file that set each key when there is more than one file.
The reason: at the terminal the reader is the process owner, who can read the file anyway.

WHEN a client calls `GET /api/config`
THEN the daemon asks for `config:write`
AND answers with the secrets hidden as above.

### The host's MCP servers

WHEN the file or the root config holds `mcpServers`
THEN each session is offered those servers, with the servers of its enabled client plugins over them
AND a client plugin's server wins when two servers have the same name.
This is the merge VS Code makes, and the daemon reads the set again at each spawn.

WHEN a client writes `mcpServers` back with an env entry or a header as `<set>`
THEN the daemon keeps the stored value of that entry.
