import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHost, fileResources, gitBranches, gitChanges, listen, memoryAutomations, shellTerminals } from '@ahpd/sdk';
import { demo } from './agent.js';

/**
 * A host with something on every screen a client draws.
 *
 * `examples/notes/main.ts` with the `demo` backend and automations held in
 * memory, so a client can make automations, run them and list their runs.
 *
 *   pnpm demo -- --port 9210 --path /tmp/demo
 *
 * Then point any AHP client at it:
 *
 *   ahpc --host ws://127.0.0.1:9210
 */

const flag = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};

/** The folder the host serves and the notes are kept in, made if it is missing. */
const path = resolve(flag('path', 'demo'));
await mkdir(path, { recursive: true });

const host = createHost({
  path,
  agents: [demo({ path })],
  resources: fileResources(),
  terminals: shellTerminals(),
  directories: gitBranches(),
  changes: gitChanges(),
  automations: memoryAutomations(),
  onEvent: (message) => process.stdout.write(`${message}\n`),
});

const listener = await listen(
  { port: Number(flag('port', '9210')) },
  (peer) => host.accept(peer),
);

process.stdout.write(`demo host on ws://${listener.host}:${listener.port} (${listener.runtime}), serving ${path}\n`);
