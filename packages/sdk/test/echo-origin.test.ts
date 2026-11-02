/*
 * Which actions carry a client's origin.
 *
 * A client applies its own action before it sends it and holds it pending
 * until the host says it back. The echo is the envelope whose `origin` names
 * that client and the `clientSeq` it sent; every other action is the host's
 * own and carries none, because a client that saw its origin on an action it
 * never sent would take that action for its own.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/actions.md
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { fileResources } from '../src/resources/resources.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { HostOptions } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';
import type { Session } from '../src/types/session.js';

const SESSION = 'ahp-session:/one';
const CHAT = 'ahp-chat:/one';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ahpd-echo-origin-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** An envelope as a client reads it. */
interface Heard {
  channel: string;
  action: Bag;
  origin?: { clientId: string; clientSeq: number };
}

/** A client keeping every action envelope it was sent. */
const listening = (): Peer & { heard: Heard[] } => {
  const heard: Heard[] = [];
  return {
    heard,
    send: () => {},
    notify: (method, params) => { if (method === 'action') heard.push(params as Heard); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

const until = async (ready: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 400; i++) {
    if (ready()) return;
    await settle(1);
  }
  throw new Error(`${what} never happened`);
};

/**
 * The echo backend, with its `begin` and `cancel` answered a tick late.
 *
 * What a backend that waits on something before it says a turn began does,
 * and one whose stop is said once the work it stopped has let go: Claude
 * switching models, cofold resuming, pi and ACP ending a cancelled prompt.
 */
const waiting = (agent: Agent): Agent => ({
  ...agent,
  create: (start: Start): Session => {
    const session = agent.create(start) as Session;
    return {
      ...session,
      begin: (...args: Parameters<Session['begin']>) => { void Promise.resolve().then(() => { session.begin(...args); }); },
      cancel: (turnId: string) => { void Promise.resolve().then(() => { session.cancel(turnId); }); },
    };
  },
});

/** A host serving `agent`, with one client watching the root, the session and its chat. */
const serving = async (agent: Agent, more: Partial<HostOptions> = {}, config?: Bag) => {
  const host = createHost({ path: dir, agents: [agent], resources: fileResources(), ...more });
  const p = listening();
  const client = host.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
  await client.handle({ method: 'createSession', params: { channel: SESSION, provider: 'echo', ...(config === undefined ? {} : { config }) } });
  await client.handle({ method: 'subscribe', params: { channel: SESSION } });
  await client.handle({ method: 'subscribe', params: { channel: CHAT } });
  const dispatch = (clientSeq: number, action: Bag) =>
    client.handle({ method: 'dispatchAction', params: { channel: CHAT, clientSeq, action } });
  return { host, p, client, dispatch };
};

/** The echo backend, with every turn begun only once `release` is called. */
const gated = (agent: Agent) => {
  const held: (() => void)[] = [];
  return {
    agent: {
      ...agent,
      create: (start: Start): Session => {
        const session = agent.create(start) as Session;
        return { ...session, begin: (...args: Parameters<Session['begin']>) => { held.push(() => { session.begin(...args); }); } };
      },
    },
    release: () => { for (const begin of held.splice(0)) begin(); },
  };
};

it('gives the echo the origin of the dispatch, and the actions it causes none', async () => {
  const { host, p, dispatch } = await serving(echo({ path: dir, pace: 0 }));
  p.heard.length = 0;
  await dispatch(5, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'one two' } });
  await until(() => p.heard.some((one) => one.action.type === 'chat/turnComplete'), 'the turn');

  // The turn renames the session, says what it is doing and answers, all
  // inside the dispatch: none of that is the client's own action.
  const types = p.heard.map((one) => one.action.type);
  expect(types).toEqual(expect.arrayContaining(['session/titleChanged', 'chat/turnStarted', 'chat/responsePart', 'chat/turnComplete']));
  const carrying = p.heard.filter((one) => one.origin !== undefined);
  expect(carrying.map((one) => [one.channel, one.action.type, one.action.turnId])).toEqual([[CHAT, 'chat/turnStarted', 't1']]);
  expect(carrying[0]?.origin).toEqual({ clientId: 'window', clientSeq: 5 });
  await host.close();
});

it('gives a turn its origin when the backend says it began after an await', async () => {
  const { host, p, dispatch } = await serving(waiting(echo({ path: dir, pace: 0 })));
  p.heard.length = 0;
  await dispatch(7, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'one two' } });
  await until(() => p.heard.some((one) => one.action.type === 'chat/turnComplete'), 'the turn');

  const started = p.heard.find((one) => one.action.type === 'chat/turnStarted');
  expect(started?.origin).toEqual({ clientId: 'window', clientSeq: 7 });
  // And nothing else of the turn takes it.
  expect(p.heard.filter((one) => one.origin !== undefined)).toHaveLength(1);
  await host.close();
});

