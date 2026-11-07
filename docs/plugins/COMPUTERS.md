# A computer

`@ahpd/computer` lets a client make a `computer`, run a session inside it, and destroy it.

Three runtimes are listed today: Docker on this host, a box reached over ssh, and a node that joined this host.

A machine is named `computer://<id>`, and it has two recipes: an image the host runs, or a folder's `devcontainer.json`, which the Dev Container CLI reads.
Writing a manifest to that name makes one, deleting it destroys it, and a session whose `computer` setting names it runs its agent in there.
A dev container is listed, picked and reached like any machine made from an image, and it survives the connection that made it.

## Setup

The account that runs the daemon needs Docker. For a hypervisor running as that account later, it also needs `/dev/kvm`:

```sh
sudo usermod -aG docker "$USER"
sudo usermod -aG kvm "$USER"
```

Groups are read at login, so log out and back in (or `newgrp docker` for the current shell). Then check:

```sh
id -nG                                    # docker and kvm listed
docker info --format '{{.ServerVersion}}'
test -r /dev/kvm && echo 'kvm readable'
```

If `getent group kvm` lists you and `id -nG` does not, the shell is older than the change. `sudo setfacl -m u:$USER:rw /dev/kvm` opens the device until the next boot without a new login.

A container machine needs only `docker`. A VM inside a container does not need the `kvm` group either: `docker run --device /dev/kvm` passes the device through, and the image has to bring the hypervisor.

## Making one

Write a JSON manifest to the machine's name:

```json
{
  "runtime": "docker",
  "image": "debian:bookworm-slim",
  "cpus": "2",
  "memory": "2g",
  "profile": "claude",
  "workdir": "/work"
}
```

```json
{ "method": "resourceWrite", "params": { "channel": "ahp-root://", "uri": "computer://box", "data": "<the manifest>", "encoding": "utf-8", "createOnly": true } }
```

Only `image` is expected. `runtime` must match the host's, the limits are optional, and `workdir` is where commands start. `createOnly` makes a taken name fail with `-32010`. An invalid manifest fails with a message naming the field.

A manifest may name `folder`, a host folder mounted at the same path inside the machine; `workdir` defaults to it when the manifest names neither. Like `mounts` it reaches outside the machine, so a body may name one only where the operator allowed `bodyMounts`; a profile's own `folder` is always allowed.

### From a folder's devcontainer.json

In place of `image`, a manifest may name a folder whose `devcontainer.json` makes the container, through a flat `source` choice:

```json
{ "source": "devcontainer", "devcontainer": "/path/to/repo", "image": "debian:bookworm-slim" }
```

