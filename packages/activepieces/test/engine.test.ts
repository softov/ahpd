import { fork } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { Answer, DescribedAnswer } from '../src/wire.js';

/*
 * The engine process, asked directly.
 *
 * The plugin is what forks it, but a piece is what the engine must survive: a
 * piece that turns off the certificate check, a piece that is not installed,
 * and a piece that carries functions of its own. Each case forks the source the
 * plugin forks, and speaks the wire the plugin speaks.
 */

/** The engine's entry, which is the source in development and the build otherwise. */
const ENGINE = fileURLToPath(new URL('../src/engine.ts', import.meta.url));

/** A fixture piece, as the engine imports it: by its URL. */
const fixture = (name: string): string =>
  pathToFileURL(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))).href;

let loose: ChildProcess[] = [];
afterEach(() => {
  for (const one of loose) one.kill();
  loose = [];
});

/** The paths a case made, removed after it. */
const made: string[] = [];
afterEach(() => {
  for (const one of made.splice(0)) rmSync(one, { recursive: true, force: true });
});

/** One empty folder for a case's attachments. */
function madeFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-engine-'));
  made.push(dir);
  return dir;
}

/** One engine, forked the way the plugin forks it, with the environment a case needs. */
function start(env: Record<string, string> = {}): ChildProcess {
  const forked = fork(ENGINE, [], {
    execArgv: [],
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  loose.push(forked);
  return forked;
}

/** One request to the engine, and the answer to it. */
function ask(engine: ChildProcess, request: Record<string, unknown>): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('the engine did not answer')); }, 10_000);
    engine.once('message', (message) => {
      clearTimeout(timer);
      resolve(message as Answer);
    });
    engine.send({ id: 1, ...request });
  });
}

/** The answer to a `describe`, which a case that got another answer should not read. */
const described = (answer: Answer): DescribedAnswer => {
  if (answer.type !== 'described') throw new Error(`the engine answered ${answer.type}: ${answer.type === 'failed' ? answer.message : ''}`);
  return answer;
};

/** The message of a request the engine refused. */
const failed = (answer: Answer): string => {
  if (answer.type !== 'failed') throw new Error(`the engine answered ${answer.type}`);
  return answer.message;
};

/** One request that runs one action of the fixture piece, in a folder when there is one. */
const run = (action: string, input: Record<string, unknown>, files?: string): Record<string, unknown> => ({
  type: 'run',
  piece: fixture('piece-run.mjs'),
  connector: 'work',
  action,
  auth: { type: 'SECRET_TEXT', secret_text: 'sk-test' },
  input,
  ...(files === undefined ? {} : { files }),
});

