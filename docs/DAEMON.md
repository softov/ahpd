# Running the daemon

`@ahpd/server` is `@ahpd/sdk` with every port wired in, plus argv, a
configuration file and a pid file. Every verb and every flag is one declaration
under [packages/server/src/commands](../packages/server/src/commands), and
[packages/server/src/main.ts](../packages/server/src/main.ts) is the
`@cofold/terminal` program those declarations are rendered by: help, shell
completion, `--json` and the exit codes all come from the one place a command
is written.

It installs the `ahpd` command:

```bash
npm i -g @ahpd/server
```

npm 12 blocks install scripts unless told otherwise, and `node-pty` needs its script on Linux to build the terminal binding. Without it the daemon still runs, but terminals fall back to pipes (`isPty: false`). Add `--allow-scripts=node-pty` to the install, or run `npm config set allow-scripts=node-pty --location=user` once.

From a checkout instead, `ahpd` below means `node packages/server/dist/main.js`
after `pnpm install && pnpm build`.

## It has no backend of its own

The daemon bundles no agent. Every backend it serves is a plugin's,
`@ahpd/agent-claude` included, so a daemon started with no plugin configured
has nothing to run and says so:

```
No backend is loaded, so this host could serve nothing. Run ahpd plugin install @ahpd/agent-claude to install Claude Code and add it to "plugins" in /home/me/.config/ahpd/config.json, or run npm i in /home/me/.config/ahpd and add the package to "plugins" yourself.
```

A daemon started with `--config-file` names that file, and the command carries
the same `--config-file` so the plugin is added where that daemon reads it.

A configuration written for 0.6 names no plugin, because 0.6 had Claude built
in. After upgrading from it, run `ahpd plugin install @ahpd/agent-claude` once.

Installing one is one command, because a bare name is resolved from the
configuration directory and nowhere else:

```bash
npm i -g @ahpd/server
ahpd plugin install @ahpd/agent-claude
```

`ahpd plugin install` runs `npm install` in the configuration directory and
adds the name to `plugins` in `config.json`, so the next run loads it. Before
npm runs, it refuses a registry package whose `package.json` has no `"ahpd"`
field. A plugin installed with `npm i -g` is invisible to that resolution.
`--no-enable` installs without naming it, `--keep` on `remove` drops the name
without uninstalling the package, and `--config-file` edits another file than
the default one.

Every plugin takes `@ahpd/sdk` as a peer, and states the oldest one it needs,
such as `>=0.8`. ahpd installs the daemon's own `@ahpd/sdk` beside the plugins
with every install and update, and asks npm to check no peer, so one plugin
never blocks installing or updating another. Whether a plugin fits is asked when
the daemon loads it: one whose range leaves out the daemon's `@ahpd/sdk`, such
as a plugin for an older minor that says `^0.7`, is refused with its range and
the daemon's version, and the others load. An upgrade is the daemon, then its
plugins, then a restart:

```bash
npm i -g @ahpd/server
ahpd plugin update all
ahpd restart
```

`ahpd plugin update all` runs one `npm install` in the configuration directory
naming every package installed there from the npm registry: each `@ahpd/*` one
at the daemon's version, any other at `latest`. `ahpd plugin update <name>...`
moves only the packages named, each of which must be installed there. One
installed from a path, a link, git or a URL is left as it is. It says each move,
or `Nothing to update.` when no version moved, and leaves `config.json` as it
is. `@ahpd/sdk` is not a plugin, so `install` and `update` refuse it by name.

`ahpd config` prints the directory if it is somewhere else, which it is when
`XDG_CONFIG_HOME` says so. A path in `plugins` is resolved instead against the
working directory and then that same place, so a checkout can be named without
installing anything.

Then name it, either for this run or for every run:

```bash
ahpd --plugin @ahpd/agent-claude
```

```json
{
  "plugins": ["@ahpd/agent-claude"]
}
```

`ahpd plugin install` already wrote that second form; the flag is for a run
that should not wait for a restart.

`@ahpd/agent-claude` takes no options in the ordinary install: it catalogues
whatever directories the daemon was started on. What it does take is in
[PLUGINS.md](PLUGINS.md), beside the other backends.

## `ahpd configure`

The install is two commands, and the second one is asked for rather than typed:

```bash
npm i -g @ahpd/server
ahpd configure
```

It asks at the terminal which backends to serve (Claude, cofold, pi), the host
to bind, the port, the connection token and which folders to serve, in that
order. Every question shows what the configuration holds now, so Enter keeps it
and a second run edits what is there rather than replacing it:

```
Claude? [Y/n]:
cofold? [y/N]: n
pi? [y/N]: n
Host [127.0.0.1]:
Port [9187]:
Connection token [generate one in /home/me/.config/ahpd/connection-token]:
Serve /work/project? [Y/n]:
```

A backend answered Yes that the file does not already name is installed into
the configuration directory, which is where a bare name is resolved from, and
named in `plugins` afterwards. Answered No on one the file does already name, it
is switched off with `enabled: false` and its options kept, exactly as
`ahpd plugin disable` writes it. The token goes in a file of its own beside the
configuration, written `0600`, and `"connectionTokenFile"` names it; type a token
instead to write one you already have. A token already written as a literal
`connectionToken` is a token clients are presenting, so Enter keeps it and moves
it into that file rather than generating over it. A folder answered No is left
out of `"paths"`, and a key this command was not asked about is left where it
is. Answering No to every folder is refused rather than written, because an
empty `paths` serves the current folder anyway.

Started at a terminal with no `config.json` at all, `ahpd` and `ahpd start` ask
whether to run it first:

```
No configuration. Run ahpd configure now? [Y/n]:
```

Answering no starts as a daemon with no backend did before the offer existed,
which is the refusal at the top of this page. Nothing is asked without a
terminal, so a script, a container and `ahpd start` from a supervisor carry on
to that refusal rather than block on a prompt nobody can see.

## Commands

```
ahpd [options]              run it here, in this terminal
ahpd start [options]        run it in the background and let go of it
ahpd stop                   stop the one running in the background
ahpd restart                stop it and start it again with the same line;
                            --force restarts while a turn is running
ahpd status                 say whether one is, and where
ahpd config                 say where the configuration is, and what it says
ahpd configure              ask at the terminal for each setting a first install
                            needs, and write them
ahpd plugin list            what the configuration names, and what a run would
                            load, without loading any of it
ahpd plugin install <name>  install a plugin into the configuration directory
                            and name it there. --no-enable installs without
                            naming it, --config-file edits another file
ahpd plugin remove <name>   drop it from the configuration and uninstall it,
                            unless --keep
ahpd plugin update all      move every installed plugin to the daemon's
                            version, in one npm call
ahpd plugin update <name>   move only the plugins named
ahpd plugin config <name>   show a plugin's options
ahpd plugin config <name> <key> <value>
                            set one of them
ahpd plugin config unset <name> <key>
                            take one of them away
ahpd plugin enable <name>   turn a configured plugin on
ahpd plugin disable <name>  turn it off, keeping its entry and options
ahpd user list              who is in the user file
ahpd user add <id>          add a person, with --role and --issuer
ahpd user token <id>        mint their credential, shown once; --url prints
                            the whole ws:// URL a client can be given
ahpd user rm <id>           take a person out of it
ahpd vault set <name>       keep a value under a name, read from standard
                            input: cat secret.txt | ahpd vault set host:x
ahpd vault delete <name>    take a name out of the vault
ahpd vault list             every name this host keeps a secret under, and
                            whether each is set. No value is ever printed
ahpd completion <shell>     print the completion script: bash, zsh or fish
```