The Dev Container CLI reads the file, so the image, the features, the mounts, the `remoteUser` and the lifecycle commands are the repository's and this host decides none of them - decision [a dev container is made by the Dev Container CLI and reached by docker exec](../../.project/decisions/a-dev-container-is-reached-by-docker-exec.md).
The folder is refused before the CLI runs when it is not there or has no `.devcontainer/devcontainer.json` or `.devcontainer.json`. The create then asks the CLI's `read-configuration` where the definition is and reads that file as VS Code's dev container host reads it, with VS Code's JSONC parser, so comments and trailing commas are the file's own; a definition that does not parse is refused `Invalid Dev Container configuration: <path>`. It runs `devcontainer up --workspace-folder <folder> --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=<folder> --config <definition> --override-config <override>`, the definition kept as the base for its own relative paths, as VS Code passes it beside an override.
The machine's labels and limits reach the container as the override's `runArgs` for an image or Dockerfile definition. The CLI gives `runArgs` to those alone, so a definition with `dockerComposeFile` gets them as VS Code gives a Compose definition its sandbox's options: a `compose.json` of its service's `labels`, `cpus` and `mem_limit`, owner-only beside the override, carrying the first Compose file's `version`, and added after the definition's own files, or for `"dockerComposeFile": []` after the files the CLI finds, in `COMPOSE_FILE`. A Compose definition with no files or no service is refused `A computer requires a Dev Container Compose configuration with files and a service.`
A body whose `source` is `image` reads the image fields and ignores the folder, and one whose `source` is `devcontainer` requires the folder and is refused without it; any other value for `source` is refused.
The object form `{ "devcontainer": { "folder": "/path/to/repo" } }` still works for a client that writes it by hand, and a body with no `source` is read as it always was.
`devcontainer.folders` in the plugin options is the allowlist: absolute host paths, compared resolved, of which a dev container may be made, with no list meaning any folder on a host with one person on it and no folder at all on a host that has a users directory - see [Security](#security).

A session in one is reached the same way any other machine is, by `docker exec`, with the user and environment the file asks for:

```
docker exec -i -u <remoteUser> -e <each derived variable> -w <remoteWorkspaceFolder> <containerId> <command>
```

The user and the environment come from the container's own `devcontainer.metadata` label and one probe of the login shell that was holding them when the container was made, which is what the CLI's own `exec` derives - decision [a dev container is reached by docker exec](../../.project/decisions/a-dev-container-is-reached-by-docker-exec.md).
A dotfile changed after the container was made is not seen until it is made again, because what a command runs in is what that shell was holding then.
The container id is the one `up` answered with, never the folder and never the name, so a session can only reach the container that folder's file made.
Removing the computer removes the container and never the folder or its `devcontainer.json`.
A container someone made with `devcontainer up` by hand carries only the CLI's `devcontainer.local_folder=<folder>` and is not listed; a `connect` for that folder adopts it rather than making a second, and records it in `computers.json` under its container id, which is what lists, meters and finds it again from then on. Until a connect adopts it, it is not a computer.

| Command | What it does |
| --- | --- |
| `resourceList` on `computer://` | The machines this host made |
| `resourceRead` on `computer://<id>/status` | The runtime's record of one |
| `resourceRead` on `computer://<id>/capabilities` | The runtime, the manifest fields and the limits |
| `resourceRead` on `computer://<id>/stats` | CPU, memory, processes, network and disk right now |
| `resourceRead` on `computer://ssh.<name>/server` | What an ssh box can run, and the lines that fix what it lacks; see [What the box can run](#what-the-box-can-run) |
| `resourceRead` / `resourceWrite` on `computer://<id>/state` | `running` or `stopped`; write `running`, `stopped` or `restarted` |
| `resourceWrite` to `computer://<id>` | Make one |
| `resourceDelete` on `computer://<id>` | Destroy it and everything in it |

Reading needs `computer:read`, and making, starting, stopping or destroying needs `computer:write`. No built-in role has `computer:write`, and `file:write` does not include it.

## How a client finds out

The handshake's `initialize._meta` (and the root state's `_meta`) carries `ahpd.resourceProviders`, one entry per scheme the host serves:

```json
{
  "computer": {
    "title": "Computer",
    "description": "A machine a session can run in.",
    "root": "computer://",
    "operations": ["get", "list", "resolve", "put", "delete"],
    "manifest": { "type": "object", "properties": { "image": { "type": "string", "title": "Image", "default": "debian:bookworm-slim" }, "...": {} } }
  }
}
```

`manifest` is the schema a create form is drawn from. The key is absent when the plugin is not loaded, and a request for a scheme nobody serves answers `-32601` with `nothing here serves computer:`. That is different from a permission refusal.

`operations` are the words a grant is made of, not the provider's method names: `get` is the provider's `read` and `put` is its `write`, so `computer:get` in a role is what `resourceRead` on `computer://` asks for. The `ahpd.grants` key beside it carries every subject the host gates and what each may be granted, this scheme among them: `computer` is listed under its own name with the operations the provider implements, `get` under `read` and `put` under `write`.

## A session in one

The plugin adds a `computer` key to the session settings:

```json
{ "method": "createSession", "params": { "channel": "ahp-session:/work", "provider": "acp", "config": { "computer": "computer://box" } } }
```

The machine must already exist. A session naming one that does not is refused. A backend that cannot enter a machine is refused too, unless it declares `runsNested`, which is the host starting a whole host in there instead - see [a backend that runs nested](#a-backend-that-runs-nested). It never falls back to running on the host.

A setting may also name a source to make one from, rather than a machine that exists. `devcontainer://<folder>` makes the folder's dev container when the session starts, with the session agent's needs, and the session then runs in the `computer://<id>` it became. Nothing makes a second container for one folder, and the picker offers that source only while no computer is labelled with the folder.

A machine is also kept to the agents it was prepared for. A profile with `agents` labels the machine `ahpd.agents=<list>`, and a session whose agent is not on that list is refused with a sentence naming both. A machine with no label was made before any of this existed and is available to every agent.

| Backend | In a machine |
| --- | --- |
| `@ahpd/agent-acp` | Its command runs from its part under `docker exec`, with the dev container's own user and environment when that is the machine. A terminal it asks for runs there too, through `computers.how`, and stays the host's to list and watch. Each shipped preset that names a part brings its machine, and a preset may lay its own over it with [`machine`](PLUGINS.md#a-second-worked-example-ahpdagent-acp) - see [ACP agents in a machine](#acp-agents-in-a-machine) |
| `@ahpd/agent-claude` | The Claude Code CLI runs from the `claude` part under `docker exec`, with the dev container's own user and environment when that is the machine - see [Claude Code in a machine](#claude-code-in-a-machine) |
| `@ahpd/agent-cofold` | A whole `ahpd` from the `ahpd` part runs inside the machine with the plugin, and its frames are carried out as the session's - see below |
| `@ahpd/agent-pi` | Runs nested the same way as cofold - see [pi in a machine](#pi-in-a-machine) |

Clients get a picker for free: the key is marked `enumDynamic`, and `sessionConfigCompletions` answers with "This host" first, then each running machine with its image or folder and status. When the client says which agent the session would run, the machines not prepared for it are left out. A [disposable profile](#disposable-machines) is offered too, as `disposable:<profile>`, and once the session has made one it is an ordinary `computer://<id>`. A `devcontainer://<folder>` row is offered when the session's folder has a `devcontainer.json` and no computer is labelled with it.

The session's working directory is mapped through the machine's mounts. With `/srv/app:/workspaces/app`, a session in `/srv/app/x` starts in `/workspaces/app/x`. The longest mount wins, and a path no mount covers starts in the machine's own working directory - for a dev container, the folder it was made from as that is mounted inside.

### A backend that runs nested

Some backends cannot be moved into a machine: cofold's loop, tools and shell all run in the host process, and there is no server mode a process outside could drive.
Such a backend declares `runsNested: true`, and a session of it whose `computer` setting names a machine is given the SDK's proxy backend instead of the backend itself.

The proxy starts a whole `ahpd` **inside the machine**, in stdio mode, with that backend loaded, and presents the inner session to the client exactly as a local one:

```
<host> --stdio --no-plugins --plugin <each>
```

The inner host creates the session with the same config minus `computer`, and the outer session forwards turns, tool confirmations, input answers, config changes, cancel and dispose to it and emits its chat and session actions as its own.
A subagent the inner session runs is a subagent chat of the outer session, with its own row, and every link to it names the outer chat.
The inner host's protocol version has to be this host's; another one is refused at the handshake.

**The inner host loads the plugin that registered the agent.**
This host records, for every agent, the spec of the plugin that registered it, and that spec is the `--plugin` the inner host is started with, whatever the provider is called and wherever the plugin came from.
A cofold renamed `cofold-work` by its options still starts `--plugin @ahpd/agent-cofold`, and its inner session is created under `cofold`, the name the inner host serves it by.
An agent registered from a preset says so with `variant: true`, as every Claude and ACP preset does, and a variant such as `claude-openrouter` is never run as another agent: an inner host that does not serve it ends the session naming it, even when it is the only agent its plugin registered.
An agent handed to the host directly rather than through a plugin cannot run nested, and its session says the host does not know which plugin serves it.
A plugin loaded from a path names a file on this host, so the machine has to have it at that path.

**An agent made from a record takes its record inside.**
A cofold or pi agent is a record of its engine, so the inner host is started with the plugin that registered that engine.
The record goes in `AHPD_AGENT_RECORD`, as JSON, in the environment of the command that starts the inner host.
The inner host serves it under the record's id, from memory, and never writes it to its own agent records.
A machine on this host or on another box's Docker gets the whole record, keys included, by name: `docker exec -e AHPD_AGENT_RECORD`, never its value in an argument.
An ssh box and a dialled node get the record without its secret fields.
The `ahpd` there needs the key set up by hand, as it does for its own configuration.
A record of an engine the inner host did not load is refused at its start, and the line names the engine.

**The inner host takes nothing from the outer plugin's options.**
It loads the plugin with its defaults, and what holds inside a machine is its profile and what that mounts: for cofold, its configuration file at the [fixed target](#cofold-in-a-machine), and for pi, its [agent directory](#pi-in-a-machine) at `/ahpd/pi`.

**The host comes from the `ahpd` part.**
cofold and pi each declare the `ahpd` part as a need, so the machine has `/opt/ahpd/ahpd` mounted and `ahpd` on its `PATH`, run by the Node of the `node` part. The part holds `@ahpd/agent-cofold` and `@ahpd/agent-pi` in `/opt/ahpd/ahpd/plugins`, and its launcher sets `AHPD_PLUGIN_ROOT` to that directory, so the inner host finds both plugins with nothing in its configuration directory.
Any glibc image runs it with nothing installed, `debian:bookworm-slim`, the default, among them. A checkout builds the part from its own packed packages and an installed daemon from npm at its own version; see [Parts](#parts).
A machine whose part could not be built is refused for these sessions by name, like any part an agent needs.

**The image's user owns a writable `HOME` and `XDG_CONFIG_HOME`, with no mount under either.**
The nested ahpd makes `$XDG_CONFIG_HOME/ahpd` when it starts, and exits with `EACCES` when it cannot.
Docker makes the parent directories of a bind target as root, so a mount under `~/.config` leaves `~/.config/ahpd` unwritable, and the session ends with the inner host's `EACCES` line as its sentence.
The default image runs as root, which owns both; an image with a user of its own gives that user its home.

**A session whose inner host ended stays ended.**
Its end is a sentence: the process's exit code or the signal that killed it, and the last lines it wrote to stderr.
Every later turn and action on that session is refused with that sentence; the inner host is not started again.

**A resumed session continues the transcript the machine holds.**
This host records a nested session in its session store when it opens: its agent, its machine, the inner session's id, its title and its folders.
After this daemon restarts, the session is listed from that record without asking the machine, and a turn on it resumes it inside the machine, where the inner session goes by the outer session's id and keeps its earlier turns.
The transcript lives in the machine, so a disposable machine that has gone takes it along: the session is still listed, and its resume ends with a sentence naming the machine.

**Deleting a session deletes it in the machine.** A nested session this host records but is not running - one listed from the record after a restart, with no host of its own - is deleted inside its machine as a running one is on its own close: this host starts the machine's host, disposes that session there, and then deletes the record. The machine being gone is not a failure: the record goes and a line says the copy went with the machine. A profile that says `nestedDelete: "record"` deletes the record and leaves the machine's copy where it is.

**The inner session works where the folder is inside the machine.**
A session in `/srv/app/x` on a machine that mounts `/srv/app` at `/workspaces/app` is created in `/workspaces/app/x` inside, and a client still reads `/srv/app/x`.
A folder no mount covers is the machine's own working directory.

**The profile says how the host starts.** `host` is the command and its arguments, `["ahpd"]` when it names none, and it is where an image that keeps its host somewhere else says so:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": {
  "profiles": {
    "cofold": {
      "title": "Cofold",
      "image": "ghcr.io/acme/ahpd-cofold:22",
      "agents": ["cofold"],
      "disposable": true,
      "host": ["node", "/work/ahpd/main.js"]
    }
  }
} }] }
```

The machine remembers the profile that made it, so a daemon that restarts - or one that did not make it - still starts the host the profile named.
The profile's `agents` is what shares cofold's configuration and provider key into the machine, the same mechanism [Claude Code](#claude-code-in-a-machine) uses, and a profile without them is a cofold session that cannot sign in.

`--stdio`, `--no-plugins` and one `--plugin` per spec are appended to `host`, so `host` names only the program: `ahpd`, a pinned `node /work/ahpd/main.js`, or whatever an image actually has.

### Claude Code in a machine

A machine made from a profile that names `claude`, or for a Claude session, carries what the agent says it needs, so the CLI and its configuration arrive without a person listing them by hand:

| Need | What it is | Where it goes |
| --- | --- | --- |
| `claudePart` | the `claude` part: the Claude Code CLI at the version the versions file pins, beside the ACP adapter | `/opt/ahpd/claude`, with `claude` on the machine's `PATH` |
| `claudeState` | a state volume seeded from this host's `~/.claude/settings.json`, `CLAUDE.md`, `skills/`, `agents/` and `commands/`, and `~/.claude.json` with only its `mcpServers` | `/ahpd/claude` |
| `claudeConfigDirectory` | `~/.claude`, only in a profile with `state: "host"` | `/ahpd/claude` |
| `claudeConfigJson` | `~/.claude.json`, only in a profile with `state: "host"` | `/ahpd/claude/.claude.json` |

The CLI runs with `CLAUDE_CONFIG_DIR=/ahpd/<variant>`: `/ahpd/claude` for the built-in Claude, `/ahpd/claude-openrouter` for a variant whose key is `claude-openrouter`, so two variants in one machine read two directories, each its own state volume, and the table's targets move with it. `computerConfigDir` in the `@ahpd/agent-claude` options names another path inside the machine for every variant, and `false` leaves the image's own configuration alone and brings only the CLI. Two variants given one `computerConfigDir` in a profile with `state: "volume"` would be two state volumes at one directory, and a machine with both is refused at create, naming the directory.

**The CLI comes from the part.** `computerCli` in the `@ahpd/agent-claude` options says where, for every variant of the load:

| Value | What the machine gets |
| --- | --- |
| `part` | The default. The `claude` part, so a session in a machine runs the pinned version and not the one installed on this host |
| `host` | `claudeExecutable` in place of the part: what `~/.local/bin/claude` points at on this host, read-only, at `computerExecutable` when that is a path and `/usr/local/bin/claude` otherwise. It is resolved when the machine is made, so an update on this host is followed |

`computerCliFallback` says what happens when the `claude` part cannot be built, offline or with a build that fails. It is read only with `computerCli: "part"`:

| Value | What happens |
| --- | --- |
| `refuse` | The default. The machine is made without the part, and a Claude session on it is refused with a sentence naming `claude`. A machine made for that one session is not made at all |
| `host` | This host's binary is mounted where `computerCli: "host"` puts it, the daemon logs one line naming the part and the mount, and the machine's `ahpd.parts` label names it at the version `host`, so the session runs |

```json
{ "plugins": [{ "name": "@ahpd/agent-claude", "options": { "computerCli": "part", "computerCliFallback": "host" } }] }
```

The fallback mount is checked with every other mount when the machine is made, whether the part builds or not, so a mount at the same target is refused naming both. A host path that is not there is refused at create, naming the need and the path, instead of becoming an empty directory the session exits 127 in.

**A variant takes its own `env` into the machine, and nothing of the daemon's.** The CLI in a machine runs with the record's own `env`, a credential a client pushed laid over it, and `CLAUDE_CONFIG_DIR` last. The daemon's `HOME`, `PATH` and `PWD` never cross, and its `ANTHROPIC_*` and `CLAUDE_CODE_OAUTH_TOKEN` cross only when the variant's `env` names them, as `{ "fromEnv": "ANTHROPIC_API_KEY" }`. A variable the variant unsets with `null` is absent inside too. These travel by name on the one `docker exec` that starts the CLI, never as the container's own environment, because `docker exec` cannot unset a variable the container holds: so the built-in Claude and an OpenRouter variant on one machine each get only their own keys.

**No sign-in is seeded.** `.credentials.json` never reaches a state volume. A variant signs in with `CLAUDE_CODE_OAUTH_TOKEN`, the token `claude setup-token` prints, which does not need refreshing, or with `ANTHROPIC_API_KEY`, written in its own `env` as `{ "$secret": "<scope>:<name>" }` or `{ "fromEnv": "NAME" }`. A `$secret` there is read when the record opens, and a record whose secret cannot be read is shown as invalid with a line naming it. A machine whose variant names neither is still made, and the CLI's own sign-in refusal is what the session says.

```json
{ "id": "claude", "engine": "claude", "owner": "host", "name": "Claude Code",
  "config": { "env": { "CLAUDE_CODE_OAUTH_TOKEN": { "$secret": "host:claude-token" } } } }
```

**Upgrading from the host's sign-in.** A machine used to mount this host's `~/.claude`, sign-in included. In a state volume it no longer does, so a person signs in again: once inside the machine, with `docker exec -it -e CLAUDE_CONFIG_DIR=/ahpd/claude <id> claude` and `/login`, which the state volume then keeps for that profile and owner, or with a token in the variant's `env` as above. A profile with `state: "host"` keeps the old shared sign-in instead; every machine that mounts it uses the same subscription, and anything running in one can read it.

### Cofold in a machine

A profile that names `cofold` carries the `ahpd` part its nested host runs from, and the harness's own configuration, the file holding its provider endpoints and keys, at a path inside the machine rather than at the host's:

| Need | What it is on the host | Where it goes |
| --- | --- | --- |
| `ahpdPart` | the `ahpd` part, with `@ahpd/agent-cofold` among its plugins | `/opt/ahpd/ahpd`, with `ahpd` on the machine's `PATH` |
| `cofoldState` | a state volume seeded with the harness's `config.json` | `/ahpd/cofold`, the file at `/ahpd/cofold/cofold/config.json` |
| `cofoldConfig` | the harness's `config.json`, read-only, only in a profile with `state: "host"` | `/ahpd/cofold/cofold/config.json` |
| `cofoldConfigPath` | - | `COFOLD_CONFIG=/ahpd/cofold/cofold/config.json` |
| `cofoldBaseUrl` | - | `COFOLD_BASE_URL`, only when a profile names it |
| `cofoldApiKey` | - | `COFOLD_API_KEY`, only when a profile names it |
| `cofoldModel` | - | `COFOLD_MODEL`, only when a profile names it |

`computerConfigDir` in the `@ahpd/agent-cofold` options names that directory, `/ahpd/cofold` by default, and `false` leaves the image's own configuration alone and declares only the part.

The path inside the machine is fixed and `COFOLD_CONFIG` points at the file, so the configuration is found whichever user the image runs as - a container whose home is `/home/app` reads it the same as one running as root. A profile that mounts the configuration at some other path of its own gets a machine where the harness does not look.

`XDG_CONFIG_HOME` is not touched, and that is the point: it is the nested `ahpd`'s own folder as well, and a machine's mount point is root-owned, so pointing it at `/ahpd/cofold` stops any image that does not run as root from starting at all - `EACCES: permission denied, mkdir '/ahpd/cofold/ahpd/usage'` on the way in. Every other program in the machine keeps its own XDG configuration.

The three variables are read on top of the file, as cofold's own CLI reads them: `COFOLD_BASE_URL` adds or replaces a provider called `default` with `COFOLD_API_KEY` as its key, and a `COFOLD_MODEL` with no slash is a model of `default`. A model id with a slash of its own, as OpenRouter's are, is written after `default/`, because the first slash ends the provider: `default/deepseek/deepseek-chat`. They have no default, so a machine gets them only from a profile, and a profile that names the key from the vault gives a machine a provider with no file holding the key. That is the way to run cofold on [another box](#profiles), where this host's own file is refused.

**The configuration holds keys.** Unlike Claude's sign-in, cofold's keys are in the file it seeds, so anything running in a machine that carries it can read them. Use a profile to decide which machines get it, and treat the file as shared for now.

### pi in a machine

`@ahpd/agent-pi` runs pi as a library in the daemon's own process, so no command can run it in a machine: it runs nested, in an `ahpd` from the `ahpd` part, as cofold does. A profile that names `pi`, or a pi session's own machine, carries:

| Need | What it is on the host | Where it goes |
| --- | --- | --- |
| `ahpdPart` | the `ahpd` part, with `@ahpd/agent-pi` among its plugins | `/opt/ahpd/ahpd`, with `ahpd` on the machine's `PATH` |
| `piState` | a state volume seeded with pi's `settings.json` and `models.json` | `/ahpd/pi` |
| `piAgentDirectory` | pi's agent directory, read-write, only in a profile with `state: "host"` | `/ahpd/pi` |
| `piAgentDir` | - | `PI_CODING_AGENT_DIR=/ahpd/pi` |
| `pi.<VARIABLE>` | one per key variable pi's provider list reads, such as `pi.ANTHROPIC_API_KEY` and `pi.OPENROUTER_API_KEY` | that variable, when a profile gives it a value |

pi's agent directory on this host is `PI_CODING_AGENT_DIR` when the daemon has it, else `~/.pi/agent`. `auth.json` is never seeded, so a sign-in on this host does not reach a machine: a key reaches it as one of the key needs, from the profile or the plugin's `needs`, and a key nobody gave is left out. The need's prefix is the agent's provider id, so a pi registered as `pi-work` has `pi-work.ANTHROPIC_API_KEY`:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": {
  "profiles": {
    "pi": { "agents": ["pi"], "needs": { "pi.OPENROUTER_API_KEY": { "$secret": "user:ada/openrouter" } } }
  }
} }] }
```

pi declares only the variables its provider list names. A variable that pi's own `models.json` names for a provider of its own is not declared, and a profile has no need to fill for it, so such a provider does not sign in inside a machine.

**A key reaches only its own agent.** A value the vault fills for a need goes to the commands of the agent whose need declared it, and to no other agent on the machine: in a machine for pi and a Claude OpenRouter variant, pi's nested host gets `pi.ANTHROPIC_API_KEY`, and the variant's CLI does not. `run_in_computer` gives a command the keys of the agent whose session called it, and only a command no agent runs, such as one through a dev container's relay, gets every agent's.

### ACP agents in a machine

Each shipped `@ahpd/agent-acp` template brings a `machine` block: the part its CLI comes from, a state directory at `/ahpd/<id>` seeded from the agent's own host files, never its login file, and the variables that point the CLI at that directory. Codex is `CODEX_HOME=/ahpd/codex` seeded from `~/.codex/config.toml`, `AGENTS.md` and `skills/`; OpenCode, Kilo and Devin move `XDG_CONFIG_HOME` and `XDG_DATA_HOME` under their state directory; Cursor runs `cursor-agent`, the name its part and its host installer share; Amp's part holds `amp-acp` and the Amp CLI it runs, which `AMP_CLI_PATH` names, and Amp has no variable that moves its settings, so it has no state directory. A record's own `machine` is laid over the template's by key, and its `env` by variable:

```json
{ "id": "codex", "engine": "acp", "owner": "host", "name": "Codex",
  "config": { "machine": { "env": { "OPENAI_API_KEY": { "$secret": "user:ada/openai" } } } } }
```

A key is never in the shipped block: a host record fills its variable in its own `machine.env`, and a `$secret` there is read when the machine is made and passed by name on each command.

## ssh machines

A box that already runs ahpd is listed in the plugin's `ssh` option and reached over ssh.
This host never makes, starts, stops or removes one: it lists it, runs commands on it, and starts a host on it for each session.

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": { "ssh": { "machines": {
  "deb": {
    "destination": "me@box.example",
    "workdir": "/home/me/work",
    "host": ["sh", "-c", ". \"$HOME/.keys\" && exec ahpd \"$@\"", "ahpd"]
  }
} } } }] }
```

| Option | What it does |
| --- | --- |
| `ssh.command` | The program that reaches a box. `ssh` when absent. |
| `ssh.args` | Arguments before its own, for a wrapper or a jump host. |
| `ssh.connectTimeout` | Seconds ssh is given to reach a box. 30 when absent, VS Code's handshake bound for an ssh host. |
| `ssh.pollSeconds` | Seconds between checks of each box. Absent, only a listing moves the up-time meter. |
| `ssh.machines.<name>.destination` | `user@host`, or a name from ssh's own config. |
| `ssh.machines.<name>.port` | The port, when it is not the one ssh would use. |
| `ssh.machines.<name>.identity` | The private key, when ssh would not pick one itself. |
| `ssh.machines.<name>.workdir` | Where a command and a session start on the box. The login directory when absent. |
| `ssh.machines.<name>.host` | The command that starts a host on the box. `["ahpd"]` when absent. |
| `ssh.machines.<name>.agents` | The agents the box is prepared for. A session of another agent is refused. |

The entry `deb` is the machine `computer://ssh.deb`.
An id is `<runtime>.<name>`, and a machine on the local Docker keeps a bare name with no dot.
A policy names every ssh machine with `computer: ["ssh.*"]`.

