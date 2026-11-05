import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply } from '../src/plugin.js';
import type { Adapter, Connector, PluginHost } from '@ahpd/sdk';

/*
 * One action, run through the adapter the plugin registered.
 *
 * `apply` forks the real engine, so a case talks to a real piece in a real
 * process. The host is a stub: it keeps what the plugin registers, and the
 * close it registers is how a case stops the engine.
 */

/** The fixture piece, as the engine imports it: by its URL. */
const PIECE = pathToFileURL(fileURLToPath(new URL('./fixtures/piece-run.mjs', import.meta.url))).href;

/** What one host kept, for the cases of one plugin. */
interface Kept {
  adapters: Map<string, Adapter>;
  problems: string[];
  logged: string[];
  closes: (() => void | Promise<void>)[];
}

/** Start the plugin on the fixture piece, with these options beside it, and answer what its host kept. */
async function start(options: Record<string, unknown> = {}): Promise<Kept> {
  const kept: Kept = { adapters: new Map(), problems: [], logged: [], closes: [] };
  const host = {
    registerAdapter: (adapter: Adapter) => { kept.adapters.set(adapter.name, adapter); },
    registerClose: (close: () => void | Promise<void>) => { kept.closes.push(close); },
    problem: (line: string) => { kept.problems.push(line); },
    log: (line: string) => { kept.logged.push(line); },
  } as unknown as PluginHost;
  await apply(host, { pieces: [PIECE], ...options });
  return kept;
}

/** One connector of the fixture piece, with the secret the calls run with. */
const connector = (id: string, secret = 'sk-test'): Connector => ({
  id,
  adapter: 'ap-run',
  owner: 'host',
  config: { secret_text: secret },
});

/** The adapter's `run`, which every case needs. */
function running(kept: Kept): NonNullable<Adapter['run']> {
  const adapter = kept.adapters.get('ap-run');
  if (adapter?.run === undefined) throw new Error('the plugin registered no runnable adapter');
  return adapter.run;
}

let kept: Kept[] = [];
afterEach(async () => {
  for (const one of kept) {
    for (const close of one.closes) await close();
  }
  kept = [];
});

/** One plugin on the fixture piece, kept for the case to stop. */
async function started(options: Record<string, unknown> = {}): Promise<Kept> {
  const one = await start(options);
  kept.push(one);
  return one;
}

