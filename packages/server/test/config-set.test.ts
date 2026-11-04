/*
 * `ahpd config set` and `ahpd config unset`, run in this process.
 *
 * The configuration is a temporary directory, so no case sees the
 * configuration or the daemon record of whoever runs the suite.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Program } from '@cofold/terminal';
import { programGlobals } from '../src/commands/options.js';
import { cliRegistry } from '../src/commands/registry.js';

let home: string;
let config: string;
let had: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-config-set-'));
  had = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  mkdirSync(join(home, 'ahpd'), { recursive: true });
  config = join(home, 'ahpd', 'config.json');
});
afterEach(() => {
  if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
  rmSync(home, { recursive: true, force: true });
});

const put = (held: unknown): void => { writeFileSync(config, `${JSON.stringify(held, null, 2)}\n`); };
const read = (): Record<string, unknown> => JSON.parse(readFileSync(config, 'utf8')) as Record<string, unknown>;

/** One line as `ahpd` reads it, against the case's own file. */
const line = async (words: string[]): Promise<{ code: number; said: string }> => {
  let said = '';
  const program = new Program({
    name: 'ahpd',
    version: '0.0.0',
    registry: cliRegistry(),
    globals: programGlobals,
    io: { out: (text) => { said += text; }, err: (text) => { said += text; } },
  });
  return { code: await program.run([...words, '--config-file', config]), said };
};

describe('ahpd config set writes one setting', () => {
  it('reads the value as JSON, and keeps every other key', async () => {
    put({ port: 9187 });
    expect((await line(['config', 'set', 'modelApi', 'true'])).code).toBe(0);
    expect((await line(['config', 'set', 'httpApi', '{"port":9300}'])).code).toBe(0);
    expect(read()).toEqual({ port: 9187, modelApi: true, httpApi: { port: 9300 } });
  });

  it('writes a file that does not exist yet', async () => {
    const got = await line(['config', 'set', 'modelApi', 'true']);
    expect(got.code).toBe(0);
    expect(got.said).toContain('Set modelApi.');
    expect(read()).toEqual({ modelApi: true });
  });

  it('writes the new name and removes the old one', async () => {
    put({ http: true, port: 9187 });
    expect((await line(['config', 'set', 'httpApi', 'true'])).code).toBe(0);
    expect(read()).toEqual({ port: 9187, httpApi: true });
  });

  it('writes nothing for a value the start would refuse', async () => {
    put({ port: 9187 });
    await expect(line(['config', 'set', 'modelApi', '{"port":70000}'])).rejects.toThrow('modelApi.port must be an integer');
    expect(read()).toEqual({ port: 9187 });
  });

  it('refuses a key ahpd does not know, and plugins', async () => {
    put({ port: 9187 });
    await expect(line(['config', 'set', 'nothing', 'true'])).rejects.toThrow('nothing is not a setting ahpd knows.');
    await expect(line(['config', 'set', 'plugins', '[]'])).rejects.toThrow('ahpd plugin');
    expect(read()).toEqual({ port: 9187 });
  });
});

describe('ahpd config unset removes one setting', () => {
  it('removes the key and its old name', async () => {
    put({ http: true, port: 9187, modelApi: true });
    expect((await line(['config', 'unset', 'httpApi'])).code).toBe(0);
    expect((await line(['config', 'unset', 'modelApi'])).code).toBe(0);
    expect(read()).toEqual({ port: 9187 });
  });

  it('says so when the file does not set the key', async () => {
    put({ port: 9187 });
    const got = await line(['config', 'unset', 'modelApi']);
    expect(got.code).toBe(0);
    expect(got.said).toContain('sets no modelApi');
    expect(read()).toEqual({ port: 9187 });
  });
});

describe('ahpd config still prints the configuration', () => {
  it('answers config with no words after it', async () => {
    put({ port: 9187 });
    const got = await line(['config']);
    expect(got.code).toBe(0);
    expect(got.said).toContain('port: 9187');
  });
});