### What the box needs

- ahpd at this host's version, and the plugins of the agents it serves, each configured in the box's own `config.json`. The host on the box loads a plugin with the options its own file gives it, and serves the agent records in its own `agents` folder, so cofold's `model` lives in the file and an ACP agent's in its record.
- `ahpd` on the `PATH` of a non-interactive login, which a Node installed by nvm is not. Otherwise name its full path in `host`.
- Its own model credentials. Nothing is sent from this host: `host` above sources a file on the box, because a non-interactive ssh reads no profile.
- This host's key in `authorized_keys`, and the box's host key known to this host. Every call passes `BatchMode=yes`, so a password prompt or an unknown host key fails with ssh's own sentence.

### What the box can run

`computer://ssh.<name>/server` asks the box what it has. Each read sends one `sh` script over ssh and answers JSON: the user it ran as, and one item for each part below. Nothing is installed on the box.

```json
{ "user": "me",
  "items": {
    "docker": { "ok": true, "found": "29.8.1", "fix": [] },
    "libvirt": { "ok": false, "found": "not installed", "fix": [
      "sudo apt install libvirt-daemon-system qemu-system-x86 qemu-utils virtinst cloud-image-utils",
      "sudo usermod -aG libvirt me",
      "# log in to the box again, so the new group applies"
    ] } } }
```

| Item | Ok when |
| --- | --- |
| `os` | `/etc/os-release` names the system. |
| `arch` | `uname -m` answers. |
| `cpus` | `nproc` answers a count. |
| `memory` | `/proc/meminfo` gives `MemTotal`. |
| `disk` | `df` gives the free space of the home folder and of `/var/lib`. |
| `docker` | `docker` is on the box. |
| `dockerAccess` | `docker info` works as the user. |
| `kvm` | `/dev/kvm` exists, and the user can read and write it. |
| `libvirt` | `virsh` is on the box. |
| `libvirtAccess` | `virsh -c qemu:///system list` works as the user. |
| `ahpd` | `ahpd --version` answers, from the `PATH` or from `~/.local/node/bin`, where the install script puts it. |

`fix` holds the lines to run on the box, in order. A line that starts with `#` is a note, so the list can be pasted into a shell as it is. The `apt` lines are for Debian and Ubuntu; on another system the fix names the package to install. A new group takes effect at the next login, so log in again before you read the leaf again.

### What runs there

Every session on an ssh machine runs nested, whatever its backend: `<host> --stdio --no-plugins --plugin <the agent's plugin>` on the box, over one `ssh -T`.
The session's folder there is the machine's `workdir`, written as the box's own path.
An ACP agent runs only in a folder the person trusts: the folder inside is trusted when their client trusts the session's folder on this host.
A restart of this host leaves the session on the box, and the next turn resumes it there.

### What an ssh machine cannot do

- It is never made: a create that names `"runtime": "ssh"` is refused.
- It has no state to set: start, stop and restart are refused.
- It takes no parts and no bind mounts, and a value named from the vault is refused in a command, since ssh carries a variable inside the remote command.
- Its up time is charged to the host, `root:<host>`, as stretches that open when a listing finds it reachable and close when one finds it gone or the daemon stops.

## Joined nodes

A box behind NAT joins this host rather than being reached over ssh.
The node dials out, so no port is opened on it, and no destination has to be reachable from here.

```sh
# on the hub: mint the node's token, which is shown once
ahpd node add box
# Shown once. Only its hash is stored, and adding the node again replaces it.
# 7d1f...

# on the box: dial the hub and keep the connection
ahpd join ws://hub.example:7331 --token 7d1f... --workdir /srv/box
```

A client lists `node.box` while that node is connected.
A session created with `computer: "computer://node.box"` runs on the node.

| Command | What it does |
| --- | --- |
| `ahpd node add <name>` | Adds a node and mints its token, shown once. Adding it again replaces the token, and the old one stops working |
| `ahpd node list` | The nodes in the file, one name per line |
| `ahpd node rm <name>` | Removes a node. Its token is refused from its next connection on, and a joined one is dropped |
| `ahpd join <url>` | Dials the hub at a `ws://` or `http://` address, with `--token`, `--token-file` or `AHPD_TOKEN`. `--workdir` names the folder a session there starts in, and the current one is the default |

