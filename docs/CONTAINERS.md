# A session in a dev container

A workspace with a `devcontainer.json` can run its session inside the container that file defines, with a whole agent host inside it and this host carrying the frames between the client and that host.
The reference client's own dev container flow drives it, so VS Code needs no extension for it and neither does anything else that speaks the same four methods.

## One computer, two recipes

A dev container is a computer.
One object, `computer://<id>`, can be made two ways - a *recipe*:

| Recipe | Where the container comes from | What runs inside |
| --- | --- | --- |
| a folder | the folder's own `devcontainer.json`, read by the Dev Container CLI | either the backend's process through `devcontainer exec`, or a whole `ahpd` reached through the relay |
| a profile | a manifest a person writes: image, mounts, working directory | the backend's process through the `computers` port, or a nested host |

Which recipe a computer is is written on the container itself: every computer carries `ahpd.computer=1`, and one made from a folder also carries `ahpd.devcontainer.folder=<folder>`.
That second label is what says a machine is reached through `devcontainer exec` rather than `docker exec`, and it is what the picker reads to know a folder already has a computer.
A container made by hand with `devcontainer up` and without those labels is not a computer: it is not listed, and no session here reaches it.

A computer made from a folder is listed, picked and reached like any other.
It survives the connection and the client that made it: a relay that ends or a socket that drops stops the host inside, and the container stays where the CLI can reuse it.
Removing the computer - `resourceDelete` on `computer://<id>`, or the `release_computer` tool - removes the container; it does not touch the folder or its `devcontainer.json`.

Use a profile when one backend should be moved and the deployment should decide the image.
Use a folder when the repository already says what its environment is and everything about the session should be inside it.
The decisions are [a computer is an object a person manages](../.project/decisions/the-computer-is-an-object-a-person-manages.md) and [a dev container is a computer, made from its devcontainer.json](../.project/decisions/a-dev-container-is-a-computer-made-from-its-devcontainer-json.md).

## Asking for one

A create body names the folder instead of an image:

```json
{ "devcontainer": { "folder": "/path/to/repo" } }
```

The two are exclusive, and a folder that is not there or has no `.devcontainer/devcontainer.json` or `.devcontainer.json` is refused before the CLI runs.
The create form a client draws from the host's manifest offers no such field: the manifest is a flat set of properties and this source is not one of them, so a body written by hand or by a client that knows the field is the route.

A session may also name the source:

```json
{ "method": "createSession", "params": { "channel": "ahp-session:/work", "provider": "acp", "config": { "computer": "devcontainer:///path/to/repo" } } }
```

The picker offers that row for the session's own folder, when the folder has a `devcontainer.json` and no computer is labelled with it.
The machine is made when the session starts, with the session agent's `machine()` needs as `--mount` and `--remote-env`, and what the session runs in is then the ordinary `computer://<id>`.
Once the computer exists the picker offers its `computer://` row and the source row is gone, so nothing makes a second container for one folder.

## What the host needs

Docker, and the Dev Container CLI (`@devcontainers/cli`, whose program is `devcontainer`).
Both are checked by asking each program for its version, and `_meta['vscode.devContainers']` is `true` only when both answer.
A host without the CLI advertises nothing, so a client never offers the flow against it: that is why the key is a probe and not a setting.

The launcher is contributed by the computer plugin, whose `devcontainer` option names the CLI and can switch the whole thing off:

```json
{ "name": "@ahpd/computer", "options": { "devcontainer": { "command": "npx", "args": ["-y", "-p", "@devcontainers/cli", "devcontainer"] } } }
```

The same option is the CLI a computer is made with, so the `up` and `exec` behind a session and the `up` and `exec` behind a relay are one program.

Anything else under that key is a deployment fact.
`host` is the program that runs inside the container, and it defaults to `ahpd`, the command the install step provides.
`install` is how that step runs: a shell command, or `false` to skip it along with the probe, for an operator whose image already has a host or whose `host` names something else.
`plugins` is what the host inside loads, and it is the one option with no useful default.
The host in there is an `ahpd` of the same build, and this one bundles no backend either, so a list with nothing in it is a process that exits on startup.
`available()` answers false on an empty list, so a client is never offered a flow that could only fail, and the reason is on the log because a list nobody filled in is a configuration somebody can fix.
`connect` refuses it too, before `devcontainer up` runs, for an embedder that never asked.

