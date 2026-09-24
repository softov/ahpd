#!/usr/bin/env node
/**
 * A scripted `docker`, for the computer: provider's tests.
 *
 * It answers `ps`, `inspect`, `run`, `stop`, `rm` and `exec` from one JSON file
 * named by `DOCKER_FAKE_STATE`, and appends every call to the same file, so a
 * test can ask what the provider ran and what it left behind. Nothing here
 * talks to a daemon and nothing sleeps: the provider is what is under test, not
 * Docker.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const state = process.env.DOCKER_FAKE_STATE;
if (state === undefined) {
  process.stderr.write('DOCKER_FAKE_STATE is not set\n');
  process.exit(2);
}

const args = process.argv.slice(2);
const held = existsSync(state)
  ? JSON.parse(readFileSync(state, 'utf8'))
  : { machines: [], calls: [] };
held.calls.push(args);
const keep = () => writeFileSync(state, JSON.stringify(held));

const verb = args[0];

if (verb === 'ps') {
  for (const machine of held.machines) {
    process.stdout.write(`${JSON.stringify({
      Names: machine.name,
      Image: machine.image,
      Status: 'Up 1 second',
      CreatedAt: '2026-09-22 00:00:00 +0000',
    })}\n`);
  }
  keep();
  process.exit(0);
}

if (verb === 'inspect') {
  const id = args[args.length - 1];
  const found = held.machines.find((machine) => machine.name === id);
  if (found === undefined) {
    process.stderr.write(`Error: No such object: ${id}\n`);
    keep();
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({
    Name: `/${found.name}`,
    Image: found.image,
    Created: '2026-09-22T00:00:00Z',
    State: { Status: 'running' },
    Config: { WorkingDir: found.workdir ?? '' },
  })}\n`);
  keep();
  process.exit(0);
}

if (verb === 'run') {
  const named = args.indexOf('--name');
  const image = args[args.length - 3];
  const mounts = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-v') mounts.push(args[i + 1]);
  }
  held.machines.push({
    name: named === -1 ? `unnamed-${held.machines.length}` : args[named + 1],
    image,
    cpus: args.includes('--cpus') ? args[args.indexOf('--cpus') + 1] : undefined,
    memory: args.includes('--memory') ? args[args.indexOf('--memory') + 1] : undefined,
    mounts,
    workdir: args.includes('-w') ? args[args.indexOf('-w') + 1] : undefined,
  });
  keep();
  process.stdout.write(`${'a'.repeat(64)}\n`);
  process.exit(0);
}

if (verb === 'stop') {
  keep();
  process.stdout.write(`${args[1]}\n`);
  process.exit(0);
}

if (verb === 'rm') {
  held.machines = held.machines.filter((machine) => machine.name !== args[args.length - 1]);
  keep();
  process.stdout.write(`${args[args.length - 1]}\n`);
  process.exit(0);
}

if (verb === 'exec') {
  keep();
  process.stdout.write(`scripted output from ${args[2]}\n`);
  process.exit(0);
}

keep();
process.stderr.write(`the scripted docker does not answer ${verb}\n`);
process.exit(2);
