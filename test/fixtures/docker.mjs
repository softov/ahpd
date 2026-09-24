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
  /*
   * The label filter, honoured rather than ignored.
   *
   * This listed everything it held, so a test could not tell a provider that
   * filters from one that does not - and the provider's scoping is exactly
   * what the label is for. A machine marked `bare` is something else's,
   * running on the same daemon with none of our labels on it.
   */
  const wanted = args.includes('--filter') ? args[args.indexOf('--filter') + 1] : undefined;
  const asked = wanted?.startsWith('label=') === true ? wanted.slice('label='.length) : undefined;
  for (const machine of held.machines) {
    if (asked !== undefined && machine.bare === true) continue;
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
    // `Running` as well as the word, because the provider answers the state
    // leaf from the boolean and a reader of the record still wants the word.
    State: {
      Status: found.state ?? 'running',
      Running: (found.state ?? 'running') === 'running',
    },
    // The label the provider puts on its own, because the provider now reads
    // it back: a container without it is not a computer, and a fixture that
    // left it out would be testing a case that cannot happen.
    Config: {
      WorkingDir: found.workdir ?? '',
      Labels: found.bare === true ? { ...(found.labels ?? {}) } : { 'ahpd.computer': '1', ...(found.labels ?? {}) },
    },
    // The limits as docker records them: nanoseconds of CPU per second, and
    // bytes. A gauge is drawn against these, so the units have to be real.
    HostConfig: {
      ...(found.cpus === undefined ? {} : { NanoCpus: Number(found.cpus) * 1e9 }),
      Memory: 0,
    },
    // As `docker inspect` reports them, because a caller's path is read
    // through these to find where it is inside the machine.
    Mounts: (found.mounts ?? []).map((one) => {
      const [source, target] = one.split(':');
      return { Type: 'bind', Source: source, Destination: target };
    }),
  })}\n`);
  keep();
  process.exit(0);
}

if (verb === 'stats') {
  // As `docker stats --no-stream --format '{{json .}}'` answers: display text
  // in every field, mixing binary and decimal units the way it really does,
  // so the parsing under test is the parsing that runs.
  const id = args[args.length - 1];
  const found = held.machines.find((machine) => machine.name === id);
  if (found === undefined) {
    process.stderr.write(`Error: No such container: ${id}\n`);
    keep();
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({
    Container: id,
    Name: id,
    CPUPerc: found.cpuPerc ?? '12.50%',
    MemUsage: found.memUsage ?? '444KiB / 512MiB',
    MemPerc: found.memPerc ?? '0.08%',
    PIDs: '7',
    NetIO: '1.01kB / 126B',
    BlockIO: '49.2kB / 0B',
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

if (verb === 'start' || verb === 'restart') {
  const id = args[args.length - 1];
  const found = held.machines.find((machine) => machine.name === id);
  if (found === undefined) {
    process.stderr.write(`Error: No such container: ${id}\n`);
    keep();
    process.exit(1);
  }
  found.state = 'running';
  found.started = (found.started ?? 0) + 1;
  keep();
  process.exit(0);
}

if (verb === 'stop') {
  const found = held.machines.find((machine) => machine.name === args[args.length - 1]);
  // Recorded, so a `state` read after a stop answers what actually happened
  // rather than the status the machine was made with.
  if (found !== undefined) found.state = 'exited';
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