/** One engine's exit, and the code it exited with. */
function exit(engine: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('the engine did not exit')); }, 10_000);
    engine.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe('the engine asks for pieces', () => {
  it('answers a piece as its auth and its actions, with no function in the answer', async () => {
    const answer = described(await ask(start(), { type: 'describe', pieces: [fixture('piece-simple.mjs')] }));

    expect(answer.errors).toEqual([]);
    expect(answer.pieces).toEqual([{
      package: fixture('piece-simple.mjs'),
      displayName: 'Simple',
      logoUrl: 'https://example.com/simple.svg',
      auth: {
        type: 'SECRET_TEXT',
        displayName: 'API Key',
        description: 'The key the simple API takes.',
        validates: true,
      },
      actions: [
        {
          name: 'say',
          displayName: 'Say',
          description: 'Says the text it is given.',
          aiDescription: 'Says one line, for a model.',
          props: {
            text: { type: 'SHORT_TEXT', displayName: 'Text', description: 'What to say.', required: true },
            loud: { type: 'CHECKBOX', displayName: 'Loud', required: false },
            count: { type: 'NUMBER', displayName: 'Count', required: false },
            format: {
              type: 'STATIC_DROPDOWN',
              displayName: 'Format',
              required: false,
              options: ['plain', 'markdown'],
            },
            channel: { type: 'DROPDOWN', displayName: 'Channel', required: false },
            when: { type: 'DATE_TIME', displayName: 'When', required: false },
            note: { type: 'MARKDOWN', displayName: 'Note', description: 'Read this first.', required: false },
          },
        },
        {
          name: 'upload-file',
          displayName: 'Upload file',
          description: 'Uploads a file.',
          props: {
            file: { type: 'FILE', displayName: 'File', required: true },
          },
        },
      ],
    }]);
  });

  it('ignores a piece that turns off the certificate check', async () => {
    const answer = described(await ask(
      start({ NODE_TLS_REJECT_UNAUTHORIZED: '1' }),
      { type: 'describe', pieces: [fixture('piece-tls.mjs')] },
    ));

    expect(answer.errors).toEqual([]);
    expect(answer.pieces.map((one) => one.package)).toEqual([fixture('piece-tls.mjs')]);
  });

  it('names a package that is not installed and still answers the others', async () => {
    const answer = described(await ask(
      start(),
      { type: 'describe', pieces: ['@activepieces/piece-nowhere', fixture('piece-simple.mjs')] },
    ));

    expect(answer.errors).toHaveLength(1);
    expect(answer.errors[0]).toContain('@activepieces/piece-nowhere');
    expect(answer.pieces.map((one) => one.package)).toEqual([fixture('piece-simple.mjs')]);
  });

  it('exits when the parent closes the channel', async () => {
    const engine = start();
    // Connected, so `disconnect` is the closure a daemon exit makes.
    await ask(engine, { type: 'describe', pieces: [] });
    const ended = exit(engine);
    engine.disconnect();
    expect(await ended).toBe(0);
  });
});

describe('an action runs as Activepieces runs one outside a flow', () => {
  it('runs as step_1, with canPause false and no agent member', async () => {
    expect(await ask(start(), run('context', {}))).toEqual({
      type: 'ran',
      id: 1,
      result: { canPause: false, step: 'step_1', agent: false },
    });
  });

  it('refuses a waitpoint in the engine\'s words, whichever way the piece asks', async () => {
    const words = 'This action pauses the run (waitpoint) and can only run inside a flow, not as a action run.';
    expect(failed(await ask(start(), run('pause', {})))).toBe(words);
    expect(failed(await ask(start(), run('wait', {})))).toBe(words);
  });

  it('refuses an action its piece lacks in the engine\'s words, naming the version that loaded', async () => {
    expect(failed(await ask(start(), {
      type: 'run',
      piece: '@activepieces/piece-resend',
      connector: 'work',
      action: 'no_such_action',
      auth: { type: 'SECRET_TEXT', secret_text: 're_test' },
      input: {},
    }))).toBe('Action not found for piece @activepieces/piece-resend@0.6.1');
  });
});

describe('a call carries a file', () => {
  it('turns a FILE value that names an attachment into the file a piece reads', async () => {
    const dir = madeFolder();
    writeFileSync(join(dir, 'notes.txt'), 'hello');

    const answer = await ask(start(), run('read', { file: 'notes.txt' }, dir));

    expect(answer).toEqual({
      type: 'ran',
      id: 1,
      result: {
        filename: 'notes.txt',
        extension: 'txt',
        size: 5,
        text: 'hello',
        base64: Buffer.from('hello').toString('base64'),
      },
    });
  });

  it('fetches a data: URI that is not base64, as the engine fetches any URL, with no folder', async () => {
    const answer = await ask(start(), run('read', { file: 'data:text/plain,hi' }));

    expect(answer).toMatchObject({ type: 'ran', result: { filename: 'unknown.txt', extension: 'txt', text: 'hi', size: 2 } });
  });

  it('refuses a FILE value that leaves the folder in the validator\'s words, naming neither the folder nor the bytes', async () => {
    const dir = madeFolder();
    const outside = join(tmpdir(), `${basename(dir)}-outside.txt`);
    writeFileSync(outside, 'outside-bytes');
    made.push(outside);

    const said = failed(await ask(start(), run('read', { file: `../${basename(outside)}` }, dir)));

    expect(JSON.parse(said)).toEqual({ file: [`Expected file url or base64 with mimeType, received: ../${basename(outside)}`] });
    expect(said).not.toContain(dir);
    expect(said).not.toContain('outside-bytes');
  });

  it('refuses a FILE value that names a file when the call has no folder, in the validator\'s words', async () => {
    const said = failed(await ask(start(), run('read', { file: 'notes.txt' })));

    expect(JSON.parse(said)).toEqual({ file: ['Expected file url or base64 with mimeType, received: notes.txt'] });
  });
});

