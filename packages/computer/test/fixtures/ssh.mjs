#!/usr/bin/env node
/**
 * A scripted `ssh`, for the computer: plugin's tests.
 *
 * It takes ssh's own flags, appends the whole call to the file `SSH_FAKE_LOG`
 * names, and then runs the remote string with `sh -c` on this host. So a
 * command "over ssh" is a real command whose output and exit code are the
 * fixture's own, and a nested host started as the remote program is a real
 * inner host behind these pipes.
 *
 * A destination named in `SSH_FAKE_UNREACHABLE` - a comma-separated list - is
 * the one box that is not there: the fixture writes ssh's own sentence to
 * stderr and exits 255, which is what ssh exits with when it cannot connect.
 * Nothing here opens a socket, needs a key or needs `ssh` installed.
 */

import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const log = process.env.SSH_FAKE_LOG;
if (log === undefined) {
  process.stderr.write('SSH_FAKE_LOG is not set\n');
  process.exit(2);
}

const args = process.argv.slice(2);
/*
 * Appended rather than rewritten, because the calls overlap: a listing asks
 * every configured box at once, and one writer replacing the file would drop
 * the lines the others recorded. A line per call is one atomic append.
 */
appendFileSync(log, `${JSON.stringify(args)}\n`);

/**
 * The call as ssh reads it: the flags, then the destination, then the command.
 *
 * `--` ends the options, so the words after it are the remote string as one
 * string: what is run is what the caller wrote, and never this program's own
 * word splitting. A destination is the first word that is not a flag.
 */
const read = () => {
  const held = { destination: undefined, port: undefined, identity: undefined, ohs: [], remote: [] };
  let at = 0;
  for (; at < args.length; at++) {
    const said = String(args[at]);
    if (said === '--') { at++; break; }
    if (said === '-o') { held.ohs.push(String(args[++at])); continue; }
    if (said === '-p') { held.port = String(args[++at]); continue; }
    if (said === '-i') { held.identity = String(args[++at]); continue; }
    if (said.startsWith('-')) continue;
    held.destination = said;
    at++;
    break;
  }
  // A `--` between the destination and the command, as the caller writes it,
  // and an ssh that is given no command at all.
  if (args[at] === '--') at++;
  held.remote = args.slice(at).map(String);
  return held;
};

const held = read();
const unreachable = (process.env.SSH_FAKE_UNREACHABLE ?? '').split(',').filter((one) => one !== '');
if (held.destination === undefined || unreachable.includes(held.destination)) {
  const host = held.destination ?? '';
  process.stderr.write(`ssh: connect to host ${host} port ${held.port ?? '22'}: No route to host\n`);
  process.exit(255);
}

// One command and no tty: the remote string goes to `sh -c` as it was written,
// and this process is the pipes between that shell and whoever called ssh.
const child = spawn('/bin/sh', ['-c', held.remote.join(' ')], { stdio: ['inherit', 'inherit', 'inherit'] });
child.on('close', (code) => process.exit(code ?? 0));
child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(127);
});
