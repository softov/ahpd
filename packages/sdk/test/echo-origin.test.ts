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
import { chatUriFor } from '../src/host/channels.js';
import { fileResources } from '../src/resources/resources.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { HostOptions } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';
import type { Session } from '../src/types/session.js';

const SESSION = 'ahp-session:/one';
const CHAT = chatUriFor(SESSION);

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
  // The second is applied once the first is answered: the client's answers
  // go out in the order it sent its actions.
  release();
  await until(() => p.heard.some((one) => one.channel === CHAT && one.action.type === 'chat/turnStarted'), 'the first start');
  await settle();
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

/*
 * A stop is said when it is taken, so the turn ends in every client's state
 * at once, and the backend is told after. A backend that finishes the turn
 * anyway says an end of a turn that no longer runs, which is not said: a turn
 * ends once. The reference host takes a client's cancel into its state and
 * then aborts the agent.
 * https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/platform/agentHost/node/agentService.ts#L13526-L13537
 * https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/platform/agentHost/node/agentSideEffects.ts#L1921-L1955
 */
it('says a stop when it is taken, and nothing of the turn its backend ends after', async () => {
  const base = echo({ path: dir, pace: 5 });
  const finishing: Agent = {
    ...base,
    create: (start: Start): Session => ({ ...(base.create(start) as Session), cancel: () => {} }),
  };
  const { host, p, client, dispatch } = await serving(finishing);
  p.heard.length = 0;
  await dispatch(1, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'one two three four five six seven eight' } });
  await until(() => p.heard.some((one) => one.action.type === 'chat/turnStarted'), 'the start');
  await dispatch(2, { type: 'chat/turnCancelled', turnId: 't1', duration: 3 });
  const stopped = p.heard.filter((one) => one.action.type === 'chat/turnCancelled');
  expect(stopped.map((one) => [one.origin?.clientSeq, one.action.duration])).toEqual([[2, 3]]);
  const held = (await client.handle({ method: 'subscribe', params: { channel: CHAT } }) as {
    snapshot: { state: { activeTurn?: unknown; turns: { id: string; state: string }[] } };
  }).snapshot.state;
  expect(held.activeTurn).toBeUndefined();
  expect(held.turns.map((one) => [one.id, one.state])).toEqual([['t1', 'cancelled']]);

  // The backend runs its words out and completes the turn it was never told to stop.
  await new Promise((done) => { setTimeout(done, 120); });
  expect(p.heard.some((one) => one.action.type === 'chat/turnComplete')).toBe(false);
  await host.close();
});

/*
 * A dispatch the backend answered and then failed on is answered once. A
 * refusal after its echo would have the client revert a change every other
 * client holds.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/actions.md#L20
 */
it('answers a draft its backend says and then fails on once, with its echo', async () => {
  const base = echo({ path: dir, pace: 0 });
  const failing: Agent = {
    ...base,
    create: (start: Start): Session => {
      const session = base.create(start) as Session;
      return { ...session, setDraft: (next) => { session.setDraft(next); throw new Error('the draft was said and the store is gone'); } };
    },
  };
  const { host, p, dispatch } = await serving(failing);
  p.heard.length = 0;
  await dispatch(9, { type: 'chat/draftChanged', draft: { text: 'half a thought', origin: { kind: 'user' } } });
  await settle();

  const answers = p.heard.filter((one) => one.origin?.clientSeq === 9) as (Heard & { rejectionReason?: string })[];
  expect(answers.map((one) => [one.action.type, one.rejectionReason])).toEqual([['chat/draftChanged', undefined]]);
  await host.close();
});

/*
 * A chat's action travels on a chat's channel, and its client holds it
 * pending on the subscription it sent it on: one sent on a session's channel
 * is refused there, and moves no chat.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/actions.md#L54
 */