It is not defaulted to this daemon's own list.
These specs are resolved *inside* the container, where this host's configuration directory does not exist and a relative path means a different tree, so what runs in there is a deployment fact and the deployment says it.

This is also the whole of cofold's answer.
`@ahpd/agent-cofold` runs its loop, its tools and its files in the host's own process and cannot be moved into a machine, so it refuses a session that names one.
Naming it here is different: the *host* is what is inside the container, and cofold runs in there because it is part of it.

```json
{ "name": "@ahpd/computer", "options": { "devcontainer": { "plugins": ["@ahpd/agent-cofold"] } } }
```

**The install step puts a host and its backends in the container.**
It runs `npm i -g @ahpd/server`, then `plugin install --no-enable` with the `host` command for every entry of `plugins` that is a package name and is not already in the container's `~/.config/ahpd/node_modules`.
The nested host resolves a bare name from there and nowhere else, so `"plugins": ["@ahpd/agent-cofold"]` starts, and an image built with its backends in place starts without the registry.

An entry that is a path or carries a scheme of its own is not installed: it is used as written inside the container.
A mounted checkout is the usual case:

```json
{ "name": "@ahpd/computer",
  "options": { "devcontainer": {
    "host": ["node", "/workspaces/ahpd/packages/server/dist/main.js"],
    "install": false,
    "plugins": ["/workspaces/ahpd/packages/agent-cofold"]
  } } }
```

The paths are the container's view of the mount, and the Dev Container CLI mounts a repository's root, so this works when the folder a person picks is anywhere inside that checkout.
`install: false` skips the server and the plugins together, for an image that is already complete.

## The surface

Four methods, all in the reference client's own names, and four notifications back.
A client that does not know `_meta['vscode.devContainers']` ignores all of it, and nothing else on this host changes.

| method | | needs |
| --- | --- | --- |
| `vscode/devContainers/isDockerAvailable` | whether Docker can be resolved | nothing |
| `vscode/devContainers/connect` | `{ connectionId, workspaceFolder, name }`, answered with `{ connectionId, address, name, remoteWorkspaceFolder, hostWorkspaceFolder? }` | `container:write` |
| `vscode/devContainers/relaySend` | `{ connectionId, data }`: one frame, written to the host inside | `container:write` |
| `vscode/devContainers/disconnect` | `{ connectionId }`: end the relay | `container:write` |

| notification | |
| --- | --- |
| `vscode/devContainers/relayMessage` | `{ connectionId, data }`: one frame from the host inside |
| `vscode/devContainers/output` | `{ connectionId, data }`: the CLI's and the container's own output, which is what a person watches while an image builds |
| `vscode/devContainers/relayClose` | `{ connectionId }`: the relay ended, and it was not this client that ended it |
| `vscode/devContainers/closeConnection` | `{ connectionId }`: the connection is gone; forget it |

`connectionId` is the client's own name for the connection and is namespaced per connection: nothing one client can spell reaches another's container, and a socket that drops stops the relays it opened.
`address` is `devcontainer:<containerId>`, which is a name a client shows and stores rather than something it can dial.
The names are the reference client's on purpose - decision [the dev container surface is the reference client's own](../.project/decisions/the-relay-surface-is-the-reference-one.md).
The grant is `container:write` and not `computer:write`, because the parameters name a workspace folder rather than a `computer://` URI, and starting a container is this host's Docker access by proxy - decision [connecting to a dev container needs a grant of its own](../.project/decisions/connecting-to-a-dev-container-needs-a-grant.md).

## How the host inside runs

