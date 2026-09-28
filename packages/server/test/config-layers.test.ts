/*
 * Which configuration files the daemon reads, and in what order.
 *
 * The user file, then the file `$AHPD_CONFIG` names merged over it, and no
 * project file; `--config-file` is read alone. Each case has its own
 * configuration home and its own `$AHPD_CONFIG`, so none of them reads the
 * configuration of whoever runs the suite.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { optionsFrom } from '../src/commands/options.js';
import { loadConfig } from '../src/config.js';

const REPO = join(import.meta.dirname, '../../..');
const MAIN = join(REPO, 'packages/server/src/main.ts');
/** A plugin that contributes a backend, which is what lets a run get to its announcement. */
const BACKEND = join(REPO, 'packages/server/test/fixtures/plugin-echo');

let home: string;
let user: string;
let elsewhere: string;
let environment: string;
const held = { xdg: process.env['XDG_CONFIG_HOME'], env: process.env['AHPD_CONFIG'] };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-config-layers-'));
  mkdirSync(join(home, 'ahpd'));
  user = join(home, 'ahpd', 'config.json');
  elsewhere = join(home, 'deploy');
  mkdirSync(elsewhere);
  environment = join(elsewhere, 'ahpd.json');
  process.env['XDG_CONFIG_HOME'] = home;
  delete process.env['AHPD_CONFIG'];
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (held.xdg === undefined) delete process.env['XDG_CONFIG_HOME'];
  else process.env['XDG_CONFIG_HOME'] = held.xdg;
  if (held.env === undefined) delete process.env['AHPD_CONFIG'];
  else process.env['AHPD_CONFIG'] = held.env;
});

const write = (path: string, value: unknown): void => { writeFileSync(path, JSON.stringify(value)); };

/** What refusing this configuration said, or the case fails for it being accepted. */
const refusal = (input: Record<string, unknown> = {}): string => {
  try {
    optionsFrom(input);
  }
  catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('the configuration was accepted');
};

describe('the layers', () => {
  it('reads the user file alone', () => {
    write(user, { port: 1111 });
    const options = optionsFrom({});
    expect(options.port).toBe(1111);
    expect(options.configFiles).toEqual([user]);
  });

  it('reads nothing when there is no file, and says so', () => {
    expect(loadConfig().files).toEqual([]);
    expect(optionsFrom({}).port).toBe(9187);
  });

  it('merges the $AHPD_CONFIG file over the user file', () => {
    write(user, { port: 1111, automations: 'memory' });
    write(environment, { port: 2222 });
    process.env['AHPD_CONFIG'] = environment;
    const options = optionsFrom({});
    expect(options.port).toBe(2222);
    expect(options.automations).toBe('memory');
    expect(options.configFiles).toEqual([user, environment]);
    const loaded = loadConfig();
    expect(loaded.sourceOf('port')).toBe(environment);
    expect(loaded.sourceOf('automations')).toBe(user);
  });

  it('refuses a $AHPD_CONFIG that names no file', () => {
    process.env['AHPD_CONFIG'] = join(elsewhere, 'nowhere.json');
    expect(() => loadConfig()).toThrow('nowhere.json');
  });

  it('reads only --config-file, whatever else is there', () => {
    const named = join(home, 'named.json');
    write(user, { port: 1111, automations: 'memory' });
    write(environment, { port: 2222 });
    write(named, { host: '127.0.0.2' });
    process.env['AHPD_CONFIG'] = environment;
    const options = optionsFrom({ configFile: named });
    expect(options.configFiles).toEqual([named]);
    expect(options).toMatchObject({ host: '127.0.0.2', port: 9187, automations: 'file' });
  });
});