it('refuses a chat\'s action sent on a session\'s channel', async () => {
  const { host, p, client } = await serving(echo({ path: dir, pace: 0 }));
  p.heard.length = 0;
  await client.handle({
    method: 'dispatchAction',
    params: { channel: SESSION, clientSeq: 4, action: { type: 'chat/draftChanged', draft: { text: 'here?', origin: { kind: 'user' } } } },
  });
  await settle();
  const answers = p.heard.filter((one) => one.origin?.clientSeq === 4) as (Heard & { rejectionReason?: string })[];
  expect(answers.map((one) => [one.channel, one.rejectionReason])).toEqual([[SESSION, `chat/draftChanged is a chat's action, and ${SESSION} is not a chat`]]);
  expect(p.heard.some((one) => one.channel === CHAT)).toBe(false);
  await host.close();
});

/*
 * A rename sent on a chat's channel renames that chat, as the reference client
 * sends it, and is answered on that channel: the rename itself is said on the
 * session's, under no origin.
 * https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L8015-L8025
 */
it('answers a rename sent on a chat\'s channel on that channel', async () => {
  const { host, p, client } = await serving(echo({ path: dir, pace: 0 }));
  p.heard.length = 0;
  await client.handle({
    method: 'dispatchAction',
    params: { channel: CHAT, clientSeq: 5, action: { type: 'session/titleChanged', title: 'Renamed' } },
  });
  await settle();
  expect(p.heard.filter((one) => one.origin?.clientSeq === 5).map((one) => one.channel)).toEqual([CHAT]);
  const renamed = p.heard.filter((one) => one.channel === SESSION && one.action.type === 'session/titleChanged');
  expect(renamed.map((one) => [one.action.title, one.origin])).toEqual([['Renamed', undefined]]);
  await host.close();
});

/*
 * The answer a backend says is the client's own action: a denial carries the
 * reason, the words and the suggestion the client gave, whatever the backend
 * rebuilt it as. The reference host emits the client's action itself.
 * https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2745-L2752
 */
it('echoes a denial with everything the client sent, over the backend\'s own word for it', async () => {
  const base = echo({ path: dir, pace: 50 });
  const asking: Agent = {
    ...base,
    create: (start: Start): Session => {
      const session = base.create(start) as Session;
      return {
        ...session,
        begin: (...args: Parameters<Session['begin']>) => {
          session.begin(...args);
          const turnId = args[0];
          start.emit('chat', { type: 'chat/toolCallStart', turnId, toolCallId: 'call-1', toolName: 'bash', displayName: 'Bash' });
          start.emit('chat', { type: 'chat/toolCallReady', turnId, toolCallId: 'call-1', invocationMessage: 'Run ls', toolInput: 'ls' });
        },
        confirm: (toolCallId: string, approved: boolean) => {
          start.emit('chat', { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId, approved, reason: 'denied' });
          return true;
        },
      };
    },
  };
  const { host, p, client, dispatch } = await serving(asking);
  await dispatch(1, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'a turn long enough to be asked about', origin: { kind: 'user' } } });
  await until(() => p.heard.some((one) => one.action.type === 'chat/toolCallReady'), 'the question');
  const denial = {
    type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-1', approved: false,
    reason: 'denied', reasonMessage: 'not on this tree', userSuggestion: 'list the parent instead',
  };
  await dispatch(2, denial);
  await settle();
  const answered = p.heard.filter((one) => one.origin?.clientSeq === 2);
  expect(answered.map((one) => one.action)).toEqual([denial]);
  const held = (await client.handle({ method: 'subscribe', params: { channel: CHAT } }) as {
    snapshot: { state: { activeTurn: { responseParts: { toolCall?: Bag }[] } } };
  }).snapshot.state;
  expect(held.activeTurn.responseParts.find((one) => one.toolCall !== undefined)?.toolCall)
    .toMatchObject({ status: 'cancelled', reasonMessage: 'not on this tree', userSuggestion: 'list the parent instead' });
  await host.close();
});

/*
 * A client holds its actions pending in the order it sent them and matches
 * each answer at the head of that list, so an action sent after one a backend
 * answers later is answered after it.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L23-L24
 */
