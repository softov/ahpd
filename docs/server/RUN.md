# Run

| Command | Does |
| --- | --- |
| `ahpd` | Run in this terminal. Ctrl+C stops it |
| `ahpd start` | Run in the background |
| `ahpd status` | Say if it runs, and where |
| `ahpd doctor` | Say what is wrong, and how to fix it |
| `ahpd stop` | Stop it, and wait up to 30 s |
| `ahpd restart` | Stop and start again with the same flags |
| `ahpd restart --force` | Restart even while a turn runs |
| `ahpd update` | Move to a newer ahpd and restart it. See [Upgrade](UPGRADE.md) |

`start` takes the same flags as `ahpd`. A bad flag is refused before anything starts.

## Files

All in `~/.config/ahpd/` (or `$XDG_CONFIG_HOME/ahpd/`):

| File | Holds |
| --- | --- |
| `config.json` | The configuration |
| `daemon.log` | What a background daemon prints. Moved aside at 5 MiB |
| `daemon.json` | The running daemon's pid, URL and flags. Mode 0600 |
| `sessions/` | Each session's settings and owner |
| `automations/` | One Markdown file per automation |
| `vault.json` | Secrets. See [Vault](VAULT.md) |

```bash
tail -f ~/.config/ahpd/daemon.log
```

## Restart

`ahpd restart` keeps the sessions, and the port when it is fixed. It is refused while a turn runs, and the refusal names the sessions:

```bash
ahpd restart            # waits for no turn
ahpd restart --force    # ends the running turns
```

Before it stops, the daemon checks that the new code accepts the recorded flags. If it does not, the restart is refused and the old daemon keeps running.

::: info Environment and folder
The new daemon keeps the old one's environment variables and working folder. To change either, use `ahpd stop` and `ahpd start`.
:::

