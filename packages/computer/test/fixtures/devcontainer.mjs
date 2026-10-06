#!/usr/bin/env node
/**
 * A scripted `devcontainer`, for the launcher's tests.
 *
 * It answers `--version` and `up` from one JSON file named by
 * `DEVCONTAINER_FAKE_STATE`, and appends every call to the same file, so a test
 * can ask what the launcher ran. Nothing here talks to a daemon, and nothing
 * builds anything: the launcher is what is under test.
 *
 * There is no `exec`. The CLI runs `up` and nothing else, and every command in
 * a container it made is a `docker exec` against the container id it reported -
 * so the commands, and what they answer, belong to the Docker fixture.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs';

const state = process.env.DEVCONTAINER_FAKE_STATE;
if (state === undefined) {
  process.stderr.write('DEVCONTAINER_FAKE_STATE is not set\n');
  process.exit(2);
}

/*
 * The scripted docker's state file, one writer at a time.
 *
 * `up` writes into it - the CLI is the maker and Docker is what holds what it
 * made, and a container a test lists has to be somewhere - so it takes the same
 * lock every `docker` call does. Without it, a launch the previous connect left
 * running reads the file before this `up` and writes it back after, taking the
 * container this one made with it. A lock older than `STALE` belongs to a call
 * that died holding it.
 */
const locked = (write) => {
  const docker = process.env.DOCKER_FAKE_STATE;
  if (docker === undefined) return write();
  const lock = `${docker}.lock`;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try { mkdirSync(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try { if (Date.now() - statSync(lock).mtimeMs > 10_000) rmdirSync(lock); }
      catch {}
      Atomics.wait(pause, 0, 0, 2);
    }
  }
  try { return write(); }
  finally {
    try { rmdirSync(lock); }
    catch {}
  }
};

const args = process.argv.slice(2);
const held = existsSync(state)
  ? JSON.parse(readFileSync(state, 'utf8'))
  : { calls: [], commands: [] };
held.calls.push(args);
// Written beside and renamed over, so the test polling this file never reads
// it half written.
const keep = () => {
  writeFileSync(`${state}.${process.pid}`, JSON.stringify(held));
  renameSync(`${state}.${process.pid}`, state);
};

if (args.includes('--version')) {
  process.stdout.write('0.80.0\n');
  keep();
  process.exit(held.versionCode ?? 0);
}

const verb = args[0];

