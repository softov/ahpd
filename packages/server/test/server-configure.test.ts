/*
 * `ahpd configure`, at a terminal nobody is sitting at and with npm faked.
 *
 * Every case is about the file the command leaves and the one npm call it makes:
 * the defaults it writes when every answer is Enter, what a second run shows for
 * them, and the keys and entries it was not asked about and kept anyway. The
 * terminal is faked so nothing here reads this process's own, and the runner is
 * a fake so no case needs a registry, a network or a package.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installLine, knownAgents, type KnownAgent } from '@ahpd/sdk';
import { askToServe, configure, offerConfigure, under, type Configured } from '../src/commands/configure.js';
import { optionsFrom } from '../src/commands/options.js';
import { cliRegistry } from '../src/commands/registry.js';
import { missingLines } from '../src/found.js';
import type { Ran, Runner, RunOptions } from '../src/install.js';
import type { Fetch } from '../src/update.js';

/**
 * A terminal nobody is sitting at: one answer per prompt, and everything the
 * questions wrote kept in one string.
 *
 * The answer is written only once a prompt has been printed, which is what a
 * person does. A fake that wrote them all up front would not do: `readline`
 * takes one line out of a buffer and drops the rest of it.
 */
const terminal = (...answers: string[]) => {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const pending = [...answers];
  let said = '';
  const output = Object.assign(new Writable({
    write(chunk, _encoding, done) {
      said += String(chunk);
      done();
      if (!said.endsWith(': ')) return;
      const answer = pending.shift();
      if (answer !== undefined) setImmediate(() => { input.write(`${answer}\n`); });
    },
  }), { isTTY: true });
  // `readline` draws around the cursor and echoes what was typed; a reader of
  // this file wants the words, so those are what is kept.
  return {
    term: { input, output },
    said: () => said.replace(/\u001b\[[0-9;]*[A-Za-z]/gu, '').replace(/\r/gu, ''),
  };
};

let root: string;
let configDir: string;
let configFile: string;
/** The only folder on PATH, so what the command finds is what a case put there. */
let bin: string;
/** What each stub says for `--version`, by the name it was found under. */
const versions = new Map<string, string>();
/** The stubs whose `--version` exits non-zero. */
const failing = new Set<string>();
/** The stubs whose `--version` never answers, which is what the 3 seconds are for. */
const hanging = new Set<string>();
/** Every program a case ran, so a second run can be shown not to make an npm call. */
const calls: { program: string; argv: string[]; options?: RunOptions }[] = [];
/** The package a source names, without the version or tag after it. */
const packageSource = (source: string): string => {
  const at = source.indexOf('@', source.startsWith('@') ? 1 : 0);
  return at === -1 ? source : source.slice(0, at);
};

/**
 * The runner: npm always succeeds and lands what each source names, and a
 * `--version` is answered from the maps above rather than by the file, which is
 * a stub holding no code at all.
 */
const run: Runner = async (program, argv, options) => {
  calls.push({ program, argv: [...argv], ...(options === undefined ? {} : { options }) });
  // An install lands each source as the package it names, with the `ahpd`
  // field a plugin's manifest has: the install path reads that manifest to
  // tell a plugin from a package that is not one, and refuses one it cannot
  // find at all.
  if (argv[0] === 'install') {
    const into = argv[argv.indexOf('--prefix') + 1] as string;
    for (const source of argv.slice(argv.indexOf('--') + 1)) {
      const name = packageSource(source);
      const folder = join(into, 'node_modules', name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'package.json'), `${JSON.stringify({ name, version: '0.8.0', ahpd: { entry: './dist/index.js' } })}\n`);
    }
    return { code: 0, stdout: '', stderr: '' } satisfies Ran;
  }
  if (argv[0] !== '--version') return { code: 0, stdout: '', stderr: '' } satisfies Ran;
  const name = basename(program).replace(/\.(?:cmd|exe|bat|com)$/iu, '');
  if (hanging.has(name)) return { code: -1, stdout: '', stderr: '' } satisfies Ran;
  if (failing.has(name)) return { code: 1, stdout: '', stderr: 'no version' } satisfies Ran;
  return { code: 0, stdout: `${versions.get(name) ?? ''}\n`, stderr: '' } satisfies Ran;
};
/**
 * A registry holding one version of `@ahpd/agent-claude`, whose `@ahpd/sdk`
 * peer range admits this daemon's `0.8.0`; any other path is answered as the
 * manifest of a version that is a plugin.
 */
