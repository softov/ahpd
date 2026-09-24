import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { spawnInside } from '../packages/agent-claude/src/spawn.js';
import type { Asked } from '../packages/agent-claude/src/spawn.js';

/*
 * The bridge between a synchronous spawn hook and an asynchronous port.
 *
 * The Claude SDK asks for a process and must be handed one in the same tick,
 * while asking a machine how to reach it is a `docker inspect`. What stands in
 * between has to hold the SDK's first writes rather than drop them, deliver a
 * failure as the `error` event the SDK already handles, and apply a kill that
 * arrived before the child did - because each of those, missed, is a session
 * that hangs with nothing on screen saying why.
 */

const asked: Asked = { command: 'claude', args: ['--print'], env: { CLAUDE_CONFIG_DIR: '/ahpd/claude' } };

/** What the port answered, and what the spawn actually ran. */
const ran = (command: string, args: string[]) =>
  async (): Promise<{ command: string; args: string[] }> => ({ command, args });

it('holds what is written before the machine has answered', async () => {
  let release: (() => void) | undefined;
  const waited = new Promise<void>((resolve) => { release = resolve; });
  const held = spawnInside(asked, async (given) => {
    await waited;
    // The port is handed what the SDK asked for, unchanged.
    expect(given.command).toBe('claude');
    // `cat` stands in for the CLI: whatever reaches its stdin comes back on
    // stdout, so a write that was dropped is a byte that never returns.
    return { command: 'cat', args: [] };
  }, 'computer://box');

  // Written while the port is still thinking, which is the case that matters.
  held.stdin.write('{"first":"frame"}\n');
  release?.();

  const back = await new Promise<string>((resolve) => {
    let seen = '';
    held.stdout.on('data', (chunk: Buffer) => {
      seen += chunk.toString();
      if (seen.includes('\n')) resolve(seen);
    });
  });
  expect(back).toContain('{"first":"frame"}');
  held.kill('SIGTERM');
});

it('delivers a machine that is not there as an error, not a hang', async () => {
  const held = spawnInside(asked, async () => undefined, 'computer://gone');
  const error = await new Promise<Error>((resolve) => { held.on('error', resolve); });
  expect(error.message).toBe('There is no computer called computer://gone');
});

it('delivers a port that rejected as an error', async () => {
  const held = spawnInside(asked, async () => { throw new Error('docker is not running'); }, 'computer://box');
  const error = await new Promise<Error>((resolve) => { held.on('error', resolve); });
  expect(error.message).toBe('docker is not running');
});

it('applies a kill that arrived before the child did', async () => {
  let release: (() => void) | undefined;
  const waited = new Promise<void>((resolve) => { release = resolve; });
  const held = spawnInside(asked, async () => {
    await waited;
    return { command: 'sleep', args: ['30'] };
  }, 'computer://box');

  // Abandoned during the inspect: without this the container keeps running a
  // turn nobody is listening to.
  held.kill('SIGTERM');
  release?.();

  const signal = await new Promise<NodeJS.Signals | null>((resolve) => {
    held.on('exit', (_code, given) => resolve(given));
  });
  expect(signal).toBe('SIGTERM');
});

it('survives a child that has already gone', async () => {
  // `true` exits at once, so the SDK's write loses the race and raises EPIPE
  // on a stream nobody owns. Unhandled, that reaches the process and takes the
  // daemon down; the exit is what says what happened.
  const held = spawnInside(asked, ran('true', []), 'computer://box');
  const code = await new Promise<number | null>((resolve) => {
    held.on('exit', (given) => resolve(given));
  });
  held.stdin.write('a write nobody will read\n');
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(code).toBe(0);
});

it('runs what the port answered, and nothing of its own', async () => {
  // The port owns the whole command; this only spawns it. A backend that
  // appended arguments of its own would run them outside the descriptor the
  // host built, which is the seam a second runtime depends on.
  const held = spawnInside(asked, ran('sh', ['-c', 'printf ran-the-descriptor']), 'computer://box');
  const back = await new Promise<string>((resolve) => {
    let seen = '';
    held.stdout.on('data', (chunk: Buffer) => { seen += chunk.toString(); });
    held.on('exit', () => resolve(seen));
  });
  expect(back).toBe('ran-the-descriptor');
});

/*
 * A session whose CLI never started says so, rather than thinking for ever.
 *
 * The query is built once, when the session is created, so a CLI that dies
 * before anybody types anything leaves a session with nothing left to answer
 * a turn. Sending one then set `active` on a dead session, which every client
 * draws as in progress - the bug this pins is a machine without the CLI in it
 * reading as an agent that is still thinking, with no reason anywhere.
 */
it('fails a turn on a session whose CLI is gone, instead of thinking for ever', async () => {
  const { claude } = await import('../packages/agent-claude/src/claude.js');
  const agent = claude({ paths: [mkdtempSync(join(tmpdir(), 'ahpd-gone-'))] });

  const seen: { type: string; message?: string }[] = [];
  const session = agent.create({
    uri: 'ahp-session:/gone',
    chatUri: 'ahp-chat:/gone',
    workingDirectory: '/',
    settings: { computer: 'computer://box' },
    // A machine whose command exits at once, which is what `docker exec` does
    // for an image with no `claude` in it.
    computers: { how: async () => ({ command: 'false', args: [] }) },
    emit: (_channel: string, what: Record<string, unknown>) => {
      const type = String(what.type ?? '');
      const part = what.part as { error?: { message?: string } } | undefined;
      seen.push({ type, ...(part?.error?.message === undefined ? {} : { message: part.error.message }) });
    },
  } as never);

  // The CLI has to have exited before the turn, which is the case that broke:
  // a person picks a machine, reads the screen, then types.
  await new Promise((resolve) => setTimeout(resolve, 600));
  session.begin('t1', 'anything');
  await new Promise((resolve) => setTimeout(resolve, 100));

  const failure = seen.find((one) => one.type === 'chat/error');
  expect(failure, `emitted: ${seen.map((one) => one.type).join(', ')}`).toBeDefined();
  expect(failure?.message).toMatch(/exited with code/);
  // Started as well as failed, so a client clears the message it just sent.
  expect(seen.some((one) => one.type === 'chat/turnStarted')).toBe(true);
  // 2 is Error, 8 is InProgress: the whole point is that it is not 8.
  expect(session.status()).toBe(2);
  session.close();
});