1. The folder must be a dev container: `.devcontainer/devcontainer.json` or `.devcontainer.json`, refused with a sentence naming the folder if neither is there.
2. A computer already labelled with the folder is reused.
   When there is none, `devcontainer up --log-level debug --workspace-folder <dir> --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=<dir>` makes it, and the CLI's own JSON is read off whichever line carries it - the CLI logs as it works, so the result is one line among several.
   The labels are the CLI's own way of finding a container, so the `up` and the `exec` below reach the folder's own container rather than a second one.
3. Inside, `command -v <host[0]>` decides whether the image already has a host.
   A container without one gets `npm i -g @ahpd/server@<this version>`, so the two hosts are the same build.
   Whether or not that line ran, every `plugins` entry that is a package name and is not already in the container's configuration directory is put there with `<host> plugin install --no-enable`, because a bare name resolves from that directory and nowhere else.
4. The nested host's configuration is written to a temporary file with its mode set to 600, through a shell command built from base64 and a name nothing chose.
   No credential goes in it: the relayed client signs in to the host inside, which is where a token for the container's models belongs.
5. The host is started as `ahpd --stdio --path <remoteWorkspaceFolder> --config-file <that file>`, and the CLI's exec carries this process's pipes into the container.
   Nothing listens in there, so the only way to reach that host is through this one - decision [the nested host speaks AHP over stdio](../.project/decisions/a-nested-host-speaks-stdio.md).
6. A line the host writes that is JSON is a frame and becomes `relayMessage`; a line that is not is the CLI talking and becomes `output`.

The same container is what a session reaches: `how()` for a dev container computer answers `devcontainer exec --workspace-folder <folder> --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=<folder> <command>` with the folder read from the container's own label, so the backend runs as the config's `remoteUser` with the file's environment.

## `ahpd --stdio`

The transport the step above needs, and the second one this daemon has: one frame per line of JSON on stdin and stdout, and no port.
The connection is admitted as the host itself, because the process that started it holds the only handle to its pipes - and the outer host's grant is what decided whether it may exist.
`ahpd start --stdio` is refused: a detached process has no pipe to answer on.

## Trying it by hand

```sh
mkdir -p /tmp/devc-work/.devcontainer
printf '%s\n' '{ "image": "node:22" }' > /tmp/devc-work/.devcontainer/devcontainer.json

cd /github/ahpd
node --conditions development --import ./scripts/dev.mjs \
  packages/server/src/main.ts --config-file /tmp/ahpd-devc.json
```

with a configuration naming the computer plugin and an open door:

```json
{
  "port": 9216,
  "host": "127.0.0.1",
  "withoutConnectionToken": true,
  "sessions": "memory",
  "automations": "memory",
  "plugins": [
    { "name": "./packages/computer/src/index.ts", "options": { "devcontainer": {
      "command": "npx", "args": ["-y", "@devcontainers/cli"],
      "plugins": ["@ahpd/agent-cofold"]
    } } }
  ]
}
```

Then, from a client that serves the four methods: `connect` with `{ "connectionId": "box", "workspaceFolder": "/tmp/devc-work", "name": "Box" }`, followed by `relaySend` carrying an `initialize` and a `ping`.
The same folder may also be reached as a computer, by writing `{"devcontainer": {"folder": "/tmp/devc-work"}}` to `computer://box` or by starting a session with `"computer": "devcontainer:///tmp/devc-work"`.
What was seen with the relay on 2026-09-24 is in the plan's [implemented.md](../.project/plans/container/01-a-session-in-a-dev-container/implemented.md): the CLI made the container, the host was installed into it, and the frames came back.

## What this is not

- **Not a security boundary.** The container is separate from this host's process, not from the network, and a bind mount is this host's files by definition. The isolation is what `devcontainer.json` asks for, which is why this reads that file instead of building a container of its own.
- **Not a container this host destroys on its own.** The container is the CLI's and the workspace's, and a relay that ends or a socket that drops kills the host inside and leaves it where the CLI can reuse it. Destroying the computer destroys the container, and never the folder.
- **Not a host with its own users.** The nested host has no directory unless the configuration handed to it has one, so it refuses nothing of its own: a client reaches it because this host's `container:write` said it may. A deployment that wants the inner host to check for itself writes a directory into that configuration.