it('answers a draft sent after a turn start after that start', async () => {
  const { agent, release } = gated(echo({ path: dir, pace: 0 }));
  const { host, p, dispatch } = await serving(agent);
  p.heard.length = 0;
  await dispatch(1, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'one' } });
  await dispatch(2, { type: 'chat/draftChanged', draft: { text: 'next', origin: { kind: 'user' } } });
  await settle();
  // The start is the backend's to say, and it has not begun the turn yet.
  expect(p.heard.some((one) => one.origin !== undefined)).toBe(false);
  release();
  await until(() => p.heard.some((one) => one.origin?.clientSeq === 2), 'the draft');
  expect(p.heard.filter((one) => one.origin !== undefined).map((one) => one.origin?.clientSeq)).toEqual([1, 2]);
  await host.close();
});

/** The echo backend, taking two config keys and holding one more fixed from its start. */
const configured = (): Agent => {
  const base = echo({ path: dir, pace: 0 });
  return {
    ...base,
    schema: () => ({
      ...base.schema(),
      properties: { ...(base.schema().properties as Bag), room: { type: 'string', title: 'Room', sessionMutable: false } },
    }),
    defaults: () => ({ ...base.defaults(), room: 'a' }),
    create: (start: Start): Session => ({ ...(base.create(start) as Session), setConfig: () => true }),
  };
};

/*
 * A config change is one action, and the server validates and broadcasts it:
 * its client is answered once, with every key it took, as the reference host
 * checks every key and then says the client's action once.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts#L603-L608
 * https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/platform/agentHost/node/agentService.ts#L13548-L13588
 */
it('answers a config change naming two keys once, with both', async () => {
  const { host, p, client } = await serving(configured());
  p.heard.length = 0;
  await client.handle({
    method: 'dispatchAction',
    params: { channel: SESSION, clientSeq: 6, action: { type: 'session/configChanged', config: { voice: 'shouty', style: 'brief' } } },
  });
  await settle();
  const answered = p.heard.filter((one) => one.origin?.clientSeq === 6);
  expect(answered.map((one) => one.action)).toEqual([{ type: 'session/configChanged', config: { voice: 'shouty', style: 'brief' } }]);
  await host.close();
});

it('answers a config change naming only a fixed key that did not move', async () => {
  const { host, p, client } = await serving(configured());
  p.heard.length = 0;
  await client.handle({
    method: 'dispatchAction',
    params: { channel: SESSION, clientSeq: 7, action: { type: 'session/configChanged', config: { room: 'a' } } },
  });
  await settle();
  const answered = p.heard.filter((one) => one.origin?.clientSeq === 7) as (Heard & { rejectionReason?: string })[];
  expect(answered.map((one) => [one.action, one.rejectionReason])).toEqual([[{ type: 'session/configChanged', config: { room: 'a' } }, undefined]]);
  await host.close();
});

/*
 * The echo example's queue as VS Code's host drains it: a stop leaves it
 * waiting, and a client taking a message back while nothing runs starts the
 * head.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L71-L90
 */
it('starts the echo example\'s head once a client takes a message back from a stopped turn\'s queue', async () => {
  const { host, p, dispatch } = await serving(echo({ path: dir, pace: 20 }));
  await dispatch(1, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'one two three four five six seven eight' } });
  await until(() => p.heard.some((one) => one.action.type === 'chat/delta'), 'the first word');
  await dispatch(2, { type: 'chat/pendingMessageSet', kind: 'queued', id: 'waiting', message: { text: 'second' } });
  await dispatch(3, { type: 'chat/pendingMessageSet', kind: 'queued', id: 'later', message: { text: 'third' } });
  await dispatch(4, { type: 'chat/turnCancelled', turnId: 't1', duration: 0 });
  await settle();
  const startedFrom = (): unknown[] => p.heard.filter((one) => one.action.type === 'chat/turnStarted').map((one) => one.action.queuedMessageId);
  expect(startedFrom()).toEqual([undefined]);

  await dispatch(5, { type: 'chat/pendingMessageRemoved', kind: 'queued', id: 'waiting' });
  await until(() => startedFrom().length === 2, 'the head');
  expect(startedFrom()).toEqual([undefined, 'later']);
  await host.close();
});
