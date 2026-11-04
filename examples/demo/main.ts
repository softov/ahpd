import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHost, fileResources, gitBranches, gitChanges, gitWorktrees, listen, memoryAutomations, shellTerminals } from '@ahpd/sdk';
import { pty } from '../../packages/server/src/pty.js';
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

/*
 * The daemon's own pseudoterminal: `node-pty` on Node, Bun's terminal on Bun,
 * and pipes where neither loads. Under one, a shell prints its prompt and
 * echoes what it is sent, as a terminal on the daemon does.
 */
const terminalBinding = await pty();

const host = createHost({
  path,
  agents: [demo({ path })],
  resources: fileResources(),
  terminals: shellTerminals(terminalBinding),
  directories: gitBranches(),
  changes: gitChanges(),
  // A git folder offers isolation and branch on a new session, as on the daemon.
  worktrees: gitWorktrees(),
  automations: memoryAutomations(),
  onEvent: (message) => process.stdout.write(`${message}\n`),
});

const listener = await listen(
  { port: Number(flag('port', '9210')) },
  (peer) => host.accept(peer),
);

process.stdout.write(`demo host on ws://${listener.host}:${listener.port} (${listener.runtime}), serving ${path}\n`);
