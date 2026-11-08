import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bag } from '@ahpd/sdk';
import { expect, it } from 'vitest';
import type { Start } from '@ahpd/sdk';
import { claude } from '../src/claude.js';
import { spawnInside } from '../src/spawn.js';
import { createSession } from '../src/session.js';
import type { Asked, SpawnedProcess } from '../src/spawn.js';

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
 * The session starts its CLI at its first send, so the turn is what meets the
 * spawn's failure, and it says it in the SDK's own words.
 */
const failureUnder = async (spawn: (asked: Asked) => SpawnedProcess): Promise<string> => {
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

/*
 * A record whose `portFailures` is `message` passes a port's failure on as it
 * is, so the turn fails in its own message, as VS Code's host shows a failed
 * send's own message.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2564-L2573
 */
it('fails a turn in the port\'s own words where the record\'s portFailures is message', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-spawn-'));
  const said: string[] = [];
  const session = await claude({ paths: [dir], preset: { portFailures: 'message' } }).create({
    uri: 'ahp-session:/port',
    chatUri: 'ahp-chat:/port',
    workingDirectory: dir,
    settings: { computer: 'computer://box' },
    computers: {
      how: async () => { throw Object.assign(new Error('connect ENOENT /var/run/docker.sock'), { code: 'ENOENT', syscall: 'connect' }); },
    } as never,
    clientToolTimeoutMs: 0,
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel, what) => {
      const error = bag(bag(what.part).error);
      if (String(what.type) === 'chat/error' && typeof error.message === 'string') said.push(error.message);
    },
  } as Start);
  session.sendMessage('t1', 'hello');
  await until(() => said.length > 0);
  session.close();
  expect(said[0]).toContain('connect ENOENT /var/run/docker.sock');
});

it('names a machine that is not there', async () => {
  const said = await failureUnder((asked) => spawnInside(asked, async () => undefined, 'computer://gone'));
  expect(said).toContain('There is no computer called computer://gone');
});
