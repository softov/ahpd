/*
 * `ahpd configure`, at a terminal nobody is sitting at and with npm faked.
 *
 * Every case is about the file the command leaves and the one npm call it makes:
 * the defaults it writes when every answer is Enter, what a second run shows for
 * them, and the keys and entries it was not asked about and kept anyway. The
 * terminal is faked so nothing here reads this process's own, and the runner is
 * a fake so no case needs a registry, a network or a package.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { askToServe, configure, offerConfigure, type Configured } from '../src/commands/configure.js';
import { optionsFrom } from '../src/commands/options.js';
import { cliRegistry } from '../src/commands/registry.js';
import type { Ran, Runner } from '../src/install.js';
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
/** Every npm call a case made, so a second run can be shown not to make one. */
const calls: { program: string; argv: string[] }[] = [];
const run: Runner = async (program, argv) => {
  calls.push({ program, argv: [...argv] });
  return { code: 0, stdout: '', stderr: '' } satisfies Ran;
};
/** A registry that says every version asked for is a plugin. */
const fetch: Fetch = async () => Response.json({ ahpd: { entry: './dist/index.js' } });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-configure-'));
  configDir = join(root, 'ahpd');
  configFile = join(configDir, 'config.json');
  mkdirSync(configDir, { recursive: true });
  calls.length = 0;
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** One run of `configure`, answering as the terminal gives. */
const asked = async (...answers: string[]): Promise<{ answered: Configured; said: string }> => {
  const term = terminal(...answers);
  const lines: string[] = [];
  const answered = await configure({
    configDir, configFile, version: '0.8.0', term: term.term, run, fetch, say: (line) => { lines.push(line); },
  });
  return { answered, said: `${term.said()}${lines.join('\n')}` };
};

const put = (held: unknown): void => { writeFileSync(configFile, `${JSON.stringify(held, null, 2)}\n`); };
const read = (): Record<string, unknown> => JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;
const tokenFile = (): string => join(configDir, 'connection-token');

it('is a local command, and no served one', () => {
  const command = cliRegistry().find('daemon.configure');
  expect(command?.surfaces?.cli).toBe(true);
  // A served command carries its route under `meta`; this one asks questions.
  expect(command?.meta?.http).toBeUndefined();
});

it('writes the defaults on Enter at every question, and installs Claude', async () => {
  const { answered } = await asked('', '', '', '', '', '', '');
  expect(answered.backends).toEqual(['@ahpd/agent-claude']);
  expect(answered.paths).toEqual([process.cwd()]);

  expect(read()).toEqual({
    host: '127.0.0.1',
    port: 9187,
    connectionTokenFile: tokenFile(),
    paths: [process.cwd()],
    plugins: ['@ahpd/agent-claude'],
  });
  // A secret, so Enter wrote one into the file beside the configuration and it
  // is not the empty string.
  expect(readFileSync(tokenFile(), 'utf8').trim().length).toBeGreaterThan(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.program).toBe('npm');
  expect(calls[0]?.argv).toContain('@ahpd/agent-claude@0.8.0');
});

it('shows what it wrote as the default on a second run, and installs nothing again', async () => {
  await asked('', '', '', '', '', '', '');
  const again = await asked('', '', '', '', '', '', '');
  expect(again.said).toContain('Claude? [Y/n]: ');
  // A backend the file already names is the answer Enter keeps.
  expect(again.said).toContain('cofold? [y/N]: ');
  expect(again.said).toContain('Host [127.0.0.1]: ');
  expect(again.said).toContain('Port [9187]: ');
  expect(again.said).toContain(`Serve ${process.cwd()}? [Y/n]: `);
  // The token that is there is what Enter keeps, rather than a second one.
  expect(again.said).toContain(`Connection token [keep ${tokenFile()}]: `);
  expect(calls).toHaveLength(1);
  expect(read().plugins).toEqual(['@ahpd/agent-claude']);
});

it('writes a typed token to the token file', async () => {
  await asked('', '', '', '', '', 'shh', '');
  expect(read().connectionTokenFile).toBe(tokenFile());
  expect(readFileSync(tokenFile(), 'utf8').trim()).toBe('shh');
});

it('generates a token on Enter, and keeps the one already there', async () => {
  await asked('', '', '', '', '', '', '');
  const generated = readFileSync(tokenFile(), 'utf8').trim();
  expect(generated).not.toBe('');
  await asked('', '', '', '', '', '', '');
  // And a third run changes neither the token nor the file.
  expect(readFileSync(tokenFile(), 'utf8').trim()).toBe(generated);
});

it('keeps a token written as a literal, moving it into the token file', async () => {
  put({ connectionToken: 'old-shh' });
  const { said } = await asked('', '', '', '', '', '', '');
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
  await asked('n', '', '', '', '', '', '');
  // A No is not a removal: the entry stays, saying it is off, as
  // `ahpd plugin disable` writes it.
  expect(read().plugins).toEqual([{ name: '@ahpd/agent-claude', enabled: false }]);

  put({ plugins: [{ name: '@ahpd/agent-claude', options: { model: 'opus' } }] });
  await asked('', '', '', '', '', '', '');
  expect(read().plugins).toEqual([{ name: '@ahpd/agent-claude', options: { model: 'opus' }, enabled: true }]);
});

it('leaves a folder answered No out of paths', async () => {
  put({ paths: ['/tmp/one', '/tmp/two'] });
  const { answered } = await asked('', '', '', '', '', '', 'n', '');
  expect(answered.paths).toEqual(['/tmp/two']);
  expect(read().paths).toEqual(['/tmp/two']);
});

it('keeps a key it was not asked about', async () => {
  put({ users: '/tmp/people.json', advancedTools: true });
  await asked('', '', '', '', '', '', '');
  expect(read().users).toBe('/tmp/people.json');
  expect(read().advancedTools).toBe(true);
});

it('refuses a port that is not one, before anything is written', async () => {
  await expect(asked('', '', '', '', 'nine thousand', '', '')).rejects.toThrow(/^Port must be a number from 0 to 65535, not nine thousand\.$/u);
  expect(existsSync(configFile)).toBe(false);
});

it('refuses rather than serving nothing when every folder is answered No', async () => {
  put({ paths: ['/tmp/one'] });
  await expect(asked('', '', '', '', '', '', 'n')).rejects.toThrow(/every folder/i);
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