describe('a call\'s input is made as Activepieces makes an action run\'s', () => {
  it('refuses a key no prop has, a missing required prop, in the diagnosis\'s words', async () => {
    expect(failed(await ask(start(), run('echo', { txt: 'hi' })))).toBe(
      "Unknown properties: 'txt'.\nSuggestions: 'txt' → did you mean 'text'?. Valid properties for this action are:\n- text (SHORT_TEXT): Text\nPlease retry with correct property names. Missing required inputs: text (SHORT_TEXT).",
    );
    expect(failed(await ask(start(), run('echo', {})))).toBe(
      'Cannot run action: Missing required inputs: text (SHORT_TEXT). Expected inputs: text (SHORT_TEXT, required).',
    );
  });

  it('gives the action each value as its prop\'s type', async () => {
    expect(await ask(start(), run('echo', { text: 42 }))).toMatchObject({ type: 'ran', result: { text: '42' } });
  });
});

describe('a written file is an attachment', () => {
  /** The engine with the file bound the plugin gives it. */
  const engine = (): ChildProcess => start({ AP_MAX_FILE_SIZE_MB: '25' });

  it('writes a file into the folder, and answers its name, which a later FILE value takes', async () => {
    const dir = madeFolder();

    const answer = await ask(engine(), run('write', { name: 'report.txt', text: 'hello' }, dir));

    expect(answer).toMatchObject({ type: 'ran', result: { written: 'report.txt' } });
    expect(readFileSync(join(dir, 'report.txt'), 'utf8')).toBe('hello');
    expect(await ask(engine(), run('read', { file: 'report.txt' }, dir))).toMatchObject({ result: { text: 'hello' } });
  });

  it('numbers a name another call already wrote, before the extension', async () => {
    const dir = madeFolder();

    const first = await ask(engine(), run('write', { name: 'report.txt', text: 'one' }, dir));
    const second = await ask(engine(), run('write', { name: 'report.txt', text: 'two' }, dir));

    expect(first).toMatchObject({ result: { written: 'report.txt' } });
    expect(second).toMatchObject({ result: { written: 'report-1.txt' } });
    expect(readFileSync(join(dir, 'report.txt'), 'utf8')).toBe('one');
    expect(readFileSync(join(dir, 'report-1.txt'), 'utf8')).toBe('two');
  });

  it('keeps only the name a piece asked for, without the path in it', async () => {
    const dir = madeFolder();

    const answer = await ask(engine(), run('write', { name: '../../evil.txt', text: 'hello' }, dir));

    expect(answer).toMatchObject({ result: { written: 'evil.txt' } });
    expect(readFileSync(join(dir, 'evil.txt'), 'utf8')).toBe('hello');
  });

  it('replaces a character a file name may not hold', async () => {
    const dir = madeFolder();

    const answer = await ask(engine(), run('write', { name: 'a b:c?.txt', text: 'x' }, dir));

    expect(answer).toMatchObject({ result: { written: 'a-b-c-.txt' } });
  });

  it('cuts a long name to 80 characters, and keeps its extension', async () => {
    const dir = madeFolder();
    const held = `${'x'.repeat(76)}.txt`;

    const answer = await ask(engine(), run('write', { name: `${'x'.repeat(100)}.txt`, text: 'x' }, dir));

    expect(answer).toMatchObject({ result: { written: held } });
    expect(readFileSync(join(dir, held), 'utf8')).toBe('x');
  });

  it('writes a Readable as the framework takes one, and uploads as it declares', async () => {
    const dir = madeFolder();

    expect(await ask(engine(), run('stream', { name: 'streamed.txt', text: 'ab', times: 3 }, dir))).toMatchObject({ result: { written: 'streamed.txt' } });
    expect(readFileSync(join(dir, 'streamed.txt'), 'utf8')).toBe('ababab');
    expect(await ask(engine(), run('upload', { name: 'up.txt', text: 'up' }, dir))).toMatchObject({ result: { id: 'up.txt', url: 'up.txt' } });
  });

  it('refuses data that is neither a Buffer nor a Readable, and a file past the bound, in the engine\'s words', async () => {
    const dir = madeFolder();

    expect(failed(await ask(engine(), run('text', {}, dir)))).toBe('Expected file data to be a Buffer or Readable stream, but received string');
    const said = failed(await ask(start({ AP_MAX_FILE_SIZE_MB: '1' }), run('stream', { name: 'big.txt', text: 'x'.repeat(1024 * 512), times: 3 }, dir)));
    expect(JSON.parse(said)).toEqual({ message: 'File size is larger than maximum supported size', currentFileSize: '1.5 MB', maximumSupportSize: '1 MB' });
  });

  it('refuses a write when the call has no folder', async () => {
    const said = failed(await ask(start(), run('write', { name: 'report.txt', text: 'hello' })));

    expect(said).toBe('this plugin does not offer files');
  });
});

