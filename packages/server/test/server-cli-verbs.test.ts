/*
 * What `ahpd` does at the command line, as `server-cli.test.ts` says.
 *
 * The verbs that read and write the configuration, the users, the vault and the plugins.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { version } from '../src/version.js';
import { BACKEND, cli, config, fakeNpm, home, put, users } from './cli.js';

describe('plugin config', () => {
  it('sets with three words, shows with two, and unsets with the word unset', async () => {
    const secret = join(import.meta.dirname, 'fixtures', 'plugin-secret', 'index.ts');
    put({ plugins: [secret] });
    const set = await cli(['plugin', 'config', secret, 'retries', '2', '--config-file', config]);
    expect(set.code).toBe(0);
    expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({ plugins: [{ name: secret, options: { retries: 2 } }] });

    const shown = await cli(['plugin', 'config', secret, '--config-file', config]);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toBe(`${secret}\n  retries: 2\n`);

    const removed = await cli(['plugin', 'config', 'unset', secret, 'retries', '--config-file', config]);
    expect(removed.code).toBe(0);
    expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({ plugins: [{ name: secret }] });
  }, 20000);
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

    const removed = await cli(['user', 'rm', 'ada', '--users', users, '--yes']);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('Removed ada.');

    const again = await cli(['user', 'rm', 'ada', '--users', users, '--yes']);
    expect(again.code).toBe(1);
    expect(again.stderr).toBe('ahpd: No user called ada.\n');
  }, 20000);

  it('asks before taking a person out, and runs with --yes where there is no terminal', async () => {
    await cli(['user', 'add', 'bob', '--users', users]);
    const asked = await cli(['user', 'rm', 'bob', '--users', users]);
    expect(asked.code).toBe(2);
    expect(asked.stdout).toBe('');
    expect(asked.stderr).toBe('ahpd: user rm removes user bob; pass --yes to run it without a terminal\n');
    // Nothing ran: the question was not answered.
    expect((await cli(['user', 'list', '--users', users])).stdout).toContain('bob');

    const removed = await cli(['user', 'rm', 'bob', '--users', users, '--yes']);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('Removed bob.');
    expect((await cli(['user', 'list', '--users', users])).stdout).not.toContain('bob');
  }, 30000);

  it('names the sub-commands of a bare verb and of one it does not have', async () => {
    for (const args of [['user'], ['user', 'toy', '--users', users], ['--json', 'user']]) {
      const said = await cli(args);
      expect(said.code).toBe(2);
      expect(said.stderr).toBe('ahpd: user takes list, add, rm, token, member or primary.\n');
      expect(said.stdout).toBe('');
    }
  });

  it('refuses add and rm without an id', async () => {
    for (const sub of ['add', 'rm', 'token']) {
      const said = await cli(['user', sub, '--users', users]);
      expect(said.code).toBe(2);
    }
  });

  it('refuses a flag the verb reads by nothing, naming it', async () => {
    await cli(['user', 'add', 'ada', '--users', users, '--role', 'admin']);
    const refused = await cli(['user', 'rm', 'ada', '--role', 'admin', '--users', users]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('Unknown option --role');
    // Nothing ran, so the person is still in the file.
    expect((await cli(['user', 'list', '--users', users])).stdout).toContain('ada');
  }, 20000);

  it('takes --host and --port on the verb that prints an address, and on no other', async () => {
    await cli(['user', 'add', 'ada', '--users', users]);
    const printed = await cli(['user', 'token', 'ada', '--url', '--users', users, '--host', '10.0.0.5', '--port', '9310']);
    expect(printed.code).toBe(0);
    expect(printed.stdout.trim()).toMatch(/^ws:\/\/10\.0\.0\.5:9310\/\?tkn=/u);

    // `--url` is the one place the address is read, so every other verb refuses
    // it rather than accepting a port that would mean nothing.
    for (const args of [
      ['user', 'list', '--users', users, '--port', '9310'],
      ['user', 'rm', 'ada', '--users', users, '--host', '10.0.0.5'],
    ]) {
      const refused = await cli(args);
      expect(refused.code).toBe(2);
      expect(refused.stderr).toMatch(/Unknown option --(port|host)/u);
    }
  }, 20000);

  it('takes --url on the verb that prints one, and on no other', async () => {
    await cli(['user', 'add', 'ada', '--users', users]);
    const printed = await cli(['user', 'token', 'ada', '--url', '--users', users]);
    expect(printed.code).toBe(0);
    expect(printed.stdout.trim()).toMatch(/^ws:\/\/[^/]+\/\?tkn=/u);

    const refused = await cli(['user', 'rm', 'ada', '--url', '--users', users]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('Unknown option --url');
  }, 20000);
});

describe('team and project', () => {
  it('takes --title on the verb that names one, and refuses it where it is read by nothing', async () => {
    const named = await cli(['team', 'add', 'backend', '--title', 'Backend', '--users', users]);
    expect(named.code).toBe(0);
    expect(named.stdout).toContain('Named team backend (Backend).');

    const refused = await cli(['team', 'rm', 'backend', '--title', 'Backend', '--users', users]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('Unknown option --title');
    // Nothing ran, so the team is still named.
    expect((await cli(['team', 'list', '--users', users])).stdout).toBe('backend  Backend\n');
  }, 20000);
});

describe('vault', () => {
  it('takes the configuration it reads and refuses the daemon flags it does not', async () => {
    put({ plugins: [{ name: 'orders', options: { apiKey: { $secret: 'host:orders' } } }] });
    const listed = await cli(['vault', 'list', '--config-file', config]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toBe('host:orders  not set, named at plugins[0].options.apiKey\n');

    const refused = await cli(['vault', 'delete', 'host:orders', '--port', '9310']);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('Unknown option --port');

    // And the configuration is `vault list`'s alone: the two that write reach
    // the vault beside the one this run reads, so a flag naming another would
    // keep a secret in a store nothing else opens.
    for (const args of [
      ['vault', 'set', 'host:orders', '--config-file', config],
      ['vault', 'delete', 'host:orders', '--config-file', config],
    ]) {
      const said = await cli(args);
      expect(said.code).toBe(2);
      expect(said.stderr).toContain('Unknown option --config-file');
    }
  }, 20000);
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

  it('refuses install, remove and update with nothing named', async () => {
    for (const sub of ['install', 'remove', 'update']) {
      const said = await cli(['plugin', sub, '--config-file', config]);
      expect(said.code).toBe(2);
    }
    // What is missing is the name, and it is named: the words reach the
    // declaration and are one argument short, rather than reaching nothing.
    for (const sub of ['install', 'remove']) {
      const said = await cli(['plugin', sub, '--config-file', config]);
      expect(said.stderr).toBe(`ahpd: "plugin ${sub}" needs name.\nUsage: ahpd plugin ${sub} <name...>\n`);
    }
  });

  it('refuses plugin install with a flag it does not take', async () => {
    const said = await cli(['plugin', 'install', '--bogus', 'some-package', '--config-file', config]);
    expect(said.code).toBe(2);
  });

  it('names the sub-commands of a bare verb and of one it does not have', async () => {
    for (const args of [['plugin'], ['plugin', 'toy', '--config-file', config], ['--json', 'plugin']]) {
      const said = await cli(args);
      expect(said.code).toBe(2);
      expect(said.stderr).toBe('ahpd: plugin takes list, update, config, install, remove, enable or disable.\n');
      expect(said.stdout).toBe('');
    }
  });

  it('still answers --help for a group', async () => {
    const said = await cli(['plugin', '--help']);
    expect(said.code).toBe(0);
    expect(said.stdout).toContain('plugin');
  });

  it('remove says the configuration changed before npm fails', async () => {
    put({ plugins: ['some-plugin'] });
    const said = await cli(['plugin', 'remove', 'some-plugin', '--config-file', config, '--yes'], { env: fakeNpm(1) });
    expect(said.code).toBe(2);
    expect(said.stdout).toContain('plugins -= some-plugin');
    expect(readFileSync(config, 'utf8')).not.toContain('some-plugin');
  });

  it('a failed npm says what failed at the terminal, and npm\'s error only as npm said it', async () => {
    writeFileSync(join(home, 'ahpd', 'package.json'), JSON.stringify({ dependencies: { 'some-plugin': '^1.0.0' } }));
    put({ plugins: ['some-plugin'] });
    const env = { ...fakeNpm(1), FAKE_NPM_STDERR: 'npm error code E404' };
    const runs: [string, string[]][] = [
      ['npm could not install some-plugin', ['plugin', 'install', 'some-plugin', '--config-file', config]],
      ['npm could not update some-plugin', ['plugin', 'update', 'all']],
      ['npm could not uninstall some-plugin', ['plugin', 'remove', 'some-plugin', '--config-file', config, '--yes']],
    ];
    for (const [failed, args] of runs) {
      const said = await cli(args, { env });
      expect(said.code).toBe(2);
      expect(said.stderr).toContain(failed);
      expect(said.stderr.split('npm error code E404')).toHaveLength(2);
    }
  }, 30000);

  it('update --force installs each package in its own npm call', async () => {
    const dir = join(home, 'ahpd');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'some-plugin': '^1.0.0', 'another-plugin': '^1.0.0' } }));
    const log = join(home, 'npm.log');
    // Nothing lands, so no version moved; what the case pins is the calls the
    // flag makes, one package each rather than the one `update all` makes.
    const said = await cli(['plugin', 'update', 'all', '--force'], { env: { ...fakeNpm(0), FAKE_NPM_LOG: log } });
    expect(said.code).toBe(0);
    const starts = readFileSync(log, 'utf8').split('\n').filter((line) => line.startsWith('start install'));
    expect(starts).toEqual([
      `start install --prefix ${dir} --legacy-peer-deps @ahpd/sdk@${version()} some-plugin@latest`,
      `start install --prefix ${dir} --legacy-peer-deps @ahpd/sdk@${version()} another-plugin@latest`,
    ]);
  }, 20000);

  it('asks for a restart when an update moved only the sdk', async () => {
    // Every update installs the daemon's own sdk beside the plugins, so a
    // daemon upgraded before its plugins moves the sdk on a call that moves no
    // plugin: the loaded plugins are on the old one until the daemon restarts.
    const dir = join(home, 'ahpd');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'some-plugin': '^1.0.0' } }));
    const there: [string, string][] = [['some-plugin', '1.0.0'], ['@ahpd/sdk', '0.0.1']];
    for (const [name, version] of there) {
      mkdirSync(join(dir, 'node_modules', name), { recursive: true });
      writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
    }
    // A record of a daemon that is up, which is what at the terminal decides
    // whether a restart is asked for.
    writeFileSync(join(dir, 'daemon.json'), JSON.stringify({
      pid: process.pid, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/', paths: [], startedAt: '',
    }));
    const said = await cli(['plugin', 'update', 'all', '--json'], { env: { ...fakeNpm(0), FAKE_NPM_LANDS: '@ahpd/sdk 9.9.9' } });
    expect(said.code).toBe(0);
    expect(JSON.parse(said.stdout) as unknown).toEqual({
      plugins: [{ name: '@ahpd/sdk', from: '0.0.1', to: '9.9.9' }],
      restart: true,
    });
    expect(said.stderr).toContain('Restart the daemon to load the change: ahpd restart');
  }, 20000);

  it('install --json writes only JSON', async () => {
    const said = await cli(
      ['plugin', 'install', 'some-plugin', '--no-enable', '--json', '--config-file', config],
      { env: fakeNpm(0) },
    );
    expect(said.code).toBe(0);
    expect(() => JSON.parse(said.stdout) as unknown).not.toThrow();
    expect(said.stderr).toContain('npm noise');
  }, 20000);
});
