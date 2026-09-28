/*
 * The configuration file, held to the schema the flags are declared with.
 *
 * A wrong value on a key the daemon knows refuses the start with a sentence
 * naming the file and the key; a key it does not know is named on one line and
 * the run goes on. The cases read a file in a temporary directory, so none of
 * them reads the configuration of whoever runs the suite.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { configSchema, flagFields, optionsFrom, serverFields } from '../src/commands/options.js';
import type { Config } from '../src/config.js';

const REPO = join(import.meta.dirname, '../../..');
const MAIN = 'packages/server/src/main.ts';
/** A plugin that contributes a backend, which is what lets a run get to its announcement. */
const BACKEND = './packages/server/test/fixtures/plugin-echo';

let home: string;
let config: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-config-check-'));
  config = join(home, 'config.json');
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const put = (value: unknown): void => { writeFileSync(config, JSON.stringify(value)); };

/** The options a run would take with this file under no flags. */
const folded = (value: unknown) => {
  put(value);
  return optionsFrom({ configFile: config });
};

/** What refusing this file said, or the case fails for the file being accepted. */
const refusal = (value: unknown): string => {
  try {
    folded(value);
  }
  catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`${JSON.stringify(value)} was accepted`);
};

describe('a wrong value on a known key', () => {
  it('refuses an integer given as a string, naming the file and the key', () => {
    expect(refusal({ port: '8080' })).toBe(`${config}: port must be an integer`);
  });

  it('refuses a number where text goes', () => {
    expect(refusal({ host: 5 })).toBe(`${config}: host must be text`);
  });

  it('refuses a value outside an enum', () => {
    expect(refusal({ automations: 'disk' })).toBe(`${config}: automations must be one of file, memory`);
    expect(refusal({ sessions: 'disk' })).toBe(`${config}: sessions must be one of file, memory`);
  });

  it('refuses a boolean given as a string', () => {
    expect(refusal({ trustToken: 'yes' })).toBe(`${config}: trustToken must be true or false`);
  });

  it('refuses a string where a list of strings goes', () => {
    expect(refusal({ paths: '/work' })).toBe(`${config}: paths must be a list of text`);
  });

  it('refuses an http.port out of range, naming the nested key', () => {
    expect(refusal({ http: { port: 70000 } })).toBe(`${config}: http.port must be an integer between 0 and 65535`);
  });

  it('refuses an http that is neither a switch nor an object', () => {
    expect(refusal({ http: 'on' })).toContain(`${config}: http must be`);
  });

  it('refuses an http.host that names no address', () => {
    expect(refusal({ http: { port: 0, host: '' } })).toContain(`${config}: http.host must be`);
  });

  it('refuses http.host without http.port', () => {
    expect(refusal({ http: { host: '127.0.0.1' } })).toContain('http.host');
    expect(refusal({ http: { host: '127.0.0.1' } })).toContain('http.port');
  });

  it('refuses a plugins entry that is not a spec', () => {
    expect(refusal({ plugins: [3] })).toContain(`${config}: plugins must be`);
    expect(refusal({ plugins: [{ options: {} }] })).toBe(`${config}: plugins.name is required`);
    expect(refusal({ plugins: [{ name: 'x', enabled: 'no' }] })).toBe(`${config}: plugins.enabled must be true or false`);
  });

  it('refuses a value that was dropped before, rather than falling back to the default', () => {
    expect(refusal({ updateCheck: 'false' })).toBe(`${config}: updateCheck must be true or false`);
  });
});

describe('an unknown key', () => {
  it('is warned about with the file and the key, and the rest is read', () => {
    const options = folded({ plugin: [], port: 1234 });
    expect(options.warnings).toEqual([`${config}: plugin is not a setting ahpd knows; ignored`]);
    expect(options.port).toBe(1234);
  });

  it('names a flag that only means something typed', () => {
    expect(folded({ stdio: true }).warnings).toEqual([`${config}: stdio is not a setting ahpd knows; ignored`]);
    expect(folded({ stdio: true }).stdio).toBe(false);
  });

  it('is not confused with a property every object has', () => {
    expect(folded({ constructor: 1 }).warnings).toEqual([`${config}: constructor is not a setting ahpd knows; ignored`]);
  });
});

