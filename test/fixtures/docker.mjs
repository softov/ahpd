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

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

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
/*
 * Written beside the state and renamed over it, so a test reading the file
 * while the provider is between calls never sees it half-written. A plain
 * `writeFileSync` truncates first, and a reader that lands in that window gets
 * an empty file - which a test waiting for a machine to disappear must not
 * mistake for the machine being gone.
 */
const keep = () => {
  const scratch = `${state}.${process.pid}.tmp`;
  writeFileSync(scratch, JSON.stringify(held));
  renameSync(scratch, state);
};

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
      // As `docker ps --format '{{json .}}'` reports it: one comma-separated
      // column, which is where the runtime reads the `ahpd.agents` label from
      // for the picker's filter.
      Labels: Object.entries(machine.labels ?? {}).map(([key, value]) => `${key}=${value}`).join(','),
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

if (verb === 'run' || verb === 'create') {
  /*
   * A create that fails, on purpose.
   *
   * A test that wants the runtime's own sentence - what a session is answered
   * with when a machine cannot be made - sets this in the state file first.
   */
  if (held.failRun === true) {
    keep();
    process.stderr.write('Error response from daemon: the scripted docker refuses to make this one\n');
    process.exit(1);
  }
  const named = args.indexOf('--name');
  const image = args[args.length - 3];
  /** `key=value` as its two halves, on the first `=`. */
  const pair = (said) => {
    const at = String(said).indexOf('=');
    return at === -1 ? [String(said), ''] : [String(said).slice(0, at), String(said).slice(at + 1)];
  };
  const mounts = [];
  const env = {};
  const labels = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-v') mounts.push(args[i + 1]);
    if (args[i] === '-e') { const [key, value] = pair(args[i + 1]); env[key] = value; }
    if (args[i] === '--label') { const [key, value] = pair(args[i + 1]); labels[key] = value; }
  }
  held.machines.push({
    name: named === -1 ? `unnamed-${held.machines.length}` : args[named + 1],
    image,
    cpus: args.includes('--cpus') ? args[args.indexOf('--cpus') + 1] : undefined,
    memory: args.includes('--memory') ? args[args.indexOf('--memory') + 1] : undefined,
    mounts,
    env,
    // The provider's own label plus whatever it added, which is what `inspect`
    // and `ps` read back.
    labels: { 'ahpd.computer': '1', ...labels },
    workdir: args.includes('-w') ? args[args.indexOf('-w') + 1] : undefined,
    // A create leaves it stopped, which is the whole point of the verb: what a
    // copy-in puts there has to be before the first process starts.
    state: verb === 'create' ? 'created' : 'running',
  });
  keep();
  process.stdout.write(`${'a'.repeat(64)}\n`);
  process.exit(0);
}

if (verb === 'cp') {
  // Recorded like every other call, so a test can assert the order: after the
  // create and before the start.
  keep();
  process.stdout.write('');
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