it('gives each chat its own turn\'s origin when two chats start a turn of the same id', async () => {
  // Both turns are owed before either backend says one began, and a client
  // names its own turns, so the two share an id and only the chat tells them
  // apart.
  const { agent, release } = gated(echo({ path: dir, pace: 0 }));
  const { host, p, client, dispatch } = await serving(agent);
  const other = 'ahp-session:/two';
  await client.handle({ method: 'createSession', params: { channel: other, provider: 'echo' } });
  const otherChat = (await client.handle({ method: 'subscribe', params: { channel: other } }) as {
    snapshot: { state: { defaultChat: string } };
  }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: otherChat } });
  p.heard.length = 0;

  await dispatch(3, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'one' } });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: otherChat, clientSeq: 4, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'two' } } },
  });
  release();
  await until(() => p.heard.filter((one) => one.action.type === 'chat/turnComplete').length === 2, 'both turns');

  const started = p.heard.filter((one) => one.action.type === 'chat/turnStarted');
  expect(started.map((one) => [one.channel, one.origin?.clientSeq]).sort()).toEqual([[CHAT, 3], [otherChat, 4]].sort());
  await host.close();
});

it('gives a turn its origin when the machine it runs in is set to the host first', async () => {
  // The machine is put where the host's branch is before every turn in it,
  // which the turn waits for: the port is asked, and the turn begins after.
  const followed: string[] = [];
  const computers = { how: async () => undefined, follow: async (id: string) => { followed.push(id); } };
  const { host, p, dispatch } = await serving(echo({ path: dir, pace: 0 }), { computers } as Partial<HostOptions>, { computer: 'computer://box' });
  p.heard.length = 0;
  await dispatch(8, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'one two' } });
  await until(() => p.heard.some((one) => one.action.type === 'chat/turnComplete'), 'the turn');

  expect(followed).toEqual(['box']);
  const started = p.heard.find((one) => one.action.type === 'chat/turnStarted');
  expect(started?.origin).toEqual({ clientId: 'window', clientSeq: 8 });
  await host.close();
});

it('gives a stop its origin when the backend says it once the turn has let go', async () => {
  const { host, p, dispatch } = await serving(waiting(echo({ path: dir, pace: 50 })));
  await dispatch(1, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'one two three four five six seven eight' } });
  await until(() => p.heard.some((one) => one.action.type === 'chat/delta'), 'the first word');
  p.heard.length = 0;

  await dispatch(9, { type: 'chat/turnCancelled', turnId: 't1' });
  await until(() => p.heard.some((one) => one.action.type === 'chat/turnCancelled'), 'the stop');

  const stopped = p.heard.find((one) => one.action.type === 'chat/turnCancelled');
  expect(stopped?.origin).toEqual({ clientId: 'window', clientSeq: 9 });
  await host.close();
});

it('gives a stop that names no turn its origin, under the turn it stopped', async () => {
  const { host, p, dispatch } = await serving(waiting(echo({ path: dir, pace: 50 })));
  await dispatch(1, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'one two three four five six seven eight' } });
  await until(() => p.heard.some((one) => one.action.type === 'chat/delta'), 'the first word');
  p.heard.length = 0;

  await dispatch(4, { type: 'chat/turnCancelled', turnId: '' });
  await until(() => p.heard.some((one) => one.action.type === 'chat/turnCancelled'), 'the stop');

  const stopped = p.heard.find((one) => one.action.type === 'chat/turnCancelled');
  expect(stopped?.action.turnId).toBe('t1');
  expect(stopped?.origin).toEqual({ clientId: 'window', clientSeq: 4 });
  await host.close();
});

it('gives a resume its origin when the backend says it reopened the turn', async () => {
  /*
   * A backend that reopens the turn and says so while the dispatch is being
   * applied, as pi does. The chat's latest turn is one a model call failed,
   * which is the only kind the protocol lets a client resume - the host
   * checks that before it asks the backend anything.
   */
  const resuming = (agent: Agent): Agent => ({
    ...agent,
    create: (start: Start): Session => {
      const session = agent.create(start) as Session;
      return {
        ...session,
        chatState: () => ({
          ...session.chatState(),
          turns: [{
            id: 't1',
            startedAt: new Date().toISOString(),
            message: { text: 'one', origin: { kind: 'user' } },
            responseParts: [{
              kind: 'error',
              error: { errorType: 'turnFailed', message: 'the model call failed' },
              resumable: true,
            }],
            state: 'error',
            duration: 5,
          }],
        }) as ReturnType<Session['chatState']>,
        resume: (turnId: string) => {
          start.emit('chat', { type: 'chat/turnResume', turnId });
          return true;
        },
      };
    },
  });
  const { host, p, dispatch } = await serving(resuming(echo({ path: dir, pace: 0 })));
  p.heard.length = 0;
  await dispatch(9, { type: 'chat/turnResume', turnId: 't1' });
  await settle();
  const resumed = p.heard.filter((one) => one.action.type === 'chat/turnResume');
  expect(resumed.map((one) => one.origin)).toEqual([{ clientId: 'window', clientSeq: 9 }]);
  await host.close();
});
