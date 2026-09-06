# @ahpd/agent-claude

The Claude backend for [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server).

## Install

```bash
pnpm add @ahpd/agent-claude @ahpd/server @microsoft/agent-host-protocol
```

## Use

```ts
import { createHost, listen } from '@ahpd/server';
import { claude } from '@ahpd/agent-claude';

const path = process.cwd();
const host = createHost({ path, agents: [claude({ paths: [path] })] });
await listen({ port: 9187 }, (peer) => host.accept(peer));
```

`createHost` takes a list of agents, so this can run alongside other backends.

## What it does

It starts the [Claude agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), converts its message stream into AHP state actions, and reads Claude's transcript files.

| export | |
| --- | --- |
| `claude(options)` | the `Agent` to pass to `createHost` |
| `createSession(options)` | one live session |
| `catalogue(dir)` | Claude's sessions in a directory, as rows a host can list |
| `turnsOf(sessionId, dir)` | a past session read from its transcript, as turns |
| `probe(options)` | runs a CLI at startup to read the available models and commands |

## Supported

Turns and streaming, tool calls and approvals, questions from the agent, model and effort selection, permission modes, MCP servers and OAuth sign-in, skills and slash commands, multiple chats per session, forking a chat from a turn, truncating a chat back to a turn, session titles, token usage, and context compaction.

Sessions the host is not running are read from Claude's transcripts, so clients can browse and read them without starting a process. The agent starts when a turn is sent.

## Credentials

Sessions use whatever the Claude CLI is signed in with. A client can push a token instead. Pushed tokens are held per connection and are not used for other clients' sessions.

## Documentation

| | |
| --- | --- |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) | The `Agent` and `Session` contracts this implements |
| [AHP.md](https://github.com/softov/ahpd/blob/main/docs/AHP.md) | Which actions are served, which are refused, and why |

## License

MIT © Softov

