import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHost, fileResources, gitBranches, gitChanges, listen, shellTerminals } from '@ahpd/server';
import { notes } from './agent.js';

/**
 * A host serving a backend with tools.
 *
 * Registration is echo's, unchanged: `createHost` was given a backend it had
 * never heard of, and nothing in it knows that this one asks before it writes
 * where the other one never asks at all. What differs is entirely inside
 * `agent.ts`.
 *
 *   node dist/examples/notes/main.js --port 9201
 *
 * Then point any AHP client at it:
 *
 *   ahpc --host ws://127.0.0.1:9201
 */

const flag = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};

/*
 * A directory of its own, because this backend writes files.
 *
 * `notes/` under wherever it was started rather than the working directory
 * itself: an example that scatters `.md` files across somebody's checkout the
 * first time they try it is one they have to clean up before they can read it.
 */
const path = resolve(flag('path', 'notes'));
await mkdir(path, { recursive: true });

const host = createHost({
  path,
  agents: [notes({ path })],
  resources: fileResources(),
  terminals: shellTerminals(),
  directories: gitBranches(),
  changes: gitChanges(),
  onEvent: (message) => process.stdout.write(`${message}\n`),
});

const listener = await listen(
  { port: Number(flag('port', '9201')) },
  (peer) => host.accept(peer),
);

process.stdout.write(`notes host on ws://${listener.host}:${listener.port} (${listener.runtime}), notes in ${path}\n`);
