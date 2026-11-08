import { posix } from '../../../tools/posix.ts';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { hostInstallOf } from '../src/hostinstall.js';
import type { Part } from '../src/parts.js';
import { quote, sshRuntime } from '../src/ssh.js';
import type { SshMachine } from '../src/ssh.js';

/*
 * The ahpd this host installs on a box it reaches over ssh.
 *
 * The box is this host, through the scripted ssh, which runs the install's
 * script with this host's `sh`: so the script runs as it does on a box, with a
 * Node download made here, which `curl` reads from a `file:` URL, whose `node`
 * runs this process's own Node and whose `npm` writes a stand-in ahpd. Nothing
 * reaches the network.
 *
 * POSIX-only, every case: the script is a POSIX `sh` script and the download
 * is a tar archive of shell scripts.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/ssh.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});
const temp = (): string => (loose ??= mkdtempSync(join(tmpdir(), 'ahpd-hostinstall-')));

/** The ahpd the stand-in npm writes: it answers `--version`, and `plugin install` makes each plugin's folder in the plugin root. */
const AHPD_STANDIN = `#!/usr/bin/env node
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const [first, , , ...specs] = process.argv.slice(2);
if (first === '--version') console.log('9.9.9');
if (first === 'plugin') {
  for (const spec of specs) mkdirSync(join(process.env.AHPD_PLUGIN_ROOT, 'node_modules', spec.slice(0, spec.lastIndexOf('@'))), { recursive: true });
}
`;

/**
 * The npm in the download: it records its arguments, refuses a prefix with no
 * lock in it, as `npm ci` does, and writes the stand-in ahpd under the prefix.
 */
const NPM_STANDIN = `#!/bin/sh
echo "$*" >> "$NPM_LOG"
while [ "$#" -gt 0 ]; do
  case "$1" in --prefix) prefix=$2; shift ;; esac
  shift
done
[ -f "$prefix/package.json" ] && [ -f "$prefix/package-lock.json" ] || { echo "npm ci: no lock in $prefix" >&2; exit 1; }
mkdir -p "$prefix/node_modules/.bin" && cp "$(dirname "$0")/../share/ahpd.js" "$prefix/node_modules/.bin/ahpd"
`;

/** The ahpd part's two files, standing in for the ones `lockOf` reads. */
const LOCK = [
  { name: 'package.json', bytes: Buffer.from('{\n  "name": "ahpd-part-ahpd",\n  "private": true\n}\n') },
  { name: 'package-lock.json', bytes: Buffer.from('{\n  "lockfileVersion": 3\n}\n') },
];

