# @ahpd/agent-claude

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fagent-claude)](https://www.npmjs.com/package/@ahpd/agent-claude)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

The Claude backend for [`@ahpd/sdk`](https://www.npmjs.com/package/@ahpd/sdk).

## Install

```bash
pnpm add @ahpd/agent-claude @ahpd/sdk @microsoft/agent-host-protocol
```

## Use

```ts
import { createHost, listen } from '@ahpd/sdk';
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