`node:read` lists the nodes, and `node:write` adds and removes them ([Users and grants](../sdk/USERS.md)).
The nodes file sits beside the users file, so `--users` or the `users` key names both.
A host with no users file has nowhere to keep a node.

### What runs there

Every session on a node runs nested, as on an ssh machine.
The hub asks for one with `node/open`, and the node dials one more socket back for it.
The node starts `ahpd --stdio --no-plugins --plugin <the agent's plugin>` in its own working directory.
The hub reads that socket as a `NestedHost`, so a turn, a tool call and a stop are the proxy's own frames.
The folder a session starts in is the one the node said in its `node/hello`, written as that box's own path.
What serves the session is the node's ahpd, with the harness and the configuration installed on that box.
This host's own agents and models are not the ones used.

### What a node trusts the hub with

A node's local `ahpd --stdio` admits the hub as itself, which is what joining means.
The hub starts a session in the node's working directory, with the node's own harness and credentials.
Each session is one more process on the node, and its log is the node's stderr.
A node whose ahpd is older than 0.14.1 is refused on join, with a sentence that says to update it.
An older ahpd cannot resume a session by id.

### A restart of either side

A control socket that drops is dialled again with a backoff of up to a minute.
A session already open keeps its own data socket, so a hub that restarts is one the node waits out.
The daemon option `nodeRestart` says what a session does when its node's join restarts.
`end`, the default, shows the session failed with a sentence naming the node.
The next turn resumes it at the same id against the node's store.
`reconnect` keeps the session and opens it again on the socket the node dials when it comes back.
A node asked for while it is not connected is given ten seconds to dial, and refused as `node <name> is not connected` when it does not.

### What a node cannot do

- It is never made: a create that names `"runtime": "node"` is refused.
- It has no state to set: start, stop, restart and remove are refused.
- It takes no parts, no bind mounts, and no file is written into it.
- It is listed only while connected, and its up time is charged to the host as stretches.

## Profiles

A profile is a named set of machine settings in the plugin options:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": {
  "needs": { "claudeConfigDirectory": "/srv/claude-home" },
  "profiles": {
    "claude": {
      "title": "Claude",
      "description": "The CLI and this host's configuration, shared in.",
      "image": "node:22", "cpus": "2", "memory": "512m", "workdir": "/work",
      "agents": ["claude"], "state": "host"
    },
    "plain": { "title": "Plain", "description": "Nothing shared.", "memory": "256m" }
  }
} }] }
```

`agents` names the harnesses a machine is prepared for. Each of them declares what it needs with its own `machine()`, and the machine is made with the result and labelled `ahpd.agents=<list>`. A profile that names no agents is a machine with nothing added, as every profile was before this.

A need is filled from the profile, then the plugin option, then the agent's own default. So `"needs": { "claudeConfigDirectory": "/srv/claude-home" }` in a profile points that one need elsewhere for that one machine, and the same key in the plugin options does it for every profile:

```json
{ "profiles": { "claude": { "agents": ["claude"], "needs": { "claudeConfigJson": "/srv/claude.json" } } } }
```

A need is delivered as a bind mount, an environment variable, a file copied in, a part, or a state volume. Copy-ins are placed between the container being created and its first process starting, and they are paid on every create and lost with the machine. A state volume is kept across machines and seeded only when its seed changed; see [Agent state](#agent-state).

`state` and `stateScope` say where the agents in a machine from the profile keep their state, and who shares it:

| Field | Values | What it does |
| --- | --- | --- |
| `state` | `volume` (default), `host` | `volume` gives each agent's state directory a named volume, seeded from this host, and leaves out every need an agent marks `when: "host"`. `host` mounts this host's own configuration, sign-in included, as those needs say, and makes no state volume: the machine is made exactly as it was before state volumes existed. |
| `stateScope` | `owner` (default), `shared` | `owner` gives each owner of a machine from the profile a volume per provider, `ahpd-state-<profile>-<owner>-<provider>-<hash>`; a bot, an automation or a plugin that owns a machine is an owner like a person. `shared` gives every owner of the profile one volume per provider, `ahpd-state-<profile>-<provider>-<hash>`, for a team that wants one shared bot state. |
| `gitGuard` | `fetch` (default), `open` | How a repository's git directory is guarded in a session's machine. `fetch` gives the machine a git directory of its own, in a volume named after the machine, and mounts nothing of this host's but the repository's `objects/` read-only: the machine commits in its own repository, as the host user's uid:gid, and ahpd fetches the work back into this host's repository. `open` mounts this host's git directory writable in the machine, which is the operator's own choice for a machine they trust with it; for a session at the repository root that leaves the image's user, and a worktree's directory is still run as the host user. `bind` is read as `fetch`, with a line saying so, so a profile written for it still starts and gets a safer machine. See [Disposable machines](#disposable-machines). |
| `sessionTree` | `shared` (default), `copy` | Whether the session's folder reaches the machine as this host's own tree or as a checkout of the machine's own. `shared` mounts this host's tree at the same path read-write, so the host sees an agent's edit as it is made; `copy` mounts the machine's git volume at that path instead, holding a working tree and its `.git` together, with nothing of this host's tree bound, so the agent's work reaches this host only through the fetch. Needs `sessionFolder`, which is what puts a folder there at all, and needs the folder to be in a repository: a folder with none is refused rather than given an empty volume. |
| `nestedDelete` | `inside` (default), `record` | What deleting a nested session that ran in a machine from the profile, and is not running, does to the copy inside. `inside` starts the machine's own host, disposes that session there, then deletes the record here; with no machine the record goes and a line says the copy went with the machine. `record` deletes the record here and leaves the machine's copy where it is, for a machine somebody works in by hand and comes back to. Any other value refuses the plugin when the options are read. |

```json
{ "profiles": { "bots": { "agents": ["claude"], "state": "volume", "stateScope": "shared" } } }
```

Any other value of either refuses the plugin when the options are read.

`parts` names the parts every machine from the profile carries, by their ids in the versions file, beside the ones its agents' needs name. A running machine never gains a part, so a long-lived machine names here every part a session in it will want. An id the versions file does not name is left out with a log line, and the rest of the profile stands. See [Parts in a machine](#parts-in-a-machine).

```json
{ "profiles": { "agents": { "title": "Agents", "parts": ["codex", "gemini"] } } }
```

A need value may be the name of a secret rather than the value itself, which is what keeps a credential out of the file:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": {
  "needs": { "anthropicKey": { "$secret": "host:shared" } },
  "profiles": {
    "ada": { "agents": ["claude"], "needs": { "anthropicKey": { "$secret": "user:ada/token" } } }
  }
} }] }
```

The value is read when the machine is made, not when the plugin loads, and it is read for that machine's own owner and team: `host:` for any machine, `team:<team>/` only for work charged to that team, `user:<id>/` only for that person's own sessions and machines. A machine made from the form has an owner and no team, so a `team:` value in the profile it picked is refused. A need that cannot be read refuses the machine, naming the need and the name.

Only what the machine resolves is read. The profile picked is the only one read, and within it only the needs that machine's agents declare: a name under a need no agent in the machine declares belongs to the machines that agent is in, so the plugin's `needs` can hold one person's key without stopping a machine for a harness that never asks for it.

`ahpd vault set host:shared` sets one. See [The vault](../server/VAULT.md) for where the file is and who may write each of the three forms.

A value read from the vault is never given when the machine is made, so `docker inspect` does not hold it in `Config.Env` and a dev container's override config and the Dev Container CLI's own `docker run` never see it.
The daemon holds it in memory with the machine and passes it on each `docker exec` into the machine, by name.
After the daemon restarts, it is read again the first time the machine is reached, for the owner and team the machine was made for.
The secrets it reads are the ones the machine was made with, which the daemon records by need, variable and secret name in `computers.json` beside its configuration; the values are never written there.
A machine made before that record existed is read again from the needs its agents declare now.

`secretUnreadable` in a profile says what happens when that read fails:

| Value | What a command into the machine does |
| --- | --- |
| `fail` | Fails with a sentence naming the need and the secret, and the next command reads again. The default, and the answer for a machine made from no profile. |
| `drop` | Runs without that one variable, and the daemon logs a line naming the need. Every other variable is still given. |

```json
{ "profiles": { "claude": { "agents": ["claude"], "needs": { "anthropicKey": { "$secret": "user:ada/token" } }, "secretUnreadable": "drop" } } }
```

Any other value refuses the plugin when the options are read.

`folder` names a host folder mounted at the same path inside the machine, and `workdir` defaults to it. The same path is what keeps an agent's own record consistent: Claude writes its history under the working directory it saw, so the same spelling inside and out is what makes a session written in a machine resumable on this host.

`ociRuntime` names the OCI runtime Docker starts every machine from the profile under, which is a stronger boundary than a plain container:

```json
{ "profiles": { "untrusted": { "ociRuntime": "runsc" } } }
```

`runsc` is [gVisor](https://gvisor.dev), which gives the machine its own kernel in user space, so a system call cannot reach this host's kernel directly. Docker must have the runtime installed; a host without it refuses the create with Docker's own message, because the value is passed as given. Absent means no `--runtime` argument at all, and Docker's own default runs the machine. The field is the profile's alone. A manifest that names it is refused, because the boundary a machine is given is the operator's to choose. A machine made from a `devcontainer.json` is refused when its profile names the field. The Dev Container CLI makes that machine rather than `docker run`, so there is no flag to add. See [Security](#security).

A manifest picks a profile with `"profile": "claude"`, and its own fields still win. Mounts add up in order: the plugin's `mounts`, then the profile's, then the manifest's (if allowed), then what the agents declared. Other fields come from the manifest, then the profile, then the host default.

An unknown profile is refused with the list of known ones. A profile that names an agent this host does not have is refused too, rather than made without what it was prepared for.

A target two different mounts land at is refused at create, naming both and where each came from, because one of them would silently lose - Docker refuses the machine outright. Two mounts that are one statement, the same source and target, are one mount however many of them say it, so two variants of one plugin that mount the same file get it once, and a profile may mount an agent's configuration by hand at the need's own target.

Two agents that ask for the same thing at one target get it once: an environment variable with one value is one `-e`, and two state needs of one provider with the same seeds are one volume. Two that ask for different things there are refused at create with both needs named - two values for one variable, neither of them printed, or two state volumes at one directory.

A mount whose host path is not there is refused at create, naming the mount and whether it came from the plugin options, a profile or a body - not mounted as an empty directory for the session to find out about later. A relative source is refused the same way, because Docker reads `cache:/cache` as a named volume rather than as a path on this host. The check is at create and not at load, so a folder made after the daemon started is still accepted, and the same is true of a need's own value.

The names are published in the create schema as an `enum` with each profile's title and description in the spec's parallel `enumLabels` and `enumDescriptions`, so a client can draw a picker. No profiles means no such property. The runtime is published with its one value as the default and `readOnly`, a field shown and not changeable.

`server` names the entry of `ssh.machines` that a profile's machines are made on, and that box's `server` leaf says what it can run. A profile whose `server` is not an entry there is left out, with a line in the log:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": {
  "ssh": { "machines": { "dev02": { "destination": "dev02" } } },
  "profiles": {
    "remote": {
      "title": "On dev02",
      "server": "dev02",
      "image": "node:22",
      "disposable": true,
      "sessionFolder": true,
      "code": "bundle",
      "needs": {
        "cofoldBaseUrl": "https://openrouter.ai/api/v1",
        "cofoldModel": "default/deepseek/deepseek-chat",
        "cofoldApiKey": { "$secret": "host:openrouter" }
      }
    }
  }
} }] }
```

The machine is made on the box's own Docker, which this host reaches as `DOCKER_HOST=ssh://<destination>`. The parts it mounts are built there too, because a part is mounted by its image and only the Docker that holds the image can mount it.