describe('a relative path', () => {
  it('in the $AHPD_CONFIG file resolves against that file\'s directory', () => {
    write(environment, {
      paths: ['work', '/abs'],
      users: 'users.json',
      connectionTokenFile: 'token',
      plugins: ['./plug', { name: '../other', options: { x: 1 } }, 'bare-name', '/abs/plugin'],
    });
    process.env['AHPD_CONFIG'] = environment;
    const options = optionsFrom({});
    expect(options.paths).toEqual([join(elsewhere, 'work'), '/abs']);
    expect(options.users).toBe(join(elsewhere, 'users.json'));
    expect(options.tokenFile).toBe(join(elsewhere, 'token'));
    // A plugin spec stays as written: the loader tries it against the working
    // directory, then the configuration directory.
    expect(options.plugins).toEqual([
      './plug',
      { name: '../other', options: { x: 1 } },
      'bare-name',
      '/abs/plugin',
    ]);
  });

  it('in the user file resolves against the configuration directory', () => {
    write(user, { paths: ['work'] });
    expect(optionsFrom({}).paths).toEqual([join(home, 'ahpd', 'work')]);
  });

  it('typed on the command line is left to the working directory', () => {
    write(user, { paths: ['work'] });
    expect(optionsFrom({ paths: ['typed'] }).paths).toEqual(['typed']);
  });
});

describe('a wrong value', () => {
  it('set in the $AHPD_CONFIG file names that file', () => {
    write(user, { host: '127.0.0.1' });
    write(environment, { port: '8080' });
    process.env['AHPD_CONFIG'] = environment;
    expect(refusal()).toBe(`${environment}: port must be an integer`);
  });

  it('set in the user file names the user file, under a $AHPD_CONFIG that set another key', () => {
    write(user, { automations: 'disk' });
    write(environment, { port: 2222 });
    process.env['AHPD_CONFIG'] = environment;
    expect(refusal()).toBe(`${user}: automations must be one of file, memory`);
  });

  it('an unknown key is warned about by the file that holds it', () => {
    write(user, { port: 1 });
    write(environment, { plugin: [] });
    process.env['AHPD_CONFIG'] = environment;
    expect(optionsFrom({}).warnings).toEqual([`${environment}: plugin is not a setting ahpd knows; ignored`]);
  });
});

/** The program as a process, in a working directory of the case's choosing. */
const cli = (args: string[], cwd: string, env: Record<string, string> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> => {
  const child = spawn(process.execPath, [MAIN, ...args], {
    cwd,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: home,
      CI: '1',
      NODE_OPTIONS: `--conditions development --import ${join(REPO, 'scripts/dev.mjs')}`,
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
  return new Promise((done) => { child.on('close', (code) => { done({ code, stdout, stderr }); }); });
};

describe('ahpd config', () => {
  it('ignores an ahpd.json and a .ahpd.json in the working directory', async () => {
    const project = join(home, 'project');
    mkdirSync(project);
    write(join(project, 'ahpd.json'), { port: 3333 });
    write(join(project, '.ahpd.json'), { port: 4444 });
    write(user, { port: 1111 });
    const said = await cli(['config', '--json'], project);
    expect(said.code).toBe(0);
    const answer = JSON.parse(said.stdout) as { files: string[]; config: Record<string, unknown> };
    expect(answer.files).toEqual([user]);
    expect(answer.config['port']).toBe(1111);
  }, 20000);

  it('prints each file read and which one set each key', async () => {
    write(user, { port: 1111, automations: 'memory' });
    write(environment, { port: 2222 });
    const said = await cli(['config'], home, { AHPD_CONFIG: environment });
    expect(said.code).toBe(0);
    expect(said.stdout).toBe(`${user}\n${environment}\n  port: 2222 (${environment})\n  automations: "memory" (${user})\n`);
  }, 20000);
});

describe('the startup', () => {
  it('names each file it read', async () => {
    write(user, { automations: 'memory' });
    write(environment, { sessions: 'memory' });
    const said = await cli(
      ['--stdio', '--plugin', BACKEND, '--no-update-check'],
      home,
      { AHPD_CONFIG: environment },
    );
    expect(said.code).toBe(0);
    expect(said.stderr).toContain(`config ${user}, ${environment}\n`);
  }, 20000);
});
