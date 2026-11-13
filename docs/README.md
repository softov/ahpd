# Documentation

One file per area of the host. Each says what is true today and links the decision behind a choice rather than repeating its reasoning, and a reader finds an area by its file name.

The files are in three folders, one for each kind of reader, and the release notes are in a fourth.

## server

For a person who runs the `ahpd` daemon: its commands, its flags and its configuration.

| File | What it covers |
| --- | --- |
| [GET-STARTED.md](server/GET-STARTED.md) | Install, configure, start, and connect VS Code |
| [INSTALL.md](server/INSTALL.md) | Install, and run on Node, Bun or Deno |
| [DOCKER.md](server/DOCKER.md) | Run it in a container: Compose, the volume, plugins and upgrades |
| [UPGRADE.md](server/UPGRADE.md) | Upgrade the daemon and its plugins, and the update check |
| [RUN.md](server/RUN.md) | Start, stop, restart, the files the daemon keeps, and served folders |
| [CONFIGURE.md](server/CONFIGURE.md) | `ahpd configure`, `config.json`, and which setting wins |
| [PLUGINS.md](server/PLUGINS.md) | Install, update and configure plugins |
| [CONNECT.md](server/CONNECT.md) | Connect VS Code or `ahpc` |
| [REMOTE.md](server/REMOTE.md) | The connection token, the network, the HTTP API and `--remote` |
| [USERS.md](server/USERS.md) | A token and a role for each person |
| [VAULT.md](server/VAULT.md) | Credentials out of `config.json` |
| [USAGE.md](server/USAGE.md) | What each pool has spent |
| [PROXY.md](server/PROXY.md) | The model proxy under `/v1` |
| [MCP.md](server/MCP.md) | The host's tools for a person's MCP client, at `/mcp` |
| [REFERENCE.md](server/REFERENCE.md) | Every command and flag, generated from the code |

## sdk

For a person who builds a host with `@ahpd/sdk`: what each subject is, as the code defines it.

| File | What it covers |
| --- | --- |
| [AHP.md](sdk/AHP.md) | The surface: every command, action and well-known key this host serves, with the row that says why |
| [AGENT.md](sdk/AGENT.md) | Writing a backend: the `Agent` interface, and what a backend owes the host |
| [BUILD-A-HOST.md](sdk/BUILD-A-HOST.md) | Building a host with `@ahpd/sdk` instead of running this one |
| [HOST.md](sdk/HOST.md) | The host itself: what it announces, what it serves and every setting it reads |
| [SESSIONS.md](sdk/SESSIONS.md) | What a session is: its backend, its settings, the directories it may touch and what it is charged to |
| [CHATS.md](sdk/CHATS.md) | One conversation inside a session: its turns, its parts and the chat URI |
| [RESOURCES.md](sdk/RESOURCES.md) | Resources: what a scheme is, the `resource*` methods and the grants each asks for |
| [TOOLS.md](sdk/TOOLS.md) | What tools a session's model is offered, and where each set of them comes from |
| [TERMINALS.md](sdk/TERMINALS.md) | Terminals: where one runs, who opens one and its grants |
| [AUTOMATIONS.md](sdk/AUTOMATIONS.md) | Automations: their triggers, the runs they make and the catalogue they live on |
| [POLICY.md](sdk/POLICY.md) | Policies: who may use which agent, model and computer, and what a refusal says |
| [USAGE.md](sdk/USAGE.md) | Usage: the records this host writes and what a pool has been charged |
| [USERS.md](sdk/USERS.md) | The user directory: the people, their roles and what their work may be charged to |
| [AUTHENTICATION.md](sdk/AUTHENTICATION.md) | Proving who a client is: the door, the tokens, `authenticate`, the issuer and what is readable before signing in |

## plugins

For a person who writes a plugin, and one page for each plugin that ships in this repository.

| File | What it covers |
| --- | --- |
| [PLUGINS.md](plugins/PLUGINS.md) | Writing a plugin: the contract, what you may register, the manifest and how one is named |
| [agent-acp.md](plugins/agent-acp.md) | An AHP backend over the Agent Client Protocol: any ACP server is one provider |
| [agent-claude.md](plugins/agent-claude.md) | Claude Code as a backend: a plugin for the daemon and an `Agent` for `@ahpd/sdk` |
| [agent-cofold.md](plugins/agent-cofold.md) | An AHP backend over the cofold agent runtime: every model it can reach is a model inside one provider |
| [agent-pi.md](plugins/agent-pi.md) | The pi coding agent as a backend, embedded in process |
| [bot.md](plugins/bot.md) | Bots for the daemon: the `bot:` resource provider |
| [BOTS.md](plugins/BOTS.md) | Bots: the `bot:` scheme, the record a bot is, and the session it is talked to in |
| [computer.md](plugins/computer.md) | Disposable Docker machines for the daemon: the `computer:` resource provider and its tools |
| [COMPUTERS.md](plugins/COMPUTERS.md) | `@ahpd/computer`: making a machine, running a session inside it, and the profiles that decide what it is |
| [CONTAINERS.md](plugins/CONTAINERS.md) | A session inside a folder's dev container, with a host of its own running in there |
| [push.md](plugins/push.md) | Expo push notifications: the `push:` resource provider a device registers with |
| [tunnel-devtunnel.md](plugins/tunnel-devtunnel.md) | Forwards the bound port through a Microsoft Dev Tunnel so VS Code can reach the daemon from anywhere |
| [webhook.md](plugins/webhook.md) | Webhooks for the daemon: a URL that talks to a bot or fires an automation |
| [WEBHOOKS.md](plugins/WEBHOOKS.md) | Webhooks: a URL that talks to a bot or fires an automation, with a secret per endpoint |

## updates

What changed in each release: one page for each minor release, with its patch releases on the same page.

| File | What it covers |
| --- | --- |
| [archive.md](updates/archive.md) | Every release, by year |
| [v0_15.md](updates/v0_15.md) | 0.15.0-rc.1 and 0.15.0-rc.2 |
| [v0_14.md](updates/v0_14.md) | 0.14.0 |
| [v0_13.md](updates/v0_13.md) | 0.13.0 |
| [v0_12.md](updates/v0_12.md) | 0.12.0 |
| [v0_11.md](updates/v0_11.md) | 0.11.0 |

What the repository is, and how to start it, is the root README. Where the reference lives and which revisions were last read is [REFERENCE.md](../REFERENCE.md). The reasoning behind a choice these files link is under [`.project/decisions/`](../.project/decisions/).