describe('an action runs in the engine', () => {
  it('gives the action the auth and the input, and answers its result', async () => {
    const one = await started();

    expect(one.problems).toEqual([]);
    expect(await running(one)(connector('work'), 'echo', { text: 'hello' })).toEqual({
      text: 'hello',
      auth: { type: 'SECRET_TEXT', secret_text: 'sk-test' },
    });
  });

  it('gives the engine none of the daemon\'s secrets', async () => {
    const before = process.env['AHPD_TOKEN'];
    process.env['AHPD_TOKEN'] = 'daemon-token';
    try {
      const one = await started();
      expect(await running(one)(connector('work'), 'env', {})).toMatchObject({ token: null });
    } finally {
      if (before === undefined) delete process.env['AHPD_TOKEN'];
      else process.env['AHPD_TOKEN'] = before;
    }
  });

  it('answers the message of an action that throws, and nothing else', async () => {
    const one = await started();
    const failed = await running(one)(connector('work'), 'fail', {}).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toBe('the action failed');
    expect((failed as Error).message).not.toContain('sk-test');
  });

  it('says what the action hands output.update as the running call\'s partial content, each update in place of the last', async () => {
    const one = await started();
    const said: unknown[] = [];
    const answer = await running(one)(connector('work'), 'progress', {}, { setContent: (content) => { said.push(content); } });

    expect(answer).toEqual({ done: true });
    expect(said).toEqual([
      [{ type: 'text', text: '{"step":1}' }],
      [{ type: 'text', text: '{"step":2}' }],
    ]);
  });

  it('fails a call that runs past Activepieces\' 600 seconds in its words, and answers the next one', async () => {
    const one = await started();
    const run = running(one);

    vi.useFakeTimers();
    try {
      // The handler is attached first, so the failure after the clock moves is not unhandled.
      const slow = expect(run(connector('work'), 'slow', {})).rejects.toThrow(
        'Slow timed out before it finished. It may have partially completed, so do not re-run it blindly; check the app for a write from this attempt first, or ask the user.',
      );
      await vi.advanceTimersByTimeAsync(599_999);
      await vi.advanceTimersByTimeAsync(1);
      await slow;
    } finally {
      vi.useRealTimers();
    }

    expect(await run(connector('work'), 'echo', { text: 'after' })).toMatchObject({ text: 'after' });
  });

  it('starts an engine that exited five times more, and then refuses every call in words', async () => {
    const one = await started();
    const run = running(one);

    for (let at = 0; at < 6; at += 1) {
      await expect(run(connector('work'), 'crash', {})).rejects.toThrow('the engine process exited (3)');
    }
    await expect(run(connector('work'), 'echo', { text: 'after' })).rejects.toThrow('The engine process stopped after 5 restarts.');
    expect(one.logged).toEqual([
      ...Array.from({ length: 5 }, () => 'activepieces: the engine process terminated unexpectedly with code 3'),
      'activepieces: the engine process terminated with code 3, giving up after 5 restarts',
    ]);
  });

  it('gives the engine a home of its own, and the variables the option names', async () => {
    const before = process.env['AHPD_TOKEN'];
    process.env['AHPD_TOKEN'] = 'daemon-token';
    try {
      const plain = await started();
      /*
       * No path on POSIX. On Windows libuv puts `PATH` back into a child's
       * environment from the parent's, as one of the variables it requires.
       * https://github.com/libuv/libuv/blob/v1.x/src/win/process.c#L50-L62
       */
      expect(await running(plain)(connector('work'), 'env', {})).toEqual({
        token: null,
        home: tmpdir(),
        path: process.platform === 'win32' ? process.env['PATH'] ?? process.env['Path'] ?? null : null,
      });
      const listed = await started({ sandboxPropagatedEnvVars: ['AHPD_TOKEN'] });
      expect(await running(listed)(connector('work'), 'env', {})).toMatchObject({ token: 'daemon-token' });
    } finally {
      if (before === undefined) delete process.env['AHPD_TOKEN'];
      else process.env['AHPD_TOKEN'] = before;
    }
  });

  it('starts the engine again after it stops', async () => {
    const one = await started();
    const run = running(one);

    expect(await run(connector('work'), 'echo', { text: 'one' })).toMatchObject({ text: 'one' });
    for (const close of one.closes) await close();

    expect(await run(connector('work'), 'echo', { text: 'two' })).toMatchObject({ text: 'two' });
  });

  it('keeps a store value for one connector, and for no other', async () => {
    const one = await started();
    const run = running(one);

    expect(await run(connector('work'), 'remember', { text: 'kept' })).toEqual({ before: null });
    expect(await run(connector('work'), 'recall', {})).toEqual({ text: 'kept' });
    expect(await run(connector('other'), 'recall', {})).toEqual({ text: null });
  });

  it("writes a file into the call's folder, and reads it back by its name", async () => {
    const one = await started();
    const run = running(one);
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-run-'));
    try {
      const written = await run(connector('work'), 'write', { name: 'notes.txt', text: 'hello' }, { files: dir });

      expect(written).toEqual({ written: 'notes.txt' });
      expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('hello');
      expect(await run(connector('work'), 'read', { file: 'notes.txt' }, { files: dir }))
        .toMatchObject({ filename: 'notes.txt', text: 'hello' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a file write when the call names no folder', async () => {
    const one = await started();
    const failed = await running(one)(connector('work'), 'write', { name: 'notes.txt', text: 'hello' })
      .catch((error: unknown) => error);

    expect((failed as Error).message).toBe('this plugin does not offer files');
  });
});
