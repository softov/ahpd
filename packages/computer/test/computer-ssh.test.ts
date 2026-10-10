import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

/*
 * A machine on another box, reached over a scripted `ssh`.
 *
 * This is the fixture's own case: what it records, what it refuses and what it
 * runs. Tasks 02 and 03 add the runtime's calls and one nested session end to
 * end, both through this same script, so a test needs no network, no key and
 * no `ssh` installed.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/ssh.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

/** The file the fixture records its calls in, made with the directory. */
const log = (): string => join((loose ??= mkdtempSync(join(tmpdir(), 'ahpd-ssh-'))), 'ssh.jsonl');

/** One run of the scripted ssh, with the environment a test wants it to read. */
const ssh = (args: string[], env: Record<string, string> = {}) => spawnSync(
  process.execPath,
  [FIXTURE, ...args],
  { encoding: 'utf8', env: { ...process.env, SSH_FAKE_LOG: log(), ...env } },
);

/** Every call recorded, in the order the fixture was run. */
const recorded = (): string[][] => readFileSync(log(), 'utf8')
  .split('\n')
  .filter((line) => line !== '')
  .map((line) => JSON.parse(line) as string[]);

it('runs the remote string on this host, and records the call as ssh was given it', () => {
  const one = ssh(['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-p', '2222', '-i', '/keys/dev86', 'dev86', '--', 'echo nested; exit 3']);

  // The command is a real one, and its output and code are this process's own.
  expect(one.stdout).toBe('nested\n');
  expect(one.status).toBe(3);
  // The whole call, so a test can assert the flags the runtime writes rather
  // than the sentence a program happened to print.
  expect(recorded()).toEqual([
    ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-p', '2222', '-i', '/keys/dev86', 'dev86', '--', 'echo nested; exit 3'],
  ]);
});

it('keeps the remote string whole, so what the caller wrote is what runs', () => {
  // One string to `sh -c` and never this program's own word splitting: the
  // quoting the runtime did survives to the shell that reads it.
  const one = ssh(['dev86', '--', 'printf "%s\\n" "a b" "c"']);
  expect(one.stdout).toBe('a b\nc\n');
  expect(one.status).toBe(0);
});

it('refuses a destination it is told is unreachable, as ssh does', () => {
  const one = ssh(['-T', '-p', '2222', 'dev86', '--', 'echo never'], { SSH_FAKE_UNREACHABLE: 'dev86,web1' });

  // ssh's own last line, which a listing reports as why the box is not up, and
  // ssh's own exit code for not connecting.
  expect(one.status).toBe(255);
  expect(one.stdout).toBe('');
  expect(one.stderr).toBe('ssh: connect to host dev86 port 2222: No route to host\n');
  // Recorded before it refused: the call was made, whatever came of it.
  expect(recorded()).toHaveLength(1);
});

it('records every call, so calls that overlap are all there', () => {
  // A listing asks each configured box at once, so the file is appended to
  // rather than rewritten: one line per call, none dropped.
  ssh(['dev86', '--', 'true']);
  ssh(['web1', '--', 'true']);
  ssh(['dev86', '--', 'true']);
  expect(recorded().map((one) => one[0])).toEqual(['dev86', 'web1', 'dev86']);
});

it('refuses a call with no destination, rather than running it here', () => {
  const one = ssh(['-T', '--', 'echo never']);
  expect(one.status).toBe(255);
  expect(one.stdout).toBe('');
  expect(one.stderr).toContain('ssh: connect to host  port 22');
});