`ahpd [options]` with no verb is the foreground daemon, and it is the same
declaration `ahpd start` renders. Every command and every flag can be read
without a daemon running:

```bash
ahpd --help              # every command, then the foreground run's flags
ahpd plugin --help       # only what follows `plugin`
ahpd user add --help     # the flags one sub-command takes
```

A removal asks before it runs: `user rm`, `team rm`, `project rm`, `plugin remove` and `vault delete` say what they would take out - `user rm removes user bob` - and wait for an answer at the terminal.
A script with no terminal there is refused with the same words and exit 2 until it passes `--yes`, which runs the removal without the question.

### `ahpd restart`

`ahpd restart` restarts the daemon `ahpd start` started, with the arguments it was started with, so a change that waits for a restart can be applied without retyping them.
Sessions come back from the store. A daemon on a fixed port comes back on the same URL; one started with `--port 0` gets a new port, and its record says which.

```bash
ahpd restart            # refused while a turn is running, naming the sessions
ahpd restart --force    # restart anyway
```

The terminal sends the recorded process a signal, `SIGHUP` for a restart and `SIGUSR2` for a forced one, and the daemon decides: it refuses while a turn is running unless forced, and otherwise starts its successor and exits.
Its answer is in `daemon.log`, which the command reads, printing the new pid and URL, the refusal, or why no successor started.
The daemon writes `restart: stopping (SIGHUP)`, or `(SIGUSR2)`, once it has read its recorded arguments and token and begins to stop, and each refusal names the signal it answers, so a terminal reads only the answer to its own kind of signal; a signal names no sender, so two terminals sending the same one share an answer.
The command waits five seconds for that line, and says when it gave up that the daemon may still take the signal; a signal that could not be sent, to a pid that is gone, is refused with words.
After the line it waits for as long as the old daemon is still stopping, since a plugin's `stopping` handler has no time limit, and gives the successor 25 seconds from the line the daemon writes when it starts it, five more than the daemon itself waits.
Before anything goes down, the daemon reads its recorded arguments over the configuration as it is now, and the connection token they give; when either cannot be read, such as a `config.json` that is no longer JSON or a `connectionTokenFile` that is gone, the restart is refused with why and the daemon runs on.
It then asks the code that would run those arguments whether it takes them at all: the entry a successor is started from, as the install has it now, is run once with the recorded arguments and `AHPD_CHECK_LINE` in its environment, and reads them strictly, refusing a flag this ahpd no longer declares where the daemon holding the line guesses at one.
A check that fails refuses the restart with the successor's own words, so a line written by an older ahpd, or by a newer one whose flags changed, leaves the daemon that holds it running rather than stopping it and leaving none.
The check is one process that reads the line and the configuration and exits, and a restart is rare enough to pay for it.
The successor is handed that token, so a changed `connectionToken` or `connectionTokenFile` is the one its connect URL carries.
It also inherits the environment and the working directory of the daemon it replaces, as any process started by it does, so a variable or a directory a restart is meant to change needs `ahpd stop` and `ahpd start`.
Before it starts the successor, the old daemon fires no automation and starts nothing new, ends every session and terminal and waits up to five seconds for their processes to exit, then closes its automation store and its session store, writing them for the last time, as a stop does, so the two processes never write the same files; a turn `--force` let run ends there.
One restart runs at a time, and a second is refused while it does; `ahpd stop` during a restart wins, and no successor is left running.
A successor writes the record only while it is still the old daemon's or no live daemon's, and a daemon, or `ahpd stop`, forgets the record only when it names the daemon it is about.
A daemon run in the foreground does not listen for either signal, so either one ends it, as a hang-up does; restart it where it runs.
A daemon started by an older ahpd did not record its arguments, so `ahpd stop` and `ahpd start` are the way to restart it once.

From another machine it is `ahpd --remote <url> restart`, or `POST /api/restart` with `{ "force": true }` to force it; the daemon answers the refusal or that it is restarting.
The terminal only signals and a remote restart only asks the API, and neither falls back to the other.

### `--json`, for the things a script reads

Every command declares what it answers, so every command has `--json`: the same
value the prose is rendered from, as stable JSON on stdout. Diagnostics always
go to stderr, so stdout is the payload alone.

```bash
ahpd status --json | jq .url
ahpd plugin list --json | jq '.[].state'
ahpd config --json
```

`--quiet` prints only the identifier a command's answer names, `--verbose` adds
diagnostics on stderr, and `--no-color` turns colour off, as does a non-terminal
or `NO_COLOR`. `--json` and `--quiet` cannot be combined.

### Completion

Completion asks the running program, rather than baking the words into a
script, so the candidates stay live as commands change:

```bash
ahpd completion bash > /etc/bash_completion.d/ahpd     # system-wide
ahpd completion zsh  > "${fpath[1]}/_ahpd"             # or a directory on $fpath
ahpd completion fish > ~/.config/fish/completions/ahpd.fish
```

`start` re-runs this same program with the rest of the line and detaches, so
the daemon outlives the shell. It records itself in `daemon.json` beside the
configuration and writes what it says to `daemon.log`, because a background
process with no output leaves nothing to read when it misbehaves. Options are
parsed by `start` as well as by the child, so a bad one is refused before
anything has been let go of.

## Options

