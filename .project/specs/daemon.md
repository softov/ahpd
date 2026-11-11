---
title: Daemon
status: current
covers:
  - packages/server/src/main.ts
  - packages/server/src/daemon.ts
  - packages/server/src/update.ts
  - packages/server/src/install.ts
  - packages/server/src/wire.ts
  - packages/server/src/pty.ts
  - packages/server/src/commands/**
  - .github/workflows/release.yml
  - .github/workflows/edge.yml
  - .github/workflows/parts-bump.yml
  - packages/computer/images/versions.json
decisions:
  - decisions/ahpd-and-ahpc-share-no-package.md
  - decisions/the-daemon-installs-its-own-sdk-beside-the-plugins.md
refs:
  - "[code://packages/server/src/main.ts#L103-L138](../../packages/server/src/main.ts#L103-L138) - `tokenFor` and `warnCleartext`, the credential of `--remote`"
  - "[code://packages/server/src/main.ts#L186-L205](../../packages/server/src/main.ts#L186-L205) - the hint that names the sub-commands of a group word"
  - "[code://packages/server/src/commands/served.ts#L79-L92](../../packages/server/src/commands/served.ts#L79-L92) - `servedRegistry`, the commands a daemon serves"
  - "[code://packages/server/src/commands/scopes.ts#L1-L45](../../packages/server/src/commands/scopes.ts#L1-L45) - `checkScopes`, the grant check before a command body"
  - "[code://packages/server/src/commands/options.ts#L620-L636](../../packages/server/src/commands/options.ts#L620-L636) - `noPlugins` and `updateCheck`, two boolean flags"
  - "[code://packages/server/src/commands/options.ts#L1133-L1169](../../packages/server/src/commands/options.ts#L1133-L1169) - `secret`, where the connection token comes from"
  - "[code://packages/server/src/daemon.ts#L22-L27](../../packages/server/src/daemon.ts#L22-L27) - `Control`, the control pipe of a Windows daemon"
  - "[code://packages/server/src/daemon.ts#L132-L136](../../packages/server/src/daemon.ts#L132-L136) - `controlFor`, a random pipe name and key"
  - "[code://packages/server/src/daemon.ts#L258-L262](../../packages/server/src/daemon.ts#L258-L262) - `readyUrl`, the connect URL with `?tkn=`"
  - "[code://packages/server/src/daemon.ts#L618](../../packages/server/src/daemon.ts#L618) - `throughPipe`, true on Windows"
  - "[code://packages/server/src/daemon.ts#L716-L740](../../packages/server/src/daemon.ts#L716-L740) - `stop`, which waits and then kills"
  - "[code://packages/server/src/commands/stop.ts#L14-L38](../../packages/server/src/commands/stop.ts#L14-L38) - `ahpd stop`"
  - "[code://packages/server/src/commands/restart.ts#L100](../../packages/server/src/commands/restart.ts#L100) - `busy`, the refusal while a turn runs"
  - "[code://packages/server/src/install.ts#L91-L108](../../packages/server/src/install.ts#L91-L108) - `launch` and `run`, npm as node and `npm-cli.js` on Windows"
  - "[code://packages/server/src/update.ts#L48-L56](../../packages/server/src/update.ts#L48-L56) - `newer`, the version comparison"
  - "[code://packages/server/src/update.ts#L122-L156](../../packages/server/src/update.ts#L122-L156) - `refreshUpdate`, `checkingUpdates` and `updateLine`"
  - "[code://packages/server/src/commands/run.ts#L1144-L1148](../../packages/server/src/commands/run.ts#L1144-L1148) - the update refresh at start and every six hours"
  - "[code://packages/server/src/wire.ts#L47-L73](../../packages/server/src/wire.ts#L47-L73) - `lineFor` and the capture limits"
  - "[code://packages/server/src/pty.ts#L140-L156](../../packages/server/src/pty.ts#L140-L156) - `pty`, the terminal binding: Bun's own on Bun, `node-pty` elsewhere"
  - "[code://.github/workflows/release.yml#L19](../../.github/workflows/release.yml#L19) - `PUBLISHED`, the packages a release publishes"
  - "[code://.github/workflows/release.yml#L58-L67](../../.github/workflows/release.yml#L58-L67) - the check that the tag and every version agree"
  - "[code://.github/workflows/release.yml#L130-L160](../../.github/workflows/release.yml#L130-L160) - the stage step"
  - "[code://packages/computer/src/parts.ts#L194-L215](../../packages/computer/src/parts.ts#L194-L215) - the image tag, with a hash of the Dockerfile"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-daemon-flag-is-declared-by-what-it-turns-on, ahpd-commands-are-declared-with-cofold-commands, ahpd-refuses-strictly-and-names-the-sub-commands, ahpd-stop-waits-for-the-daemon-to-exit, an-untyped-flag-stays-absent-in-cofold-input, connect-url-lives-in-the-record, remote-needs-a-token, remote-reads-its-token-from-a-file-too, remote-warns-when-its-token-travels-in-cleartext, the-traffic-log-is-the-wire-capture-in-vs-codes-shape, windows-reaches-a-daemon-through-a-named-pipe, windows-runs-npm-as-node-and-npm-cli, release-versions-move-together, the-computer-is-not-published-yet, the-whole-workspace-is-published, update-check-compares-versions-by-hand, update-check-fails-silently, update-check-is-a-file-refreshed-in-the-background, update-check-reads-dist-tags, an-agent-cli-is-pinned-in-one-versions-file
---

The daemon is the `ahpd` binary in `packages/server`.
Its verbs and flags are declared once with `@cofold/commands` and run at the terminal through `@cofold/terminal`.
The same declarations are served over HTTP, as [HTTP API and proxy](http-api-and-proxy.md) says, and each command names the grant pairs it needs.
A detached daemon keeps a record, `daemon.json`, in the config folder, so that `stop`, `restart` and `status` can find it.
The daemon also checks npm for a newer release in the background, and can write a capture of its traffic.
The code is in [`code://packages/server/src/main.ts`](../../packages/server/src/main.ts), [`code://packages/server/src/daemon.ts`](../../packages/server/src/daemon.ts) and the files under `commands/`.

## Scenarios

### A command checks its grants

WHEN a command arrives over HTTP
THEN `checkScopes` holds the caller to the grant pairs the command declares
AND a command marked for the deployment alone refuses every person, whatever their grants.

WHEN the same command runs at the terminal
THEN no grant is checked.
The reason: the process owner already holds the files and the process.

### A group word without a sub-command

WHEN a person types a group word such as `ahpd plugin` with no known sub-command
THEN ahpd writes `plugin takes list, install or ...` on stderr
AND exits with the code of a usage error.
The list comes from the visible commands, so it names what exists.

WHEN a line has no verb at all
THEN ahpd runs the daemon in the foreground, as `ahpd run`.

### A boolean flag names what it turns on

WHEN a person passes `--no-update-check`
THEN `updateCheck` is false.

WHEN no flag, file key or environment variable turns the check off
THEN `updateCheck` is true.
The field carries no default, and `optionsFrom` applies the default after the file is folded in.
This is so that a flag that is absent does not hide the value in the file.

### A detached daemon writes its record

WHEN `ahpd start` starts a daemon in the background
THEN the daemon writes `daemon.json` at mode 0600 in the config folder
AND the record holds a `connectUrl` with the token as `?tkn=`.
The reason: stdout is a log, so the startup lines name where the token came from and never show the token.

### A stop waits for the daemon to exit

WHEN a person runs `ahpd stop`
THEN ahpd asks the daemon to stop and waits up to 30 seconds
AND prints `Stopped <url> (pid N).` when the process is gone.

WHEN the daemon is still running after 30 seconds
THEN ahpd kills it and says it did not stop within 30 seconds.
The record is removed only when the process is gone.

WHEN no daemon is running
THEN `ahpd stop` answers `None running.` as a conflict.

### A restart waits for the turns

WHEN a person runs `ahpd restart` while a turn runs
THEN ahpd refuses and names the sessions with a running turn
AND tells the person to pass `--force`.

WHEN the person passes `--force`
THEN the daemon restarts even with a turn running.
On Linux and macOS a restart is the signal `SIGHUP`, and a forced restart is `SIGUSR2`.

### A container holds the daemon

WHEN the daemon starts with `AHPD_SERVICE=container`
THEN it writes its own record with `service: container`
AND `ahpd status` and a client find it.

WHEN a client or `ahpd restart` restarts it
THEN the daemon closes, removes its record and exits with 75
AND the container's restart policy starts it again.

WHEN a person runs `ahpd stop` or `ahpd update` in the container
THEN ahpd refuses and says to stop the container, or to pull the new image.
The reason: the restart policy starts again any daemon that exits, and the image owns the files an update would replace.

### Windows reaches a daemon through a pipe

WHEN a daemon runs on Windows
THEN its record holds a named pipe `\\.\pipe\ahpd-<random>` and a random 32-byte key
AND `stop` and `restart` send a JSON line with the key and the signal name through that pipe.
The reason: Windows cannot send `SIGHUP` or `SIGUSR2`, and its `SIGTERM` is a hard kill.

### npm runs as the daemon's node

WHEN the daemon runs npm
THEN it runs its own `node` with `npm-cli.js`, from `npm_execpath` or from beside node.
AND beside node is `node_modules/npm/bin` on Windows and `../lib/node_modules/npm/bin` on other platforms.

WHEN neither path holds `npm-cli.js`, or the daemon runs under a program that is not node
THEN on Windows it runs npm through the shell, with each argument in double quotes.
AND on other platforms it runs `npm` from the `PATH`, with no shell.

### A remote command needs a token

WHEN a person passes `--remote <url>`
THEN ahpd loads the command list from `<url>/api/cli-manifest` and runs the command over HTTP
AND it takes the token from `--token`, `--token-file` or `AHPD_TOKEN`, in that order.

WHEN the person passes both `--token` and `--token-file`
THEN ahpd refuses with exit code 2.

WHEN no token comes from any of the three
THEN ahpd refuses with exit code 2 before it sends a request.
The reason: every daemon that serves the API asks for a credential.

### A remote token over cleartext

WHEN the remote URL is `http://` and not on this machine
THEN ahpd writes on stderr that the token travels in cleartext
AND it still sends the request.

### The update check

WHEN the daemon starts with the check on
THEN it asks the npm registry for the package's `dist-tags` when `update.json` is older than six hours
AND it asks again every six hours.

WHEN the registry answers with a 2xx status and a string `latest`
THEN the daemon writes `update.json`.

WHEN the request fails, times out after five seconds or has no `latest`
THEN the daemon writes nothing and says nothing.

WHEN `run`, `start` or `status` prints its lines
THEN it reads only the file and adds `update: <name> <latest> is on npm, this is <version>` when `latest` is newer.
The comparison is written by hand, because one comparison does not earn a dependency.
A prerelease is older than its own release, and a version that does not parse is never behind.

### The update check is off

WHEN a person passes `--no-update-check`, writes `"updateCheck": false`, or sets `NO_UPDATE_NOTIFIER` or `CI`
THEN the daemon does not ask npm and prints no update line.

### The traffic log

WHEN a person passes `--wire <file>`
THEN the daemon writes each frame as one JSON line, with an `_ahpLog` field in the shape of VS Code's capture
AND the field holds the time, `c2s` or `s2c`, the connection, the transport and the byte length.

WHEN a frame is not a JSON object
THEN the line keeps the text whole under `_raw`.

WHEN a file reaches 75 MiB
THEN the daemon rolls it aside and keeps five files, each at mode 0600.
A line longer than 1 MiB is written again with each string cut to 16 KiB.

### A release

WHEN a `v*` tag is pushed
THEN the release workflow checks that the tag equals the version of every package in `PUBLISHED`
AND it stages each package version that npm does not hold yet.
`PUBLISHED` holds eleven packages, `@ahpd/computer` included, and they all move to one version together.

WHEN the checks of a `v*` tag pass
THEN the workflow pushes `ghcr.io/<owner>/ahpd` for `linux/amd64` and `linux/arm64`, before npm is approved
AND the tags are the version and its channel, `latest` or `next`, with `X.Y` and `X` on a stable version.
The default `AHPD_TAG` in `docker/compose.yaml` must name that image, or the tag check fails.

WHEN a package has never been published
THEN the workflow warns that it needs one publish with a token and a trusted publisher
AND the run is red.

### Agent CLIs are pinned

WHEN the image of a part is built
THEN the agent CLI or runtime comes from `packages/computer/images/versions.json`, with an exact version and a sha256 for each archive
AND the image tag carries the version and a hash of the Dockerfile.
A part can name environment variables in `updates`, which turn off the CLI's own self-update.
A weekly workflow proposes a pull request when a part has a newer release.

### A terminal is a pseudoterminal where the runtime has one

WHEN the daemon starts on a Bun that makes a terminal
THEN its terminals run under Bun's own pseudoterminal, the `terminal` option of `Bun.spawn`
AND `node-pty` is neither probed nor loaded.
The reason: on Bun, `node-pty` loads and every shell it starts dies at once.
`Bun.Terminal` came with Bun 1.3.5, and on Windows it makes a ConPTY from Bun 1.3.14.
The daemon makes one terminal and closes it at start, to see that Bun can.

WHEN a terminal on Bun on Windows runs `cmd.exe` with a line
THEN the line is the command line after the file, written as it is
AND `kill` takes no signal and ends the process, as `node-pty` does on Windows.

WHEN a terminal's process exits on Bun
THEN its exit is said once `exited` resolves, after its whole output
AND its terminal is closed, and input after that is dropped.

WHEN it starts on a Bun without `Bun.Terminal`, or on a Bun that cannot make one, such as Bun 1.3.13 on Windows
THEN its terminals run on pipes and say `isPty: false`.

WHEN it starts on Node or Deno
THEN its terminals run under `node-pty` where a child of the same runtime survives loading it, and on pipes otherwise.