const packument = {
  versions: { '0.8.0': { peerDependencies: { '@ahpd/sdk': '>=0.8' } } },
  'dist-tags': { latest: '0.8.0' },
};
const fetch: Fetch = async (url) => Response.json(
  String(url).endsWith('@ahpd%2fagent-claude') ? packument : { ahpd: { entry: './dist/index.js' } },
);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-configure-'));
  configDir = join(root, 'ahpd');
  configFile = join(configDir, 'config.json');
  bin = join(root, 'bin');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(bin, { recursive: true });
  calls.length = 0;
  versions.clear();
  failing.clear();
  hanging.clear();
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** One run of `configure`, answering as the terminal gives, over this case's PATH. */
const asked = async (...answers: string[]): Promise<{ answered: Configured; said: string }> => {
  const term = terminal(...answers);
  const lines: string[] = [];
  const answered = await configure({
    configDir, configFile, version: '0.8.0', term: term.term, run, fetch, path: bin, say: (line) => { lines.push(line); },
  });
  return { answered, said: `${term.said()}${lines.join('\n')}` };
};

/** The file a stub has in `bin` on this system, where npm installs a `.cmd` on Windows. */
const stubFile = (name: string): string => join(bin, process.platform === 'win32' ? `${name}.cmd` : name);

/** A command on PATH. It is never run: the runner above answers its version. */
const stub = (name: string, version?: string): void => {
  writeFileSync(stubFile(name), '#!/bin/sh\n');
  chmodSync(stubFile(name), 0o755);
  if (version !== undefined) versions.set(name, version);
};

/** A row by id, which every case here then has for sure. */
const row = (id: string): KnownAgent => {
  const agent = knownAgents[id];
  if (agent === undefined) throw new Error(`knownAgents has no ${id}`);
  return agent;
};

const put = (held: unknown): void => { writeFileSync(configFile, `${JSON.stringify(held, null, 2)}\n`); };
const read = (): Record<string, unknown> => JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;
const tokenFile = (): string => join(configDir, 'connection-token');

/** The `@ahpd/agent-acp` entry in the file, as an object, which every pi case writes. */
const acpEntry = (): Record<string, unknown> => {
  const entry = (read().plugins as unknown[]).find((one) => typeof one === 'object' && one !== null
    && ((one as Record<string, unknown>)['source'] ?? (one as Record<string, unknown>)['name']) === '@ahpd/agent-acp');
  if (entry === undefined) throw new Error('the file has no @ahpd/agent-acp entry');
  return entry as Record<string, unknown>;
};

/** The presets the `@ahpd/agent-acp` entry still holds, which the next start moves to records. */
const presetsOf = (): Record<string, unknown> => {
  const options = acpEntry()['options'];
  if (typeof options !== 'object' || options === null) return {};
  const presets = (options as Record<string, unknown>)['presets'];
  return typeof presets === 'object' && presets !== null ? presets as Record<string, unknown> : {};
};

/**
 * One agent record as the file keeps it, or nothing when there is none.
 *
 * An agent is a record on the agents channel now, and the daemon's store keeps
 * each one as `<configDir>/agents/<id>.json`.
 */
