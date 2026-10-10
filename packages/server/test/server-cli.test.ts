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

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { version } from '../src/version.js';
import { BACKEND, cli, config, foreground, gone, home, put, recordOf, spawned, users, wire } from './cli.js';

describe('what a person types first', () => {
  it('answers --help and -h with the usage and a zero', async () => {
    for (const flag of ['--help', '-h']) {
      const said = await cli([flag]);
      expect(said.code).toBe(0);
      expect(said.stdout).toContain('ahpd');
      expect(said.stdout).toContain('--port');
      expect(said.stdout).toContain('container');
      expect(said.stdout).toContain('trust decision');
      expect(said.stdout).toContain('without the dashes');
      expect(said.stdout).toContain('?tkn=');
      expect(said.stdout).toContain('Authorization: Bearer');
      expect(said.stdout).not.toContain('ahpd run');
      expect(said.stdout.match(/Global options:/gu)).toHaveLength(1);
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

describe('completion and values', () => {
  it('completes the foreground run flags', async () => {
    const said = await cli(['__complete', '--', '--po']);
    expect(said.code).toBe(0);
    expect(said.stdout).toContain('--port');
  });

  it('offers --plugin and never --plugins', async () => {
    const said = await cli(['__complete', '--', 'start', '--plu']);
    expect(said.code).toBe(0);
    expect(said.stdout).toContain('--plugin');
    expect(said.stdout).not.toContain('--plugins');
  });

  it('a value spelled -v is a value', async () => {
    const said = await cli(['--stdio', '--connection-token', '-v', '--plugin', BACKEND, '--config-file', config, '--no-update-check']);
    expect(said.code).toBe(0);
    expect(said.stderr).toContain('token: from --connection-token');
  }, 20000);
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

  it('refuses --plugins, which is not another spelling of --no-plugins', async () => {
    const said = await cli(['--plugins', '--stdio', '--config-file', config]);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('Unknown option --plugins');
  });

  it('serves only what is named under --no-cwd, and refuses when nothing is', async () => {
    writeFileSync(config, JSON.stringify({ plugins: [BACKEND], sessions: 'memory', automations: 'memory' }));
    const refused = await cli(['--stdio', '--no-cwd', '--plugin', BACKEND, '--config-file', config]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('--no-cwd serves only');
    // A refusal that did not say what to do instead is a sentence over.
    expect(refused.stderr).toContain('--path');
    expect(refused.stderr).toContain('ahpd configure');

    writeFileSync(config, JSON.stringify({ paths: [home], plugins: [BACKEND], sessions: 'memory', automations: 'memory' }));
    const serving = await cli(['--stdio', '--no-cwd', '--plugin', BACKEND, '--config-file', config]);
    expect(serving.code).toBe(0);
    expect(serving.stderr).toContain(`sessions in ${home}`);
    // On a pipe, so nothing was asked about the folder it was started in.
    expect(serving.stderr).not.toContain('Serve ');
  }, 20000);

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

  it('refuses an http.host that names no address', async () => {
    const said = await cli(['--config-file', config, '--connection-token', 't'], { config: { http: { port: 0, host: '' } } });
    expect(said.code).toBe(2);
    expect(said.stderr).toContain(`${config}: http.host must be text matching ^\\S+$`);
  }, 20000);

  it('refuses an http.host with space around the address', async () => {
    const said = await cli(['--config-file', config, '--connection-token', 't'], { config: { http: { port: 0, host: ' 127.0.0.1 ' } } });
    expect(said.code).toBe(2);
    expect(said.stderr).toContain(`${config}: http.host must be text matching ^\\S+$`);
  }, 20000);
});

describe('reaching a daemon elsewhere', () => {
  /*
   * The address is one this machine keeps to itself but is not one of the three
   * names `ON_MACHINE` knows, so the scheme is what the warning turns on and a
   * refused connection ends the case at once rather than after a timeout.
   */
  it('refuses a blank token as no token, before anything is fetched', async () => {
    const blankFile = join(home, 'blank-token');
    writeFileSync(blankFile, '  \n');
    for (const [args, env] of [
      [['--token='], {}],
      [['--token', '  '], {}],
      [['--token-file', blankFile], {}],
      [[], { AHPD_TOKEN: '  ' }],
    ] as [string[], Record<string, string>][]) {
      const said = await cli(['--remote', 'http://127.0.0.1:9', ...args, 'status'], { env });
      expect(said.code).toBe(2);
      expect(said.stderr).toBe('ahpd: http://127.0.0.1:9 needs a token: pass --token, --token-file or AHPD_TOKEN.\n');
    }
  }, 40000);

  it('warns about a cleartext token for a scheme in either case', async () => {
    const said = await cli(['--remote', 'HTTP://127.0.0.2:9', '--token', 'abc12345', 'status']);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('the token travels in cleartext');
  }, 20000);

  it('takes space around the token from --token and AHPD_TOKEN as it does from a file', async () => {
    // The API on, so `--remote` has a manifest and a route to reach.
    put({ http: true, plugins: [BACKEND] });
    const began = await cli([
      'start', '--config-file', config, '--port', '0', '--connection-token', 'abc', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const record = recordOf();
    spawned.push(record.pid);
    // Only the port is read back: the announcement names the loopback host.
    const url = `http://127.0.0.1:${new URL(record.url).port}`;
    // The client's own cache, so nothing lands in the machine's real one.
    const env = { XDG_CACHE_HOME: join(home, 'cache') };

    const inline = await cli(['--remote', url, '--token', ' abc ', 'status'], { env });
    expect(inline.code).toBe(0);
    expect(inline.stdout).toContain(String(record.pid));

    const inherited = await cli(['--remote', url, 'status'], { env: { ...env, AHPD_TOKEN: ' abc\n' } });
    expect(inherited.code).toBe(0);
    expect(inherited.stdout).toContain(String(record.pid));
  }, 40000);
});

describe('a daemon that binds a port', () => {
  it('binds the port and host a person passed', async () => {
    const url = await foreground(['--port', '0', '--host', 'localhost', '--plugin', BACKEND, '--no-update-check']);
    expect(url.startsWith('ws://localhost:')).toBe(true);
    expect(url).not.toBe('ws://localhost:9187');
  }, 30000);

  it('binds the port and host the configuration names', async () => {
    writeFileSync(join(home, 'ahpd', 'config.json'), JSON.stringify({ port: 0, host: 'localhost', plugins: [BACKEND] }));
    const url = await foreground([]);
    expect(url.startsWith('ws://localhost:')).toBe(true);
    expect(url).not.toBe('ws://localhost:9187');
  }, 30000);

  it('starts, reports and stops the daemon the record names', async () => {
    const began = await cli(['start', '--port', '0', '--plugin', BACKEND, '--automations', 'memory', '--sessions', 'memory', '--no-update-check']);
    expect(began.code).toBe(0);
    expect(began.stdout).toContain('ahpd on ws://127.0.0.1:');
    const record = JSON.parse(readFileSync(join(home, 'ahpd', 'daemon.json'), 'utf8')) as { pid: number; url: string };
    spawned.push(record.pid);

    const status = await cli(['status']);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain(record.url);

    const stopped = await cli(['stop']);
    expect(stopped.code).toBe(0);
    expect(stopped.stdout).toContain('Stopped');
    await gone(record.pid);

    const after = await cli(['status']);
    expect(after.code).toBe(1);
  }, 40000);
});