This is one profile's Docker, not the plugin's. The plugin's `env.DOCKER_HOST` moves every machine to that Docker, and `server` moves only that profile's machines, which get ids such as `docker-<profile>.ahpd-computer-…`. A profile whose `server` is the plugin's own `env.DOCKER_HOST` makes its machines there, as any other profile does. Docker is given no key file, so a box with `identity` is left out: name the key for its destination in ssh's own configuration instead.

A machine on another box mounts no path of this host's. A bind mount from the plugin options, the profile or the body is refused at create, with the mount named. A dev container is refused too, because the Dev Container CLI reads the folder on this host. With `sessionFolder`, the machine has a volume of its own at the folder's path, and `code` says how the session's code gets into it.

The session's folder is on this host, so `code` says how the machine gets the session's code:

| `code` | What happens |
| --- | --- |
| `bundle` | The default. This host makes a git bundle of the session's branch, copies it in with `docker cp`, and the machine clones it with `origin` set to the repository's remote. No credential goes into the box. |
| `clone` | The machine fetches the session's branch from `origin`, a GitHub SSH origin by GitHub's HTTPS origin as VS Code's agent host clones one, so `git@github.com:acme/app.git` is fetched as `https://github.com/acme/app.git`, and any other origin as written. The machine holds no key and no token, so this works only for a public repository it can fetch, and the branch has to be on `origin`. |

Either way the work comes back the same way, by the fetch [Disposable machines](#disposable-machines) describes, and the machine never pushes.

A credential of this host's own never goes to another box. An agent need marked as a credential whose value is this host's, such as a cofold configuration seeded from `~/.config/cofold/config.json`, is refused at create with a sentence naming the need. Give the box its own value in the profile instead, best named from the vault as above: the value is passed by name on each `docker exec` and is never in the machine's `docker inspect`.

### Profiles that make VMs

`runtime` says what makes a profile's machines. `docker`, the default, makes a container. `libvirt` makes a VM on the libvirt of the profile's `server`, and `proxmox` makes a VM on the node that the `proxmox` option names. A VM is a linked clone of a template, so it is made in seconds and its disk holds only what it changed.

A libvirt profile must name its `server`, and the box must be an entry of `ssh.machines`. Before a VM is made there, the box's `kvm`, `libvirt` and `libvirtAccess` items must be ok, as [What the box can run](#what-the-box-can-run) says:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": {
  "ssh": { "machines": { "dev02": { "destination": "dev02" } } },
  "libvirt": { "pool": "default", "network": "default", "image": "debian-13-genericcloud-amd64.qcow2" },
  "profiles": {
    "vm": { "title": "A VM on dev02", "runtime": "libvirt", "server": "dev02", "disposable": true, "sessionFolder": true }
  }
} }] }
```

| `libvirt` | What it says |
| --- | --- |
| `uri` | The libvirt connection for every server. `qemu+ssh://<destination>/system` when absent. |
| `pool` | The storage pool that holds the template and every VM's disk. `default` when absent. |
| `network` | The libvirt network a VM is on. `default` when absent. |
| `template` | A template volume in the pool, which every VM's disk backs onto. It must already hold the parts at `/opt/ahpd`. |
| `image` | A cloud image volume in the pool, a qcow2 with cloud-init, that a template is built from. |
| `user` | The login a VM is made with. `ahpd` when absent. |
| `disk` | The size of a VM's disk, as `virsh vol-create-as` reads it. `20G` when absent. |
| `virsh`, `virtInstall` | The programs and the arguments they start with. `["virsh"]` and `["virt-install"]` when absent. |

A Proxmox profile names no `server` to make its VMs on, because the node is in the `proxmox` option. Its `server` is optional, and names the box that a VM is reached through, for a node whose VM network this host has no route to. That box is not checked, because it runs nothing of the VM's:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": {
  "ssh": { "machines": { "jump": { "destination": "ops@jump" } } },
  "proxmox": {
    "url": "https://pve.example.com:8006",
    "tokenId": "ahpd@pve!ahpd",
    "secret": { "$secret": "host:proxmox" },
    "node": "pve",
    "storage": "local-lvm",
    "bridge": "vmbr0",
    "image": "debian-13-cloud",
    "ca": "/etc/ahpd/pve-root-ca.pem"
  },
  "profiles": {
    "pve": { "title": "A VM on pve", "runtime": "proxmox", "server": "jump", "disposable": true, "sessionFolder": true }
  }
} }] }
```

| `proxmox` | What it says |
| --- | --- |
| `url` | The API's address, `https://<node>:8006`. |
| `tokenId` | The API token's id, `<user>@<realm>!<name>`. |
| `secret` | The token's secret, best named from the vault as `{ "$secret": "host:proxmox" }`. It is read at each call and never written to a log. |
| `node` | The node every VM is made on. |
| `storage` | The storage a template built here is copied onto. |
| `bridge` | The bridge a VM's network card is on. |
| `template` | A template VM on the node, with cloud-init and the QEMU guest agent, that every VM is a linked clone of. It must already hold the parts at `/opt/ahpd`. |
| `image` | A cloud-init template VM on the node, with the QEMU guest agent, that a template is built from. |
| `user` | The login a VM is made with. `ahpd` when absent. |
| `ca` | A PEM file on this host that the node's certificate is checked against, for a node with its own certificate authority. |

A Proxmox profile is left out, with a line in the log, when the option does not name `url`, `tokenId`, `secret`, `node`, `storage` and `bridge`. The token needs `PVEVMAdmin` on the node, `PVEDatastoreUser` on the storage and `PVESDNUser` on the bridge's zone. A VM gets its address from DHCP, and the guest agent reports it.

Either runtime refuses a VM when its option names neither `template` nor `image`. With `image`, the runtime builds the template itself, from the parts in [The joined image](#the-joined-image):

1. The template is named `ahpd-template-<hash>`, where the hash is the joined image's hash.
2. A helper VM boots from the image with this host's key and the packages a container has.
3. The parts are copied into the helper at `/opt/ahpd`, and cloud-init forgets the helper's instance.
4. The helper's disk is kept as the template, and the helper is gone.

A change to `versions.json` or to the ahpd part is a new hash, so the next VM builds a new template and backs onto it. Two VMs asked for at once build the template once. An older template is named in the log and kept, because a VM may still back onto it: remove it by hand once none does.

A VM is another host, so every backend of a session in one runs nested, and its login is reached with this host's own key, through the box. A box with an `identity` is left out, as it is for Docker: name the key for its destination in ssh's own configuration instead. A VM takes no bind mount, no copied file, no variable and no state volume, so a profile that needs one of them is refused at create, with what it needs named. Use `state: "host"`, or a Docker profile.

A VM can be held: writing `suspended` to its [state](#state) pauses it where it is, and `running` lets it go on. A suspended VM is not up, so its up-time stretch closes when it is held and a new one opens when it goes on. Its owner pays only for the time it runs. Stopping a VM asks the guest to shut down, and cuts it off when it has not within a minute. Removing one brings its work back first, as [Disposable machines](#disposable-machines) says, then removes the VM and its disk.

## Disposable machines

A profile that sets `disposable: true` has no machine until a session starts. It is offered in the session's `computer` picker as `disposable:<profile>`, labelled with the profile's title, and the machine is made at session start from the profile, that session's harness needs and, where the profile says so, the session's folder mounted at the same path:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": {
  "profiles": {
    "scratch": {
      "title": "Scratch",
      "description": "A machine of this session's own.",
      "image": "node:22",
      "disposable": true,
      "disposableDelay": 300000,
      "disposableAlone": true,
      "sessionFolder": true
    }
  }
} }] }
```

| Field | What it does |
| --- | --- |
| `disposable` | The profile is offered as a `disposable:<profile>` row instead of being made ahead of time. The machine takes the `machine()` needs of the harness the session runs, so the profile names no `agents`. |
| `disposableDelay` | Milliseconds after the last session using the machine is disposed before it is removed. Default `300000`, five minutes. A session that picks the machine again in that window cancels the timer. |
| `disposableAlone` | The machine is not listed in the picker, so only the session it was made for runs in it. The `disposable:<profile>` row is still offered, and a second session that names the machine by its `computer://<id>` is refused rather than sharing a machine built for one. |
| `sessionFolder` | The session's working folder is mounted read-write at the same path inside the machine, so Claude keys its history the same inside and out. Off by default: the folder is the client's and this is the host's filesystem inside a machine, so a profile opts in. Without it a session's history written in the machine is not this host's, and the session starts in the profile's `workdir` or the image's. A profile's own `folder` is the operator's and is mounted either way. |
| `sessionRepository` | The repository that session's folder sits inside is mounted too: for a folder below a repository's root, the root at its own path in place of the folder, and the git directory beside it. Off by default for the same reason as `sessionFolder`, one step wider: a session folder is one folder, and the repository root it sits under is every path around it - a folder at `~/.config/nvim` has `$HOME` for a root. Without it the folder alone is mounted, with no git directory, and the daemon logs a line naming the repository it left out. Needs `sessionFolder`, which is what puts a folder there at all. |

**A worktree brings its repository.** Where the session's folder is mounted and it is a linked worktree, or a folder below a repository's root, the repository reaches the machine, so the machine's git answers from the branch the tree is on and a commit made there is one ahpd brings back onto that branch at the turn's end, by the fetch below. Under `gitGuard: "open"` there is no fetch to make: the machine commits in this host's own git directory and lands on the worktree's branch directly. A folder below the root mounts the whole tree at its own path in place of the folder where the profile says `sessionRepository` as well, and the session still starts in the folder; without that the folder is all that is mounted, and no repository, since the one beside the root is not under the folder. A `devcontainer://<folder>` source does the same through the override config, with the tree mounted at its own path rather than under `/workspaces`. Only the folder's own repository reaches a machine: `<root>/.git` for a main checkout, or the git directory of the worktree the root's `.git` file names, whose own `gitdir` file names that `.git` back. A folder whose `.git` names another repository, or whose `.git` holds a `commondir` leading anywhere but the directory it is in, gets no repository at all, with one line naming that file. Under the profile's `gitGuard`, `fetch` by default, none of this host's git directory is writable in the machine, and nothing of it is mounted but the objects; `gitGuard: "open"` is the other answer: a worktree's git directory is mounted read-write at its own path and still run as the host user, and a folder at a repository's root gets no mount of its own, since the tree is mounted and the `.git` inside it comes writable with it, under the image's user.

