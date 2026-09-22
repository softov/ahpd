# @ahpd/agent-acp

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fagent-acp)](https://www.npmjs.com/package/@ahpd/agent-acp)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

The [Agent Client Protocol](https://agentclientprotocol.com) backend for [`@ahpd/sdk`](https://www.npmjs.com/package/@ahpd/sdk).

Any program that speaks ACP over its stdio is one configured command rather than a package of its own, so `copilot --acp`, `codex-acp`, `gemini --experimental-acp` and `@deepseek-ai/dsh-acp` share one bridge.

## Install

```bash
pnpm add @ahpd/agent-acp @ahpd/sdk @microsoft/agent-host-protocol
```

## Use

```ts
import { createHost, listen } from '@ahpd/sdk';
import { acpAgent } from '@ahpd/agent-acp';

const path = process.cwd();
const host = createHost({
  path,
  agents: [
    acpAgent({ provider: 'copilot', displayName: 'Copilot', command: 'copilot', args: ['--acp'] }),
  ],
});
await listen({ port: 9187 }, (peer) => host.accept(peer));
```

`createHost` takes a list of agents, so several ACP servers run beside each other and beside any other backend.

## Options

| option | | |
| --- | --- | --- |
| `command` | required | the program to spawn as the ACP server |
| `args` | | the arguments to give it |
| `env` | | environment variables merged over `process.env` for the child |
| `cwd` | | the directory the server runs in; the session's working directory when absent |
| `provider` | | the AHP provider id, default `acp` |
| `displayName` | | what a client reads instead of the id, default `ACP` |
| `description` | | one line about what this backend is |
| `model` | | the model a session that names none runs on |

## What it does

It spawns the command, completes the ACP handshake over its stdio, opens one session, and turns each `session/update` into the `chat/*` action a client already knows. A turn ends as `chat/turnComplete` or `chat/turnCancelled` from the server's own stop reason, and `cancel` reaches the server as its notification.

The package is both an embeddable `Agent` and a plugin. An embedder passes `acpAgent(options)` to `createHost`; the daemon loads the same package to register one provider per configured command.

## Documentation

| | |
| --- | --- |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) | The `Agent` and `Session` contracts this implements |
| [AHP.md](https://github.com/softov/ahpd/blob/main/docs/AHP.md) | Which actions are served, which are refused, and why |

## License

MIT © Softov