From another machine: `ahpd --remote <url> restart`. See [Remote access](REMOTE.md#run-commands-from-another-machine).

A client of the daemon's AHP restarts it with the command `x-ahpd/restart`, which runs the same checks. It takes `config:write`, and only the host's own connection may send it. The answer is `{ "restarting": true, "pid": <pid> }`, and the daemon restarts once the answer has gone.

## Doctor

`ahpd doctor` runs every check on this machine and prints one line for each, with the fix when something is wrong. It reads the configuration, the daemon's record, the service file and the plugins, and it starts nothing.

The checks, in this order:

| Check | Says |
| --- | --- |
| Runtime | The Node version that runs ahpd, and the other runtimes on `PATH` |
| Config | Each configuration file that is read, and whether it parses |
| Daemon | The record, then whether the daemon answers on its address within 5 s |
| Service | The service file, on a system with a service manager |
| Plugins | Whether each plugin in the configuration resolves, and has a whole manifest |
| Agents | The agent commands in the configuration, against the ones on `PATH` |
| Update | Whether a newer ahpd is on record |

`ok` is a state that needs nothing, `warn` is a state a person may want to change, and `fail` is a fault. Every `warn` and `fail` names its fix on the next line.

```bash
ahpd doctor
```

```
ok Runtime: Node v22.19.0 runs ahpd
ok Config: read /home/you/.config/ahpd/config.json
warn Daemon: no daemon is running
  fix: ahpd start
warn Service: no systemd file is at /home/you/.config/systemd/user/ahpd.service
  fix: ahpd service install
ok Plugins: 2 plugins load
ok Agents: every agent command on PATH is configured
ok Update: no newer @ahpd/server is on record
5 ok, 2 warn, 0 fail
```

`ahpd doctor --json` gives the same checks as an array, and is the output for a support ticket. It holds no token.

The exit code is 1 when a check is `fail`, and 0 otherwise, so a script can ask doctor whether the machine is well. With `--json`, the array stays on stdout and the failure is one JSON line on stderr, as with every command.

## Service

`ahpd service install` hands the daemon to the service manager of this machine, so it starts at login and is started again ten seconds after it ends, as VS Code's CLI keeps its own service running. On Linux that is a systemd user unit, and on macOS a LaunchAgent loaded in the graphical login. Neither needs sudo: both files belong to this user. `ahpd stop` and `ahpd restart` go through the manager, so a stop stays stopped.

```bash
ahpd service install
ahpd status
```

```
ahpd on ws://127.0.0.1:8787 (pid 48213), started 2026-10-16T09:12:04.881Z, under systemd
```

What it writes is one file that runs the same daemon as `ahpd` with no command, for the configuration file of this install. A service starts in your home folder, so a run with no `paths` serves the home folder, the way a terminal opened there would.

| Platform | File |
| --- | --- |
| Linux | `~/.config/systemd/user/ahpd.service` |
| macOS | `~/Library/LaunchAgents/dev.ahpd.daemon.plist` |

While the service holds the daemon, `ahpd stop` and `ahpd restart` go through the manager rather than sending a signal: a daemon a signal ends is one the manager starts again. The log is where the manager puts it: the journal on Linux, and `daemon.log` on macOS.

```bash
journalctl --user -u ahpd -f        # Linux
tail -f ~/.config/ahpd/daemon.log   # macOS
```

::: info Environment
The file gets the `PATH` of the shell that ran `service install`, so the agents this host starts find their own runtimes. The daemon's own interpreter is written in full, so a `node` from nvm needs no `PATH` of its own.

A configuration home of its own is an `XDG_CONFIG_HOME` that is not `~/.config`. An install from one writes that home into the file too, so the daemon the manager starts keeps to the folder under it. Which of the daemon's environment an agent's shells get is [`shellEnv`](../sdk/HOST.md#configuration-keys)'s to say.
:::

After an upgrade, run `ahpd service install` again: it writes the file for the new binary and starts the daemon from it. `ahpd service uninstall` stops the daemon, takes the service out of the list this machine starts at login, and removes the file.

`service install` is refused while a daemon from `ahpd start` runs - stop that one first.

### More than one daemon

A second daemon on the same machine has a configuration home of its own, and a port of its own. Name its service in its configuration file, `$XDG_CONFIG_HOME/ahpd/config.json`, so it installs beside the first one:

```json
{ "port": 9188, "service": { "name": "two" } }
```

```bash
XDG_CONFIG_HOME=~/.config/ahpd-two ahpd service install
```

| Platform | Service | File |
| --- | --- | --- |
| Linux | `ahpd@two` | `$XDG_CONFIG_HOME/systemd/user/ahpd@two.service`, linked into the folder systemd reads units from |
| macOS | `dev.ahpd.daemon.two` | `~/Library/LaunchAgents/dev.ahpd.daemon.two.plist` |

Run every command for that daemon with its `XDG_CONFIG_HOME`. Its record names its service, so `ahpd stop`, `ahpd restart` and `ahpd service uninstall` reach that service and not the first one. `service install` is refused for a daemon that a service of another name already holds.

## Served folders

The daemon serves the folders in `paths`. With none, it serves the folder it started in.

```bash
ahpd paths list
ahpd paths add /work/web
ahpd paths remove /work/web
```

A running daemon with the [HTTP API](REMOTE.md#http-api) on takes the change at once. Otherwise, run `ahpd restart`.

Started at a terminal in a folder it does not serve, `ahpd` asks:

```
Serve /work/new? [y/N]:
```

Yes adds it to `paths`. To never ask, pass `--no-cwd`. It serves only `paths` and `--path`.

::: tip
A path is where sessions are listed and created by default. It is not a fence: a client may still open a session in any folder on the machine. The [connection token](REMOTE.md#the-connection-token) decides who may connect.
:::

## Output for scripts

Every command takes these:

| Flag | Does |
| --- | --- |
| `--json` | Print the answer as JSON on stdout |
| `--quiet` | Print only the id the answer names |
| `--verbose` | Add diagnostics on stderr |
| `--no-color` | No colour. Also off for a non-terminal or with `NO_COLOR` |
| `--yes` | Remove without asking. A script with no terminal needs it |

```bash
ahpd status --json | jq .url
ahpd plugin list --json | jq '.[].state'
```

Under `--json`, a failure is one JSON line on stderr, so stdout holds only the answer. `ahpd --json plugin` writes:

```json
{"message":"plugin takes list, update, config, install, remove, enable or disable.","kind":"argument","exitCode":2}
```

`kind` names the sort of failure, and `exitCode` is the code the process leaves, for a script that never reads stderr:

| `kind` | Exit code | Means |
| --- | --- | --- |
| `argument` | 2 | The words typed are wrong. |
| `configuration` | 3 | The program is not configured, or is configured wrongly. |
| `authorization` | 3 | The request was refused, and `missing` names the scopes that would allow it. |
| `unavailable` | 4 | Something the command needed did not answer. |
| `conflict` | 1 | The machine's state does not allow it, such as a daemon that is not running. |
| `internal` | 1 | An unexpected failure. |

Without `--json`, each failure stays the one `ahpd: <sentence>` line on stderr.

## Shell completion

::: code-group

```bash [bash]
ahpd completion bash > /etc/bash_completion.d/ahpd
```

```bash [zsh]
ahpd completion zsh > "${fpath[1]}/_ahpd"
```

```bash [fish]
ahpd completion fish > ~/.config/fish/completions/ahpd.fish
```

:::