**The work comes back by fetch.** Under `fetch`, the machine commits in a git directory of its own, in the volume `ahpd-git-<machine>`: mounted over `<root>/.git` where that is a directory, and at `/opt/ahpd/git` with a file this host wrote bound read-only over `<root>/.git` where it is a file, which is what a linked worktree has. That directory's `objects/info/alternates` names the repository's `objects/`, mounted read-only at `/opt/ahpd/host-objects` rather than at any path the machine's own git directory holds, so the machine's git reads the whole history and writes none of it. Its branch is the branch the tree is on, at the commit the tree is at, the index that commit names, and the two config values a commit needs copied from the tree and nothing else of this host's config, so no remote, hook path or include reaches it and a commit there is a commit anywhere. Where the tree is this host's own, nothing of the commit is read into the working tree, so a change nobody has committed here shows up in the machine as the uncommitted change it is. Every command in such a machine runs as this host user's uid:gid, on `docker run` and on each `docker exec`, so the volume's files stay the host user's.

ahpd brings the commits back by asking the machine for a bundle - `git bundle create -` out through `docker exec`, on a pipe, never through a path this host's git opens inside the machine's volume - and fetching it here with `transfer.fsckObjects` on, into `refs/ahpd/machines/<machine>/<branch>`. Every branch the machine holds is asked for, not only the one it is on: a branch an agent made and left is work with nowhere else to live, so it comes back on a hidden ref of its own and moves the host's branch of that name. The host's branch is fast-forwarded to it where that is a fast-forward and nothing is staged in the tree, and made at the machine's commit where the host has no branch by that name at all; where neither holds, the work waits under that ref and one line says so, so nothing is lost and nothing is overwritten. It is fetched when a turn ends or is cancelled, before an operation on the changeset runs, when a session leaves its machine, and before a machine is removed. A commit made in a machine is therefore a change the branch gets at the turn's end and not before: a person reading the branch mid-turn sees the work as uncommitted changes, or not at all under `copy`.

The other direction is `follow`. A commit made on the host between turns is handed to the machine before its next turn, and after an operation on the changeset that moved the branch, as `update-ref` and `reset -q` in the machine, whose objects already reach it through the alternates. It happens only where the machine holds nothing this host has not fetched - the commit the machine is at, and the branch of that name it is about to be pointed at, which is re-pointed only where the host's commit leads on from it - so a branch of a machine's never loses a commit: where it would, the machine keeps working where it is and one line says why. A branch of the machine's the host is not on is left exactly where it is.

**What does not work in a machine.** No remote reaches it, so `git push`, `git fetch`, `git pull` and a submodule that has to be cloned all fail there; the machine's history is the host's objects read-only, and the way work leaves it is the fetch above. A filter driver such as Git LFS is a program configured on the host, and the machine has neither its config nor the remote its smudge and clean talk to, so an LFS-tracked file is a pointer file in the machine and stays one. A host repository whose `objects/info/alternates` names anything is refused a machine outright, since those paths are not mounted and its git would fail on the first object it could not read.

**A copy of the tree.** `sessionTree: "copy"` gives the machine a checkout of its own instead: the volume `ahpd-git-<machine>` is mounted at the tree's own path, holding a working tree and its `.git` together, and nothing of this host's tree is bound at all. Its git is seeded the same way and then reset hard, so the machine starts clean on the tree's branch at the tree's commit. Everything above holds unchanged - the fetch, the moments, the follow, the read-only objects - with two differences. The host's tree is moved with `merge --ff-only` rather than a bare fast-forward, so a host change to a file the machine's commit writes makes the fetch refuse and the work wait under `refs/ahpd/machines/<machine>/<branch>` instead of overwriting it; and what the agent never committed is kept when the machine is removed, as `refs/ahpd/machines/<machine>/uncommitted` here. The changes view under `copy` shows what has been fetched, so a person sees an agent's work turn by turn and nothing uncommitted. A folder that is not in a repository is refused under `copy`, since there is no commit to seed a checkout at, and no git-ignored file - `.env`, `node_modules` - is carried into the copy.

A machine with work in it is emptied before it goes. A stopped one is started again to be read, because `docker exec` refuses a stopped container. Only a `fetch` machine or a copy tree has work to read, so only those are started. A machine that will not start is refused rather than removed with nothing brought out of it. A start, a bring-back or a copy tree's uncommitted files that fails keeps the machine and its volumes. The refusal names the machine and keeps the cause: `Could not remove <name>, so it is still here: <cause>`. `release_computer` answers that sentence to the model, and `DELETE computer://<id>` answers it to the client. A disposable machine's timer is given its delay again, so the work is tried for once more. A machine nobody arms again would stay for the rest of the daemon's life.

A machine made this way is made as one a client writes is, and the request that names the source needs `computer:write` as well as `session:write`: a `disposable:<profile>` or `devcontainer://<folder>` on `createSession`, on a change before the session's first turn and on an automation's start. The plugin's `max` caps the machines the agent's tool asks for, as VS Code caps what an agent's tools create, and VS Code's host makes every container a client asks for.

Making a machine is one operation in a queue per Docker, as VS Code queues one source's dev container operations, and for the tool its count is the same operation, so `max` holds however many calls ask at once. The operation runs for as long as the create takes, and a `devcontainer up` that builds an image holds every other create behind it until it ends.

The machine is labelled `ahpd.disposable=<profile>`, `ahpd.session=<uri>` and `ahpd.host=<id>`, so a daemon that restarts finds the machines it left behind, knows which session each was made for and knows which daemon made it. The session id alone is not enough: a client picks the channel a session id comes from, so two daemons on one Docker keep their sessions under the same ids. Its `computer` setting is the `computer://<id>` it became, so a session started again before its first turn keeps the machine it already made rather than making a second one.

A session that picks the running machine, by its `computer://<id>`, counts as a user of it too; the delay starts when the last of them is disposed. A machine that could not be made answers the session with the runtime's own sentence.

At startup a daemon lists the machines labelled `ahpd.disposable` and adopts the ones that carry its own `ahpd.host` and whose `ahpd.session` it still holds, counting that session among its users. An adopted machine arms no timer: the delay starts when its last session leaves, as it would have on a machine that never went out. A leftover this daemon does not adopt - one whose session was deleted while they were all down, or one another daemon made and is keeping - is left exactly where it is. The daemon that made it is the one that adopts and removes it; where there is none, no daemon removes it and no daemon is charged for the time it is up. Find those with `docker ps -a --filter label=ahpd.disposable`, and remove one with `docker rm -f <id>`.

A `disposableAlone` machine is refused as well to a session whose owner is not the owner it was made for, and to every session on a daemon that did not make it: a channel is the client's to choose, so a session opened under a disposed one's id spells the same URI and the owner is what tells the two apart, and a machine another daemon made is that daemon's to run and to remove.

