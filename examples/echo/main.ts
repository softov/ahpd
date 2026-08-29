import { createHost, fileResources, listen, shellTerminals } from '../../src/index.js';
import { echo } from './agent.js';

/**
 * A host of your own, in about ten lines.
 *
 * Three things and nothing else: a backend, a host to serve it, and a socket
 * to serve it on. Everything the protocol requires - version negotiation,
 * snapshots, subscriptions, sequence numbers, paging, completions - is the
 * host's, and none of it needed changing to add a backend it had never heard
 * of.
 *
 *   node dist/examples/echo/main.js --port 9200
 *
 * Then point any AHP client at it:
 *
 *   ahpc --host ws://127.0.0.1:9200
 */

const flag = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};

const path = flag('path', process.cwd());

const host = createHost({
  path,
  // Register as many as you like. The first is what a client gets when it
  // names none; each needs a `provider` no other has.
  agents: [echo({ path })],
  // The parts that touch the machine, handed in. `createHost` is the protocol
  // and owns neither a filesystem nor a shell, so a host that wants to serve
  // files and terminals says so - and one that does not simply leaves these
  // out and answers `-32601` when asked.
  resources: fileResources(),
  terminals: shellTerminals(),
  onEvent: (message) => process.stdout.write(`${message}\n`),
});

const listener = await listen(
  { port: Number(flag('port', '9200')) },
  (peer) => host.accept(peer),
);

process.stdout.write(`echo host on ws://${listener.host}:${listener.port} (${listener.runtime})\n`);
