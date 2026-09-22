#!/usr/bin/env node
/**
 * A disposable computer, on Docker.
 *
 * One container with a name this script owns: start one, run something in it,
 * throw it away. It is the manual half of what a `computer:` resource provider
 * would drive - `scripts/acp-smoke.mts` is to the ACP bridge what this is to
 * the machine behind `computer://`.
 *
 * Not part of the published packages and not run by the tests.
 *
 * Usage:
 *   node scripts/computer.mjs start [options]
 *   node scripts/computer.mjs status
 *   node scripts/computer.mjs exec -- <command...>
 *   node scripts/computer.mjs stop
 *   node scripts/computer.mjs rm
 *   node scripts/computer.mjs list
 *
 * Options:
 *   --name <n>        Container name. Default ahpd-computer
 *   --image <ref>     Image to run. Default debian:bookworm-slim
 *   --cpus <n>        CPU limit, for example 2
 *   --memory <size>   Memory limit, for example 2g
 *   --mount <spec>    A value passed to docker's `--mount`, repeatable
 *   --kvm             Pass /dev/kvm through, for a hypervisor inside
 *   --label <k=v>     Another label, repeatable; ahpd.computer=1 is always set
 *
 * Exit status is docker's where docker ran, and 2 for a refusal this script
 * makes itself.
 */

import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';

const USAGE = `A disposable computer, on Docker.

  node scripts/computer.mjs start [options]   run one, or start the stopped one
  node scripts/computer.mjs status            is it running, and on what image
  node scripts/computer.mjs exec -- <cmd...>  run a command inside it
  node scripts/computer.mjs stop              stop it, keeping it
  node scripts/computer.mjs rm                remove it for good
  node scripts/computer.mjs list              every computer this script made

Options: --name <n>  --image <ref>  --cpus <n>  --memory <size>
         --mount <spec>  --kvm  --label <k=v>`;

const refuse = (message) => {
  process.stderr.write(`${message}\n\n${USAGE}\n`);
  process.exit(2);
};

const argv = process.argv.slice(2);
const verb = argv[0];
const rest = argv.slice(1);
if (verb === undefined || verb === '--help' || verb === '-h') {
  process.stdout.write(`${USAGE}\n`);
  process.exit(verb === undefined ? 2 : 0);
}

const options = {
  name: 'ahpd-computer',
  image: 'debian:bookworm-slim',
  cpus: undefined,
  memory: undefined,
  kvm: false,
  mounts: [],
  labels: [],
};
let command = [];

for (let i = 0; i < rest.length; i++) {
  const one = rest[i];
  if (one === '--') { command = rest.slice(i + 1); break; }
  const value = () => {
    const held = rest[++i];
    if (held === undefined) refuse(`${one} needs a value.`);
    return held;
  };
  if (one === '--name') options.name = value();
  else if (one === '--image') options.image = value();
  else if (one === '--cpus') options.cpus = value();
  else if (one === '--memory') options.memory = value();
  else if (one === '--mount') options.mounts.push(value());
  else if (one === '--label') options.labels.push(value());
  else if (one === '--kvm') options.kvm = true;
  else refuse(`Unknown option ${one}.`);
}

/** Run docker, inheriting the terminal, and answer its status. */
const run = (args) => spawnSync('docker', args, { stdio: 'inherit' }).status ?? 1;

/** Run docker and answer its trimmed stdout, or undefined when it failed. */
const ask = (args) => {
  const held = spawnSync('docker', args, { encoding: 'utf8' });
  return held.status === 0 ? held.stdout.trim() : undefined;
};

const exists = () => ask(['inspect', '--format', '{{.Id}}', options.name]) !== undefined;
const running = () => ask(['inspect', '--format', '{{.State.Running}}', options.name]) === 'true';

/** Whether this user may open the KVM device, which is a group question. */
const kvmReady = () => {
  try { accessSync('/dev/kvm', constants.R_OK | constants.W_OK); return true; }
  catch { return false; }
};