if (verb === 'up') {
  // The CLI logs while it works, so the result is one line among several.
  process.stdout.write('{"type":"progress","step":"building"}\n');
  /*
   * A log a test wants arriving in pieces, with a pause between them so each is
   * a read of its own on the other end of the pipe: a line is not one write,
   * and a reader that handles each read alone sees a line cut anywhere.
   */
  if (Array.isArray(held.upLog)) {
    const pause = new Int32Array(new SharedArrayBuffer(4));
    for (const piece of held.upLog) {
      process.stderr.write(piece);
      Atomics.wait(pause, 0, 0, 40);
    }
  }

  /*
   * The `--mount` the CLI takes, which is not the one `docker run` takes.
   *
   * The read-only bind is the case that matters: `cliMount` spells one
   * `,readonly`, which the real CLI answers "Unmatched argument format" - so
   * this is where a manifest with a read-only need fails, as it does against
   * the real program.
   */
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--mount') continue;
    const said = String(args[i + 1]);
    if (!/^type=(bind|volume),source=.+,target=.+(,external=(true|false))?$/.test(said)) {
      process.stderr.write(`Error: Unmatched argument format: ${said}\n`);
      keep();
      process.exit(1);
    }
  }

  /*
   * `--override-config`, which replaces the folder's own file rather than
   * merging with it.
   *
   * So an override holding only what this host adds is a config that names no
   * recipe at all, and the CLI answers that by name. This is what an override
   * that was not the folder's whole config would look like.
   */
  const override = args.indexOf('--override-config');
  let said = {};
  if (override !== -1) {
    const where = String(args[override + 1]);
    try {
      // The mode as well as the words: the file holds environment values on
      // disk while `up` runs, so its being unreadable to anybody else is part
      // of what the CLI is handed.
      (held.overrides ??= []).push({ where, mode: statSync(where).mode & 0o777 });
      said = JSON.parse(readFileSync(where, 'utf8'));
      held.overrides[held.overrides.length - 1].config = said;
    }
    catch (error) {
      process.stderr.write(`Failed to read the config file at ${where}: ${error.message}\n`);
      keep();
      process.exit(1);
    }
    const recipes = ['image', 'dockerFile', 'dockerComposeFile'];
    if (!recipes.some((one) => said[one] !== undefined)) {
      const at = args.indexOf('--workspace-folder');
      const named = `${String(args[at + 1])}/.devcontainer/devcontainer.json`;
      process.stderr.write(`Dev container config (${named}) is missing one of "image", "dockerFile" or "dockerComposeFile" properties.\n`);
      keep();
      process.exit(1);
    }
  }

  if (held.upFailure !== undefined) {
    process.stderr.write(`${held.upFailure}\n`);
    keep();
    process.exit(1);
  }
  const made = held.up ?? { outcome: 'success', containerId: 'abc123', remoteWorkspaceFolder: '/workspaces/Box' };
  /*
   * Where the folder lands inside.
   *
   * The real CLI mounts it at `/workspaces/<basename>` unless the config says
   * `workspaceMount`, and `workspaceFolder` alone names a directory that is not
   * mounted - so a body asking for a `workdir` reaches the folder by
   * `workspaceMount` and this answers where it actually is.
   */
  const folderAt = args[args.indexOf('--workspace-folder') + 1];
  const base = String(folderAt).split('/').filter((one) => one !== '').pop() ?? 'workspace';
  const mounting = typeof said.workspaceMount === 'string' && said.workspaceMount !== '' ? said.workspaceMount : '';
  const target = (mounting.split(',').find((one) => one.startsWith('target=')) ?? `target=/workspaces/${base}`).slice('target='.length);
  made.remoteWorkspaceFolder = target;
  /*
   * The container Docker now holds.
   *
   * `up` is the CLI *and* Docker, so a test that reads the listing needs the
   * machine to exist somewhere. With `DOCKER_FAKE_STATE` set, what the CLI
   * reported is put in the scripted docker's own record, labelled from the
   * `--id-label` flags it was given, so a later `docker ps` or
   * `docker inspect` answers for it the way the real pair would.
   */
  const docker = process.env.DOCKER_FAKE_STATE;
  if (docker !== undefined) {
    const folder = folderAt;
    const labels = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] !== '--id-label') continue;
      const said = String(args[i + 1]);
      const eq = said.indexOf('=');
      if (eq !== -1) labels[said.slice(0, eq)] = said.slice(eq + 1);
    }
    /*
     * A `--mount type=image` in `runArgs` whose source image is not here, which
     * Docker refuses naming the container's own image rather than the missing
     * one: the part image has to be built before `up`.
     */
    let missing;
    locked(() => {
      const record = existsSync(docker) ? JSON.parse(readFileSync(docker, 'utf8')) : { machines: [], calls: [] };
      /*
       * The container these labels already name.
       *
       * The CLI finds it rather than building again - the whole of what
       * `--id-label` is for - and starts it when it is stopped, so a second
       * `up` for one folder answers one container rather than a second beside
       * it.
       */
      const known = record.machines.find((machine) => Object.entries(labels)
        .every(([key, value]) => (machine.labels ?? {})[key] === value));
      if (known === undefined) {
        /*
         * What the override's `runArgs` reached the container, as Docker
         * records it.
         *
         * A `--label` here is a plain label, set when the container is made and
         * never found by: only the `--id-label` pair identifies it, which is
         * what keeps a name among them from giving a folder a second
         * container.
         */
        const runArgs = Array.isArray(said.runArgs) ? said.runArgs : [];
        const typed = [];
        for (let i = 0; i < runArgs.length; i++) {
          if (runArgs[i] === '--label') {
            const pair = String(runArgs[i + 1]);
            const eq = pair.indexOf('=');
            if (eq !== -1) labels[pair.slice(0, eq)] = pair.slice(eq + 1);
          }
          // A `--mount` reaches `docker run` as written, an image mount among them.
          if (runArgs[i] === '--mount') typed.push(String(runArgs[i + 1]));
        }
        missing = typed
          .filter((one) => one.split(',').includes('type=image'))
          .map((one) => one.split(',').find((pair) => pair.startsWith('source='))?.slice('source='.length))
          .find((one) => !(record.images ?? []).includes(one));
        if (missing !== undefined) return;
        /*
         * The `mounts` the override asked for, as the CLI's own renderer makes
         * them.
         *
         * A string entry is passed through exactly as written, which is how a
         * read-only mount reaches Docker at all. An object keeps only `type`,
         * `source` and `target`: the CLI's renderer builds `type=`, `src=` and
         * `dst=` and drops everything else, so `readOnly` on an object is
         * silently lost and the container is made writable.
         */
        const mounts = Array.isArray(said.mounts)
          ? said.mounts.map((one) => {
            if (typeof one === 'string') {
              const read = (key) => one.split(',').find((pair) => pair.startsWith(`${key}=`))?.slice(key.length + 1) ?? '';
              return `${read('source')}:${read('target')}${one.includes('readonly') ? ':ro' : ''}`;
            }
            const said = typeof one === 'object' && one !== null ? one : {};
            return `${String(said.source ?? '')}:${String(said.target ?? '')}`;
          })
          : [];
        record.machines.push({
          /*
           * Three ids, kept apart the way the real ones are: the container id
           * `up` answers and `inspect` reports, the name Docker knows it by,
           * and the name a create gave as a label. A road that keys something
           * under the wrong one is a road a test cannot see.
           */
          id: made.containerId,
          name: held.name ?? `${base}-devcontainer`,
          image: held.image ?? 'devcontainer',
          labels: {
            'ahpd.computer': '1',
            ...labels,
            // The one label every later command is derived from: the CLI leaves
            // the folder's own configuration here, one entry per feature base
            // image or file, and nothing else about the container says who its
            // user is.
            'devcontainer.metadata': JSON.stringify(held.metadata ?? [{ remoteUser: 'dev' }]),
          },
          // The workspace mount is what the real CLI makes, and the one thing a
          // caller's folder can be read through; the override's own `mounts`
          // are added to it as the container's other binds.
          // A named volume's `--mount` on the command line is one more.
          mounts: [`${folder}:${made.remoteWorkspaceFolder}`, ...mounts, ...args.flatMap((one, at) => {
            if (at === 0 || args[at - 1] !== '--mount' || !String(one).startsWith('type=volume,')) return [];
            const read = (key) => String(one).split(',').find((pair) => pair.startsWith(`${key}=`))?.slice(key.length + 1) ?? '';
            return [`${read('source')}:${read('target')}`];
          })],
          ...(typed.length === 0 ? {} : { typed }),
          // The container's own environment: the image's, with the override's
          // `containerEnv` laid over it, which is what `${containerEnv:NAME}`
          // in a `remoteEnv` resolves from.
          env: { ...(held.containerEnv ?? {}), ...(said.containerEnv ?? {}) },
          state: 'running',
        });
      }
      else {
        if (known.state !== 'running') known.state = 'running';
        // The container id, which is what the CLI answers for a container it
        // found rather than made.
        made.containerId = known.id ?? known.name;
      }
      writeFileSync(`${docker}.${process.pid}.tmp`, JSON.stringify(record));
      renameSync(`${docker}.${process.pid}.tmp`, docker);
    });
    if (missing !== undefined) {
      process.stderr.write(`Error response from daemon: pull access denied for vsc-${base}, repository does not exist or may require 'docker login'\n`);
      keep();
      process.exit(1);
    }
  }
  process.stdout.write(`${JSON.stringify(made)}\n`);
  keep();
  process.exit(0);
}

process.stderr.write(`the fake devcontainer does not know ${String(verb)}\n`);
keep();
process.exit(2);
