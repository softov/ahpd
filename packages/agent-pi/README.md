# @ahpd/agent-pi

The [pi coding agent](https://github.com/earendil-works/pi) as a backend for [`ahpd`](https://github.com/softov/ahpd), so a pi session can be run on one machine and driven from another over the Agent Host Protocol - from VS Code, from [`ahpc`](https://github.com/softov/ahpc), or from any other AHP client, with more than one watching at once.

pi is embedded, not spawned. `AgentSession` is constructible from pi's own SDK, so the agent runs in the daemon's process: there is no `pi --mode rpc` subprocess and no stdio between the host and the agent. A subprocess would add process lifecycle and backpressure without isolating anything, since the model credentials and the files are the same either way.

## Use

```bash
ahpd plugin install @ahpd/agent-pi
ahpd --plugin @ahpd/agent-pi --path /work/project
```

Or in the configuration file:

```json
{ "plugins": ["@ahpd/agent-pi"] }
```

pi resolves its own model provider and credentials from its own settings, so there is nothing to configure here to get a working session. It needs at least one model provider set up for pi first - `pi` run by hand in the same directory is the quickest way to check.

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

`projectTrust` is `trust` or `deny` and never pi's third answer, `ask`: a daemon has nobody at a terminal to ask, and a prompt nothing can answer is a session that never starts. `trust` loads the checked-out project's pi resources, which means running its code - the same decision `pi` asks a person about on a directory it has not seen.

`sessionDir` left alone means a session started here is one `pi` run by hand in the same directory will list, because both look in the same place.

## What maps, and what does not

Some of pi lands on the protocol without adaptation:

- **Steering** is pi's own `steer()`, so a message sent into a running turn is the thing the protocol means rather than a queued message pretending to be one.
- **Truncation** is `navigateTree`. pi's sessions are append-only trees: the leaf moves back and the abandoned path stops being context, which is exactly what `chat/truncated` asks for. A turn read back from pi's file ends at the entry the file says it did, so it can be truncated like one this session watched. A `!command` turn and one whose `prompt` threw leave no point to cut at, and the host refuses to truncate them.
- **The thinking level** rides in each model's own `configSchema`, the protocol's escape hatch for a model that needs an answer beside its name. A client draws it as a form beside the model and sends the values back in `ModelSelection.config`.
- **Models** are identified as `provider/modelId`, the way pi's own configuration spells one, so two providers serving a model of the same name stay apart. The probe lists the models pi's own runtime has for its agent directory, so a client's picker has them before any session opens and after a restart. A provider only a project's extension registers arrives when a session in that project opens.
- **The session file** is a real path, so the reference client's "open session state file" opens the conversation pi actually wrote.
- **Host and client tools.** The tools the host contributes to a session are offered to pi's model, and one of the host's own runs in the host. A tool a connected client provides is offered too, and a call to it is reported against that client and waits for its answer. A client's tools take effect from the next turn, because pi fixes its custom tools when the session starts and the session is restarted on the same file with the new set.
- **Tool confirmation.** A session asks a person before a call its `permissionMode` says to ask about: the call is shown `pending-confirmation`, the session is `InputNeeded`, and the answer runs the call or blocks it with a reason the model reads. A tool that declares no effects runs, a read outside the working directory asks, and the six modes carry the meanings Claude and cofold advertise, with `default` as pi's default.

Some of it does not, and the backend says so rather than pretending:

- **Forking a turn.** pi can branch from an entry, but naming the entry a *turn* began at means recording it as the turn runs. This backend does not, so it advertises no fork rather than offering a control that fails when used.
- **Turning a customization on or off, and MCP servers.** pi loads its extensions and skills when it opens and has no runtime switch for them, and its MCP support is an extension's business rather than pi's. Both answer `false`, which is a real answer; a control that reported success and changed nothing would be worse.
- **Several directories per session.** pi's `AgentSession` is built around a single `cwd` - its tools, its project resources and its session store all hang off it.

## The catalogue

Sessions are listed from two places at once: pi's own files, so a conversation somebody had from the `pi` command in a served directory has a row here, and the sessions this process is running. A row that came off disk opens with its turns: the entries on the file's current branch are raised as the events pi raises live and read through the same mapping a running turn uses, so a rebuilt turn has the same text, reasoning and tool calls a watched one has. A session this process is running answers from what it watched, after the turns it resumed from the file.

## License

MIT