A disposable machine's state lives in its profile's state volume, so a second disposable machine of one profile and owner, or of one shared profile, finds the state the first left and copies nothing; see [Agent state](#agent-state).

**A hand-written copy-in is paid on every create**, so a disposable profile prefers a state volume or a mount. A need delivered as a copy is paid again for every session's machine and lost with it, which is the opposite of what a profile picked per session wants.

**Stopping the daemon stops the waiting, not the machines.** A machine a session has just left is read back before ahpd exits, so what it committed is on the host rather than only in a machine the next start finds. A removal that is already running is waited for before ahpd exits, so the machine it was removing is gone rather than half removed, and a disposal timer that has not fired yet is cleared, so nothing is removed after the daemon has gone. A machine with nobody in it is left exactly where it is. A later start reads those machines as any start does: the ones whose session it still holds are adopted, and their delay starts again when that session leaves. An inner host a dev container session started is ended with the daemon rather than left running in the machine.

## Agent state

An agent declares its state directory as a state need, with the few host files that seed it:

```js
machine: () => ({
  claudeState: {
    state: '/ahpd/claude',
    seed: [
      { source: '~/.claude/settings.json', drop: ['security.auth'] },
      { source: '~/.claude/CLAUDE.md' },
      { source: '~/.claude/skills' },
      { source: '~/.claude.json', target: '.claude.json', keep: ['mcpServers'] },
    ],
  },
  claudeConfigDirectory: { directory: '~/.claude', target: '/ahpd/claude', when: 'host' },
}),
```

In a profile with `state: "volume"`, the default, the machine mounts a named volume at the state directory, and needs marked `when: "host"` are left out. Nothing of this host's home is mounted.

Each provider has its own state volume, the variants of one plugin included, so the built-in Claude and an OpenRouter variant share no setting and no sign-in. The volume is named by the machine's profile, its owner and the provider of the agent that declared the need:

| Machine | Volume |
| --- | --- |
| From a profile, `stateScope: "owner"` | `ahpd-state-<profile>-<owner>-<provider>-<hash>`, such as `ahpd-state-claude-user-alice-claude-openrouter-3f9c21ab` |
| From a profile, `stateScope: "shared"` | `ahpd-state-<profile>-<provider>-<hash>` |
| Without a profile | `ahpd-state-<machine id>-<provider>-<hash>` |

Each piece is lowercased, with every character outside `a-z`, `0-9` and `-` written as a dash, so the owner `user:alice` is `user-alice`. Two owners can read the same that way, `user:A` and `user:a` among them, so `<hash>` is the first 8 hex digits of the sha256 of the pieces as written, joined by a NUL byte, and each owner keeps a volume of its own. A profile's volumes outlive every machine made from it. The volumes of a machine made without a profile, such as a dev container a session asked for, are removed with it. A machine with a state volume is labelled `ahpd.state=volume`.

A seed is written before the machine starts, through a helper container that is removed again, and only when it changed. A dev container that builds its own image has no image before it is made, so its seeds are written once it is up, into the running container, by the same rules:

- The volume holds `.ahpd-seed.json`, which records each seed's size and mtime, or that it was absent. A seed whose record matches is not copied, so a second machine of one profile and owner copies nothing.
- A seed that changed on this host is written again on its own, over the file at its target. Everything else in the volume - the agent's history, caches and what it wrote - is left alone. A setting edited inside a machine is lost at the next seed of that file, so edit it on the host.
- `target` is relative to the state directory and defaults to the source's name. A directory is copied whole under its target.
- `keep` keeps only those top-level keys of a JSON file, and `drop` removes each dotted path. Either on a directory is refused when the machine is made.
- A seed whose host source is not there is skipped with a log line naming it, and the others are seeded. It is seeded once it appears.
- A seed's source may be a link, which is followed. A link inside a seeded directory is never followed: it is skipped with a log line naming it.
- Every entry of the seed is written with the numeric ids of the machine's user, the volume's root included, by `docker cp -a`, so an image whose user is not root can write its state. The ids are read once from the image. A dev container uses its `remoteUser`, else its `containerUser`, else its image's user.
- A dev container that builds its own image reads its user's ids inside the running container before its seeds are written there.

A login file is never a seed, so a machine starts signed out and an upgrading user signs in again inside it, where the state volume keeps the sign-in, or opts into `state: "host"`. A credential reaches a machine as an env need, from the vault or the daemon's environment, and only the agent whose need declared it is given it. A Claude variant's key reaches the CLI on each exec rather than through the machine: it is never in a state volume or the container's environment, so a variant's key is not left in a machine another variant runs in.

`state: "host"` is the old shared sign-in: the machine mounts this host's `~/.claude`, pi's agent directory or cofold's file, and every machine that mounts it uses the same subscription.

| Agent | State directory | Seeded from this host |
| --- | --- | --- |
| Claude, and each variant | `/ahpd/<variant>` | `~/.claude/settings.json`, `CLAUDE.md`, `skills/`, `agents/`, `commands/`, and `~/.claude.json` keeping `mcpServers` |
| cofold | `/ahpd/cofold` | its `config.json` |
| pi | `/ahpd/pi` | `settings.json` and `models.json` |
| An ACP preset | `/ahpd/<id>` | what its [shipped `machine`](#acp-agents-in-a-machine) names |

## Stats

`computer://<id>/stats`:

```json
{ "running": true,
  "cpu": { "percent": 34.2, "cores": 2 },
  "memory": { "used": 421888, "limit": 536870912, "percent": 0.08 },
  "pids": 7,
  "network": { "rx": 266, "tx": 84 },
  "block": { "read": 4100, "write": 0 } }
```

Sizes are bytes. `cpu.percent` is percent of one core, so it can exceed 100; `cores` is present when the machine has a CPU limit. A stopped machine answers `{ "running": false }`. Each read is one `docker stats --no-stream`, so poll for a live view.

## State

`computer://<id>/state` reads `running` or `stopped`, and a VM can also read `suspended`. Writing `restarted` is `docker restart`, which also starts a stopped machine. A VM takes `suspended`, which holds it, and `running`, which lets a suspended VM go on; another machine refuses `suspended`. The runtime's finer states (`exited`, `paused`, `created`) are in `status` under `State.Status`.

## The channel and its commands

A client that subscribes to `x-ahpd-computers://` holds every machine with its state. Subscribing needs `computer:read`, and a reader without it is refused. The snapshot lists each machine as `{ id, record }`, where `record` is `{ state, status }`: `state` is what `computer://<id>/state` reads, where the runtime gives one, and `status` is what `computer://<id>/status` reads.

The channel is read again after each change this plugin makes to a machine, and every five minutes for the changes made outside it, VS Code's periodic pass over a catalogue whose source changes without telling it. A runtime that does not answer a listing keeps the machines it last listed, as VS Code keeps the list it had when a refresh fails, and the daemon's log gets a line naming it.

```json
{ "records": [
  { "id": "box", "record": { "state": "running", "status": { "Name": "/box", "State": { "Running": true, "Status": "running" }, "...": {} } } }
] }
```

Three actions follow the snapshot: `x-ahpd-computers/added` `{ id, record }` for a new machine, `x-ahpd-computers/changed` `{ id, record }` for a machine whose record is different, and `x-ahpd-computers/removed` `{ id }` for a machine that is gone. A stop sends:

```json
{ "type": "x-ahpd-computers/changed", "id": "box", "record": { "state": "stopped", "status": { "Name": "/box", "State": { "Running": false, "Status": "exited" }, "...": {} } } }
```

The commands do what a write or a delete on `computer:` does, with the same refusals. Each answers `{}`.

| Command | Params | Grant | Does |
| --- | --- | --- | --- |
| `x-ahpd/computers/create` | `{ name, manifest }` | `computer:put` | Makes a machine from `manifest`, the body a write to `computer://<name>` takes. The caller is its owner. |
| `x-ahpd/computers/start` | `{ name }` | `computer:put` | Writes `running` to its state. |
| `x-ahpd/computers/stop` | `{ name }` | `computer:put` | Writes `stopped` to its state. |
| `x-ahpd/computers/restart` | `{ name }` | `computer:put` | Writes `restarted` to its state. |
| `x-ahpd/computers/remove` | `{ name }` | `computer:delete` | Destroys the machine. |

The channel hears what this daemon does to a machine: a command, a write or a delete on `computer:`, a tool, a session's own machine, and a disposable machine's removal. The runtime sends no events, so a machine that is changed outside the daemon, for example with `docker stop`, reaches no channel until the next refresh.

## Security

Read this before exposing the plugin to anyone but yourself.

**Only machines this host made.** Each machine carries a label, and every read and action checks it. Any other container on the same Docker answers `-32008`, the same as a name that does not exist. `computer:write` covers this host's machines, not the Docker daemon.

**Mounts in a manifest are off by default.** A manifest that could name `/:/host` would give root on the host to anyone with `computer:write`. By default a machine sees only the plugin's `mounts` and its profile's, a manifest with `mounts` or a `folder` is refused, and both fields are left out of the create schema. To allow them:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": { "bodyMounts": true } }] }
```

That is reasonable on a single-person host. With it on, `computer:write` is root on the host.

A `devcontainer` source is not gated by `bodyMounts`: the folder names a `devcontainer.json`, and what that file mounts is the CLI's to apply, so a body that may name one is a body that may build a folder's container. It is not a way to mount an arbitrary host path by itself, but `computer:write` with it reaches whatever the named file declares.

**Allowed folders.** By default any folder with a `devcontainer.json` may be built from, on a host where one person signs in. To limit them, name them under `devcontainer`:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": { "devcontainer": { "folders": ["/srv/app", "/srv/site"] } } }] }
```

Each entry is an absolute host path and is compared resolved, so a symlinked or relative way of naming the same folder is the same folder and a folder outside the list is refused with a sentence naming it - on the create body, the `devcontainer://<folder>` setting, the picker's row and the relay's `connect` alike, so the allowlist cannot be stepped around by choosing a different route.
An entry that is not an absolute path is refused when the options are read, because a relative one means something different depending on where the daemon was started.

On a host that has a users directory, the list is required: `ahpd --users` with no `devcontainer.folders` makes no dev container at all, and every route is refused with a sentence naming the option - decision [on a host with a users directory, no dev container is made until `devcontainer.folders` is set](../../.project/decisions/dev-containers-need-allowed-folders-on-a-host-with-users.md). On such a host a `devcontainer.json` that asks for `--privileged`, mounts or run arguments is applied by the CLI as it is, so anybody who holds `computer:write` and may write a file in a folder could otherwise take the host; on a host with one person on it, that person already holds the host. A daemon started without `--users` keeps building from any folder until the list is set, and `devcontainer: false` switches every route off either way.

`devcontainer: false` switches all four off, and no folder is ever built from.

**Allowed images.** By default any image may be used. To limit them:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": { "images": ["docker.io/library/node", "ghcr.io/acme"] } }] }
```

The host's default image and every profile's image are always allowed. Each entry is a scope of the image policy the containers tools read, [containers-policy.json](https://github.com/containers/image/blob/main/docs/containers-policy.json.5.md)'s `docker:` transport: an image is matched by its identity, its repository, each namespace above it, its registry, and each `*.` domain its registry is under, whole names and never string prefixes:

| Scope | Allows | Refuses |
| --- | --- | --- |
| `docker.io/library/node:22` | that image | any other tag |
| `docker.io/library/node` | any tag or digest of `node` | `nodejs/node`, `node-evil/x` |
| `ghcr.io/acme` | anything under `acme`, at any depth | `ghcr.io/acme-evil/x` |
| `ghcr.io` | anything on that registry | anything elsewhere |
| `*.example.com` | anything on a registry under `example.com`, whatever its port | `example.com` itself |

An image is named in its fully expanded form, so `node:22`, `library/node:22`, `docker.io/library/node:22` and `index.docker.io/library/node:22` are the one image `docker.io/library/node:22`, and an image with no tag is its `latest`. A scope in another form, such as `node:22`, `docker.io/node` or `ghcr.io/acme/**`, is rejected when the plugin loads. When every entry names one image, the list is published as an `enum` for a picker.

An image starting with `-` is always refused, because Docker would read it as a flag.

**Values reach a machine by name.** Every environment value a machine is given goes to `docker run` and `docker exec` as `-e NAME`, with the value in the environment the `docker` program is spawned with, so the host's process list shows the name and not the value.
`PATH`, `HOME` and every name starting `DOCKER_` are the exception: `docker` reads them itself, so they stay `-e NAME=VALUE` and are never put in the environment `docker` is spawned with, and a secret given under one of those names is visible in `ps`.
A value named from the vault is never given when the machine is made, so `docker inspect` does not hold it; it is passed on each `docker exec` instead, as [Profiles](#profiles) says.
A plain value given to a dev container goes into the Dev Container CLI's `containerEnv`, which the CLI writes into its own `docker run -e NAME=value`, its log and `docker inspect`.
A dev container's `remoteEnv` and its user's probed environment go by name on each `docker exec` too, and the probe kept in `computers.json` holds only what differs from the container's own `Config.Env`.
`computers.json` holds the vault-named needs a machine was made with as secret names, never their values.
A value under the plugin's `needs` or a profile's `needs` answers `<set>` in `ahpd config`, `GET /api/config` and the plugin listing, as an `env` value does; a `{ "$secret": "..." }` reference answers as written, since it is a name and not a value.

**This host's git directory, and a machine's own.** Under `fetch`, the default, a machine is never given a writable path in this host's git directory, and nothing of that directory is mounted in it but the repository's `objects/`, read-only at `/opt/ahpd/host-objects`. What the machine commits into is a git directory of its own in the volume `ahpd-git-<machine>`, whose `objects/info/alternates` names those objects - so the whole of the risk this note is about, a link a machine plants under `logs/`, `refs/`, `objects/` or a worktree entry, which the host's next git command would write through, is a link in a volume this host's git never opens. Before such a machine is made its host git directory is read: a symbolic link under its root, or in `logs/`, `refs/`, `objects/` or the session's own worktree entry, refuses the machine and names each link and what it points at, because git writes no link in any of those places and one there is planted or a person's. Nothing is removed: a person should see it before it goes. A host repository whose `objects/info/alternates` names anything is refused a machine too, since those paths are not mounted and the machine's git would fail on the first object it could not read. A hook path inside the worktree itself, such as `.husky`, is files the agent may edit under every guard, so review hook changes like any other. `gitGuard: "open"` is the one guard that mounts this host's git directory writable in a machine, at its own path beside a worktree, and there the machine can move a branch and commit in the worktree as a person in it could - and can equally plant a link the host's git follows, which is the risk an operator takes by asking for it. The link refusal above is asked of a `fetch` machine and not of an `open` one.

**Review a session's changes before running git on them.** An agent can write a gitlink and a nested `.git` with its own config inside the worktree, and a git command that recurses into submodules reads that config and runs what it names, such as `core.fsmonitor`. Every git command ahpd itself runs on the host passes `-c core.fsmonitor= -c submodule.recurse=false`, and `--ignore-submodules` where the subcommand takes it, so the daemon's own status, diffs and commits do not. Your own `git` in that worktree has none of this, so look at what the session changed, nested `.git` directories and `.gitmodules` among it, before you run git there yourself.

**A profile may give its machines a kernel of their own.** `ociRuntime: "runsc"` starts a machine under gVisor, which answers the machine's system calls in user space. A syscall that would exploit this host's kernel meets the sandbox instead. Without it a machine runs under Docker's default runtime and shares this host's kernel, as every container does. The option is the operator's, and see [Profiles](#profiles) for how a profile names it.

**What a machine is not.** The container separates processes and the filesystem, not the network, and a bind mount is the host's files. Nothing in a machine survives `resourceDelete`.

## Parts

Every agent CLI is a **part**: one image that holds one CLI at one exact version, at `/opt/ahpd/<id>`, with its launchers at `/opt/ahpd/<id>/bin`. `codex` is a part, `goose` is a part, and so is `node`, which the npm parts name as a requirement so one Node serves them all. `claude` holds both Claude Code and its ACP adapter, and `ahpd` holds ahpd with the backends that run nested. Parts are the default way an agent's CLI reaches a machine: nothing of this host's binaries is mounted unless an agent's options ask for it.

The versions file is `packages/computer/images/versions.json`, and it is the only place a version is written down. Each entry names an `id`, a `version` that is one exact version, `major.minor.patch` with a prerelease and nothing more, as VS Code pins an agent SDK, and a `kind`:

| Kind | Is | Holds |
| --- | --- | --- |
| `node` | The Node every npm part needs | One download per platform |
| `npm` | A CLI published to npm | `packages`, installed onto the node part, each at the part's `version` or at its own when written `<package>@<version>` |
| `archive` | A CLI published as a tarball | `archives`, one url and sha256 per platform, and any `packages` installed onto the node part beside it, each written `<package>@<version>` |
| `ahpd` | ahpd itself | From npm, or from a checkout's own tarballs |

A part is built the first time it is asked for and never again for that version: the tag is the version, so `ahpd-part/codex:2.1.1` that is already there is answered from the daemon rather than rebuilt. A package pinned at its own version adds that version to the tag, so `ahpd-part/claude:0.85.1-2.1.291` moves when either moves. A short hash of the Dockerfile that writes the image is in the tag after them, so an ahpd upgrade that changes how an image is written is a different image at the same versions and the part is built again. A part whose build fails is refused by name and every other part still builds.

### Parts in a machine

A machine asks for a part two ways: its profile's `parts`, and an agent's part need, `{ "part": "codex" }`, in what its `machine()` answers. A profile's or the plugin option's `needs` value for that need names another part id, which is how a profile pins another build. Every part asked for is built with the parts it requires before the machine is made, and each lands read-only at `/opt/ahpd/<id>`; the target is never the agent's to choose, and a mount at it is refused as any other shared target.

A part reaches the machine one of two ways:

| Route | When | What Docker is given |
| --- | --- | --- |
| Image | Docker takes an image mount | `--mount type=image,source=ahpd-part/<id>:<version>,image-subpath=opt/ahpd/<id>,target=/opt/ahpd/<id>,readonly` |
| Volume | Docker refuses one, or the option `imageMounts` is `false` | `-v ahpd-part-<id>-<version>:/opt/ahpd/<id>:ro` |

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": { "imageMounts": false } }] }
```

Whether Docker takes an image mount is asked once, on the first machine with a part, by creating and removing a container that mounts that part's own image. A refusal of the mount type is kept for the daemon's life; any other failure, such as the image missing, is asked again for the next machine. Docker 29 prints `WARNING: Image mount is an experimental feature`, which is not a failure.

A part volume is filled once from its image: an empty volume mounted at the part's path by `docker create` is filled by Docker, nothing is started, and a `.ahpd-filled` marker is written into it last. A volume without the marker is a fill that stopped half way, and is removed and filled again. The version is in the volume's name, so a bump makes a new volume and the old one is left for `docker volume prune`.

A dev container gets its parts the same way: an image mount as a `--mount` entry in the override config's `runArgs`, or for a Compose definition an `image` volume of its service, or the volume as a read-only entry in its `mounts`, since the CLI's own `--mount` has no word for read-only.

The machine is labelled `ahpd.parts` with the parts it was made with, as JSON, `[{"id":"codex","version":"2.1.1"}, ...]`, as the dev container tooling writes its structured label, `devcontainer.metadata`, and [VS Code](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostService.ts#L967-L976) reads a container's labels as JSON. A machine an older daemon labelled `<id>@<version>,...` is read by the id before each `@`, as VS Code reads a container's [older folder label](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostService.ts#L977-L981) beside the current one. Its `PATH` has each one's `bin` in front: a Docker machine's is set at `docker run` over the image's own, and a dev container's is put in front of the probed `PATH` every command is given. So a command a preset names is found inside without its path.

A part whose build fails, or whose requirement's build fails, is left out of the machine with one log line naming it and the build's reason, and the machine is made with the rest. A session whose agent needs a part the label does not name is refused with a sentence naming the part, and every other session on the machine runs.

A machine made for one session, a disposable or a `devcontainer://` made when the session starts, is the exception: when a part that session's agent needs fails to build, the machine is not made and the session is refused at create with a sentence naming the part, so no container, volume or `computers.json` entry is left behind. A failed part that session's agent does not need is left out as above.

### The joined image

`ahpd-agents:<hash>` is every part copied into one image, which is what ahpd publishes and what a runtime that cannot mount image parts runs. Its hash folds in the versions file and the ahpd part's own source, so a version that moved is a different image. Build it with:

```sh
node --import ./scripts/dev.mjs scripts/computer.mjs parts --joined
```

A machine made from a profile that names no image runs `debian:bookworm-slim` with its parts mounted, so a fifteen-part build never precedes the first default machine.

### Adding a part

Add the entry to `packages/computer/images/versions.json` and nothing else: the reader refuses a version that is not one exact version, in VS Code's words; an `id`, a `bin` entry or an `updates` variable or value outside the letters, digits, `.`, `_` and `-` VS Code holds a shell token to, since each lands unquoted in a shell line; an `id` an image name cannot be, as the reference grammar's path component is lowercase; an archive with no checksum for a platform, a `requires` naming a part the file does not have, and two parts of one id. A build picks an archive part's download by the `TARGETARCH` BuildKit sets, and a build that sets none is refused rather than given another architecture's. `requires` names the parts this one is built on, and `bin` names the commands it puts on the PATH - for an `npm` part the matching entry in its `node_modules/.bin`, run by the part's Node when it is a script and as it is when the package installed an executable, for an `archive` part whatever the publisher's tarball holds, which the build finds by name and does not assume a layout, or what its own `packages` put in `node_modules/.bin`. An archive part with `packages` requires `node`, and each package names its own version, since the part's is the download's.

The kinds it will not build are named in the error a missing or unknown `kind` gives, rather than guessed at. A CLI that is neither npm nor a tarball needs a kind of its own before the file will accept it.

### Bumps

Bumps come by pull request. `.github/workflows/parts-bump.yml` runs weekly and on demand, compares the file with the ACP registry and with npm, computes each archive's new sha256, and opens one pull request carrying every newer version. A part no feed carries is skipped and named in the log, so it is bumped by hand, as is a package pinned at its own version, such as Claude Code in the `claude` part:

```sh
node scripts/parts-bump.mjs --dry-run
```

### Building ahead

The verb above is `parts`, and it warms every part image before the first session that would otherwise wait for one:

```sh
node --import ./scripts/dev.mjs scripts/computer.mjs parts --all
node --import ./scripts/dev.mjs scripts/computer.mjs parts codex goose
```

It needs the resolver because it runs the plugin's own source. Each line is the tag and whether it was `built` or `was already there`, so running it twice builds nothing.

## The three tools

`request_disposable_computer`, `release_computer` and `run_in_computer` let a model ask for a scratch machine during a session. They are separate from the machine a session runs in, and they follow the same image rules.

They are off until the daemon enables advanced tools:

```json
{ "advancedTools": true }
```

or `--advanced-tools`. The plugin option `tools: false` removes them even then.

## The script

`scripts/computer.mjs` manages one container directly with Docker, without a client. It labels it `ahpd.computer=1`, so it shows up in `computer://` listings.

```sh
node scripts/computer.mjs start --cpus 2 --memory 2g
node scripts/computer.mjs exec -- sh -c 'uname -a'
node scripts/computer.mjs stop
node scripts/computer.mjs rm
```

| | |
| --- | --- |
| `start` | Run it, or start it if stopped |
| `status` | Running or not, image, since when |
| `exec -- <cmd>` | Run a command inside it |
| `stop` | Stop it and keep it |
| `rm` | Remove it |
| `list` | Every computer the script made |
| `parts` | Build the parts ahead of a session (see [Parts](#parts)) |

Options: `--name` (default `ahpd-computer`), `--image` (default `debian:bookworm-slim`), `--cpus`, `--memory`, `--mount`, `--kvm`, `--label`. `--kvm` fails up front if `/dev/kvm` is not readable. `--mount` is passed to Docker as written:

```sh
node scripts/computer.mjs start --mount type=bind,src=/github/ahpd,dst=/work
```

## Trying it from a checkout

A daemon with the computer plugin and the ACP bridge, with the test fixture as the `acp` record:

```sh
mkdir -p /tmp/ahpd-computer-config/ahpd/agents
cat > /tmp/ahpd-computer-config/ahpd/agents/acp.json <<'JSON'
{ "id": "acp", "engine": "acp", "owner": "host", "name": "Test ACP", "config": { "command": "node", "args": ["/srv/acp.mjs"] } }
JSON
cat > /tmp/ahpd-computer.json <<'JSON'
{
  "port": 9216,
  "host": "127.0.0.1",
  "withoutConnectionToken": true,
  "paths": ["/github/ahpd"],
  "plugins": [
    { "name": "./packages/computer/src/index.ts", "options": { "image": "node:22", "bodyMounts": true } },
    { "name": "./packages/agent-acp/src/index.ts" }
  ]
}
JSON
XDG_CONFIG_HOME=/tmp/ahpd-computer-config node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts --config-file /tmp/ahpd-computer.json
```

From a client, write a manifest to `computer://box` with `mounts: ["/github/ahpd/packages/agent-acp/test/fixtures/acp-server.mjs:/srv/acp.mjs:ro"]` and `workdir: "/srv"`, create a session with `config: { "computer": "computer://box" }`, and send a turn. It should answer `chat/turnComplete`. After `resourceDelete` on `computer://box`, `docker ps -a --filter label=ahpd.computer=1` should be empty.