describe('a valid file', () => {
  it('of every key is read, each under its flag', () => {
    const options = folded({
      port: 0,
      host: '127.0.0.1',
      paths: [home],
      connectionToken: 'secret',
      connectionTokenFile: join(home, 'token'),
      withoutConnectionToken: false,
      users: join(home, 'users.json'),
      resource: 'https://ahpd.test/',
      issuer: 'github',
      trustToken: true,
      advancedTools: true,
      automations: 'memory',
      sessions: 'memory',
      wire: join(home, 'wire.jsonl'),
      http: { port: 0, host: '127.0.0.1' },
      plugins: ['a', { name: 'b', options: { x: 1 }, enabled: false }],
      updateCheck: false,
    });
    expect(options.warnings).toEqual([]);
    expect(options).toMatchObject({
      port: 0,
      host: '127.0.0.1',
      paths: [home],
      token: 'secret',
      tokenFile: join(home, 'token'),
      open: false,
      users: join(home, 'users.json'),
      resource: 'https://ahpd.test/',
      issuer: 'github',
      trustToken: true,
      advancedTools: true,
      automations: 'memory',
      sessions: 'memory',
      wire: join(home, 'wire.jsonl'),
      http: { port: 0, host: '127.0.0.1' },
      plugins: ['a', { name: 'b', options: { x: 1 }, enabled: false }],
      updateCheck: false,
    });
  });

  it('takes http true as the daemon\'s own listener and false as off', () => {
    expect(folded({ http: true }).http).toEqual({});
    expect(folded({ http: false }).http).toBeUndefined();
  });

  it('is under every flag that was typed', () => {
    put({ port: 1, automations: 'memory', paths: ['/from-file'], trustToken: true });
    const options = optionsFrom({ configFile: config, port: 2, automations: 'file', paths: ['/typed'], trustToken: false });
    expect(options).toMatchObject({ port: 2, automations: 'file', paths: ['/typed'], trustToken: false });
  });

  it('leaves the defaults where neither says anything', () => {
    const options = folded({});
    expect(options).toMatchObject({
      port: 9187, host: '127.0.0.1', open: false, trustToken: false, advancedTools: false,
      automations: 'file', sessions: 'file', plugins: [], updateCheck: true, warnings: [],
    });
  });
});

describe('the schema', () => {
  it('is built from the flags, so a new one is checked in the file too', () => {
    const keys = Object.keys(configSchema.properties);
    for (const key of Object.keys(serverFields)) {
      if (['stdio', 'configFile', 'noPlugins'].includes(key)) continue;
      expect(keys).toContain(key);
    }
  });

  it('gives http no flag', () => {
    expect(Object.keys(flagFields)).not.toContain('http');
    expect(Object.keys(serverFields)).toContain('http');
  });

  it('names the keys Config does', () => {
    expectTypeOf<keyof Config>().toEqualTypeOf<keyof typeof configSchema.properties>();
  });
});

/** The daemon as a process, over stdio, with this file. */
const run = (value: unknown): Promise<{ code: number | null; stderr: string }> => {
  put(value);
  const child = spawn(
    process.execPath,
    [MAIN, '--stdio', '--config-file', config, '--plugin', BACKEND, '--no-update-check'],
    {
      cwd: REPO,
      env: { ...process.env, XDG_CONFIG_HOME: home, CI: '1', NODE_OPTIONS: '--conditions development --import ./scripts/dev.mjs' },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  child.stdin.end();
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
  child.stdout.resume();
  return new Promise((done) => { child.on('close', (code) => { done({ code, stderr }); }); });
};

describe('the daemon', () => {
  it('starts with an unknown key and says so in its log', async () => {
    const said = await run({ plugin: [] });
    expect(said.code).toBe(0);
    expect(said.stderr).toContain(`${config}: plugin is not a setting ahpd knows; ignored`);
    expect(said.stderr).toContain('ahpd over stdio');
  }, 20000);

  it('refuses to start on a wrong value, naming the file and the key', async () => {
    const said = await run({ port: '8080' });
    expect(said.code).toBe(2);
    expect(said.stderr).toContain(`${config}: port must be an integer`);
  }, 20000);
});
