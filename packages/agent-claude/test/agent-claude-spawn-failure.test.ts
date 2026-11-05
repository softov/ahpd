import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bag } from '@ahpd/sdk';
import { expect, it } from 'vitest';
import { spawnInside } from '../src/spawn.js';
import { createSession } from '../src/session.js';
import type { Asked, Spawned } from '../src/spawn.js';

/*
 * A CLI that never started fails its turn in the SDK's own words, as VS Code's
 * host ends a send that failed with the error's own message.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2565
 *
 * This runs the real SDK, because the words being read are the SDK's own and a
 * mock of it would only pin what the mock was told to say.
 */

/** A command no host has, so the spawn fails the way a missing CLI does. */
const MISSING = '/definitely/not/here/claude';

/**
 * What the SDK says of a CLI whose process could not be found, naming the
 * executable it was configured with, which is `claude` behind a spawn hook.
 */
const NOT_FOUND = 'Claude Code native binary not found at claude';

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

it('fails a turn whose hook command is not there in the SDK own words', async () => {
  const said = await failureUnder((asked) => spawnInside(asked, async () => ({ command: MISSING, args: [] }), 'computer://box'));
  expect(said).toContain(NOT_FOUND);
});

it('fails a turn whose hook rejected with an errno in the SDK own words', async () => {
  const said = await failureUnder((asked) => spawnInside(asked, async () => {
    throw Object.assign(new Error('connect ENOENT /var/run/docker.sock'), { code: 'ENOENT', syscall: 'connect' });
  }, 'computer://box'));
  expect(said).toContain(NOT_FOUND);
});

it('names a machine that is not there', async () => {
  const said = await failureUnder((asked) => spawnInside(asked, async () => undefined, 'computer://gone'));
  expect(said).toContain('There is no computer called computer://gone');
});