describe('a connection checked by the piece', () => {
  /** One `validate` of the fixture piece's auth. */
  const validating = (auth: Record<string, unknown>): Record<string, unknown> => ({ type: 'validate', piece: fixture('piece-run.mjs'), auth });

  it('answers the piece\'s own verdict on its auth\'s value, as the engine\'s validateAuth asks for it', async () => {
    expect(await ask(start(), validating({ type: 'SECRET_TEXT', secret_text: 'sk-test' }))).toEqual({ type: 'validated', id: 1, valid: true });
    expect(await ask(start(), validating({ type: 'SECRET_TEXT', secret_text: 're_wrong' }))).toEqual({ type: 'validated', id: 1, valid: false, error: 'Invalid Api Key' });
    expect(await ask(start(), validating({ type: 'BASIC_AUTH', username: 'a', password: 'b' }))).toEqual({ type: 'validated', id: 1, valid: false, error: 'No piece auth found for auth value' });
  });
});

describe('a connector\'s store', () => {
  /** One call of the fixture piece whose connector's store is kept in `stores`. */
  const stored = (action: string, input: Record<string, unknown>, stores: string): Record<string, unknown> => ({ ...run(action, input), stores });

  it('keeps the flow and the project scopes apart, on disk, past the engine', async () => {
    const stores = madeFolder();

    expect(await ask(start(), stored('remember', { text: 'kept' }, stores))).toMatchObject({ result: { before: null } });
    expect(await ask(start(), stored('project', { text: 'shared' }, stores))).toMatchObject({ result: { flow: 'kept', project: 'shared' } });
    // Another engine, which reads the connector's file.
    expect(await ask(start(), stored('recall', {}, stores))).toMatchObject({ result: { text: 'kept' } });
    expect(JSON.parse(readFileSync(join(stores, 'work.json'), 'utf8'))).toEqual({ 'flow_work/text': 'kept', text: 'shared' });
  });

  it('refuses a key past 128 characters and a value past 512 KB, in the engine\'s words', async () => {
    const stores = madeFolder();
    const key = 'k'.repeat(129);

    expect(JSON.parse(failed(await ask(start(), stored('keep', { key, size: 1 }, stores))))).toEqual({
      message: `Failed to read/write key "${key}", the key is empty or longer than 128 characters`,
    });
    expect(JSON.parse(failed(await ask(start(), stored('keep', { key: 'big', size: 512 * 1024 }, stores))))).toEqual({
      message: 'Failed to read/write key "flow_work/big", the value you are trying to read/write is larger than 512 KB',
    });
    expect(await ask(start(), stored('keep', { key: 'small', size: 10 }, stores))).toMatchObject({ result: { kept: 10 } });
  });
});
