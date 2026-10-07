# @ahpd/agent-pi

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fagent-pi)](https://www.npmjs.com/package/@ahpd/agent-pi)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

The [pi coding agent](https://github.com/earendil-works/pi) as a backend for [`@ahpd/sdk`](https://www.npmjs.com/package/@ahpd/sdk), and a plugin for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon. A pi session runs on one machine and is driven from VS Code, [`ahpc`](https://github.com/softov/ahpc) or any other AHP client, with more than one watching at once.

pi runs inside the daemon's process through pi's own SDK, not as a `pi --mode rpc` subprocess.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/agent-pi`](https://github.com/softov/ahpd/tree/main/packages/agent-pi).

## In the daemon

```bash
ahpd plugin install @ahpd/agent-pi
ahpd --plugin @ahpd/agent-pi --path /work/project
```

Or in the configuration file:

```json
{ "plugins": ["@ahpd/agent-pi"] }
```

pi reads its model providers and credentials from its own settings, so nothing here needs configuring. Set up at least one provider for pi first; running `pi` by hand in the same directory is the quickest check.

### In a machine

A pi session whose `computer` setting names a machine runs nested: pi is a library in the daemon's process, so an `ahpd` from the `ahpd` part, which carries this plugin, is started inside the machine and runs the session there. Any glibc image runs it with nothing installed.

pi's agent directory inside is `/ahpd/pi`, set as `PI_CODING_AGENT_DIR`: a state volume seeded with this host's `settings.json` and `models.json`, or this host's directory mounted read-write in a profile with `state: "host"`. `auth.json` is never seeded, so a key reaches the machine as a need the profile fills, one per variable pi's provider list reads, named `<provider>.<VARIABLE>`:

```json
{ "plugins": [{ "name": "@ahpd/computer", "options": {
  "profiles": { "pi": { "agents": ["pi"], "needs": { "pi.ANTHROPIC_API_KEY": { "$secret": "user:ada/anthropic" } } } }
} }] }
```

Such a key reaches pi's nested host and no other agent in the machine. A variable only pi's own `models.json` names is not declared, and does not reach a machine. See [pi in a machine](https://github.com/softov/ahpd/blob/main/docs/COMPUTER.md#pi-in-a-machine).

## In your own host

```bash
pnpm add @ahpd/agent-pi @ahpd/sdk
```

```ts
import { createHost, listen } from '@ahpd/sdk';
import { piAgent } from '@ahpd/agent-pi';

const path = process.cwd();
const host = createHost({ path, agents: [piAgent({}, [path])] });
await listen({ port: 9187 }, (peer) => host.accept(peer));
```

`piAgent(options, directories)` takes the options below and the directories the backend may work in.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `provider` | `pi` | The id a client names in `createSession` |
| `displayName` | `pi` | What a person reads instead of the id |
| `description` | | One line about this backend |
| `model` | | The model a new session runs on, as `provider/modelId`; a turn may choose another, and a resumed or forked session keeps its own |
| `projectTrust` | `trust` | Whether a project's own pi extensions, skills and prompts are loaded |
| `sessionDir` | pi's own (`~/.pi`) | Where pi keeps its sessions |

```json
{
  "plugins": [
    { "name": "@ahpd/agent-pi", "options": { "projectTrust": "deny" } }
  ]
}
```

`projectTrust` is `trust` or `deny`. pi's third answer, `ask`, is not offered, because a daemon has nobody at a terminal to answer it. `trust` loads the project's pi resources, which runs its code.

The host's own answer about the folder is asked as well, and both have to say yes. A folder no window vouched for loads none of the project's extensions, skills or prompts, however `projectTrust` is set. See [Trusted folders](https://github.com/softov/ahpd/blob/main/docs/USERS.md#trusted-folders).

With `sessionDir` left alone, `pi` run by hand in the same directory lists the sessions started here, and the other way round.

## What maps, and what does not

Some of pi lands on the protocol without adaptation:

- **Steering** is pi's own `steer()`, so a message sent into a running turn is the thing the protocol means rather than a queued message pretending to be one.
- **Truncation** is `navigateTree`. pi's sessions are append-only trees: the leaf moves back and the abandoned path stops being context, which is exactly what `chat/truncated` asks for. A turn read back from pi's file ends at the entry the file says it did, so it can be truncated like one this session watched. A `!command` turn and one whose `prompt` threw leave no point to cut at, and the host refuses to truncate them.
- **The thinking level** rides in each model's own `configSchema`, the protocol's escape hatch for a model that needs an answer beside its name. A client draws it as a form beside the model and sends the values back in `ModelSelection.config`.
- **Models** are identified as `provider/modelId`, the way pi's own configuration spells one, so two providers serving a model of the same name stay apart. The probe lists the models pi's own runtime has for its agent directory, so a client's picker has them before any session opens and after a restart. A provider only a project's extension registers arrives when a session in that project opens.
- **Forking a turn** is `SessionManager.createBranchedSession`. The entry a turn settled at is what a fork cuts at, and branching there writes the conversation through that turn, answer included, under a new id, leaving the source file as it was.
- **The session file** is a real path, so the reference client's "open session state file" opens the conversation pi actually wrote.
- **Host and client tools.** The tools the host contributes to a session are offered to pi's model, and one of the host's own runs in the host. A tool a connected client provides is offered too, and a call to it is reported against that client and waits for its answer. A client's tools take effect from the next turn, because pi fixes its custom tools when the session starts and the session is restarted on the same file with the new set.
- **Tool confirmation.** A session asks a person before a call its `permissionMode` says to ask about: the call is shown `pending-confirmation`, the session is `InputNeeded`, and the answer runs the call or blocks it with a reason the model reads. A tool that declares no effects runs, a read outside the working directory asks, and the six modes carry the meanings Claude and cofold advertise, with `default` as pi's default.

Some of it does not, and the backend does not advertise it:

- **Turning a customization on or off, and MCP servers.** pi loads its extensions and skills when it opens and has no runtime switch for them, and MCP in pi is an extension's job. Both answer `false`.
- **Several directories per session.** pi's `AgentSession` has a single `cwd`, which its tools, project resources and session store all use.

## The catalogue

Sessions are listed from two places at once: pi's own files, so a conversation somebody had from the `pi` command in a served directory has a row here, and the sessions this process is running. A row that came off disk opens with its turns: the entries on the file's current branch are raised as the events pi raises live and read through the same mapping a running turn uses, so a rebuilt turn has the same text, reasoning and tool calls a watched one has. A session this process is running answers from what it watched, after the turns it resumed from the file.

## Documentation

| | |
| --- | --- |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/PLUGINS.md) | Loading a plugin into the daemon |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) | The `Agent` and `Session` contracts this implements |
| [pi](https://github.com/earendil-works/pi) | The coding agent this runs |

## License

MIT © Softov
