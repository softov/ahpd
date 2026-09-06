# @ahpd/agent-claude

The Claude backend for [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server): one `Agent`, and the transcripts it left behind.

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

`createHost` takes a list, so this can sit beside another backend and the host cannot tell them apart.

## What it does

This is the only thing in either package that knows what the Claude harness *is*. It starts the [agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), translates its message stream into the state actions the protocol describes, and reads a session somebody else's run left on disk.

| | |
| --- | --- |
| `claude(options)` | the `Agent` to register |
| `createSession(options)` | one live session, reduced into its channels' state |
| `catalogue(dir)` | Claude's own sessions, as rows a host can list |
| `turnsOf(sessionId, dir)` | a past session read out of its transcript, as turns |
| `probe(options)` | one CLI at startup, to learn the models and commands it offers |

A host serving some other harness has a different answer to every one of those, and no reason to load this package to find that out.

## What it covers

Turns and streaming, tool calls and their confirmation, the agent's own questions, model and effort selection, permission modes, MCP servers and signing into them, skills and slash commands, several chats in one session, forking a chat from a turn and truncating one back to a turn, session titles, usage, and compaction reported as what it is.

Sessions this host is not running are reconstructed from Claude's transcripts, so a client can browse and read them; the agent process only starts when somebody sends a turn.

## Credentials

Whatever the Claude CLI already has. A token pushed by a connected client is held per connection and never spent on another client's session; with none, sessions inherit the daemon's own.

## Documentation

| | |
| --- | --- |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) | The `Agent` and `Session` contracts this implements |
| [AHP.md](https://github.com/softov/ahpd/blob/main/docs/AHP.md) | Which actions are served, which are refused, and why |

MIT © Luiz Fernando Softov
