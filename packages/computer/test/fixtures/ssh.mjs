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
 *
 * `SSH_FAKE_UNREACHABLE_FILE` is the same list read from a file, again on every
 * call. A box that goes down between two listings is what an environment cannot
 * say - it is fixed when the host is loaded - and a file is what a test rewrites
 * in between.
 *
 * `SSH_FAKE_CHECK` names a file whose text is the box's answer to the server
 * check: a remote `sh -s`, or `sh -s -- named` for a box that names its host's
 * command, reads the script on stdin and prints that file in its place, so a
 * test says what a box has without this host having it.
 */

import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

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
  const held = { destination: undefined, port: undefined, identity: undefined, jump: undefined, ohs: [], remote: [] };
  let at = 0;
  for (; at < args.length; at++) {
    const said = String(args[at]);
    if (said === '--') { at++; break; }
    if (said === '-o') { held.ohs.push(String(args[++at])); continue; }
    if (said === '-p') { held.port = String(args[++at]); continue; }
    if (said === '-i') { held.identity = String(args[++at]); continue; }
    if (said === '-J') { held.jump = String(args[++at]); continue; }
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
/** The list from the environment, then the one from the file it names. */
const fromFile = () => {
  const where = process.env.SSH_FAKE_UNREACHABLE_FILE;
  if (where === undefined || where === '') return '';
  try { return readFileSync(where, 'utf8'); }
  catch { return ''; }
};
const unreachable = `${process.env.SSH_FAKE_UNREACHABLE ?? ''},${fromFile()}`
  .split(',')
  .map((one) => one.trim())
  .filter((one) => one !== '');
if (held.destination === undefined || unreachable.includes(held.destination)) {
  const host = held.destination ?? '';
  process.stderr.write(`ssh: connect to host ${host} port ${held.port ?? '22'}: No route to host\n`);
  process.exit(255);
}

/** The server check's answer: the script on stdin is read and dropped, and the file printed. */
const answerCheck = (file) => {
  process.stdin.resume();
  process.stdin.on('end', () => {
    process.stdout.write(readFileSync(file, 'utf8'));
    process.exit(0);
  });
};

/**
 * One command and no tty: the remote string goes to `sh -c` as it was written,
 * and this process is the pipes between that shell and whoever called ssh.
 */
const runRemote = () => {
  const child = spawn('/bin/sh', ['-c', held.remote.join(' ')], { stdio: ['inherit', 'inherit', 'inherit'] });
  child.on('close', (code) => process.exit(code ?? 0));
  child.on('error', (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(127);
  });
};

const check = process.env.SSH_FAKE_CHECK;
if (check !== undefined && check !== '' && ['sh -s', 'sh -s -- named'].includes(held.remote.join(' '))) answerCheck(check);
else runRemote();
