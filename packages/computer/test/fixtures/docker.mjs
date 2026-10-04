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

import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';

const state = process.env.DOCKER_FAKE_STATE;
if (state === undefined) {
  process.stderr.write('DOCKER_FAKE_STATE is not set\n');
  process.exit(2);
}

/*
 * One call at a time over the state file.
 *
 * Each call reads the whole file and writes the whole file back, so two calls
 * that overlap - a provider's startup `ps` beside a session's `run` - would
 * have the later writer drop what the earlier one recorded. A real daemon
 * serialises them; this directory does the same, and is let go on exit. A
 * lock older than `STALE` belongs to a call that died holding it.
 */
const lock = `${state}.lock`;
const STALE = 10_000;
const pause = new Int32Array(new SharedArrayBuffer(4));
for (;;) {
  try {
    mkdirSync(lock);
    break;
  }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try {
      if (Date.now() - statSync(lock).mtimeMs > STALE) rmdirSync(lock);
    }
    catch {}
    Atomics.wait(pause, 0, 0, 2);
  }
}
process.on('exit', () => {
  try { rmdirSync(lock); }
  catch {}
});

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
  /*
   * Any `--format` a provider asks with, as Docker renders it.
   *
   * `{{.Field}}` is one of the listing's own fields, `{{.Label "key"}}` one
   * label by name, and `{{json .}}` keeps its own shape.
   *
   * `.Labels` is the one that is not JSON whatever is asked of it: a listing
   * prints every label as one column of `key=value` pairs joined by commas,
   * with or without `json` in front of it. So a value holding a comma cannot be
   * told from the pair after it, which is why a provider that means to read
   * labels asks `inspect` for them instead - see the `inspect` below.
   */
  const joined = (labels) => Object.entries(labels).map(([key, value]) => `${key}=${value}`).join(',');
  const render = (format, row, labels) => format.replace(
    /\{\{\s*(json\s+)?\.(\w+)(?:\s+"([^"]*)")?\s*\}\}/gu,
    (whole, json, field, label) => {
      if (field === 'Labels') return joined(labels);
      if (json !== undefined) return JSON.stringify(String(row[field] ?? ''));
      if (field === 'Label') return String(labels[label] ?? '');
      return String(row[field] ?? '');
    },
  );
  const format = args.includes('--format') ? args[args.indexOf('--format') + 1] : undefined;
  for (const machine of held.machines) {
    if (asked !== undefined && machine.bare === true) continue;
    const labels = machine.labels ?? {};
    const row = {
      Names: machine.name,
      Image: machine.image,
      // As `docker ps` words it: `Up ...` for a container that is running,
      // `Exited ...` for one that is not, which is what tells a listing's rows
      // apart. The listing is `ps -a`, so it holds both.
      Status: (machine.state ?? 'running') === 'running' ? 'Up 1 second' : 'Exited (0) 2 minutes ago',
      CreatedAt: '2026-09-22 00:00:00 +0000',
    };
    // `{{json .}}` keeps the shape Docker gives it, where every label is one
    // comma-joined column and a value holding a comma cannot be told from the
    // pair after it. Any other format is rendered field by field.
    process.stdout.write(format === undefined || format === '{{json .}}'
      ? `${JSON.stringify({ ...row, Labels: joined(labels) })}\n`
      : `${render(format, row, labels)}\n`);
  }
  /*
   * A machine removed between this listing and the call that follows it.
   *
   * `vanishAfterPs` names a machine this listing has just answered and then
   * drops, which is what a machine somebody else took away in between looks
   * like: the `inspect` after it is asked for a machine that is not there and
   * answers the others with a non-zero exit.
   */
  if (typeof held.vanishAfterPs === 'string') {
    held.machines = held.machines.filter((machine) => machine.name !== held.vanishAfterPs);
  }
  keep();
  process.exit(0);
}

/*
 * What one machine's record says, as `docker inspect` gives it.
 *
 * The labels are a real map here, which is the whole difference from a listing:
 * a value holding a comma, a tab or a newline is a value.
 */
const recordOf = (found) => ({
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
});

/** One `.a.b` path into a record, for `--format '{{json .a.b}}'`. */
const at = (record, path) => path.split('.').reduce(
  (held, key) => (typeof held === 'object' && held !== null ? held[key] : undefined),
  record,
);

/*
 * `--format` as docker renders it over a record, whatever is asked of it.
 *
 * `{{.Field}}` is one value as a string, `{{json .}}` the whole record and
 * `{{json .Config.Labels}}` one map - and a format may ask for both at once,
 * which is how a caller asks for the machine a line belongs to beside the
 * labels that machine carries. `{{.Name}}` keeps the leading `/` docker gives a
 * container's name in a record, which a listing does not print.
 */
const renderRecord = (format, record) => format.replace(
  /\{\{\s*(json\s+)?\.([\w.]*)\s*\}\}/gu,
  (whole, json, path) => {
    const value = path === '' ? record : at(record, path);
    if (json !== undefined) return JSON.stringify(value ?? null);
    return typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  },
);

if (verb === 'inspect') {
  /*
   * `--format` as docker renders it, over every id asked for.
   *
   * One line per machine that is there, one machine that is not there as an
   * error on stderr and a non-zero exit, with the others still printed, which
   * is what docker does - and the reason a caller reads these lines by name
   * rather than by the order it asked in.
   */
  const formatAt = args.indexOf('--format');
  const format = formatAt === -1 ? '{{json .}}' : args[formatAt + 1];
  const missing = [];
  for (const id of args.slice(formatAt === -1 ? 1 : formatAt + 2)) {
    const found = held.machines.find((machine) => machine.name === id);
    if (found === undefined) {
      missing.push(id);
      continue;
    }
    process.stdout.write(`${renderRecord(format, recordOf(found))}\n`);
  }
  keep();
  if (missing.length > 0) {
    process.stderr.write(`Error: No such object: ${missing.join(', ')}\n`);
    process.exit(1);
  }
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
  /*
   * Two mounts at one target, refused as Docker refuses them: the same error,
   * so a manifest that named one target twice fails here as it would there.
   */
  const targets = new Set();
  for (const mount of mounts) {
    const target = mount.split(':')[1];
    if (targets.has(target)) {
      keep();
      process.stderr.write(`Error response from daemon: Duplicate mount point: ${target}\n`);
      process.exit(1);
    }
    targets.add(target);
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
