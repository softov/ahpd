/*
 * What `ahpd` does at the command line, pinned before it is declared.
 *
 * Every flag and every verb, as a process: `main.ts` runs the daemon on import
 * and the exit code is half of what a script reads. Nothing here names a
 * function inside `main.ts`, only what a person can see, so the same cases hold
 * when the hand-written parser is replaced by the declarations under
 * `packages/server/src/commands/` - which is the whole point of pinning them
 * first.
 *
 * The configuration directory is a temporary one, so a case can write the file
 * the verb under test reads without touching the machine it runs on.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { version } from '../packages/server/src/version.js';

const REPO = join(import.meta.dirname, '..');
const MAIN = 'packages/server/src/main.ts';
/** A plugin that contributes a backend, which is what lets a run get to its announcement. */
const BACKEND = './test/fixtures/plugin-echo';

interface Said {
  code: number | null;
  stdout: string;
  stderr: string;
}

let home: string;
let config: string;
let users: string;
let wire: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-cli-'));
  mkdirSync(join(home, 'ahpd'), { recursive: true });
  config = join(home, 'config.json');
  users = join(home, 'users.json');
  wire = join(home, 'wire.jsonl');
  writeFileSync(config, '{}\n');
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const put = (value: unknown): void => {
  writeFileSync(config, typeof value === 'string' ? value : JSON.stringify(value));
};

