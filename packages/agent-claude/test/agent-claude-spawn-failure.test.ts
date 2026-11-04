import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bag } from '@ahpd/sdk';
import { expect, it } from 'vitest';
import { spawnInside } from '../src/spawn.js';
import { createSession } from '../src/session.js';
import { failureOf } from '../src/session/failure.js';
import type { Asked, Spawned } from '../src/spawn.js';

/*
 * A CLI that never started says one sentence, and names no path.
 *
 * The SDK keeps its own words for a process that would not come up - the
 * bundled binary's path, the libc it wanted, the syscall - and those are about
 * the host rather than about the session. This runs the real SDK, because the
 * classification being read is the SDK's own and a mock of it would only pin
 * what the mock was told to say.
 */

/** A command no host has, so the spawn fails the way a missing CLI does. */
const MISSING = '/definitely/not/here/claude';

/** The one sentence a person reads for either. */
const COULD_NOT_START = 'Claude Code process could not start';

/** What the session said, and nothing while it has not said it yet. */
const until = async (check: () => boolean, times = 4000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((done) => { setTimeout(done, 1); });
  }
  throw new Error(`still waiting after ${times} tries`);
};

/**
 * One session over a spawn hook, and the message its turn failed with.
 *
 * The CLI has to have given up before the turn is asked for, which is the case
 * a person reaches by watching a session open and then typing: a turn started
 * beside a live-looking CLI would take the other road to the same message.
 */
const failureUnder = async (spawn: (asked: Asked) => Spawned): Promise<string> => {
  const said: string[] = [];
  const session = createSession({
    uri: 'ahp-session:/spawn',
    chatUri: 'ahp-chat:/spawn',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-spawn-')),
    settings: {},
    spawn,
    emit: (_channel, what) => {
      const error = bag(bag(what.part).error);
      if (String(what.type) === 'chat/error' && typeof error.message === 'string') said.push(error.message);
    },
  });
  await until(() => session.status() === 2);
  session.sendMessage('t1', 'hello');
  await until(() => said.length > 0);
  session.close();
  return said[0] ?? '';
};

it('answers a hook whose command is not there with the errno, and no path', async () => {
  const said = await failureUnder((asked) => spawnInside(asked, async () => ({ command: MISSING, args: [] }), 'computer://box'));
  expect(said).toBe(`${COULD_NOT_START} (ENOENT)`);
  expect(said).not.toContain('/');
});

it('answers a hook that rejected with the errno it carries, and no path', async () => {
  const said = await failureUnder((asked) => spawnInside(asked, async () => {
    throw Object.assign(new Error('connect ENOENT /var/run/docker.sock'), { code: 'ENOENT', syscall: 'connect' });
  }, 'computer://box'));
  expect(said).toBe(`${COULD_NOT_START} (ENOENT)`);
  expect(said).not.toContain('/');
});

it('names a machine that is not there, which holds no path', async () => {
  const said = await failureUnder((asked) => spawnInside(asked, async () => undefined, 'computer://gone'));
  expect(said).toContain('There is no computer called computer://gone');
});

it('keeps the message of an error that is not a failure to start', () => {
  // What the SDK files a CLI that ran and then failed under.
  expect(failureOf(Object.assign(new Error('Claude Code process exited with code 3'), { errorClass: 'process_error' })))
    .toBe('Claude Code process exited with code 3');
  // A value that is not an Error at all, which is what a rejected port may throw.
  expect(failureOf('docker is not running')).toBe('docker is not running');
  expect(failureOf(undefined)).toBe('undefined');
});

it('reads the classification and the errno off the error, not off its type', () => {
  expect(failureOf(Object.assign(new Error('the whole story'), { errorClass: 'spawn_failed' }))).toBe(COULD_NOT_START);
  expect(failureOf(Object.assign(new Error('the whole story'), { errorClass: 'executable_not_found', code: 'EACCES' })))
    .toBe(`${COULD_NOT_START} (EACCES)`);
});
