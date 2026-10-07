import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Bag, Session, Start } from '@ahpd/sdk';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/clientcalls.js';
import { acpAgent, connectAcp, watchSession } from '../src/index.js';

/*
 * A server that never starts, and one that exits mid-prompt.
 *
 * The command in the first case is a program that does not exist, which is
 * what a configuration naming an ACP server nobody installed looks like. Each
 * case also listens on the test process itself: an `error` event nobody heard
 * or a rejection nobody caught ends a daemon and every session on it, so
 * neither is allowed to reach it.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** A program name no machine has on its PATH. */
const MISSING = 'ahpd-no-such-acp-server';

/** What reached the process unheard while a case ran. */
const escaped: unknown[] = [];
const heard = (why: unknown): void => { escaped.push(why); };

const started: Session[] = [];

beforeEach(() => {
  escaped.length = 0;
  process.on('uncaughtException', heard);
  process.on('unhandledRejection', heard);
});

afterEach(() => {
  for (const session of started.splice(0)) session.close();
  process.off('uncaughtException', heard);
  process.off('unhandledRejection', heard);
});

/** The subprocess's work finishing, up to a point. */
const until = async (check: () => boolean, times = 3000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
};

/** A session of `command`, with every action it emits kept. */
function start(command: string, args: string[] = []): { session: Session; actions: Bag[] } {
  const actions: Bag[] = [];
  const agent = acpAgent({ command, args, provider: 'acp-failure' });
  const opening: Start = {
    uri: 'ahp-session:/failure',
    chatUri: 'ahp-chat:/failure',
    settings: {},
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel, action) => { actions.push(action); },
    // The host always resolves this, and its own answer when the deployment
    // said nothing is ten minutes.
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
    // What this case is about is the command, and an absent trust answer is
    // untrusted - decision `a-folder-is-untrusted-until-a-client-says-
    // otherwise` - so the folder is one the host vouched for.
    trusted: () => true,
  };
  const session = agent.create(opening);
  started.push(session);
  return { session, actions };
}

/** The message on the `chat/error` that ended a turn, once one has. */
const failure = (actions: Bag[]): string | undefined => {
  const error = actions.find((action) => action.type === 'chat/error') as
    { part?: { error?: { message?: string } } } | undefined;
  return error?.part?.error?.message;
};

it('fails the first turn of a session whose command is missing, and nothing escapes', async () => {
  const { session, actions } = start(MISSING);
  session.begin('t1', 'hi');
  await until(() => failure(actions) !== undefined);

  expect(failure(actions)).toContain(MISSING);
  expect(failure(actions)).toContain('not found');
  // A second turn fails the same way rather than waiting on the first attempt.
  session.begin('t2', 'hi again');
  await until(() => actions.filter((action) => action.type === 'chat/error').length > 1);
  expect(actions.filter((action) => action.type === 'chat/error')).toHaveLength(2);
  expect(escaped).toEqual([]);
});

it('rejects the handshake with a sentence naming a missing command', async () => {
  const connection = connectAcp({ command: MISSING, handlers: { update: () => {} } });
  await expect(connection.initialize()).rejects.toThrow(`${MISSING} was not found`);
  connection.close();
  await until(() => false, 20);
  expect(escaped).toEqual([]);
});

it('answers a listing with the watched sessions when the command is missing', async () => {
  watchSession({ provider: 'acp-missing-list', id: 'kept', cwd: '/tmp', additional: [], title: 'Kept' });
  const agent = acpAgent({ command: MISSING, provider: 'acp-missing-list' });
  const listed = await agent.list?.() ?? [];
  expect(listed.map((row) => row.id)).toEqual(['kept']);
  await until(() => false, 20);
  expect(escaped).toEqual([]);
});

it('fails the turn with the exit code when the server exits mid-prompt', async () => {
  const { session, actions } = start(process.execPath, [FIXTURE]);
  session.begin('t1', 'die now');
  await until(() => failure(actions) !== undefined);

  expect(failure(actions)).toContain('exited with code 3');
  expect(escaped).toEqual([]);
});

it('fails the turn with what the server wrote on stderr before it died', async () => {
  const { session, actions } = start(process.execPath, [FIXTURE]);
  session.begin('t1', 'be noisy');
  await until(() => failure(actions) !== undefined);

  expect(failure(actions)).toContain('exited with code 4');
  expect(failure(actions)).toContain('the model backend refused the request');
  expect(failure(actions)).toContain('at Backend.send (backend.js:41)');
  expect(escaped).toEqual([]);
});

it('never surfaces the stderr of a server that answered', async () => {
  const { session, actions } = start(process.execPath, [FIXTURE]);
  session.begin('t1', 'chatter a little');
  await until(() => actions.some((action) => action.type === 'chat/turnComplete'));

  // The line went to the connection and stayed there: a client hears about a
  // server's own output when it failed, never while it is working.
  expect(actions.some((action) => action.type === 'chat/error')).toBe(false);
  expect(JSON.stringify(actions)).not.toContain('a line the server said to nobody');
  expect(escaped).toEqual([]);
});

it('keeps the last 8 KB of stderr, cut at a line boundary', async () => {
  const lines = Array.from({ length: 2000 }, (_one, at) => `line ${String(at)}`);
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', `process.stderr.write(${JSON.stringify(lines.join('\n'))}, () => { process.exit(5); });`],
    handlers: { update: () => {} },
  });
  await expect(connection.initialize()).rejects.toThrow('exited with code 5');
  const tail = await connection.stderrTail();

  expect(tail.length).toBeLessThanOrEqual(8 * 1024);
  // The oldest line went, and what is left begins at a whole one rather than at
  // the middle of it.
  expect(tail).not.toContain('line 0\n');
  expect(tail.split('\n')[0]).toMatch(/^line \d+$/);
  expect(tail.endsWith('line 1999')).toBe(true);
  connection.close();
});

it('settles a close once the server process has gone, and never rejects', async () => {
  const connection = connectAcp({
    command: process.execPath,
    args: ['-e', "process.stdin.resume(); process.on('SIGTERM', () => { setTimeout(() => process.exit(0), 100); });"],
    handlers: { update: () => {} },
  });
  let gone = false;
  void connection.ended.then(() => { gone = true; });
  await new Promise((resolve) => { setTimeout(resolve, 200); });
  await connection.close();
  expect(gone).toBe(true);
  // A second close of a server already gone settles at once.
  await connection.close();
  expect(escaped).toEqual([]);
});
