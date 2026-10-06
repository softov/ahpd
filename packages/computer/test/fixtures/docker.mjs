#!/usr/bin/env node
/**
 * A scripted `docker`, for the computer: provider's tests.
 *
 * It answers `ps`, `inspect`, `run`, `stop`, `rm` and `exec` from one JSON file
 * named by `DOCKER_FAKE_STATE`, and appends every call to the same file, so a
 * test can ask what the provider ran and what it left behind. `image inspect`
 * and `build` are there too, so a part image can be built without a daemon, and
 * `pull`, `volume` and an image `--mount`, so a part can be mounted from its
 * image or from a volume filled from it.
 * Nothing here talks to a daemon and nothing sleeps: the provider is what is
 * under test, not Docker.
 */

import { spawn } from 'node:child_process';
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
/**
 * Let the lock go, for a call that is done with the state file.
 *
 * A command the fixture runs for real has already written what it recorded and
 * will not touch the file again, and it can be the whole lifetime of a nested
 * host - a lock held for that long would answer every other call about this
 * host as a daemon that hangs.
 */
const release = () => {
  try { rmdirSync(lock); }
  catch {}
};

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

/** All of stdin, as one buffer, for a verb whose context arrives through a pipe. */
const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
};

if (verb === 'image') {
  /*
   * `docker image inspect`, which is about an image rather than a machine.
   *
   * A tag that is in `images` answers with a record and exits zero; a tag that
   * is not there is a non-zero exit, which is what the provider reads as "not
   * here, build it" - so an unknown tag must not answer zero and must not print
   * anything that looks like a record. `--format '{{json .Config.Env}}'` answers
   * the image's environment: `imageEnv` by tag, else the `PATH` Docker's own
   * images carry.
   */
  const tag = args[args.length - 1];
  const images = held.images ?? [];
  if (args[1] === 'inspect' && images.includes(tag)) {
    const env = (held.imageEnv ?? {})[tag] ?? ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'];
    // The user its containers run as: `imageUser` by tag, else root's empty one.
    const user = (held.imageUser ?? {})[tag] ?? '';
    const format = args.includes('--format') ? args[args.indexOf('--format') + 1] : undefined;
    process.stdout.write(format === '{{json .Config.Env}}'
      ? `${JSON.stringify(env)}\n`
      : format === '{{json .Config.User}}'
        ? `${JSON.stringify(user)}\n`
        : `${JSON.stringify({ Id: `sha256:${tag}`, Config: { Env: env, User: user } })}\n`);
    keep();
    process.exit(0);
  }
  keep();
  process.stderr.write(`Error response from daemon: No such image: ${tag}\n`);
  process.exit(1);
}

if (verb === 'build') {
  /*
   * A build whose context is piped, which is the whole build context: a tar
   * holding a `Dockerfile` and whatever else the Dockerfile copies.
   *
   * What is recorded is the Dockerfile and the names beside it, so a test can
   * assert on the text without a real build - `pnpm test` runs nowhere near a
   * daemon, and the point of the provider is the Dockerfile, not Docker.
   */
  const piped = await readStdin();
  const named = args.indexOf('-t');
  const tag = named === -1 ? undefined : args[named + 1];
  // A tar is a ustar header: `ustar` at 257. Anything else is the Dockerfile on
  // its own, which is what a part with no files beside it is built from.
  const isTar = piped.length > 262 && piped.subarray(257, 262).toString('latin1') === 'ustar';
  // Every entry of a tar, by name, in the order the archive holds them.
  const entries = isTar ? (() => {
    const found = [];
    for (let at = 0; at + 512 <= piped.length;) {
      const header = piped.subarray(at, at + 512);
      if (header.every((byte) => byte === 0)) break;
      const size = Number.parseInt(header.subarray(124, 136).toString('latin1').replace(/\0.*$/s, '').trim(), 8);
      found.push({ name: header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, ''), bytes: piped.subarray(at + 512, at + 512 + size) });
      at += 512 + ((size + 511) & ~511);
    }
    return found;
  })() : [{ name: 'Dockerfile', bytes: piped }];
  const dockerfile = entries.find((one) => one.name === 'Dockerfile');
  if (dockerfile === undefined) {
    keep();
    process.stderr.write('failed to read dockerfile: the context holds none\n');
    process.exit(1);
  }
  held.builds ??= [];
  held.images ??= [];
  held.builds.push({
    tag,
    dockerfile: dockerfile.bytes.toString('utf8'),
    files: entries.map((one) => one.name),
  });
  // A build a test wants to fail, on purpose, and by name so one part may fail
  // while the rest of the file is healthy.
  if (held.failBuild === true || (Array.isArray(held.failBuild) && held.failBuild.includes(tag))) {
    keep();
    process.stderr.write('ERROR: failed to solve: process "/bin/sh -c curl --fail" did not complete: exit 1\n');
    process.exit(1);
  }
  held.images.push(tag);
  keep();
  process.stdout.write(`Successfully tagged ${tag}\n`);
  process.exit(0);
}