| flag | |
| --- | --- |
| `--port <n>` | Default `9187`. `0` picks a free one |
| `--host <addr>` | Default `127.0.0.1`. `0.0.0.0` accepts from other machines and needs a token |
| `--path <dir>` | A directory this host catalogues. Repeatable. Default: where the daemon started |
| `--no-cwd` | Serve only the directories named above, and ask about none. Refused when none is named. See below |
| `--worktrees-root <dir>` | Keep every session worktree under this folder, as `<dir>/<repo>/<name>`. Default: `<repo>.worktrees` beside each repository |
| `--connection-token <secret>` | Require this secret on every connection |
| `--connection-token-file <p>` | Require the secret in this file, writing a fresh one if it is not there |
| `--without-connection-token` | Accept any connection |
| `--stdio` | Serve one connection over stdin and stdout instead of binding a port. One line of JSON per frame, no token, and the connection is this host itself. This is how a container runs a host for another host to carry (see [CONTAINERS.md](CONTAINERS.md)) |
| `--users <file>` | The user directory. See [USERS.md](USERS.md) |
| `--resource <url>` | The https identifier this host advertises for its own sign-in. Default: derived from `--host` and `--port` |
| `--issuer <github\|url>` | An authorization server whose tokens are also accepted. See [USERS.md](USERS.md) |
| `--trust-token` | A person's connection token authorizes them as well as admits them. Off by default |
| `--advanced-tools` | Offer the tools that declare they need advanced permission, such as the computer's three. Off by default |
| `--client-tool-timeout-ms <ms>` | How long a tool call a client runs may wait for that client's answer before it is failed. Default ten minutes; `0` waits for ever |
| `--config-file <p>` | Read this instead of the file below |
| `--automations <where>` | `file`, the default, or `memory`. See below |
| `--unowned-automations <scope>` | `every`, the default, or `none`: what an automation that names no owner wakes on. See [Automations](#automations) |
| `--sessions <where>` | `file`, the default, or `memory`: where the read and archived bits, a session's settings, whose each session is and who sent each of its turns go. `memory` is why a restart forgets the last two |
| `--wire <file>` | Append every frame, both directions, to this file as JSON lines, one message per line with an `_ahpLog` beside it - the shape VS Code's agent host writes its traffic log in, so a capture opens in whatever reads that. A line over 1 MiB is written again with its strings cut and `_ahpLog.truncated` set; a file over 75 MiB rolls to `<file>.1` and five files are kept. The capture holds every token a client sent in `authenticate`, so each of its files is `0600`. `pnpm wire -- <file>` checks it against the schema |
| `--plugin <spec>` | A plugin to load: a package, a path, or an object. Repeatable, applied in order. See below |
| `--no-plugins` | Load none, whatever the configuration file says |
| `--plugin-option <plugin>.<key>[.<key>...]=<value>` | Set one option of a loaded plugin for this run, as deep in its options as the key path goes. Repeatable. See below |
| `--update-check`, `--no-update-check` | Ask npm, in the background, whether a newer version exists. On by default; `--no-update-check`, `NO_UPDATE_NOTIFIER`, `CI` and `"updateCheck": false` turn it off. See below |
| `--version`, `-v` | What version this is |
| `--help`, `-h` | |

### `--automations`, and what memory costs

`file` is the default: definitions are written to `automations.json` beside the
configuration, come back on a restart, and a clock fires the ones with a
schedule. It is the mode a daemon wants, because being running at nine in the
morning is the only way a schedule fires with nobody connected.

`memory` holds definitions for as long as the process does and fires nothing.
A client may still write, patch, list and run one by hand; what it will not get
is a `nextRunAt`, which is the honest form of "this host will not fire that".

Both are the same `AutomationStore`, so the host is not told which it was
given. Runs are in memory either way: a run names the sessions it started, and
those went when the process did.

What an automation wakes on, and what a run does while another is still going, is under [Automations](#automations).

### `--path`, and what it is not

A path is a directory on the machine **the daemon runs on**. The first is where
a session goes when the client names none, and is what the host advertises as
its default; the catalogue is the union of all of them, so past sessions in any
of them are listed and nothing goes missing by adding one.

```bash
ahpd --path /work/api --path /work/web
```

It is not a fence. A client may name any directory on the machine for a
session, a terminal or a `resource*` request, the way the reference host lets
it: the window's folder dialog lists `..` from wherever it is and picks what is
typed, and a host that refused everything outside `--path` was one where no
folder outside it could be picked at all. Who may ask is decided once, by the
connection token - which is why a host on `0.0.0.0` will not start without one.

### `--no-cwd`, and asking to serve a folder

A folder a host serves is one its agents read, edit and run in, which is what
Claude Code asks a person to trust before it does. Started at a terminal in a
folder that is under none of the ones configured, `ahpd` asks about it:

```
Serve /work/new? [y/N]:
```

Yes writes it to `paths` in `config.json`, so it is asked once and every run
after it serves it, and the run that was asked serves it too. No starts without
it. A folder inside one that is configured is not asked about, and nothing is
asked without a terminal.

`--no-cwd` is the other half: serve only what `--path` and `paths` name, and ask
about no folder at all.

```bash
ahpd start --no-cwd --path /work/api
```

With neither naming a directory it is refused, because a daemon with no folder
has nothing to work in:

```
--no-cwd serves only what --path or "paths" names, and neither does. Pass --path, or run ahpd configure.
```

### `--update-check`, and knowing when it is old

The daemon asks npm, six hours apart, whether a newer `@ahpd/server` exists,
and writes the answer to `update.json` beside the configuration. Its startup
line, `ahpd start` and `ahpd status` read that file and say so when there is
one:

```
update: @ahpd/server 0.6.0 is on npm, this is 0.5.0
```

Nothing waits on the network: the line is what the file said last time, the
request is made in the background after the daemon is up, and a fresh install
says nothing on its first start because there is no file yet. The request is
`GET <registry>/-/package/@ahpd/server/dist-tags`, eighteen bytes, against
`npm_config_registry` when that is set and `registry.npmjs.org` otherwise, so
a mirror is not reached past. Every failure is silence - offline, a proxy
that answers nothing, a registry that is down - because none of them is
something to act on from here.

Off with `--no-update-check`, with `NO_UPDATE_NOTIFIER` or `CI` set to
anything in the environment, or with `"updateCheck": false` in the file. The
daemon has no terminal, so the file is the one that matters.

### `--plugin`, and what naming one runs

A plugin is an installed package that contributes to the host the daemon
builds: a backend, one of its ports, a server tool or a configuration default.
It is named on the command line or in the configuration file.

```bash
ahpd --plugin @ahpd/agent-cofold --plugin ./my-plugin
```

`--plugin` is repeatable and the plugins apply in the order they are named.
`--no-plugins` loads none, whatever the file says, and passing it beside a
`--plugin` is refused as contradictory. A command line `--plugin` **replaces**
the file's `plugins` list rather than adding to it, the way `--path` replaces
`paths`.

A spec is a package name, a path to a directory or a file, or an object naming
one with the options `apply` receives and whether it is on:

```json
{
  "plugins": [
    "@ahpd/agent-cofold",
    { "name": "./my-plugin", "options": { "token": "…" }, "enabled": false }
  ]
}
```

A bare name is resolved from the configuration directory's own `node_modules`,
so `ahpd plugin install` is the install. A relative path is tried against the
working directory and then the configuration directory, and the absolute path
that ran is on the log.

`ahpd plugin install` and `ahpd plugin remove` do the two halves together: npm
installs into the configuration directory, and `config.json` gains or loses the
name. The file is rewritten with every other key and entry as it was found, and
nothing a running daemon already loaded changes until it is restarted.

Naming a plugin **runs its code in this process with this process's
permissions**, so the configuration file is the trust boundary here the way the
token is the port's. A plugin that does not resolve, whose manifest is wrong,
or that throws is reported on stdout and skipped; the one failure that refuses
the start is two plugins claiming the same agent `provider`, because a host
built over that answers a turn with the wrong backend.

`ahpd plugin config <name>` reads a plugin's options in `config.json`, `ahpd plugin config <name> <key> <value>` writes one and `ahpd plugin config unset` takes one away, and `ahpd plugin enable` and `ahpd plugin disable` set its `enabled`.
The plugin is named as `plugins` names it, and one the file does not name is refused.
One module is named once. A name written twice is reported and the second entry is skipped, since a plugin's options are what make its variants and root config keys one entry under `plugins.<name>`.

```bash
ahpd plugin config @ahpd/agent-claude                       # every option it sets
ahpd plugin config @ahpd/agent-claude workerStop session    # set one
ahpd plugin config unset @ahpd/agent-claude workerStop      # take one away
ahpd plugin disable @ahpd/agent-cofold
ahpd plugin enable @ahpd/agent-cofold
```

A value is JSON when it parses and text otherwise, so `3` is a number and `session` is a string.
A number that would not read back as typed, such as a long id or `1.0`, stays text, and a value quoted as JSON, `'"3"'` at the shell, is always a string.
Inside an object or array a number must read back exactly as typed too, and since it cannot become text there, a value such as `{"id":12345678901234567890}`, `{"a":1.0}` or `{"x":1e400}` is refused; quote that number as a JSON string.
It is checked against the plugin's `optionsSchema` by importing the plugin as a start would, and a value the schema refuses is not written.
A plugin that cannot be imported is written anyway, and its options are checked at the next start.
A plugin switched off with `enabled: false` is never imported, here or over the API: a value set for it is written unchecked and checked when it is enabled and loads, and one read over the API answers `<set>` for each of its values.
An `unset` of an option the entry does not set leaves the file as it is and says so.
Nothing a running daemon loaded changes until it is restarted, and each of these says so when a daemon is running.

`--plugin-option` sets one option for one run, over the file's:

```bash
ahpd --plugin-option @ahpd/agent-claude.workerStop=session
ahpd --plugin-option @ahpd/agent-claude.presets.x.model=haiku
```

It is repeated for each option, and its value is read the same way as `plugin config`'s.
The plugin is the longest name this run loads that the text ahead of the `=` starts with, so a scoped name or a path is found by asking the list rather than by counting dots, and everything after it is a key path, set as deep into the plugin's options as it goes: `presets.x.model` changes that one preset's model and leaves the others, where `presets` alone would replace all of them.
A key on the way down that the options do not have is made, the way `mkdir -p` makes the directories on its way, so one run can add a preset the file has never heard of; one that is there and is not an object is refused, naming it, because setting into it would drop what it holds.
It must name a plugin this run loads, the file's or a typed `--plugin`, and not one switched off with `enabled: false`, and the option is checked when the plugin loads, so a value the schema refuses skips that plugin with the option named in the log.
A plain value is written down twice over: it lands in the shell's history, and a flag's lands again in the daemon record's `argv`, which `ahpd restart` starts from. A credential is given as a `$secret` reference instead, and the value stays in the [vault](#the-vault):

```bash
ahpd --plugin-option '@ahpd/plugin-orders.apiKey={"$secret":"host:stripe"}'
ahpd plugin config @ahpd/plugin-orders apiKey '{"$secret":"host:stripe"}'
```

The first leaves only the reference in the record a restart reads, and the second only the reference in `config.json`; neither holds the credential itself.

`ahpd plugin list` prints one line per spec - its state, where it resolves, and
the name and title its manifest declares - without importing any of it. The
states are `ready`, `incompatible`, `unconfigured`, `disabled`, `missing` and
`error`, and a plugin that would throw on load still lists as `ready`, which is
the reason the `ahpd` key lives in `package.json` at all.

Writing one is [PLUGINS.md](PLUGINS.md).

## Automations

An automation is one instruction this host carries out with nobody watching: a trigger says when, and the run is a session whose first message is what the automation wrote. A trigger is a schedule or an event, and this is the event half. An event trigger is a rule about what a session does, and the run it starts is told what woke it.

There are three kinds. `session` is what a session does, with a count, a follow-up or a state check around it. `watch` is one of five patterns somebody already thought about, with its numbers left to you. A third kind arrives with a plugin, which registers its own type and fires its events.

### What a session does

| Event | Fires when |
| --- | --- |
| `turnCompleted` | The last turn of the session ended well |
| `turnFailed` | The last turn of the session ended with an error |
| `turnCancelled` | Somebody stopped the last turn |
| `toolCalled` | A tool call in the session finished |
| `toolFailed` | A tool call in the session failed |
| `messageQueued` | A message waits behind the turn that is running |
| `idle` | The last turn ended with nothing waiting behind it |
| `childFinished` | A session or worker chat this one started went quiet |

`idle` fires as soon as the last turn ends with nothing queued behind it, and a rule that wants a quiet period says so itself, with `then`. `childFinished` is about the sessions a `create` tool call starts: the child going quiet says it, which is its last turn ending with nothing queued behind it, every later turn that goes quiet says it again, and the child being disposed of says it too. A worker chat a session opened says it when its turn ends. Every event also says where the session works and whether a run of an automation made it, so a rule may name a folder or ask for sessions nothing automated started.

A turn that works without saying anything emits nothing, so a rule about a turn that has gone quiet is timed rather than fired: the host tells the engine when each turn starts and every time the session does anything, and the engine arms a timer that matches once the turn has been quiet the rule's length. `when.turnLongerThan` is read the same way, against the turn running as the event arrives. A rule that watches a turn ending, with no count and no follow-up, is fired by that timer alone: a turn that keeps working is one the timer starts again on, and a turn that has ended is one there is nothing left to measure.

### The rule around the event

A `session` trigger picks its event in `events`, and its `config` holds four optional parts. Every one of them left out is a rule that fires on the event itself, in any session.

| Key | What it says |
| --- | --- |
| `filter` | Which sessions this rule looks at: `sessions`, `providers`, `owners`, `projects`, `folders`, `automated`. Left out, every session is looked at |
| `count` | How many times the event has to happen: `n`, and whether they have to arrive `consecutive`, with `sameInput`, or inside a `within` |
| `then` | What has to follow: `{ "kind": "event", "event": "id", "within": "5m" }` for another event, `{ "kind": "idle", "for": "3m" }` for quiet, `{ "kind": "absent", "event": "id", "for": "3m" }` for an event that does not come |
| `when` | What the session has to look like as the event arrives: `running`, `queuedAtLeast`, `toolCallsAtLeast`, `turnLongerThan` |

A duration is written `30s`, `5m` or `2h`. A key the rule does not have is refused with the key named, and so is a value of the wrong kind, when the automation is saved.

```json
{
  "title": "Fix the failing tests",
  "enabled": true,
  "message": { "text": "{{event}} in {{sessionTitle}}: look at it." },
  "session": { "provider": "claude", "workingDirectories": ["file:///work/api"] },
  "triggers": [{
    "id": "t1",
    "kind": "event",
    "type": "session",
    "title": "Failing tests",
    "events": [{ "id": "toolFailed" }],
    "config": {
      "count": { "n": 3, "consecutive": true, "within": "5m" },
      "when": { "running": true },
      "filter": { "projects": ["api"] }
    }
  }]
}
```

That one is a count and a state check together: three tool calls failing one after another inside five minutes, while the turn is still running, in a session of the `api` project.

A follow-up is a rule that waits for a second thing after the first: `"then": { "kind": "event", "event": "turnCompleted", "within": "10m" }` fires on a failure that was followed by a turn finishing within ten minutes, and fires on nothing at all if that turn never comes. An absence is the other way round: `"then": { "kind": "absent", "event": "toolCalled", "for": "5m" }` fires on a failure that five minutes passed without a tool call after, and `"then": { "kind": "idle", "for": "3m" }` waits for the session to be quiet for three minutes instead - the turn ending and the `idle` that says so are not counted against it, while anything else the session does is.

### The presets

A `watch` trigger names one of these in `events` and its numbers in `config`. Each is the `session` rule above, written out, so the host treats it as one.

| Preset | Watches for | Number, and what it starts as |
| --- | --- | --- |
| `looks-stuck` | The same tool called with the same input several times | `times`, 3 |
| `failing-tools` | Tool calls failing one after another | `times`, 3 |
| `long-silent-turn` | A turn still running with nothing happening for a while | `minutes`, 10 |
| `idle-after-failure` | A turn failed and the session went quiet after it | `minutes`, 3 |
| `waiting-while-busy` | A message queued behind a turn that has already run several tool calls | `toolCalls`, 3 |

A preset also takes the same `filter` the rule does, so one can be narrowed to a folder, a project or a provider. `long-silent-turn` is the one with no event behind it: its rule is about a turn that is still running, so the host times it, and the timer starts again on every tool call, tool result or message chunk in that turn - it fires only after that many minutes of nothing happening at all.

### One chat, or a session each run

By default every run makes a session of its own. The automation's `_meta.ahpd.session` set to `pinned` changes that: it keeps one session and adds each run as the next turn in the chat that session holds, so a run sees the ones before it. The host writes that session's URI to `_meta.ahpd.pinnedSession` - it is the host's own note and a client writing one has it dropped - and a run whose session is gone makes a new one and keeps it there. The session's folder, worktree and machine stay between runs, and its context grows until the backend compacts it.

A pinned automation also types into a chat somebody else may be using, so a turn running there is a turn already going, whoever started it: an event arriving then is answered by `overlap` like any other, and a run pressed by hand is refused while that turn runs.

```json
{ "_meta": { "ahpd": { "session": "pinned", "pinnedSession": "ahp-session://claude/local/..." } } }
```

### What an event does while a run is going

An event can arrive while the automation's own last run is still going, and `_meta.ahpd.overlap` says what happens to it. Left out, it is `queue`.

| Mode | What happens |
| --- | --- |
| `queue` | One run waits, and later events fold into it: the run that finally starts is told how many there were |
| `steer` | The event goes into the running turn as a message. With no turn running it becomes a `queue` |
| `parallel` | A run starts for every event |
| `skip` | The event is dropped, and counted on the run it arrived during |

A pinned automation refuses `parallel` when it is saved, because it has one chat and two turns in it at once is not a thing. A scheduled automation answers to this setting exactly as an event does. A run somebody presses by hand is not held behind one that is going - what the press is answered with is the run it started - with one exception: a press on a pinned automation is refused while its chat has a turn running, because that chat takes one turn at a time.

### What the run is told

The agent reads its message and nothing else, so the event that woke it arrives there, twice over: filled into the text where the automation asked for it, and stated at the end whether it did or not.

| Placeholder | What it becomes |
| --- | --- |
| `{{trigger}}` | The trigger's own title, as the automation wrote it |
| `{{event}}` | The event's title, as the type that offers it names it |
| `{{session}}` | The session's URI, where the event was about one |
| `{{sessionTitle}}` | That session's title, where this host has one to give |
| `{{count}}` | How many events the rule counted |
| `{{at}}` | When the event happened, ISO 8601 |

A name that is not one of the six is left exactly as it was written, and a placeholder for something an event does not carry is filled with nothing rather than left in the message.

The summary block goes after whatever the automation wrote:

```
Examining the failing tests.

What woke this run: A tool call failed
Session: Fix the parser (ahp-session://claude/local/9f2c...)
Count: 3
At: 2026-10-07T14:22:05.118Z
```

### What stops a wake

- A rule only sees sessions its owner may `session:read`, and an owner this host has not met sees none. An automation that names no owner sees every session, unless the daemon was started with `--unowned-automations none` - and an event a plugin fires is held to that same answer, whether or not it names a session.
- A run's own sessions never wake the automation that made them, so an automation cannot feed itself.
- An automation runs at most 20 times an hour. Past that an event is dropped and logged with the count, and the next one inside the hour is dropped too. Switching the automation off and on again does not start the hour over, and an event its own overlap mode dropped is not one of the twenty.
- Counts, timers and the hourly count live in memory and start again when the daemon restarts, so a wake that was halfway through is missed once.

## Configuration

The daemon reads two files, in this order, each merged over the one before it key by key:

1. The user file: `$XDG_CONFIG_HOME/ahpd/config.json`, or `~/.config/ahpd/config.json`. Not there is not an error.
2. The file `$AHPD_CONFIG` names, when it is set. It must exist. A relative `$AHPD_CONFIG` is taken from the working directory.

A later file wins a key it sets, and an object such as `http` merges key by key; a list such as `paths` or `plugins` is replaced whole. No file in the working directory is read: starting `ahpd` inside a repository never picks up an `ahpd.json` or `.ahpd.json` from it, so per-project settings go through `$AHPD_CONFIG` or `--config-file`. `--config-file PATH` reads that file and nothing else, with `$AHPD_CONFIG` and the user file both left out.

A relative path in `paths`, `worktreesRoot`, `users` or `connectionTokenFile` is taken from the directory of the file that set it, not from where the daemon was started. A `--worktrees-root` typed on the line is made absolute against the working directory as it is read, because it is a base other paths are joined to rather than a folder opened where it stands. A relative plugin spec is tried against the working directory and then the configuration directory, the same as `--plugin`. The startup block has a `config` line naming every file read, and `none` when there were none.

Every flag can be a key instead, spelled without the dashes:

```json
{
  "port": 9187,
  "host": "127.0.0.1",
  "paths": ["/work/api", "/work/web"],
  "connectionTokenFile": "/home/you/.ahpd/token",
  "users": "/home/you/.config/ahpd/users.json",
  "resource": "https://ahpd.example.com/",
  "issuer": "github"
}
```

`users` turns on the directory described in [USERS.md](USERS.md): a person's own
token then opens a socket and names nobody, so they sign in with `authenticate`
before a gated command is served. `resource` is the https identifier this host
advertises for its own sign-in, which a client names in `authenticate`; leave it
out and the daemon derives one from `host` and `port`. `issuer` accepts `github`
or an OpenID Connect issuer - https anywhere, or plain http on loopback - and
the host then also accepts tokens that issuer mints, advertising it in
`authorization_servers` so a client can resolve a provider for it; the roles
still come from the user file, matched by the `subject` the issuer answers with.
A record may name its own issuer instead, and the record then advertises every
provider the file uses, so one host can take GitHub for one person and a company
identity provider for another. A record may also name the claim its roles come
from, with the grants still written in the file. `node scripts/dev-issuer.mjs 9310`
is a throwaway issuer for trying it.
`trustToken` (or `--trust-token`) trusts every person's connection token as
their authorization; off by default, so the door admits and `authenticate`
authorizes, and a record's own `trustToken` overrides it.
`advancedTools` (or `--advanced-tools`) offers the tools that declare
`advancedPermission` to every session's model. Off by default, because making a
container on this host is the operator's decision and not a plugin's: the
computer plugin contributes its lifecycle either way, and the reference host's
own tools declare nothing so this key does not touch them.
`deltaWindowMs` (or `--delta-window-ms`) is how long the host gathers the
streamed text of one part before it sends it, in milliseconds: within that
window a turn's deltas are merged into one action, so a client draws the same
text from fewer envelopes. The default is 75, and 0 sends every delta as it
arrives. A wrong value is `...: deltaWindowMs must be an integer between 0 and
1000`.
`http` (or `http: { "port": N }`) serves the commands over HTTP under `/api`; it
has no flag, because it is a property of a deployment rather than of one run.
See [An HTTP API](#an-http-api-for-the-commands-the-terminal-runs).
`usage` (`{ "per": "report", "timezone": "America/Sao_Paulo" }`) says how a turn is
written down, and where the periods are cut. The default, `turn`, holds what a
turn has used and writes one record when the turn ends; `report` writes one
record for every usage report, each holding what that report added since the one
before it, so a turn that is still running is already billed for what it has
spent. Both bill the same work, and a wrong value is
`...: usage.per must be one of turn, report`. `timezone` names, as `Intl` names
one, the zone a day starts at and a week starts on - a week is Monday 00:00
there, not on the system's own - and the system's own zone is used when the key
is absent, or when it names a zone this host cannot read, which is said once at
start. Neither key has a flag: both are properties of a deployment rather than
of one run.
`policies` (`{ "check": true }`) says whether the rows saying who may use which
agent, model and computer are enforced. Off by default, and it has no flag: a
daemon that refuses somebody is a deployment's decision and not one run's. The
rows are kept and the `policy:` scheme is served either way, so a store can be
filled in before anything is switched on; a wrong value is
`...: policies.check must be true or false`. See [docs/POLICY.md](POLICY.md).

`mcpServers` is the host's own MCP servers, by the name a person gave each, and
every session is offered them whatever agent it runs, as the `mcpServers` member
of what its backend is started with. An entry is one of the two shapes VS Code
uses:

```json
"mcpServers": {
  "files": { "type": "stdio", "command": "mcp-server-filesystem", "args": ["/srv"], "cwd": "/srv", "env": { "TOKEN": "..." } },
  "issues": { "type": "http", "url": "http://127.0.0.1:9310/mcp", "headers": { "Authorization": "Bearer ..." } }
}
```

A `stdio` server needs a `command` and an `http` one a `url`; an entry that is
neither shape, or that is missing the one its own `type` needs, is one warning in
the log and is left out, because one server nobody can reach is a gap in one
agent's reach where a wrong `port` is a daemon that would not run at all. A value
in `env` or in `headers` is a credential, so each answers `<set>` here and over
the API alike. It has no flag, for the same reason `usage` and `policies` have
none: it is a list of programs, and that is a deployment's decision rather than
one run's. See [docs/PLUGINS.md](PLUGINS.md) for what a session is handed.

`ahpd usage` prints what this host was charged, and the same store is served as
the `usage:` scheme, so a client reads it through the resource calls it already
has: `usage://` lists the pools that reader may see, `usage://<pool>` reads
that pool as `{ pool, day, week, month }`, and `usage://<pool>/records?from=&until=`
lists the records charged to it, newest first, at most 200. A pool name holds
colons, so it is one encoded path segment - `usage://project%3Abackend%3Asearch`
is `project:backend:search`, not an authority. `ahpd usage` with no pool lists
what that caller may see, and with one prints that pool's three totals, cut in
`usage.timezone`.

A flag beats the file, because a flag is this run and a file is every run until
somebody edits it. `paths` and `plugins` are the two exceptions worth knowing: a
`--path` or a `--plugin` on the command line **replaces** its list rather than
adding to it, so a file naming two and a flag naming a third loads one, not
three. `"updateCheck": false` is `--no-update-check`. `--no-plugins` and
`--no-cwd` have no key, because leaving `plugins` out is already the off and an
empty `paths` is already the only folder a run serves, and `--plugin-option` has
none, because an entry's `options` is where the file sets the same thing.

The merged files are checked against the same schema the flags are, before anything starts. A wrong value on a key ahpd knows refuses the start with exit code 2 and a line naming the file that set the key, and the key: `"port": "8080"` is `/home/you/.config/ahpd/config.json: port must be an integer`, and `"http": { "port": 70000 }` is `...: http.port must be an integer between 0 and 65535`. A key ahpd does not know, such as `"plugin"` for `"plugins"` or one a newer version added, is one line in the log, `/home/you/.config/ahpd/config.json: plugin is not a setting ahpd knows; ignored`, and the daemon starts without it. `stdio`, `configFile`, `noPlugins`, `noCwd` and `pluginOptions` mean something only when typed, so the file warns about them the same way.

`ahpd config` prints every file it read, then each key and its value; with more than one file, each key also names the file that set it. `ahpd config --json` answers `files`, `config` and `sources`, the file per key.

### What a client can configure

The keys of this section are in root config as well, so a client holding `config:read` is shown them beside the host's own three and edits them with `config:write`. The daemon's are `paths`, `port`, `host`, `http`, `updateCheck`, `advancedTools`, `wire` and `mcpServers`, and each configured plugin is one more, `plugins.<name>`, whose value is `{ enabled, options }`. A plugin is named once, so it has one such key, and its variants are made by its own options. Nothing else the file holds is there, so `stdio`, `configFile`, `noCwd`, `worktreesRoot`, `clientToolTimeoutMs`, the connection token keys, `trustToken`, `issuer`, `resource`, `users`, `automations` and `sessions` are still edited the way they always were.

`advancedTools` and `wire` apply to this daemon as they are written: the tools every running session's model is offered change at once, and the wire capture starts, moves or stops. `mcpServers` applies to the next session opened; a running session keeps the servers it started with. Every other key is written to `config.json` and the answer puts `ahpd.restartNeeded` in the `_meta` of the root state, which every reader of root is shown whether or not it may see the keys the notice is about, so `ahpd restart` applies it.

A key shows what the file holds rather than what this run is using, and when a start flag overrode it the key's description says so. A credential is never sent back: every value the plugin's own `optionsSchema` marks `writeOnly`, however deep in its options the mark sits, is answered as `<set>`, here and over the API alike, and a client that sends that back has said the credential is left as it is. The terminal's own `ahpd config` is the one answer that prints the file as it is, because whoever runs it can read the file.

## The vault

A plugin that needs a credential is handed it by name rather than by value, and the value lives in one file: `$XDG_CONFIG_HOME/ahpd/vault.json`, or `~/.config/ahpd/vault.json`. The startup block says `vault /home/you/.config/ahpd/vault.json` where it read it, and `vault from a plugin` where a plugin registered the vault instead of the file.

```bash
printenv STRIPE_KEY | ahpd vault set host:stripe
printenv ORDERS_KEY | ahpd vault set team:backend/orders
ahpd vault list
ahpd vault delete host:stripe
```

The file is plain JSON, mode 0600, and it is not encrypted. Anything running as the user the daemon runs as can read it, and so can any backup of the configuration directory, so it is kept like any other file that holds a credential: out of a repository, out of a synced folder, out of a container image that is pushed anywhere. It is read again on every call, so a set at the terminal lands in a running daemon at its next read.

A value never goes on the command line. `ahpd vault set` reads standard input to its end and drops one trailing newline, and a terminal there is refused with `pipe the value on standard input`, because argv is in `ps` and in the shell's history and there is no question this program can ask for one without echoing the answer back.

A name says whose secret it is, and who may write it follows from that, with no grant of its own:

| name | who may write it | who may list it |
| --- | --- | --- |
| `host:<name>` | `config:write` | `config:read` |
| `team:<team>/<name>` | `team:write`, and a membership in that team | the same |
| `user:<id>/<name>` | that person | that person |

The deployment's connection token is root and may write and list any of the three. A name that is none of those three forms is refused where it is written, with the forms spelled out.

A plugin's option names one rather than holding it:

```json
{
  "plugins": [{ "name": "@ahpd/plugin-orders", "options": { "apiKey": { "$secret": "host:stripe" } } }]
}
```

The daemon reads the value when it loads the plugin and hands `apply` the value, so the option is held to its own schema as the string it finally is. A name the vault does not hold, or one out of scope at load, skips the plugin with one line saying which name it could not read and why, as a schema failure does. A reference is answered as written everywhere a plugin's options are shown, root config and `ahpd config` and `ahpd plugin list` alike, so the name stays visible; a plain-text credential marked `writeOnly` still answers `<set>`.

An option whose schema says `"secretAtUse": true` keeps its reference instead, for a plugin that reads the value later and per call, through `host.secret(name)`. See [PLUGINS.md](PLUGINS.md).

Claude's own `fromEnv` is untouched: a backend that reads its key from the environment still declares `"fromEnv": true` and still receives it as a value. The two are for different things, and a plugin may use either.

Nothing here answers a value. `ahpd vault list` and `GET /api/vault/list` say a name and whether it is set, and list a name the configuration references and the vault does not hold as not set, with the path that named it, so a plugin waiting for a secret says so rather than staying silent.

## Who may connect

Loopback with no token needs no secret: anything reaching `127.0.0.1` is already
on this machine. Binding anything else without one of the three token flags
refuses to start, rather than putting a host on the network that anybody can
drive.

```bash
ahpd --host 0.0.0.0 --connection-token-file ~/.ahpd/token   # written if absent, owner-readable
ahpd --host 0.0.0.0 --connection-token "$SECRET"
ahpd --host 0.0.0.0 --without-connection-token              # deliberately open
```

Clients present it as `?tkn=<secret>` on the WebSocket URL or as an
`Authorization: Bearer <secret>` header. The query string is the one that always
works, because a browser cannot set headers on a WebSocket handshake. A wrong
token is refused with **401 at the handshake**, so it never reaches the host.

```bash
ahpc --host ws://192.168.1.10:9187 --token "$SECRET"
```

Only stdout says where the token came from, never what it is.

This is the *connection* token, which is about who may reach the host at all.
With a user directory a person's own token reaches it too, and the deployment's
token is the host itself; [USERS.md](USERS.md) is the two layers. The token a
client pushes with `authenticate` is a different thing again and is covered in
[AHP.md](AHP.md#authentication).

## An HTTP API, for the commands the terminal runs

`http` in the configuration serves the same declarations under `/api`, so
`status`, `config`, `plugin` and `user` can be run by something that is not a
terminal. It is off until it is named, and it needs something to hold a request
against: a connection token or a user directory. With neither, the daemon
refuses to start rather than serve an administration surface that anybody who
reaches the port may drive.

```json
{
  "http": true
}
```

That puts it on the daemon's own port, beside the WebSocket, at
`http://127.0.0.1:9187/api`, so a tunnel that reaches the socket reaches the API
with no more setup. `http.port` moves it to a listener of its own, which is how
it is bound where AHP is not, and `http.host` says where that listener binds.
The default is the daemon's own `host`, so naming `127.0.0.1` keeps
administration on the machine while AHP is on the network:

```json
{
  "http": { "port": 9188, "host": "127.0.0.1" }
}
```

`http.host` without `http.port` has no listener to bind, and is refused.

The startup line says where it went: `http on http://127.0.0.1:9187/api`.
Without `http`, `/api` answers 404 and a request anywhere else keeps the answer
it always had. The API is served on Node, Bun and Deno alike, on the daemon's
own port or on `http.port`.

The model proxy is served beside it under `/v1`, on the same listener and only
while `http` is on; see [PROXY.md](PROXY.md).

The same commands under the same grants. A request carries
`Authorization: Bearer <token>`: the deployment's connection token is root,
exactly as it is on the socket; anything else is a person's token, verified the
way `authenticate` verifies one, and the command's scopes are checked against
the grants their roles resolve to:

| Command | Needs |
| --- | --- |
| `status`, `plugin list` | `config:read` |
| `config` | `config:write` |
| `user list` | `user:read`, `role:read` |
| `user add`, `user rm`, `user token`, `user member` | `user:write` |
| `team list` | `team:read` |
| `team add`, `team rm` | `team:write` |
| `project list` | `project:read` |
| `project add`, `project rm` | `project:write` |
| `usage` | their own pools; every pool with `usage:read` |
| `vault list` | `config:read` for `host:` names; a team's own with `team:write`; a person's own |
| `vault set`, `vault delete` | `config:write` for `host:` names; a team's own with `team:write`; a person's own |
| `plugin install`, `plugin remove` | the deployment's token only |
| `plugin update` | the deployment's token only |
| `plugin config` (reading or setting one), `plugin config unset`, `plugin enable`, `plugin disable` | the deployment's token only |
| `restart` | the deployment's token only |

`user:write` manages people at or below the caller: `user add` refuses a role,
and `user add`, `user token` and `user rm` refuse a person, that holds a grant
the caller does not hold, so the grant is not `admin` under another name. Each of
the four people subjects is its own, so a caller may be let name teams without
being let read the people on them. `user list` asks for `role:read` as well,
because the answer prints what each person's roles resolve to. `usage` is the
one row that is not a flat pair, because which pools a caller may see is a
question about who they are: `GET /api/usage/<pool>` serves their own `user:`
pool and the `team:` and `project:` pools they belong to with no grant at all,
and every other pool needs `usage:read`. See
[USERS.md](USERS.md) for the subjects and the schemes.

`plugin install` runs `npm install` and names a package the daemon loads at its
next start, so it runs code as the host; no grant a person may hold confers
that, and a person's token is refused whatever its roles. A served install
answers `restart: true`, because the daemon that answered is the one holding the
list it started with. `GET /api/config` answers every key of the daemon's own
file, with `connectionToken` and every value under a plugin entry's `options`
reported as `<set>` rather than as what they are, and the userinfo of a plugin
spec's URL replaced the same way (`git+https://<set>@host/repo`), so a grant to
read or change settings carries neither the root credential nor a plugin's own
secrets.
`GET /api/plugin/list` reports each plugin's `options` and every string that may
quote its spec the same way.
A row carries `name`, the key every other `plugin` verb takes - the spec as the configuration wrote it, so a path, a git URL and a package name each answer their own - beside `module`, the name the package declares itself by; a client acts on a row by passing `name` back and names nothing itself.
A spec whose URL carries userinfo is the exception: a served row masks it in `name` as in `spec`, and that masked name matches no plugin, so such a plugin is changed from the terminal.
Every list answers the same way: a row carries the field the kind's keyed commands take, `id` for a person, a team and a project, `pool` for a pool and `name` for a secret.
`POST /api/plugin/config` with `{ "name": ... }` answers a plugin's options, `POST /api/plugin/config/set` with a `value` sets one and `POST /api/plugin/config/unset` with a `key` takes one away; an option its schema marks `writeOnly` is answered as `<set>`, and every option is when the plugin cannot be imported to read its schema.
`POST /api/plugin/enable` and `/api/plugin/disable` take `{ "name": ... }`.

The vault is served the same way, at `POST /api/vault/set/<name>`, `POST /api/vault/delete/<name>` and `GET /api/vault/list`. A name holds colons and a slash, so it is one encoded path segment - `team%3Abackend%2Forders` is `team:backend/orders` - and only the HTTP body carries a value, `{ "value": "..." }`, for the same reason the terminal reads standard input: nowhere else is a value echoed into a log. `GET /api/vault/set/<name>` is not a route, so it is answered 404 like any other path the API does not have: a value can be set and can never be read back.

A refusal carries the same sentence the WebSocket gives, so a script reads the
reason:

```bash
curl http://127.0.0.1:9187/api/status -H "Authorization: Bearer $SECRET"
curl http://127.0.0.1:9187/api/config -H "Authorization: Bearer $SECRET"

# A person the grant does not cover, and the answer the socket gives too.
curl -i http://127.0.0.1:9187/api/status -H "Authorization: Bearer $ADA"
# HTTP/1.1 403 Forbidden
# { "message": "ada may not config:read here" }

# Installing a plugin is the deployment's own, whatever a person's roles are.
curl -i http://127.0.0.1:9187/api/plugin/install \
  -H "Authorization: Bearer $ADA" -H "content-type: application/json" \
  -d '{"name":["@ahpd/agent-claude"]}'
# HTTP/1.1 403 Forbidden
# { "message": "ada may not install or remove a plugin here; only the deployment token may" }
```

A request is answered only when its `Host` is one of the daemon's own names -
the loopback names at the port the API is bound to, the address it is bound to
when that is a specific one (an IPv6 one in brackets), and the host of
`resource` when a deployment names it, with the port it names if it names one -
and when its `Origin`, if a browser sends one, is one of them too. A body
is served only when its `content-type` is `application/json`; anything else is
answered 415. That keeps a page on another site, or one that rebinds its own
name to loopback, from driving the API.

A served command reads the daemon's own options and never the request's idea of
them: its configuration file, its user directory, its plugins and its
directories. `configFile`, `users`, `plugins` and `paths` are absent from the
served declarations and so from the manifest, and `GET /api/status` describes
the process answering rather than the record a detached daemon wrote.

`GET /api/cli-manifest` is the command surface as JSON - the same declaration
the CLI parses - and it is not gated, so a client can read what a daemon offers
before it has a token. It is what `--remote` reads.

### `--remote`: the same CLI, against a daemon

`--remote <url>` runs the administration commands on the daemon the URL names
instead of here. A token is required: `--token <secret>`, `--token-file <path>`
or `AHPD_TOKEN`, and a call with none, or with one that is empty or only
spaces, is refused before anything is fetched. `--token` and `--token-file`
together are refused, as is a file that is missing or empty. Plain `http://` to
a host that is not loopback sends the token readable by anything on the path,
so the client says so on stderr and proceeds; `https://`, or `http://` on
loopback, says nothing. The manifest is cached under `~/.cache/ahpd/remote`,
mode 0700, so `--help` is not a round trip and the binary still works while the
daemon is not answering; `--refresh` fetches it again.

```bash
ahpd --remote http://127.0.0.1:9187 --token "$SECRET" status
ahpd --remote http://127.0.0.1:9187 --token-file ~/.config/ahpd/token plugin list
AHPD_TOKEN="$SECRET" ahpd --remote http://127.0.0.1:9187 --refresh config
```

The URL is the daemon's origin; `/api` is appended. `start` and `stop` are the
one pair that stays local, because they are about a background daemon on this
machine rather than the one answering. Everything else - `status`, `config`,
`plugin` and `user` - is the daemon's declaration, with the same help,
completion and `--json` it has when typed at its terminal, and it answers about
the daemon that is running. A served `status` and `config` take no fields at
all.

## Clients

```bash
ahpc --host ws://127.0.0.1:9187
```

VS Code, in `settings.json`:

```json
"chat.remoteAgentHostsEnabled": true,
"chat.remoteAgentHosts": [
  { "name": "ahpd", "address": "ws://127.0.0.1:9187", "connectionToken": "…" }
]
```

`address` may be bare (`127.0.0.1:9187`) or a full `ws://` / `wss://` URL; the
client puts the token on the URL as `?tkn=`, which is one of the two forms this
host accepts. `connectionToken` may be left out for a loopback host started
without one.

## Runtimes

```bash
node packages/server/dist/main.js --port 9187 --path /work/project   # Node
bun  packages/server/dist/main.js --port 9187 --path /work/project   # Bun
deno run -A packages/server/dist/main.js --port 9187 --path /work    # Deno
```

The runtime is detected at startup and named in the first line of output. Node
needs the optional `ws` dependency, having no WebSocket server of its own; Bun
and Deno use their built-in servers and need nothing. The HTTP API is the same
on all three: Bun and Deno hand its requests to their built-in servers, and Node
serves them through `@cofold/remote`'s `node:http` adapter.
[packages/sdk/src/listen.ts](../packages/sdk/src/listen.ts) is the only file that knows which one it is on.

All three are run. Deno was proved on **2.9.6** against the built output,
driving a whole session - handshake, catalogue, changeset, operations, the
write half and a resource watch. Run `dist/` rather than `src/` there, or pass
`--sloppy-imports`: the sources import `./x.js` the way the emitted output
does, and Deno reads that literally.

## While you are changing it

```bash
pnpm dev          # node
pnpm dev:bun      # bun
pnpm echo         # the same pair, for examples/echo
pnpm echo:bun
pnpm notes        # and for examples/notes
pnpm notes:bun
```

All six run the TypeScript source, restart on save, compile nothing and install
nothing. Each names the runtime it is on in its first line of output, so there
is never a question which one answered. The `:bun` half exists because
`listen.ts` is one file and three code paths, and a change to it wants running
under more than one before it is believed.

The difference between them is in what each needs to find a file. This source
spells its own imports `./host.js`, because that is what will be there after a
build. Bun rewrites those to the `.ts` on disk by itself; Node resolves them
literally and looks for a `host.js` that does not exist yet, so the Node scripts
register [scripts/dev-hooks.mjs](../scripts/dev-hooks.mjs) to do the same
rewrite - about twenty lines, no dependency. [scripts/dev.mjs](../scripts/dev.mjs)
registers it with `module.registerHooks`, on the main thread, and with
`module.register`, on a thread of its own, on a Node older than 22.15 or 23.5
that lacks it; every module then resolves across threads, so importing pi
takes about four times as long.

Node also strips types rather than transforming them, so it cannot run the
TypeScript that *emits* code: enums, namespaces, and constructor parameter
properties. There are none here, and `packages/sdk/test/strippable.test.ts` is what keeps it
that way.