const recordOf = (id: string): Record<string, unknown> | undefined => {
  const file = join(configDir, 'agents', `${id}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> : undefined;
};

/** One agent record written the way the daemon keeps it: the whole record as pretty JSON. */
const putRecord = (record: Record<string, unknown>): void => {
  mkdirSync(join(configDir, 'agents'), { recursive: true });
  writeFileSync(join(configDir, 'agents', `${String(record['id'])}.json`), `${JSON.stringify(record, null, 2)}\n`);
};

/*
 * A folder under a served one, as VS Code's agent host tells a folder under a
 * trusted one: a letter's case ignored where the file system ignores it, and
 * kept on Linux, where `Work` and `work` are two folders.
 */
it('reads a folder under a served one as VS Code does, its letters\' case ignored except on Linux', () => {
  const served = join(tmpdir(), 'Work');
  expect(under(join(tmpdir(), 'work', 'app'), served, true)).toBe(true);
  expect(under(join(tmpdir(), 'WORK'), served, true)).toBe(true);
  expect(under(join(tmpdir(), 'workshop'), served, true)).toBe(false);
  expect(under(join(tmpdir(), 'work', 'app'), served, false)).toBe(false);
  expect(under(join(tmpdir(), 'Work', 'app'), served, false)).toBe(true);
  expect(under(join(tmpdir(), 'work', 'app'), served)).toBe(process.platform !== 'linux');
});

it('is a local command, and no served one', () => {
  const command = cliRegistry().find('daemon.configure');
  expect(command?.surfaces?.cli).toBe(true);
  // A served command carries its route under `meta`; this one asks questions.
  expect(command?.meta?.http).toBeUndefined();
});

it('writes the defaults on Enter at every question, and installs Claude and the web UI', async () => {
  const { answered } = await asked('', '', '', '', '', '', '', '');
  expect(answered.backends).toEqual(['@ahpd/agent-claude']);
  expect(answered.paths).toEqual([process.cwd()]);

  expect(read()).toEqual({
    host: '127.0.0.1',
    port: 9187,
    connectionTokenFile: tokenFile(),
    paths: [process.cwd()],
    plugins: ['@ahpd/agent-claude', '@ahpd/web'],
  });
  // A secret, so Enter wrote one into the file beside the configuration and it
  // is not the empty string.
  expect(readFileSync(tokenFile(), 'utf8').trim().length).toBeGreaterThan(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.program).toBe('npm');
  expect(calls[0]?.argv).toContain('@ahpd/agent-claude@0.8.0');
  // The web UI is offered on a first run, and Enter takes it.
  expect(calls[0]?.argv).toContain('@ahpd/web');
});

it('installs only Claude when the web UI is answered No on a first run', async () => {
  const { said } = await asked('', '', '', 'n', '', '', '', '');
  expect(said).toContain('Web UI? [Y/n]: ');
  expect(read().plugins).toEqual(['@ahpd/agent-claude']);
  expect(calls.some((one) => one.argv.includes('@ahpd/web'))).toBe(false);
});

it('switches a web UI the file names off when it is answered No', async () => {
  put({ plugins: ['@ahpd/agent-claude', '@ahpd/web'] });
  await asked('', '', '', 'n', '', '', '', '');
  // A No is not a removal: the entry stays, saying it is off.
  expect(read().plugins).toEqual(['@ahpd/agent-claude', { source: '@ahpd/web', enabled: false }]);
});

it('shows what it wrote as the default on a second run, and installs nothing again', async () => {
  await asked('', '', '', '', '', '', '', '');
  const again = await asked('', '', '', '', '', '', '', '');
  expect(again.said).toContain('Claude? [Y/n]: ');
  // A backend the file already names is the answer Enter keeps.
  expect(again.said).toContain('cofold? [y/N]: ');
  expect(again.said).toContain('Host [127.0.0.1]: ');
  expect(again.said).toContain('Port [9187]: ');
  expect(again.said).toContain(`Serve ${process.cwd()}? [Y/n]: `);
  // The token that is there is what Enter keeps, rather than a second one.
  expect(again.said).toContain(`Connection token [keep ${tokenFile()}]: `);
  expect(calls).toHaveLength(1);
  expect(read().plugins).toEqual(['@ahpd/agent-claude', '@ahpd/web']);
});

it('makes the configuration folder on a first run, rather than failing on the token file', async () => {
  // A machine that has never configured this daemon has neither the folder nor
  // anything in it, and the token is written before the configuration file is:
  // a `writeFileSync` that makes no folder fails the whole command at its last
  // question.
  const fresh = join(root, 'never-made');
  const file = join(fresh, 'config.json');
  const term = terminal('', '', '', '', '', '', '', '');
  const answered = await configure({
    configDir: fresh, configFile: file, version: '0.8.0', term: term.term, run, fetch, path: bin, say: () => {},
  });
  expect(answered.paths).toEqual([process.cwd()]);
  const wrote = join(fresh, 'connection-token');
  expect(existsSync(wrote)).toBe(true);
  expect(readFileSync(wrote, 'utf8').trim()).not.toBe('');
  expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ connectionTokenFile: wrote });
});

it('writes a typed token to the token file', async () => {
  await asked('', '', '', '', '', '', 'shh', '');
  expect(read().connectionTokenFile).toBe(tokenFile());
  expect(readFileSync(tokenFile(), 'utf8').trim()).toBe('shh');
});

it('generates a token on Enter, and keeps the one already there', async () => {
  await asked('', '', '', '', '', '', '', '');
  const generated = readFileSync(tokenFile(), 'utf8').trim();
  expect(generated).not.toBe('');
  await asked('', '', '', '', '', '', '', '');
  // And a third run changes neither the token nor the file.
  expect(readFileSync(tokenFile(), 'utf8').trim()).toBe(generated);
});

it('keeps a token written as a literal, moving it into the token file', async () => {
  put({ connectionToken: 'old-shh' });
  const { said } = await asked('', '', '', '', '', '', '', '');
  // A token clients are already presenting is one Enter keeps, not one it
  // replaces: a fresh one here locks every one of them out.
  expect(said).toContain(`Connection token [keep the token in ${configFile}]: `);
  expect(readFileSync(tokenFile(), 'utf8').trim()).toBe('old-shh');
  expect(read().connectionTokenFile).toBe(tokenFile());
  // And the literal is taken out, since `secret()` refuses both spellings.
  expect(read().connectionToken).toBeUndefined();
});

it('switches a backend the file names off when it is answered No, and on again when it is answered Yes', async () => {
  put({ plugins: ['@ahpd/agent-claude'] });
  await asked('n', '', '', '', '', '', '', '');
  // A No is not a removal: the entry stays, saying it is off, as
  // `ahpd plugin disable` writes it.
  expect(read().plugins).toEqual([{ source: '@ahpd/agent-claude', enabled: false }]);

  put({ plugins: [{ name: '@ahpd/agent-claude', options: { model: 'opus' } }] });
  await asked('', '', '', '', '', '', '', '');
  expect(read().plugins).toEqual([{ source: '@ahpd/agent-claude', options: { model: 'opus' }, enabled: true }]);
});

it('leaves a folder answered No out of paths', async () => {
  put({ paths: ['/tmp/one', '/tmp/two'] });
  const { answered } = await asked('', '', '', '', '', '', '', 'n', '');
  expect(answered.paths).toEqual(['/tmp/two']);
  expect(read().paths).toEqual(['/tmp/two']);
});

it('keeps a key it was not asked about', async () => {
  put({ users: '/tmp/people.json', advancedTools: true });
  await asked('', '', '', '', '', '', '', '');
  expect(read().users).toBe('/tmp/people.json');
  expect(read().advancedTools).toBe(true);
});

it('refuses a port that is not one, before anything is written', async () => {
  await expect(asked('', '', '', '', '', 'nine thousand', '', '')).rejects.toThrow(/^Port must be a number from 0 to 65535, not nine thousand\.$/u);
  expect(existsSync(configFile)).toBe(false);
});

it('refuses rather than serving nothing when every folder is answered No', async () => {
  put({ paths: ['/tmp/one'] });
  await expect(asked('', '', '', '', '', '', '', 'n')).rejects.toThrow(/every folder/i);
});

describe('what is on PATH', () => {
  it('asks about a found agent, and a Yes writes it as a host record and names its plugin', async () => {
    stub('gemini', '0.9.0');
    const { said } = await asked('', '', '', '', '', '', '', '', '');
    expect(said).toContain('Gemini? [Y/n]: ');
    expect(read().plugins).toEqual([
      '@ahpd/agent-acp',
      '@ahpd/agent-claude',
      '@ahpd/web',
    ]);
    // The record is what the agents channel serves; the plugin is what registers
    // the engine it opens on, and the host is the owner a preset's agent had.
    expect(recordOf('gemini')).toMatchObject({
      id: 'gemini', engine: 'acp', owner: 'host', name: 'Gemini', config: {},
    });
    // The package that runs it is installed with the backend, after the write.
    expect(calls.some((one) => one.program === 'npm' && one.argv.includes('@ahpd/agent-acp'))).toBe(true);
  });

  it('writes no agent-acp entry and installs nothing for it when the agent is answered No', async () => {
    stub('gemini', '0.9.0');
    await asked('', '', '', '', 'n', '', '', '', '');
    expect(read().plugins).toEqual(['@ahpd/agent-claude', '@ahpd/web']);
    expect(calls.some((one) => one.argv.includes('@ahpd/agent-acp'))).toBe(false);
  });

  it('shows an agent the file has as a record as configured, asks nothing about it, and keeps it', async () => {
    put({ plugins: [{ name: '@ahpd/agent-acp', options: { hostTools: false } }] });
    putRecord({ id: 'gemini', engine: 'acp', owner: 'host', name: 'Gemini', config: { model: 'flash' } });
    stub('gemini', '0.9.0');
    const { said } = await asked('', '', '', '', '', '', '', '');
    expect(said).toContain('Gemini 0.9.0 (configured, @ahpd/agent-acp)');
    expect(said).not.toContain('Gemini? [Y/n]: ');
    expect(read().plugins).toEqual([
      { name: '@ahpd/agent-acp', options: { hostTools: false } },
      '@ahpd/agent-claude',
    ]);
    // Nothing here edits the record: the file as it was is the file it is.
    expect(recordOf('gemini')).toMatchObject({ config: { model: 'flash' } });
  });

  it('asks about an agent whose record is there but whose plugin the file does not name', async () => {
    // A record left behind by a setup that stopped before it wrote the file is
    // not one the daemon serves, so it is asked about, and the answer is what
    // puts the plugin that registers its engine in the file.
    putRecord({ id: 'gemini', engine: 'acp', owner: 'host', name: 'Gemini', config: {} });
    stub('gemini', '0.9.0');
    const { said } = await asked('', '', '', '', '', '', '', '', '');
    expect(said).toContain('Gemini 0.9.0 (not configured, @ahpd/agent-acp)');
    expect(said).toContain('Gemini? [Y/n]: ');
    expect(read().plugins).toContain('@ahpd/agent-acp');
  });

  it('counts a preset the file still holds as configured, until the next start moves it', async () => {
    put({
      plugins: [{
        name: '@ahpd/agent-acp',
        options: { presets: { gemini: { model: 'flash' } }, hostTools: false },
      }],
    });
    stub('gemini', '0.9.0');
    const { said } = await asked('', '', '', '', '', '', '', '');
    expect(said).toContain('Gemini 0.9.0 (configured, @ahpd/agent-acp)');
    expect(said).not.toContain('Gemini? [Y/n]: ');
    // The preset is still the only copy of the agent, so no record is made here.
    expect(recordOf('gemini')).toBeUndefined();
    expect(presetsOf()).toEqual({ gemini: { model: 'flash' } });
  });

  it('asks nothing about the ACP pi preset when the native pi backend is on', async () => {
    stub('pi-acp', '1.0.0');
    const { said } = await asked('', '', 'y', '', '', '', '', '');
    expect(said).toContain('pi-acp: not asked, the pi backend runs pi');
    expect(said).not.toContain('Pi? [Y/n]: ');
    // The one pi is the backend, and no preset was written beside it.
    expect(read().plugins).toEqual(['@ahpd/agent-claude', '@ahpd/agent-pi', '@ahpd/web']);
  });

  it('offers to remove an ACP pi agent the file has when the native pi backend is on', async () => {
    const both = {
      plugins: ['@ahpd/agent-pi', { name: '@ahpd/agent-acp', options: { presets: { pi: {} }, hostTools: false } }],
    };
    const record = { id: 'pi', engine: 'acp', owner: 'host', name: 'Pi', config: {} };
    put(both);
    putRecord(record);
    stub('pi-acp', '1.0.0');
    const yes = await asked('', '', '', '', '', '', '', '', '');
    expect(yes.said).toContain('Remove the ACP pi agent? It clashes with the pi backend. [Y/n]: ');
    // The record and the preset are both of them: a file this start would move
    // its preset into a record otherwise has two agents of one id.
    expect(recordOf('pi')).toBeUndefined();
    expect(presetsOf()).toEqual({});
    // Dropping the agent keeps every other option the entry holds.
    expect((acpEntry()['options'] as Record<string, unknown>)['hostTools']).toBe(false);

    put(both);
    putRecord(record);
    const no = await asked('', '', '', '', 'n', '', '', '', '');
    expect(no.said).toContain('Remove the ACP pi agent? It clashes with the pi backend. [Y/n]: ');
    expect(recordOf('pi')).toMatchObject({ id: 'pi', engine: 'acp' });
    expect(presetsOf()).toEqual({ pi: {} });
  });

  it('asks about the ACP pi agent when the native pi backend is answered No', async () => {
    stub('pi-acp', '1.0.0');
    const { said } = await asked('', '', 'n', '', '', '', '', '', '');
    expect(said).toContain('Pi? [Y/n]: ');
    expect(said).not.toContain('pi-acp: not asked, the pi backend runs pi');
    expect(recordOf('pi')).toMatchObject({ id: 'pi', engine: 'acp', owner: 'host', name: 'Pi', config: {} });
    expect(read().plugins).toContain('@ahpd/agent-acp');
  });

  it('lists every agent it did not find with the line that installs it', async () => {
    const { said } = await asked('', '', '', '', '', '', '', '');
    expect(said).toContain('Agents not found:');
    expect(said).toContain(`  Codex: ${installLine(row('codex'), process.platform)}`);
    expect(said).toContain(`  OpenCode: ${installLine(row('opencode'), process.platform)}`);
    // A row with no line for this system shows its page instead of an empty one.
    expect(said).toContain(`  Amp: ${row('amp').page}`);
  });

  it('asks no agent question with an empty PATH, so the questions are the ones of today', async () => {
    const { said } = await asked('', '', '', '', '', '', '', '');
    for (const agent of Object.values(knownAgents)) {
      expect(said, `${agent.name} was asked about`).not.toContain(`${agent.name}? [Y/n]: `);
    }
  });

  it('names the runtime versions the runner gave', async () => {
    stub('node', 'v24.21.0');
    stub('bun', '1.2.3');
    stub('deno', '2.0.0');
    const { said } = await asked('', '', '', '', '', '', '', '');
    expect(said).toContain('Node v24.21.0 (runs ahpd)');
    expect(said).toContain('Bun 1.2.3 (runs ahpd)');
    expect(said).toContain('Deno 2.0.0 (runs ahpd; each plugin it loads needs an npm: spec)');
  });

  it('says ahpd does not run on Node 20', async () => {
    stub('node', 'v22.17.0');
    const { said } = await asked('', '', '', '', '', '', '', '');
    expect(said).toContain('Node v22.17.0 (ahpd does not run on it; it needs Node 22.18 or newer)');
  });

  it('shows the version the runner gave for the agent it found', async () => {
    stub('gemini', '0.9.0');
    const { said } = await asked('', '', '', '', '', '', '', '', '');
    expect(said).toContain('Agents found:');
    expect(said).toContain('Gemini 0.9.0 (not configured, @ahpd/agent-acp)');
  });

  it('shows the path and no version when --version fails', async () => {
    stub('gemini');
    failing.add('gemini');
    const { said } = await asked('', '', '', '', 'n', '', '', '', '');
    expect(said).toContain(`Gemini at ${stubFile('gemini')} (not configured, @ahpd/agent-acp)`);
    // The limit is what keeps an agent that checks for updates as it starts
    // from holding up the setup, so the probe is given it.
    const probe = calls.find((one) => one.program === stubFile('gemini') && one.argv[0] === '--version');
    expect(probe?.options).toEqual({ timeoutMs: 3000, capture: true });
  });

  it('shows the path and no version when --version passes the 3 seconds', async () => {
    stub('gemini');
    hanging.add('gemini');
    const { said } = await asked('', '', '', '', 'n', '', '', '', '');
    expect(said).toContain(`Gemini at ${stubFile('gemini')} (not configured, @ahpd/agent-acp)`);
  });

  it('shows claude under Also found, and asks the three backend questions it always did', async () => {
    stub('claude', '2.1.291');
    const { said } = await asked('', '', '', '', '', '', '', '');
    expect(said).toContain('Also found:');
    expect(said).toContain('  claude 2.1.291');
    expect(said).toContain('Claude? [Y/n]: ');
    expect(said).toContain('cofold? [y/N]: ');
    expect(said).toContain('pi? [y/N]: ');
  });

  it('shows an install line a record writes for a missing agent, not the row it shipped with', async () => {
    // The plugin is in the file, so the record is one this host serves and its
    // own install line is the one the person would run.
    put({ plugins: ['@ahpd/agent-acp'] });
    putRecord({
      id: 'gemini', engine: 'acp', owner: 'host', name: 'Gemini',
      config: { install: { all: 'npm i -g my-gemini' } },
    });
    const { said } = await asked('', '', '', '', '', '', '', '');
    expect(said).toContain('  Gemini: npm i -g my-gemini');
    expect(said).not.toContain('@google/gemini-cli');
  });

  it('shows a row page for a system the row has no line for', () => {
    const one: KnownAgent = {
      id: 'x', name: 'X',
      site: 'https://x.example', company: 'https://x.example',
      command: 'x',
      install: { linux: 'apt install x' },
      page: 'https://example.com/x',
      variables: [],
    };
    expect(missingLines([one], 'win32')).toEqual(['Agents not found:', '  X: https://example.com/x']);
  });

  it('shows the site when a row has neither a line for the system nor a page', () => {
    const one: KnownAgent = {
      id: 'x', name: 'X',
      site: 'https://x.example', company: 'https://x.example',
      command: 'x',
      variables: [],
    };
    expect(missingLines([one], 'win32')).toEqual(['Agents not found:', '  X: https://x.example']);
  });
});

describe('a start with no configuration', () => {
  /** One offer, answering as the terminal gives, and what it asked and ran. */
  const offer = async (configFile: string, term: ReturnType<typeof terminal>) => {
    const said: string[] = [];
    let ran = 0;
    const done = await offerConfigure({
      configFile, term: term.term, say: (line) => { said.push(line); },
      run: async () => { ran += 1; },
    });
    return { done, said: `${term.said()}${said.join('\n')}`, ran };
  };

  it('asks and runs it on yes, so the run that follows reads what it wrote', async () => {
    const term = terminal('');
    const { done, said, ran } = await offer(configFile, term);
    expect(done).toBe(true);
    expect(ran).toBe(1);
    expect(said).toContain('No configuration. Run ahpd configure now? [Y/n]: ');
  });

  it('says it did not run it on no, and refuses as a start with no backend does', async () => {
    const term = terminal('n');
    const { done, said, ran } = await offer(configFile, term);
    expect(done).toBe(false);
    expect(ran).toBe(0);
    expect(said).toContain('Not run.');
  });

  it('asks nothing at all without a terminal, or with a configuration there', async () => {
    const piped = terminal('');
    piped.term.input.isTTY = false;
    const silent = await offer(configFile, piped);
    expect(silent.said).toBe('');
    expect(silent.ran).toBe(0);

    put({ port: 9187 });
    const configured = terminal('');
    const answered = await offer(configFile, configured);
    expect(answered.done).toBe(false);
    expect(answered.ran).toBe(0);
    expect(configured.said()).toBe('');
  });
});

describe('a start in a folder nothing serves', () => {
  /** One question, over a file and flags as given, answering as the terminal gives. */
  const asked = async (held: unknown, flags: Record<string, unknown>, ...answers: string[]) => {
    put(held);
    const options = optionsFrom({ configFile, ...flags });
    const term = terminal(...answers);
    const lines: string[] = [];
    await askToServe(options, configFile, term.term, (line) => { lines.push(line); });
    return { paths: options.paths, said: `${term.said()}${lines.join('\n')}` };
  };

  it('asks on yes and writes the folder to paths, which this run serves too', async () => {
    const { paths, said } = await asked({ paths: ['/tmp/one'] }, {}, '');
    expect(said).toContain(`Serve ${process.cwd()}? [y/N]: `);
    // Enter keeps the No, so the folder has to be answered for it to be added.
    expect(paths).toEqual(['/tmp/one']);
    expect(read().paths).toEqual(['/tmp/one']);

    const yes = await asked({ paths: ['/tmp/one'] }, {}, 'y');
    expect(yes.paths).toEqual(['/tmp/one', process.cwd()]);
    expect(read().paths).toEqual(['/tmp/one', process.cwd()]);
  });

  it('asks nothing about a folder one that is served is under', async () => {
    const here = await asked({ paths: [process.cwd()] }, {});
    expect(here.said).toBe('');
    const above = await asked({ paths: [join(process.cwd(), '..')] }, {});
    expect(above.said).toBe('');
  });

  it('asks nothing under --no-cwd', async () => {
    const { paths, said } = await asked({ paths: ['/tmp/one'] }, { noCwd: true });
    expect(said).toBe('');
    expect(paths).toEqual(['/tmp/one']);
  });

  it('asks nothing without a terminal, and starts without it', async () => {
    put({ paths: ['/tmp/one'] });
    const options = optionsFrom({ configFile });
    const term = terminal('');
    term.term.input.isTTY = false;
    await askToServe(options, configFile, term.term, () => { throw new Error('something was said'); });
    expect(term.said()).toBe('');
    expect(options.paths).toEqual(['/tmp/one']);
    expect(read().paths).toEqual(['/tmp/one']);
  });
});