/*
 * `docker pull`, which puts an image here unless `failPull` says the registry
 * has none.
 */
if (verb === 'pull') {
  const tag = args[args.length - 1];
  if (held.failPull === true) {
    keep();
    process.stderr.write(`Error response from daemon: pull access denied for ${tag}, repository does not exist or may require 'docker login'\n`);
    process.exit(1);
  }
  held.images ??= [];
  if (!held.images.includes(tag)) held.images.push(tag);
  keep();
  process.exit(0);
}

/*
 * Named volumes: `volume inspect` and `volume rm`.
 *
 * `volumes` holds each by name with the files in it, which is what a fill from
 * a part image and the marker written after it put there.
 */
if (verb === 'volume') {
  const name = args[args.length - 1];
  held.volumes ??= {};
  if (held.volumes[name] === undefined) {
    keep();
    process.stderr.write(`Error response from daemon: get ${name}: no such volume\n`);
    process.exit(1);
  }
  if (args[1] === 'rm') delete held.volumes[name];
  else process.stdout.write(`${JSON.stringify([{ Name: name, Driver: 'local' }])}\n`);
  keep();
  process.exit(0);
}

/*
 * The version flag, which is how the launcher asks whether Docker is there.
 *
 * Without it every `docker()` and `available()` would be answered by a program
 * that has nothing to say about itself, and the two would read as a host with
 * no Docker.
 */
if (args.includes('--version')) {
  process.stdout.write('Docker version 29.6.2, build 0000000\n');
  keep();
  process.exit(0);
}

/*
 * The container a call names, whichever of the two names it used.
 *
 * Docker answers to an id and to a name for the same object, and this host makes
 * containers that carry both - the id the CLI reported and the name Docker gave
 * it - so a lookup that only knew the name would say a container is not there
 * when it plainly is.
 */
const named = (id) => held.machines.find((machine) => machine.name === id || machine.id === id);

/**
 * One `-e` value as Docker reads it: `NAME=VALUE` as written, and `NAME` alone
 * from this program's own environment.
 *
 * Stricter than Docker on purpose. Docker drops an unset `-e NAME` silently and
 * the variable is simply missing inside; this refuses it, naming the variable,
 * so a caller that spawns `docker` without the environment the flag relies on
 * is a failing test rather than a machine quietly missing a value.
 */
/**
 * The `DOCKER_*` names this program was spawned with, its own state file aside.
 *
 * Real Docker reads every one of them - which daemon, which context, which
 * configuration - so a test asks this to prove none reached it from a machine.
 */
const dockerNames = () => Object.keys(process.env).filter((key) => key.startsWith('DOCKER_') && key !== 'DOCKER_FAKE_STATE');

const envPair = (said) => {
  const text = String(said);
  const eq = text.indexOf('=');
  if (eq !== -1) return [text.slice(0, eq), text.slice(eq + 1)];
  if (process.env[text] === undefined) {
    process.stderr.write(`the scripted docker was given -e ${text} and ${text} is not in its environment; Docker would drop it silently\n`);
    keep();
    process.exit(1);
  }
  return [text, process.env[text]];
};