/** A Node download, packed as the box unpacks it, and its sha256. */
const download = (): { url: string; sha256: string } => {
  const dir = join(temp(), 'publisher');
  const top = join(dir, 'node-v0-linux');
  mkdirSync(join(top, 'bin'), { recursive: true });
  mkdirSync(join(top, 'share'), { recursive: true });
  writeFileSync(join(top, 'bin', 'node'), `#!/bin/sh\nexec ${quote(process.execPath)} "$@"\n`, { mode: 0o755 });
  writeFileSync(join(top, 'bin', 'npm'), NPM_STANDIN, { mode: 0o755 });
  writeFileSync(join(top, 'share', 'ahpd.js'), AHPD_STANDIN, { mode: 0o755 });
  const archive = join(dir, 'node.tar.gz');
  expect(spawnSync('tar', ['-czf', archive, '-C', dir, 'node-v0-linux']).status).toBe(0);
  return { url: `file://${archive}`, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex') };
};

/** The parts file of a box install: one Node download for both machines, and ahpd 9.9.9 with two plugins. */
const partsWith = (node: { url: string; sha256: string }): Part[] => [
  { id: 'node', name: 'Node', kind: 'node', version: '0.0.0', archives: { 'linux-x64': node, 'linux-arm64': node }, bin: ['node', 'npm', 'npx'] },
  { id: 'ahpd', name: 'ahpd', kind: 'ahpd', version: '9.9.9', requires: ['node'], plugins: ['@ahpd/agent-cofold', '@ahpd/agent-pi'], bin: ['ahpd'] },
];

/** Where the box keeps its installs. */
const installs = (): string => join(temp(), 'data', 'ahpd', 'server');

/** The ssh runtime with the box dev02, which is this host, and the lines its log was given. */
const box = (parts: Part[], options: { env?: Record<string, string>; machine?: Partial<SshMachine> } = {}) => {
  const logged: string[] = [];
  const runtime = sshRuntime({
    command: process.execPath,
    args: [FIXTURE],
    env: {
      SSH_FAKE_LOG: join(temp(), 'ssh.jsonl'),
      XDG_DATA_HOME: join(temp(), 'data'),
      HOME: temp(),
      NPM_LOG: join(temp(), 'npm.log'),
      ...options.env,
    },
    machines: { dev02: { destination: 'dev02', ...options.machine } },
    parts,
    lock: LOCK,
    log: (line) => { logged.push(line); },
  });
  return { runtime, logged };
};

/** What the stand-in npm was asked, one line per run. */
const npmRuns = (): string[] => (existsSync(join(temp(), 'npm.log'))
  ? readFileSync(join(temp(), 'npm.log'), 'utf8').trim().split('\n')
  : []);

/** An ahpd at `path` that answers `--version` with `version`. */
const standing = (path: string, version: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
};

it.skipIf(!posix)('installs ahpd in the box user folder the first time, and starts the host from there', async () => {
  const parts = partsWith(download());
  const { key } = hostInstallOf(parts, LOCK);
  const { runtime, logged } = box(parts);

  const command = await runtime.hostCommand('dev02');
  const dir = join(installs(), key);
  expect(command).toEqual(['env', `AHPD_PLUGIN_ROOT=${join(dir, 'ahpd', 'plugins')}`, join(dir, 'bin', 'ahpd')]);
  // The launcher runs the ahpd npm installed on the download's Node.
  expect(spawnSync(join(dir, 'bin', 'ahpd'), ['--version'], { encoding: 'utf8' }).stdout.trim()).toBe('9.9.9');
  // ahpd from the ahpd part's lock, written byte for byte, by `npm ci` with the part's flags.
  for (const one of LOCK) expect(readFileSync(join(dir, 'ahpd', one.name))).toEqual(one.bytes);
  const [run] = npmRuns();
  expect(run?.split(' ').slice(0, 2)).toEqual(['ci', '--prefix']);
  expect(run?.split(' ').slice(3)).toEqual(['--no-audit', '--no-fund', '--loglevel=error']);
  // The plugins are installed into the install's own root.
  expect(existsSync(join(dir, 'ahpd', 'plugins', 'node_modules', '@ahpd', 'agent-cofold'))).toBe(true);
  expect(existsSync(join(dir, 'ahpd', 'plugins', 'node_modules', '@ahpd', 'agent-pi'))).toBe(true);
  // The folder the download was unpacked in went into place, and nothing else is left.
  expect(readdirSync(installs())).toEqual([key]);
  expect(logged).toEqual([`ahpd 9.9.9 was installed on dev02 at ${join(dir, 'bin', 'ahpd')}`]);
});

it.skipIf(!posix)('starts the host from the install it finds, and downloads nothing', async () => {
  const parts = partsWith(download());
  const first = box(parts);
  const command = await first.runtime.hostCommand('dev02');

  const second = box(parts);
  expect(await second.runtime.hostCommand('dev02')).toEqual(command);
  expect(npmRuns()).toHaveLength(1);
  expect(second.logged).toEqual([]);
});

it.skipIf(!posix)('installs once for two sessions starting on one box at once', async () => {
  const parts = partsWith(download());
  const { runtime } = box(parts);

  const [one, two] = await Promise.all([runtime.hostCommand('dev02'), runtime.hostCommand('dev02')]);
  expect(one).toEqual(two);
  expect(npmRuns()).toHaveLength(1);
  expect(readFileSync(join(temp(), 'ssh.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
});

it.skipIf(!posix)('runs the command the box names as it is, and installs nothing', async () => {
  const { runtime } = box(partsWith(download()), { machine: { host: ['ahpd'] } });

  expect(await runtime.hostCommand('dev02')).toEqual(['ahpd']);
  expect(existsSync(join(temp(), 'ssh.jsonl'))).toBe(false);
});

it.skipIf(!posix)('keeps the five installs used most recently', async () => {
  const parts = partsWith(download());
  const { key } = hostInstallOf(parts, LOCK);
  const older = [0, 1, 2, 3, 4, 5].map((at) => `1.0.${at}-00000000000${at}`);
  for (const [at, name] of older.entries()) {
    mkdirSync(join(installs(), name), { recursive: true });
    const when = new Date(Date.UTC(2026, 0, 1 + at));
    utimesSync(join(installs(), name), when, when);
  }

  await box(parts).runtime.hostCommand('dev02');
  expect(readdirSync(installs()).sort()).toEqual([...older.slice(2), key].sort());
});

it.skipIf(!posix)('starts the newest other install when the download fails, and says why', async () => {
  const parts = partsWith({ url: `file://${join(temp(), 'missing.tar.gz')}`, sha256: '0'.repeat(64) });
  const old = join(installs(), '9.9.8-0123456789ab');
  standing(join(old, 'bin', 'ahpd'), '9.9.8');
  const { runtime, logged } = box(parts);

  expect(await runtime.hostCommand('dev02')).toEqual(['env', `AHPD_PLUGIN_ROOT=${join(old, 'ahpd', 'plugins')}`, join(old, 'bin', 'ahpd')]);
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatch(new RegExp(`^ahpd 9\\.9\\.9 was not installed on dev02, so ${join(old, 'bin', 'ahpd').replaceAll('.', '\\.')} there starts its sessions' host: curl: `));
});

it.skipIf(!posix)('refuses with the install own line when the download fails and no other install of this host is there, whatever ahpd the PATH holds', async () => {
  const parts = partsWith({ url: `file://${join(temp(), 'missing.tar.gz')}`, sha256: '0'.repeat(64) });
  const bin = join(temp(), 'bin');
  standing(join(bin, 'ahpd'), '0.13.0');
  const { runtime, logged } = box(parts, { env: { PATH: `${bin}:/usr/bin:/bin` } });

  await expect(runtime.hostCommand('dev02')).rejects.toThrow(/^ahpd 9\.9\.9 was not installed on dev02: curl: /);
  expect(logged).toEqual([]);
});

it.skipIf(!posix)('refuses with the box own line when no ahpd can start there', async () => {
  const node = download();
  const parts = partsWith({ ...node, sha256: '0'.repeat(64) });
  const { runtime } = box(parts, { env: { PATH: '/usr/bin:/bin' } });

  await expect(runtime.hostCommand('dev02')).rejects.toThrow(/^ahpd 9\.9\.9 was not installed on dev02: .*checksum/);
  // A download that did not check out is never put in place.
  expect(existsSync(installs()) ? readdirSync(installs()) : []).toEqual([]);
});

it.skipIf(!posix)('refuses a box no download is made for, in the words VS Code refuses one with, before any install runs', async () => {
  const bin = join(temp(), 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo FreeBSD ;; -m) echo amd64 ;; esac\n', { mode: 0o755 });
  // An install of this host's there runs nothing either: the platform is asked first.
  standing(join(installs(), '9.9.8-0123456789ab', 'bin', 'ahpd'), '9.9.8');
  const { runtime, logged } = box(partsWith(download()), { env: { PATH: `${bin}:/usr/bin:/bin` } });

  await expect(runtime.hostCommand('dev02')).rejects.toThrow('ahpd 9.9.9 was not installed on dev02: Unsupported remote platform: FreeBSD amd64');
  expect(npmRuns()).toEqual([]);
  expect(logged).toEqual([]);
});

it.skipIf(!posix)('refuses a folder the box answers that is not one of this host installs', async () => {
  // The box's `sh`, which reads the script and answers with a folder outside the
  // installs, in the form the install answers in.
  const bin = join(temp(), 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'sh'), [
    '#!/bin/sh',
    'cat > /dev/null',
    `echo "root=${installs()}"`,
    'echo "install=/usr/local/elsewhere"',
    'echo "host=/usr/local/elsewhere/bin/ahpd"',
    '',
  ].join('\n'), { mode: 0o755 });
  const { runtime } = box(partsWith(download()), { env: { PATH: `${bin}:/usr/bin:/bin` } });

  await expect(runtime.hostCommand('dev02')).rejects
    .toThrow('ahpd 9.9.9 was not installed on dev02: the box answered "/usr/local/elsewhere", which is not one of this host\'s installs');
});