/** The daemon as a process: argv in, what it said and the code it left, out. */
const cli = (args: string[], options: { config?: unknown; env?: Record<string, string> } = {}): Promise<Said> => {
  if (options.config !== undefined) put(options.config);
  const env: NodeJS.ProcessEnv = { ...process.env, XDG_CONFIG_HOME: home, CI: '1' };
  delete env.NO_UPDATE_NOTIFIER;
  Object.assign(env, options.env ?? {});
  const child = spawn(
    process.execPath,
    ['--conditions', 'development', '--import', './scripts/dev.mjs', MAIN, ...args],
    { cwd: REPO, env, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  // The peer's end of the pipe, closed at once: a stdio host serves until the
  // client goes away, and a case that starts one has nothing to say to it.
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
  return new Promise((done) => {
    // A run that does start and somehow sat on the pipe fails on the cases
    // below rather than on the suite's own timeout.
    const timer = setTimeout(() => { child.kill(); }, 15000);
    child.on('exit', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
  });
};

describe('what a person types first', () => {
  it('answers --help and -h with the usage and a zero', async () => {
    for (const flag of ['--help', '-h']) {
      const said = await cli([flag]);
      expect(said.code).toBe(0);
      expect(said.stdout).toContain('ahpd');
      expect(said.stdout).toContain('--port');
    }
  });

  it('prints the manifest version for --version and -v', async () => {
    for (const flag of ['--version', '-v']) {
      const said = await cli([flag]);
      expect(said.code).toBe(0);
      expect(said.stdout.trim()).toBe(version());
    }
  });

  it('refuses an option it does not know, with two', async () => {
    const said = await cli(['--nope']);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('Unknown option --nope');
  });

  it('refuses a word that is not a command, with two', async () => {
    const said = await cli(['frobnicate']);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('frobnicate');
  });
});

/*
 * One run carries almost every flag the daemon takes, because the interesting
 * fact about each is that it is read at all and the announcement is the one
 * place they are visible at once. What is left out is what contradicts another
 * flag, which the cases below take one at a time.
 */
describe('the flags of a run', () => {
  it('takes every daemon flag and announces what each decided', async () => {
    const said = await cli([
      '--stdio', '--config-file', config,
      '--port', '0', '--host', '127.0.0.1', '--path', home,
      '--connection-token', 'secret1234',
      '--resource', 'https://ahpd.test/',
      '--issuer', 'github',
      '--trust-token', '--advanced-tools',
      '--automations', 'memory', '--sessions', 'memory',
      '--wire', wire,
      '--plugin', BACKEND,
      '--no-update-check',
    ]);
    expect(said.code).toBe(0);
    expect(said.stderr).toContain('ahpd over stdio');
    expect(said.stderr).toContain(`sessions in ${home}`);
    expect(said.stderr).toContain('automations in memory, schedules do not fire');
    expect(said.stderr).toContain('plugins echo-plugin');
    expect(said.stderr).toContain('token: from --connection-token');
    expect(said.stderr).toContain('advanced tools: offered to every session');
    expect(said.stderr).toContain(`wire to ${wire}`);
    // The capture is opened as the run starts, so a `--wire` that was read is
    // a file that is there.
    expect(readFileSync(wire, 'utf8')).toBe('');
  }, 20000);

  it('writes nothing to stdout over --stdio but the frames', async () => {
    const said = await cli(['--stdio', '--plugin', BACKEND, '--config-file', config, '--no-update-check']);
    expect(said.code).toBe(0);
    expect(said.stdout).toBe('');
  }, 20000);

  it('takes --without-connection-token, and says so instead of a secret', async () => {
    const said = await cli(['--stdio', '--without-connection-token', '--plugin', BACKEND, '--config-file', config, '--no-update-check']);
    expect(said.code).toBe(0);
    expect(said.stderr).toContain('no token: any connection is accepted');
  }, 20000);

  it('reads --connection-token-file and says where the secret came from', async () => {
    const at = join(home, 'token');
    writeFileSync(at, 'held-in-a-file\n');
    const said = await cli(['--stdio', '--connection-token-file', at, '--plugin', BACKEND, '--config-file', config, '--no-update-check']);
    expect(said.code).toBe(0);
    expect(said.stderr).toContain(`token: read from ${at}`);
  }, 20000);

  it('refuses --no-plugins beside a --plugin', async () => {
    const said = await cli(['--stdio', '--no-plugins', '--plugin', BACKEND, '--config-file', config]);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('--no-plugins contradicts');
  });

  it('refuses an --automations it does not have', async () => {
    const said = await cli(['--stdio', '--automations', 'potato', '--config-file', config]);
    expect(said.code).toBe(2);
  });

  it('refuses a --sessions it does not have', async () => {
    const said = await cli(['--stdio', '--sessions', 'potato', '--config-file', config]);
    expect(said.code).toBe(2);
  });

  it('refuses an --issuer that is neither github nor a URL it may reach', async () => {
    const said = await cli(['--stdio', '--issuer', 'not-an-issuer', '--config-file', config]);
    expect(said.code).toBe(2);
  });

  it('refuses a bind address that exposes it with no token', async () => {
    const said = await cli(['--stdio', '--host', '0.0.0.0', '--config-file', config]);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('exposes this host');
  });

  it('refuses a --resource that is not the identifier the record wants', async () => {
    writeFileSync(users, '{ "users": [] }\n');
    const said = await cli(['--stdio', '--users', users, '--resource', 'http://ahpd.test/', '--plugin', BACKEND, '--config-file', config]);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('--resource must be an https URL');
  }, 20000);
});

describe('start, stop and status', () => {
  it('says none is running when none is, from stop and from status', async () => {
    for (const verb of ['stop', 'status']) {
      const said = await cli([verb]);
      expect(said.code).toBe(1);
      expect(said.stdout).toBe('None running.\n');
    }
  });

  it('reports a live record without the token it holds', async () => {
    writeFileSync(join(home, 'ahpd', 'daemon.json'), JSON.stringify({
      pid: process.pid,
      url: 'ws://127.0.0.1:9187',
      connectUrl: 'ws://127.0.0.1:9187/?tkn=secret',
      paths: ['/x'],
      automations: 'in /c, schedules fire',
      startedAt: '2026-09-18T12:00:00.000Z',
    }));
    const said = await cli(['status', '--no-update-check']);
    expect(said.code).toBe(0);
    expect(said.stdout).toBe(
      `ahpd on ws://127.0.0.1:9187 (pid ${String(process.pid)}), started 2026-09-18T12:00:00.000Z\n`
      + 'sessions in /x\n'
      + 'automations in /c, schedules fire\n',
    );
    expect(said.stdout).not.toContain('secret');
  });

  it('takes --no-update-check from the configuration as well as the flag', async () => {
    writeFileSync(join(home, 'ahpd', 'daemon.json'), JSON.stringify({
      pid: process.pid, url: 'ws://127.0.0.1:9187', paths: [], startedAt: '2026-09-18T12:00:00.000Z',
    }));
    writeFileSync(join(home, 'ahpd', 'update.json'), JSON.stringify({ name: '@ahpd/server', latest: '9.9.9', checkedAt: '2026-09-18T12:00:00Z' }));
    const without = await cli(['status', '--no-update-check']);
    expect(without.stdout.split('\n')).toHaveLength(2);
    writeFileSync(join(home, 'ahpd', 'config.json'), '{ "updateCheck": false }\n');
    const fromFile = await cli(['status']);
    expect(fromFile.stdout.split('\n')).toHaveLength(2);
  });
});

describe('config', () => {
  it('prints the file it read and what it says', async () => {
    put({ port: 1234, host: '0.0.0.0' });
    const said = await cli(['config', '--config-file', config]);
    expect(said.code).toBe(0);
    expect(said.stdout).toBe(`${config}\n  port: 1234\n  host: "0.0.0.0"\n`);
  });

  it('says nothing is set when the file is empty', async () => {
    const said = await cli(['config']);
    expect(said.code).toBe(0);
    expect(said.stdout).toBe(`${join(home, 'ahpd', 'config.json')}\n  (nothing set)\n`);
  });
});

describe('user', () => {
  it('says the file holds nobody', async () => {
    const said = await cli(['user', 'list', '--users', users]);
    expect(said.code).toBe(0);
    expect(said.stdout).toBe(`no users in ${users}\n`);
  });

  it('adds, lists, mints for and removes a person', async () => {
    const added = await cli(['user', 'add', 'ada', '--users', users, '--role', 'admin']);
    expect(added.code).toBe(0);
    expect(added.stdout).toContain('Added ada (admin)');

    const listed = await cli(['user', 'list', '--users', users]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain('ada (admin)');

    const minted = await cli(['user', 'token', 'ada', '--users', users]);
    expect(minted.code).toBe(0);
    expect(minted.stdout.trim()).toMatch(/^[\w-]{20,}$/u);
    expect(minted.stderr).toContain('Shown once');

    const removed = await cli(['user', 'rm', 'ada', '--users', users]);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('Removed ada.');

    const again = await cli(['user', 'rm', 'ada', '--users', users]);
    expect(again.code).toBe(1);
    expect(again.stdout).toBe('No user called ada.\n');
  }, 20000);

  it('refuses a sub-command it does not have', async () => {
    const said = await cli(['user', 'toy', '--users', users]);
    expect(said.code).toBe(2);
  });

  it('refuses add and rm without an id', async () => {
    for (const sub of ['add', 'rm', 'token']) {
      const said = await cli(['user', sub, '--users', users]);
      expect(said.code).toBe(2);
    }
  });
});

describe('plugin', () => {
  it('says none is named, and says when --no-plugins turned them all off', async () => {
    const none = await cli(['plugin', 'list', '--config-file', config]);
    expect(none.code).toBe(0);
    expect(none.stdout).toBe('plugins: none named\n');

    const off = await cli(['plugin', 'list', '--no-plugins', '--config-file', config]);
    expect(off.code).toBe(0);
    expect(off.stdout).toBe('plugins: --no-plugins, so nothing is listed\n');
  }, 20000);

  it('describes a --plugin without loading it', async () => {
    const said = await cli(['plugin', 'list', '--plugin', BACKEND, '--config-file', config]);
    expect(said.code).toBe(0);
    expect(said.stdout).toContain('plugin-echo');
    // Nothing was imported: a listing is resolve and manifest, and no more.
    expect(said.stderr).not.toContain('plugin-echo from');
  }, 20000);

  it('refuses install and remove with nothing named', async () => {
    for (const sub of ['install', 'remove']) {
      const said = await cli(['plugin', sub, '--config-file', config]);
      expect(said.code).toBe(2);
    }
  });

  it('refuses plugin install with a flag it does not take', async () => {
    const said = await cli(['plugin', 'install', '--bogus', 'some-package', '--config-file', config]);
    expect(said.code).toBe(2);
  });

  it('refuses a sub-command it does not have', async () => {
    const said = await cli(['plugin', 'toy', '--config-file', config]);
    expect(said.code).toBe(2);
  });
});
