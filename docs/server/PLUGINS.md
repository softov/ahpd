# Plugins

Every backend is a plugin, Claude included. Plugins also add tools, ports and URI schemes.

| Plugin | Adds |
| --- | --- |
| [`@ahpd/agent-claude`](../plugins/agent-claude.md) | Claude Code |
| [`@ahpd/agent-cofold`](../plugins/agent-cofold.md) | cofold agents |
| [`@ahpd/agent-pi`](../plugins/agent-pi.md) | pi |
| [`@ahpd/agent-acp`](../plugins/agent-acp.md) | Copilot, Codex, Gemini and other ACP agents |
| [`@ahpd/computer`](../plugins/computer.md) | Computers and containers a session runs in |
| [`@ahpd/bot`](../plugins/bot.md) | Bots |
| [`@ahpd/webhook`](../plugins/webhook.md) | Webhooks |
| [`@ahpd/push`](../plugins/push.md) | Push notifications |
| [`@ahpd/tunnel-devtunnel`](../plugins/tunnel-devtunnel.md) | A public URL through Dev Tunnels |
| [`@ahpd/web`](https://github.com/ahpio/ahpw) | A web UI, at `/plugins/web/` |

::: warning
A plugin runs in the daemon's process with its permissions. Install only plugins you trust.
:::

## Install and remove

```bash
ahpd plugin install @ahpd/agent-pi
ahpd plugin list
ahpd restart
```

`install` runs `npm install` in the configuration directory (`~/.config/ahpd`) and adds the name to `plugins` in `config.json`. A change loads at the next restart. The source may be a package name, a path, a tarball URL, `github:<owner>/<repo>` or a `git+ssh:` URL; what `plugins` gets is the name npm wrote for it. A package with no `ahpd` field is refused, and one npm installed from a source is uninstalled again.

| Command | Does |
| --- | --- |
| `ahpd plugin install <source>` | Install and add to `plugins` |
| `ahpd plugin install <name> --no-enable` | Install only |
| `ahpd plugin remove <name>` | Remove from `plugins` and uninstall |
| `ahpd plugin remove <name> --keep` | Remove from `plugins` only |
| `ahpd plugin enable <name>` | Turn on |
| `ahpd plugin disable <name>` | Turn off, keep its options |
| `ahpd plugin list` | Show each plugin and its state |

A bare name installs the newest version that fits this daemon. `@ahpd/agent-pi@1.2.0` or a tag goes to npm as written.

::: info A plugin installed with `npm i -g` is not found
ahpd looks for a bare name in the configuration directory only. Use `ahpd plugin install`.
:::

### States

`ahpd plugin list` shows one of these per plugin:

| State | Means |
| --- | --- |
| `ready` | Loads at the next start |
| `disabled` | `enabled: false` in its entry |
| `incompatible` | Needs another `@ahpd/sdk` than this daemon's |
| `unconfigured` | Needs an option set first |
| `missing` | Not installed |
| `error` | Fails to import |

## Update

```bash
ahpd plugin update all          # every plugin
ahpd plugin update @ahpd/agent-pi
ahpd plugin update all --force  # one npm call per plugin, so one failure does not stop the rest
```

Each plugin moves to its newest version whose `@ahpd/sdk` range fits this daemon. A plugin installed from a path, git or a URL is left as it is.

## Options

```bash
ahpd plugin config agent-claude                     # show
ahpd plugin config agent-claude workerStop session  # set
ahpd plugin config unset agent-claude workerStop    # remove
```

A value is JSON when it parses, and text otherwise. Quote a string that looks like a number: `'"3"'`. Each plugin's page lists its options.

The same in `config.json`:

```json
{
  "plugins": [
    "@ahpd/agent-claude",
    { "source": "@ahpd/agent-pi", "options": { "model": "anthropic/claude-haiku-4-5" }, "enabled": false }
  ]
}
```

`source` names the package, file or directory. An entry with `name` and no `source` is the old form and still loads; the next change writes it as `source`. A `name` beside a `source` is a display name.

::: tip Credentials
Put a secret in the [vault](VAULT.md) and name it, so it is not in `config.json` or your shell history:

```bash
ahpd plugin config orders apiKey '{"$secret":"host:stripe"}'
```
:::

## For one run

| Flag | Does |
| --- | --- |
| `--plugin <spec>` | Load this plugin too. Adds to the file's `plugins` list. Repeatable |
| `--no-plugins` | Leave the file's `plugins` list out. With `--plugin`, only those load |
| `--plugin-option <id>.<key>=<value>` | Set one option for this run. Repeatable |

```bash
ahpd --plugin @ahpd/agent-cofold --plugin ./my-plugin
ahpd --plugin-option agent-claude.workerStop=session
```

A spec is a package name or a path. A path is tried from the working directory, then from the configuration directory.

## Language

A client that sends a `locale` reads the new session form and the plugins screen in that language. The host and each first-party plugin ship `pt` and `es`. A string with no translation shows in English. A client that changes its language connects again. See [Text in the client's language](../plugins/PLUGINS.md#text-in-the-client-s-language) to ship a catalog with a plugin.

## Where a plugin keeps its records

Each record is one Markdown file: `~/.config/ahpd/<collection>/<id>.md`. You can edit, copy or delete it while the daemon runs, and the plugin sees the change.

## Write one

See [Writing a plugin](../plugins/PLUGINS.md).
