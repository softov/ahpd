#!/usr/bin/env node
/**
 * A scripted `devcontainer`, for the launcher's tests.
 *
 * It answers `--version`, `up` and `exec` from one JSON file named by
 * `DEVCONTAINER_FAKE_STATE`, and appends every call and every command to the
 * same file, so a test can ask what the launcher ran. Nothing here talks to a
 * daemon, and nothing builds anything: the launcher is what is under test.
 *
 * `exec` runs the command it is handed only when the state names a prefix it
 * starts with (`passthrough`), which is how a test puts a real process behind
 * the relay. Everything else is recorded and answered with an exit code, so a
 * test never installs a package or writes outside its temporary directory.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const state = process.env.DEVCONTAINER_FAKE_STATE;
if (state === undefined) {
  process.stderr.write('DEVCONTAINER_FAKE_STATE is not set\n');
  process.exit(2);
}

const args = process.argv.slice(2);
const held = existsSync(state)
  ? JSON.parse(readFileSync(state, 'utf8'))
  : { calls: [], commands: [] };
held.calls.push(args);
const keep = () => writeFileSync(state, JSON.stringify(held));

if (args.includes('--version')) {
  process.stdout.write('0.80.0\n');
  keep();
  process.exit(held.versionCode ?? 0);
}

const verb = args[0];

if (verb === 'up') {
  // The CLI logs while it works, so the result is one line among several.
  process.stdout.write('{"type":"progress","step":"building"}\n');
  if (held.upFailure !== undefined) {
    process.stderr.write(`${held.upFailure}\n`);
    keep();
    process.exit(1);
  }
  const made = held.up ?? { outcome: 'success', containerId: 'abc123', remoteWorkspaceFolder: '/workspaces/Box' };
  process.stdout.write(`${JSON.stringify(made)}\n`);
  keep();
  process.exit(0);
}

if (verb === 'exec') {
  const at = args.indexOf('-c');
  const said = args[at + 1];
  held.commands.push(said);
  keep();
  if (said.startsWith('command -v ')) {
    if (held.hostPresent === true) {
      process.stdout.write('/usr/local/bin/ahpd\n');
      process.exit(0);
    }
    process.exit(1);
  }
  // The line is quoted for `/bin/sh -c`, so a prefix is looked for inside
  // it rather than at its start.
  const runnable = (held.passthrough ?? []).find((prefix) => said.includes(prefix));
  if (runnable === undefined) {
    process.stdout.write(held.execOut ?? '');
    process.exit(held.execCode ?? 0);
  }
  const child = spawn('/bin/sh', ['-c', said], { stdio: ['inherit', 'inherit', 'inherit'] });
  child.on('close', (code) => process.exit(code ?? 0));
  child.on('error', (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(127);
  });
} else {
  process.stderr.write(`the fake devcontainer does not know ${String(verb)}\n`);
  keep();
  process.exit(2);
}