const KVM_HELP = `--kvm was asked for, and /dev/kvm is not readable and writable by you.
Allow it, once, from a normal shell, then start a new session:

  sudo usermod -aG kvm "$USER"
  newgrp kvm            # or log out and back in

and check it with:

  test -r /dev/kvm && echo readable

A container whose root opens the device does not need that group:

  docker run --device /dev/kvm ...

See docs/COMPUTER.md.`;

function start() {
  if (exists()) {
    if (running()) {
      process.stdout.write(`${options.name} is already running.\n`);
    } else {
      const code = run(['start', options.name]);
      if (code !== 0) process.exit(code);
      process.stdout.write(`Started ${options.name}.\n`);
    }
    process.stdout.write(`Run something in it: node scripts/computer.mjs exec -- sh -c 'uname -a'\n`);
    return 0;
  }

  if (options.kvm && !kvmReady()) refuse(KVM_HELP);

  const args = ['run', '-d', '--name', options.name, '--label', 'ahpd.computer=1'];
  for (const label of options.labels) args.push('--label', label);
  if (options.cpus !== undefined) args.push('--cpus', options.cpus);
  if (options.memory !== undefined) args.push('--memory', options.memory);
  if (options.kvm) args.push('--device', '/dev/kvm');
  for (const mount of options.mounts) args.push('--mount', mount);
  // Kept alive with nothing running in it: a computer waits for work, and a
  // container that exits the moment its command ends is not one.
  args.push(options.image, 'sleep', 'infinity');

  // The id is captured rather than inherited, so what is printed is the short
  // one beside the name a person will use; docker's own errors still show.
  const held = spawnSync('docker', args, { stdio: ['ignore', 'pipe', 'inherit'] });
  if (held.status !== 0) process.exit(held.status ?? 1);
  const id = held.stdout.toString().trim().slice(0, 12);
  process.stdout.write(`Started ${options.name} (${id}) on ${options.image}.\n`);
  process.stdout.write(`Run something in it: node scripts/computer.mjs exec -- sh -c 'uname -a'\n`);
  return 0;
}

function status() {
  if (!exists()) {
    process.stdout.write(`No computer named ${options.name}.\n`);
    return 1;
  }
  const said = ask(['inspect', '--format', '{{.State.Status}} {{.Config.Image}} {{.State.StartedAt}}', options.name]);
  process.stdout.write(`${options.name}: ${said ?? 'unknown'}\n`);
  return 0;
}

const verbs = {
  start,
  status,
  stop() {
    if (!exists()) {
      process.stdout.write(`No computer named ${options.name}.\n`);
      return 1;
    }
    if (!running()) {
      process.stdout.write(`${options.name} is already stopped.\n`);
      return 0;
    }
    const code = run(['stop', options.name]);
    if (code !== 0) process.exit(code);
    process.stdout.write(`Stopped ${options.name}. It is still there, and \`rm\` removes it.\n`);
    return 0;
  },
  rm() {
    if (!exists()) {
      process.stdout.write(`No computer named ${options.name}.\n`);
      return 0;
    }
    const code = run(['rm', '-f', options.name]);
    if (code !== 0) process.exit(code);
    process.stdout.write(`Removed ${options.name}.\n`);
    return 0;
  },
  list() {
    return run(['ps', '-a', '--filter', 'label=ahpd.computer=1', '--format', 'table {{.Names}}\t{{.Status}}\t{{.Image}}']);
  },
  exec() {
    if (command.length === 0) refuse('exec needs a command after --, for example: exec -- uname -a');
    if (!exists()) refuse(`No computer named ${options.name}. Start one first.`);
    if (!running()) refuse(`${options.name} is stopped. Start it with: node scripts/computer.mjs start`);
    return run(['exec', '-i', options.name, ...command]);
  },
};

const held = verbs[verb];
if (held === undefined) refuse(`No command called ${verb}.`);
process.exit(held());