if (verb === 'ps') {
  /*
   * The label filter, honoured rather than ignored.
   *
   * This listed everything it held, so a test could not tell a provider that
   * filters from one that does not - and the provider's scoping is exactly
   * what the label is for. A machine marked `bare` is something else's,
   * running on the same daemon with none of our labels on it.
   */
  /*
   * Every `--filter`, not the first one: Docker intersects them, and a lookup
   * that names two labels is asking for the container carrying both.
   */
  const asked = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--filter') continue;
    const said = String(args[i + 1]);
    if (said.startsWith('label=')) asked.push(said.slice('label='.length));
  }
  const labelled = (labels, one) => {
    const eq = one.indexOf('=');
    return eq === -1
      ? Object.keys(labels).includes(one)
      : labels[one.slice(0, eq)] === one.slice(eq + 1);
  };
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
    /*
     * The same projection `inspect` makes: a machine that is not somebody
     * else's carries this provider's label, which is what makes `ps` and
     * `inspect` answer about the same container.
     */
    const labels = machine.bare === true ? { ...(machine.labels ?? {}) } : { 'ahpd.computer': '1', ...(machine.labels ?? {}) };
    if (!asked.every((one) => labelled(labels, one))) continue;
    const row = {
      // The short id and the name, as `docker ps` prints them. The short form is
      // what makes an id recorded in full matchable against a listing.
      ID: String(machine.id ?? machine.name).slice(0, 12),
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
  Id: found.id ?? found.name,
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
    // As Docker records the image's environment: the list a
    // `${containerEnv:NAME}` in a dev container's `remoteEnv` is resolved
    // from, which is this and never the probe.
    Env: Object.entries(found.env ?? {}).map(([key, value]) => `${key}=${value}`),
    User: found.user ?? '',
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
    const found = named(id);
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
  const found = named(id);
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
  /*
   * The image is the first word that is not a flag or a flag's value, as Docker
   * reads it: a machine runs `<image> sleep infinity`, and a probe or a fill
   * helper is `<image> x`.
   */
  const valued = new Set(['--name', '--label', '-v', '-e', '-w', '--cpus', '--memory', '--mount', '--user']);
  let image;
  let imageAt = -1;
  for (let i = 1; i < args.length; i++) {
    if (valued.has(args[i])) { i++; continue; }
    if (String(args[i]).startsWith('-')) continue;
    image = args[i];
    imageAt = i;
    break;
  }
  /** `key=value` as its two halves, on the first `=`. */
  const pair = (said) => {
    const at = String(said).indexOf('=');
    return at === -1 ? [String(said), ''] : [String(said).slice(0, at), String(said).slice(at + 1)];
  };
  const mounts = [];
  const typed = [];
  const env = {};
  const labels = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-v') mounts.push(args[i + 1]);
    if (args[i] === '--mount') typed.push(args[i + 1]);
    if (args[i] === '-e') { const [key, value] = envPair(args[i + 1]); env[key] = value; }
    if (args[i] === '--label') { const [key, value] = pair(args[i + 1]); labels[key] = value; }
  }
  /*
   * An image mount, as Docker 29 takes it and an older Docker refuses it.
   *
   * `imageMounts: false` is a Docker that does not know the type, in the
   * daemon's own words; `failMount` is any other refusal a test wants, such as
   * the source image missing. A Docker that takes one warns on stderr that it
   * is experimental, and makes the container all the same.
   */
  const field = (mount, key) => String(mount).split(',').find((one) => one.startsWith(`${key}=`))?.slice(key.length + 1);
  const images = typed.filter((one) => field(one, 'type') === 'image');
  if (images.length > 0) {
    if (held.imageMounts === false) {
      keep();
      process.stderr.write('Error response from daemon: invalid mount config for type "image": mount type unknown\n');
      process.exit(1);
    }
    if (typeof held.failMount === 'string') {
      keep();
      process.stderr.write(`${held.failMount}\n`);
      process.exit(1);
    }
    const absent = images.map((one) => field(one, 'source')).find((one) => !(held.images ?? []).includes(one));
    if (absent !== undefined) {
      keep();
      // Docker names the container's image here rather than the missing one.
      process.stderr.write(`Unable to find image '${image}' locally\nError response from daemon: pull access denied for ${String(image).split(':')[0]}, repository does not exist or may require 'docker login'\n`);
      process.exit(1);
    }
    process.stderr.write('WARNING: Image mount is an experimental feature\n');
  }
  /*
   * A named volume, made when it is first mounted and filled from the image
   * at that path when it is empty - which is what makes a part's volume.
   */
  held.volumes ??= {};
  for (const mount of mounts) {
    const [source, target] = String(mount).split(':');
    if (source.startsWith('/')) continue;
    // A volume a test wants Docker to fail to fill, such as on a full disk.
    if ((held.failVolume ?? []).includes(source)) {
      keep();
      process.stderr.write(`Error response from daemon: failed to populate volume ${source}: no space left on device\n`);
      process.exit(1);
    }
    const volume = (held.volumes[source] ??= { files: [] });
    if (volume.files.length === 0 && (held.images ?? []).includes(image)) {
      volume.files.push(`from ${image} at ${target}`);
      (held.fills ??= []).push(source);
    }
  }
  /*
   * Two mounts at one target, refused as Docker refuses them: the same error,
   * so a manifest that named one target twice fails here as it would there.
   */
  const targets = new Set();
  for (const mount of [...mounts, ...typed.map((one) => `:${field(one, 'target')}`)]) {
    const target = mount.split(':')[1];
    if (targets.has(target)) {
      keep();
      process.stderr.write(`Error response from daemon: Duplicate mount point: ${target}\n`);
      process.exit(1);
    }
    targets.add(target);
  }
  /*
   * A `run --rm`, which runs one command and leaves no container: `id -u` and
   * `id -g` answer the `--user` from `users`, and a `chown` is recorded in
   * `chowns`, which is what a state volume's seeding asks of one.
   */
  if (verb === 'run' && args.includes('--rm')) {
    const command = args.slice(imageAt + 1);
    const user = args.includes('--user') ? args[args.indexOf('--user') + 1] : '';
    const ids = (held.users ?? {})[user] ?? { uid: 0, gid: 0 };
    if (command[0] === 'id') process.stdout.write(`${command[1] === '-g' ? ids.gid : ids.uid}\n`);
    if (command[0] === 'chown') (held.chowns ??= []).push(command);
    keep();
    process.exit(0);
  }
  held.machines.push({
    name: named === -1 ? `unnamed-${held.machines.length}` : args[named + 1],
    // The `DOCKER_*` names the make itself was spawned with.
    dockerEnv: dockerNames(),
    image,
    cpus: args.includes('--cpus') ? args[args.indexOf('--cpus') + 1] : undefined,
    memory: args.includes('--memory') ? args[args.indexOf('--memory') + 1] : undefined,
    mounts,
    // Each `--mount` as it was written, an image mount among them.
    ...(typed.length === 0 ? {} : { typed }),
    env,
    // The provider's own label plus whatever it added, which is what `inspect`
    // and `ps` read back. A container made with no label at all - a probe, a
    // volume's fill - is not the provider's machine and is not listed.
    ...(args.includes('--label') ? { labels: { 'ahpd.computer': '1', ...labels } } : { labels: {}, bare: true }),
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
  /*
   * Recorded like every other call, so a test can assert the order: after the
   * create and before the start.
   *
   * Into or out of a named volume a container mounts, the files are the
   * volume's: `cp - <id>:<dir>` unpacks the tar on stdin there, and `cp
   * <id>:<path> -` answers only a file that is there.
   */
  const volumeAt = (said) => {
    const at = String(said).indexOf(':');
    const found = named(String(said).slice(0, at));
    const path = String(said).slice(at + 1);
    for (const mount of found?.mounts ?? []) {
      const [source, target] = String(mount).split(':');
      if (!source.startsWith('/') && (path === target || path.startsWith(`${target}/`))) {
        return { volume: (held.volumes ??= {})[source] ??= { files: [] }, rest: path.slice(target.length + 1) };
      }
    }
    return undefined;
  };
  // `-a` keeps the uid and gid each entry carries, which is recorded in
  // `owners`; without it every entry is root's, as Docker makes it.
  const archive = args[1] === '-a';
  const said = archive ? [args[0], ...args.slice(2)] : args;
  if (said[1] === '-') {
    /*
     * Each entry by its whole path - the ustar prefix, then the name - with its
     * text kept in `contents`, over whatever the volume held at that path, and
     * the paths of one copy recorded in `copiedIn`. Each entry lands in the
     * volume its path falls in, so an archive written into the directory above
     * a mount reaches it. A directory entry is only its owner, `.` for the
     * mount point itself, which is the volume's root; an entry for the
     * directory the archive is written into is not applied, as Docker does not.
     */
    const piped = await readStdin();
    const dest = String(said[2]);
    const container = dest.slice(0, dest.indexOf(':'));
    const base = dest.slice(dest.indexOf(':') + 1).replace(/\/$/, '');
    const copied = [];
    const field = (header, from, to) => Number.parseInt(header.subarray(from, to).toString('latin1').replace(/\0.*$/s, '').trim() || '0', 8);
    for (let at = 0; at + 512 <= piped.length;) {
      const header = piped.subarray(at, at + 512);
      if (header.every((byte) => byte === 0)) break;
      const size = field(header, 124, 136);
      const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
      const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
      const owner = archive ? `${field(header, 108, 116)}:${field(header, 116, 124)}` : '0:0';
      const bytes = piped.subarray(at + 512, at + 512 + size);
      at += 512 + ((size + 511) & ~511);
      const relative = [prefix, name.replace(/\/$/, '')].filter((one) => one !== '' && one !== '.').join('/');
      if (relative === '') continue;
      const into = volumeAt(`${container}:${base}/${relative}`);
      if (into === undefined) continue;
      if (String.fromCharCode(header[156]) === '5') {
        (into.volume.owners ??= {})[into.rest === '' ? '.' : into.rest] = owner;
        continue;
      }
      const path = into.rest;
      if (!into.volume.files.includes(path)) into.volume.files.push(path);
      (into.volume.contents ??= {})[path] = bytes.toString('utf8');
      (into.volume.owners ??= {})[path] = owner;
      copied.push(path);
    }
    if (copied.length > 0) (held.copiedIn ??= []).push(copied);
    keep();
    process.exit(0);
  }
  if (args[2] === '-') {
    /*
     * One file out, as Docker writes it: a tar holding that file. A file the
     * volume holds no text for, such as a part's marker, answers nothing.
     */
    const from = volumeAt(args[1]);
    keep();
    if (from === undefined || !from.volume.files.includes(from.rest)) {
      process.stderr.write(`Error response from daemon: Could not find the file ${String(args[1]).slice(String(args[1]).indexOf(':') + 1)} in container\n`);
      process.exit(1);
    }
    const text = from.volume.contents?.[from.rest];
    if (text !== undefined) {
      const bytes = Buffer.from(text, 'utf8');
      const header = Buffer.alloc(512);
      header.write(from.rest.split('/').pop(), 0, 100, 'utf8');
      header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
      header.write('0', 156, 1, 'utf8');
      header.write('ustar\0', 257, 6, 'utf8');
      const padded = Buffer.alloc((bytes.length + 511) & ~511);
      bytes.copy(padded);
      process.stdout.write(Buffer.concat([header, padded, Buffer.alloc(1024)]));
    }
    process.exit(0);
  }
  keep();
  process.stdout.write('');
  process.exit(0);
}

if (verb === 'start' || verb === 'restart') {
  const id = args[args.length - 1];
  const found = named(id);
  if (found === undefined) {
    process.stderr.write(`Error: No such container: ${id}\n`);
    keep();
    process.exit(1);
  }
  // A start the daemon refuses, in the words a test sets: a container whose
  // mount source is gone, for one.
  if (typeof held.failStart === 'string') {
    process.stderr.write(`${held.failStart}\n`);
    keep();
    process.exit(1);
  }
  found.state = 'running';
  found.started = (found.started ?? 0) + 1;
  keep();
  process.exit(0);
}

if (verb === 'stop') {
  const found = named(args[args.length - 1]);
  // Recorded, so a `state` read after a stop answers what actually happened
  // rather than the status the machine was made with.
  if (found !== undefined) found.state = 'exited';
  keep();
  process.stdout.write(`${args[1]}\n`);
  process.exit(0);
}

if (verb === 'rm') {
  const gone = named(args[args.length - 1]);
  held.machines = held.machines.filter((machine) => machine !== gone);
  keep();
  process.stdout.write(`${args[args.length - 1]}\n`);
  process.exit(0);
}

/*
 * `exec`, which is how every command in a dev container is reached.
 *
 * The flags are read rather than guessed at, and the command is answered from
 * this state file: a probe (`cat /proc/self/environ`), whether the host inside
 * is present (`command -v`), a `plugin install`, and a prefix a test wants run
 * for real behind the relay. What `passthrough` starts is a real process, which
 * is how the nested host is put behind the relay in a test with no Docker.
 */
if (verb === 'exec') {
  const env = {};
  let user;
  let workdir;
  let at = 1;
  for (; at < args.length; at++) {
    const said = args[at];
    if (said === '-i' || said === '-t' || said === '-it') continue;
    if (said === '-u') { user = args[at + 1]; at++; continue; }
    if (said === '-w') { workdir = args[at + 1]; at++; continue; }
    if (said === '-e') {
      const [key, value] = envPair(args[at + 1]);
      env[key] = value;
      at++;
      continue;
    }
    break;
  }
  const id = args[at];
  const command = args.slice(at + 1);
  const found = held.machines.find((machine) => machine.name === id || machine.id === id);
  if (found === undefined) {
    process.stderr.write(`Error: No such container: ${id}\n`);
    keep();
    process.exit(1);
  }
  /*
   * A container that is not running, with the daemon's own sentence.
   *
   * `docker exec` refuses one whatever its state says, and that refusal is
   * what a command in a stopped dev container is answered with.
   */
  if ((found.state ?? 'running') !== 'running') {
    process.stderr.write(`Error response from daemon: container ${id} is not running\n`);
    keep();
    process.exit(1);
  }
  const said = command.join(' ');
  (held.commands ??= []).push({ id, ...(user === undefined ? {} : { user }), ...(workdir === undefined ? {} : { workdir }), env, command, dockerEnv: dockerNames() });

  // The probe the derivation runs: its markers around what the user's shell was
  // holding, NUL-separated as `/proc/self/environ` prints it.
  const probe = /echo -n (\S+); cat \/proc\/self\/environ/.exec(said);
  if (probe !== null) {
    const marker = probe[1];
    // The container's own `Config.Env` under what the login shell was holding:
    // every process in a container inherits the environment it was created
    // with, so an override's `containerEnv` is seen by the probe.
    const env = { ...(found.env ?? {}), ...(found.probeEnv ?? held.probeEnv ?? { PATH: '/usr/bin', HOME: '/root' }) };
    process.stdout.write(`${marker}${Object.entries(env)
      .map(([key, value]) => `${key}=${value}\0`).join('')}${marker}`);
    keep();
    process.exit(0);
  }
  // `id -u` and `id -g` for the `-u` user, from `users`.
  if (command[0] === 'id') {
    const ids = (held.users ?? {})[user ?? ''] ?? { uid: 0, gid: 0 };
    process.stdout.write(`${command[1] === '-g' ? ids.gid : ids.uid}\n`);
    keep();
    process.exit(0);
  }
  // Whether the host inside is already in the image. The line is quoted for
  // `/bin/sh -c`, so the question is looked for inside it rather than at its
  // start.
  if (said.includes('command -v ')) {
    keep();
    if (held.hostPresent === true) {
      process.stdout.write('/usr/local/bin/ahpd\n');
      process.exit(0);
    }
    process.exit(1);
  }
  // The line is quoted for `/bin/sh -c`, so a prefix is looked for inside it
  // rather than at its start.
  const failing = (held.failCommands ?? []).find((prefix) => said.includes(prefix));
  if (failing !== undefined) {
    process.stderr.write(`${held.failErr ?? `${failing} failed`}\n`);
    keep();
    process.exit(held.failCode ?? 1);
  }
  // Recorded and answered, never run: the line starts the host program, and
  // the host here is a fake that would serve stdio instead of installing.
  const runnable = (held.passthrough ?? []).find((prefix) => said.includes(prefix));
  if (runnable === undefined) {
    process.stdout.write(held.execOut ?? '');
    keep();
    process.exit(held.execCode ?? 0);
  }
  keep();
  release();
  const child = spawn('/bin/sh', ['-c', command[command.length - 1]], { stdio: ['inherit', 'inherit', 'inherit'] });
  child.on('close', (code) => process.exit(code ?? 0));
  child.on('error', (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(127);
  });
}

/*
 * Anything else. `exec` is above and the verb that got here is one this script
 * does not answer, said rather than run: the relay reads it as the container
 * refusing what it asked.
 */
if (verb !== 'exec') {
  keep();
  process.stderr.write(`the scripted docker does not answer ${String(verb)}\n`);
  process.exit(2);
}
