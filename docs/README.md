# Documentation

One file per area of the host. Each says what is true today and links the decision behind a choice rather than repeating its reasoning, and a reader finds an area by its file name.

| File | What it covers |
| --- | --- |
| [README.md](README.md) | This index |
| [AGENT.md](AGENT.md) | Writing a backend: the `Agent` interface, and what a backend owes the host |
| [AHP.md](AHP.md) | The surface: every command, action and well-known key this host serves, with the row that says why |
| [AUTHENTICATION.md](AUTHENTICATION.md) | Proving who a client is: the door, the tokens, `authenticate`, the issuer and what is readable before signing in |
| [AUTOMATIONS.md](AUTOMATIONS.md) | Automations: their triggers, the runs they make and the catalogue they live on |
| [CHATS.md](CHATS.md) | One conversation inside a session: its turns, its parts and the chat URI |
| [COMPUTER.md](COMPUTER.md) | `@ahpd/computer`: making a machine, running a session inside it, and the profiles that decide what it is |
| [CONTAINERS.md](CONTAINERS.md) | A session inside a folder's dev container, with a host of its own running in there |
| [DAEMON.md](DAEMON.md) | Running the daemon: its verbs, its flags and the configuration file under them |
| [HOST.md](HOST.md) | The host itself: what it announces, what it serves and every setting it reads |
| [LIBRARY.md](LIBRARY.md) | Building a host with `@ahpd/sdk` instead of running this one |
| [PLUGINS.md](PLUGINS.md) | Writing a plugin: the contract, what you may register, the manifest and how one is named |
| [POLICY.md](POLICY.md) | Policies: who may use which agent, model and computer, and what a refusal says |
| [PROXY.md](PROXY.md) | The model proxy: calling a provider through this host under `/v1` with an ahpd token |
| [RESOURCES.md](RESOURCES.md) | Resources: what a scheme is, the `resource*` methods and the grants each asks for |
| [SESSIONS.md](SESSIONS.md) | What a session is: its backend, its settings, the directories it may touch and what it is charged to |
| [TERMINALS.md](TERMINALS.md) | Terminals: where one runs, who opens one and its grants |
| [TOOLS.md](TOOLS.md) | What tools a session's model is offered, and where each set of them comes from |
| [USAGE.md](USAGE.md) | Usage: the records this host writes and what a pool has been charged |
| [USERS.md](USERS.md) | The user directory: the people, their roles and what their work may be charged to |

What the repository is, and how to start it, is [the root README](../README.md). Where the reference lives and which revisions were last read is [REFERENCE.md](../REFERENCE.md). The reasoning behind a choice these files link is under [`.project/decisions/`](../.project/decisions/).
