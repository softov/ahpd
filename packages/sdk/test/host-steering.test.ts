import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Session } from '../src/types/session.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * A steering message the running turn was handed, sent again.
 *
 * The backend here is the example with a slow turn and a `sendSteeringMessage`
 * that holds what it is handed, as an agent holds a correction until its next
 * tool call: the message stays the chat's steering message while the turn
 * runs, which is the window a second `chat/pendingMessageSet` under its id
 * arrives in.
 */

const DIR = '/tmp/ahpd-steering';

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

const settle = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

type Note = { channel: string; action: Bag; origin?: { clientSeq: number }; rejectionReason?: string };

const envelopes = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

/** The example, slow enough that its turn is still running, holding each steering message it is handed. */
function backend() {
  const base = echo({ path: DIR, pace: 10_000 });
  const steers: { id: string; text: string }[] = [];
  const agent: Agent = {
    ...base,
    provider: 'steady',
    displayName: 'Steady backend',
    create: (start: Start): Session => {
      const session = base.create(start);
      return {
        ...session,
        sendSteeringMessage: ({ id, text }) => {
          if (session.chatState().activeTurn === undefined) return false;
          steers.push({ id, text });
          start.emit('chat', { type: 'chat/pendingMessageSet', kind: 'steering', id, message: { text, origin: { kind: 'user' } } });
          return true;
        },
      };
    },
  };
  return { agent, steers };
}

async function running() {
  const { agent, steers } = backend();
  const p = peer();
  const host = createHost({ path: DIR, agents: [agent] });
  const client = host.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  const uri = 'ahp-session:/steady';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'steady' } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as { snapshot: { state: { defaultChat: string } } };
  const chatUri = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'first words here' } } },
  });
  await settle();
  const steer = (clientSeq: number, text: string) => client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, clientSeq, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text, origin: { kind: 'user' } } } },
  });
  // A queued message under the same id as `steer`'s.
  const queue = (clientSeq: number, text: string) => client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, clientSeq, action: { type: 'chat/pendingMessageSet', kind: 'queued', id: 's1', message: { text, origin: { kind: 'user' } } } },
  });
  // A client taking `steer`'s message back.
  const unsteer = (clientSeq: number) => client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, clientSeq, action: { type: 'chat/pendingMessageRemoved', kind: 'steering', id: 's1' } },
  });
  return { p, chatUri, steers, steer, queue, unsteer };
}

/*
 * "Steering handed to the provider cannot be edited, and can be removed only if
 * the provider can withdraw it": the reference host asks the provider's
 * capability before the provider hears of the removal (agentService.ts
 * L13517-L13524 at a4e689ae). A backend with no withdrawal keeps what it was
 * handed.
 */
it('refuses taking back the running turn\'s steering message from a backend that cannot withdraw it', async () => {
  const { p, chatUri, steers, steer, unsteer } = await running();
  await steer(2, 'stop that');
  await settle();
  await unsteer(3);
  await settle();
  const answer = envelopes(p, chatUri).find((e) => e.origin?.clientSeq === 3);
  expect(answer?.rejectionReason).toBe('Cannot change a steering message while it is being processed.');
  expect(steers.map((one) => one.id)).toEqual(['s1']);
});

/*
 * "Repeated identical upserts MUST NOT cause duplicate provider delivery": the
 * reference host hands each steering message to its provider once, and an
 * upsert of one it handed over finds it handed (agentService.ts L13516-L13523,
 * queueDrainContribution.ts L190-L196 at a4e689ae).
 */
it('answers the same steering message sent again, and hands it to the backend once', async () => {
  const { p, chatUri, steers, steer } = await running();
  void steer(2, 'not that one');
  await settle();
  void steer(3, 'not that one');
  await settle();

  expect(steers).toEqual([{ id: 's1', text: 'not that one' }]);
  const again = envelopes(p, chatUri).find((one) => one.origin?.clientSeq === 3);
  expect(again?.rejectionReason).toBeUndefined();
  expect(again?.action).toMatchObject({ type: 'chat/pendingMessageSet', kind: 'steering', id: 's1' });
});

/*
 * "Hosts MUST reject edits ... that they can no longer honor after handoff",
 * in the reference host's words.
 */
it('refuses an edit of the steering message the running turn holds', async () => {
  const { p, chatUri, steers, steer } = await running();
  void steer(2, 'not that one');
  await settle();
  void steer(3, 'the other one');
  await settle();

  expect(steers).toEqual([{ id: 's1', text: 'not that one' }]);
  const edit = envelopes(p, chatUri).find((one) => one.origin?.clientSeq === 3);
  expect(edit?.rejectionReason).toBe('Cannot change a steering message while it is being processed.');
});

/*
 * A queued message under the held steering message's id changes its kind, which
 * the reference host refuses while a turn runs (agentService.ts L13517-L13524 at
 * a4e689ae): `existing` is found by id whatever the action's kind.
 */
it('refuses a queued message under the id of the steering message the running turn holds', async () => {
  const { p, chatUri, steers, steer, queue } = await running();
  void steer(2, 'not that one');
  await settle();
  void queue(3, 'not that one');
  await settle();

  expect(steers).toEqual([{ id: 's1', text: 'not that one' }]);
  const queued = envelopes(p, chatUri).find((one) => one.origin?.clientSeq === 3);
  expect(queued?.rejectionReason).toBe('Cannot change a steering message while it is being processed.');
  expect(envelopes(p, chatUri).some((one) => one.rejectionReason === undefined
    && one.action.type === 'chat/pendingMessageSet' && one.action.kind === 'queued')).toBe(false);
});

/*
 * A backend that takes no steering refuses it with nothing running too, as the
 * reference host refuses steering to a provider that cannot take it, idle or
 * not, in its words (agentService.ts L13526-L13529 at 6b68d3fe). The example
 * has no `sendSteeringMessage`.
 */
it('refuses a steering message to a backend that takes none, with nothing running', async () => {
  const p = peer();
  const host = createHost({ path: DIR, agents: [echo({ path: DIR, pace: 0 })] });
  const client = host.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  const uri = 'ahp-session:/plain';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as { snapshot: { state: { defaultChat: string } } };
  const chatUri = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, clientSeq: 1, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'now', origin: { kind: 'user' } } } },
  });
  await settle();

  expect(envelopes(p, chatUri).find((one) => one.origin?.clientSeq === 1)?.rejectionReason).toBe('The session provider does not support steering messages.');
  expect(envelopes(p, chatUri).some((one) => one.action.type === 'chat/turnStarted')).toBe(false);
});

/*
 * "Cancellation clears every pending steering entry, including prompts handed
 * off but not yet consumed": the steering message sent into the stopped turn
 * goes with it, and the queued message stays (AGENTS.md L617,
 * queueDrainContribution.ts L55-L65 at a4e689ae).
 */
it('takes the steering message out of the chat when the turn it was sent into is stopped', async () => {
  const { agent } = backend();
  const p = peer();
  const host = createHost({ path: DIR, agents: [agent] });
  const client = host.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  const uri = 'ahp-session:/stopped';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'steady' } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as { snapshot: { state: { defaultChat: string } } };
  const chatUri = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  const dispatch = (clientSeq: number, action: Bag) => client.handle({ method: 'dispatchAction', params: { channel: chatUri, clientSeq, action } });
  await dispatch(1, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'first words here' } });
  await settle();
  await dispatch(2, { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'and the tests', origin: { kind: 'user' } } });
  await dispatch(3, { type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { text: 'later', origin: { kind: 'user' } } });
  await dispatch(4, { type: 'chat/turnCancelled', turnId: 't1', duration: 0 });
  await settle();

  const removed = envelopes(p, chatUri).filter((one) => one.action.type === 'chat/pendingMessageRemoved');
  expect(removed.map((one) => [one.action.kind, one.action.id])).toEqual([['steering', 's1']]);
  const state = ((await client.handle({ method: 'subscribe', params: { channel: chatUri } })) as { snapshot: { state: Bag } }).snapshot.state;
  expect(state.steeringMessage).toBeUndefined();
  expect((state.queuedMessages as Bag[]).map((one) => one.id)).toEqual(['q1']);
});

/*
 * The example under a backend that answers each steering message as a case
 * says, and records what it was sent, handed and asked to withdraw. A case
 * says the turn's own actions through `chat`, and `fail` has the next sends
 * fail as a client can resume, as a rate-limited model call does.
 */
function answering(answer: (calls: number) => boolean | Promise<boolean>) {
  const base = echo({ path: DIR, pace: 10_000 });
  const steers: string[] = [];
  const withdrawn: string[] = [];
  const sends: string[] = [];
  let opened: Start | undefined;
  let failing = false;
  const agent: Agent = {
    ...base,
    provider: 'steady',
    displayName: 'Steady backend',
    create: (start: Start): Session => {
      opened = start;
      const session = base.create(start);
      return {
        ...session,
        sendMessage: (turnId, text, from, attachments, options) => {
          sends.push(text);
          if (!failing) return session.sendMessage(turnId, text, from, attachments, options);
          start.emit('chat', {
            type: 'chat/error',
            turnId,
            duration: 0,
            part: { kind: 'error', error: { errorType: 'turnFailed', message: '429 rate limited' }, resumable: true },
          });
          return undefined;
        },
        sendSteeringMessage: ({ id }) => {
          steers.push(id);
          return answer(steers.length);
        },
        withdrawSteeringMessage: (id) => { withdrawn.push(id); },
      };
    },
  };
  return {
    agent,
    steers,
    withdrawn,
    sends,
    chat: (action: Bag): void => { opened?.emit('chat', action); },
    fail: (on: boolean): void => { failing = on; },
  };
}

/** A session of `agent` with its chat subscribed, a client's dispatches into the chat, and what the chat holds. */
async function chatOf(agent: Agent, name: string) {
  const p = peer();
  const host = createHost({ path: DIR, agents: [agent] });
  const client = host.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  const uri = `ahp-session:/${name}`;
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'steady' } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as { snapshot: { state: { defaultChat: string } } };
  const chatUri = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  let seq = 0;
  const dispatch = (action: Bag): Promise<unknown> => client.handle({ method: 'dispatchAction', params: { channel: chatUri, clientSeq: ++seq, action } });
  const state = async (): Promise<Bag> => ((await client.handle({ method: 'subscribe', params: { channel: chatUri } })) as { snapshot: { state: Bag } }).snapshot.state;
  const started = (): Note[] => envelopes(p, chatUri).filter((one) => one.action.type === 'chat/turnStarted');
  return { p, chatUri, dispatch, state, started };
}

const turn = (turnId: string, text: string): Bag => ({ type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text } });
const pending = (kind: 'queued' | 'steering', id: string, text: string): Bag => ({ type: 'chat/pendingMessageSet', kind, id, message: { text, origin: { kind: 'user' } } });

/*
 * Steering the backend cannot take yet, its turn still preparing its prompt,
 * stays the chat's and is handed again on the turn's next action, as the
 * reference host hands pending steering on each action of the active turn
 * until its provider takes it (queueDrainContribution.ts L92-L121 and
 * L175-L216 at 6b68d3fe).
 */
it('hands steering sent while a turn prepares to that turn once it can take it', async () => {
  let ready = false;
  const { agent, steers, chat } = answering(() => ready);
  const { dispatch, state } = await chatOf(agent, 'preparing');
  await dispatch(turn('t1', 'first words here'));
  await settle();
  await dispatch(pending('steering', 's1', 'and the tests'));
  await settle();
  expect(steers).toEqual(['s1']);

  ready = true;
  chat({ type: 'chat/activityChanged', activity: 'Reading the tests' });
  await settle();
  expect(steers).toEqual(['s1', 's1']);
  expect(((await state()).steeringMessage as Bag | undefined)?.id).toBe('s1');
});

/*
 * Steering that waited with nothing running, held behind a failure a client
 * can resume, is handed to the next turn a client starts, at its start, as the
 * reference host hands pending steering when a turn starts
 * (queueDrainContribution.ts L123-L130 and L245-L265 at 6b68d3fe).
 */
it('hands steering that waited with nothing running to the next turn that starts', async () => {
  const { agent, steers, fail } = answering(() => true);
  const { dispatch, started } = await chatOf(agent, 'idle');
  fail(true);
  await dispatch(turn('t1', 'first words here'));
  await settle();
  fail(false);
  await dispatch(pending('steering', 's1', 'and the tests'));
  await settle();
  expect(steers).toEqual([]);

  await dispatch(turn('t2', 'second words here'));
  await settle();
  expect(steers).toEqual(['s1']);
  // It went into that turn rather than running as a turn of its own.
  expect(started().map((one) => one.action.turnId)).toEqual(['t1', 't2']);
});

/*
 * Steering the backend hands back unsent, the turn it was meant for having
 * ended first, steers the turn that runs then, as the reference host steers
 * the active turn with it (queueDrainContribution.ts L230-L243 at 6b68d3fe).
 */
it('steers the turn that runs with steering its backend handed back', async () => {
  let handBack: (sent: boolean) => void = () => {};
  const { agent, steers, chat } = answering((calls) => (calls === 1 ? new Promise<boolean>((resolve) => { handBack = resolve; }) : true));
  const { dispatch, started } = await chatOf(agent, 'handed-back');
  await dispatch(turn('t1', 'first words here'));
  await settle();
  await dispatch(pending('steering', 's1', 'and the tests'));
  await settle();
  // The turn it was meant for ends before the backend sends it, and another starts.
  chat({ type: 'chat/turnComplete', turnId: 't1', duration: 1 });
  await settle();
  await dispatch(turn('t2', 'second words here'));
  await settle();
  expect(steers).toEqual(['s1']);

  handBack(false);
  await settle();
  expect(steers).toEqual(['s1', 's1']);
  expect(started().map((one) => one.action.turnId)).toEqual(['t1', 't2']);
});

/*
 * A stop takes every pending steering message out with the host's own action,
 * said right behind the stop and before the backend is stopped, withdraws
 * nothing, since the stop drops what the backend holds, and starts nothing;
 * a message set once the chat is idle starts the queue's head, as the
 * reference host does (agentSideEffects.ts L1921-L1955,
 * queueDrainContribution.ts L55-L69 and L92-L121 at 6b68d3fe).
 */
it('takes the steering out at a stop before its backend stops, starts nothing, and starts the head once a message is set', async () => {
  const { agent, steers, withdrawn } = answering(() => true);
  const { p, chatUri, dispatch, state, started } = await chatOf(agent, 'stopped-drain');
  await dispatch(turn('t1', 'first words here'));
  await settle();
  await dispatch(pending('steering', 's1', 'and the tests'));
  await dispatch(pending('queued', 'q1', 'later'));
  await dispatch({ type: 'chat/turnCancelled', turnId: 't1', duration: 0 });
  await settle();

  expect(steers).toEqual(['s1']);
  expect(withdrawn).toEqual([]);
  const said = envelopes(p, chatUri);
  const stop = said.findIndex((one) => one.action.type === 'chat/turnCancelled');
  expect(said[stop + 1]?.action).toMatchObject({ type: 'chat/pendingMessageRemoved', kind: 'steering', id: 's1' });
  expect(said[stop + 1]?.origin).toBeUndefined();
  expect(started().map((one) => one.action.turnId)).toEqual(['t1']);
  expect(((await state()).queuedMessages as Bag[]).map((one) => one.id)).toEqual(['q1']);

  await dispatch(pending('queued', 'q2', 'and later'));
  await settle();
  expect(started().at(-1)?.action.queuedMessageId).toBe('q1');
});

/*
 * A queued message waits behind a failure a client can resume, as the
 * reference host's drain holds the queue there (queueDrainContribution.ts
 * L262-L265 at 6b68d3fe).
 */
it('leaves a queued message waiting behind a failure a client can resume', async () => {
  const { agent, sends, fail } = answering(() => true);
  const { dispatch, state, started } = await chatOf(agent, 'failed');
  fail(true);
  await dispatch(turn('t1', 'first words here'));
  await settle();
  fail(false);
  await dispatch(pending('queued', 'q1', 'later'));
  await settle();

  expect(started().map((one) => one.action.turnId)).toEqual(['t1']);
  expect(sends).toEqual(['first words here']);
  expect(((await state()).queuedMessages as Bag[]).map((one) => one.id)).toEqual(['q1']);
});

/*
 * A client's removal of steering the backend was handed, while its turn runs,
 * is said as the client sent it and reaches the backend's withdrawal, as the
 * reference host has its provider withdraw it (agentService.ts L13530-L13537,
 * queueDrainContribution.ts L84-L86 and L165-L173 at 6b68d3fe).
 */
it('withdraws handed steering a client takes back while its turn runs', async () => {
  const { agent, steers, withdrawn } = answering(() => true);
  const { p, chatUri, dispatch, state } = await chatOf(agent, 'withdrawn');
  await dispatch(turn('t1', 'first words here'));
  await settle();
  await dispatch(pending('steering', 's1', 'and the tests'));
  await settle();
  await dispatch({ type: 'chat/pendingMessageRemoved', kind: 'steering', id: 's1' });
  await settle();

  expect(steers).toEqual(['s1']);
  expect(withdrawn).toEqual(['s1']);
  const removed = envelopes(p, chatUri).find((one) => one.action.type === 'chat/pendingMessageRemoved');
  expect(removed?.rejectionReason).toBeUndefined();
  expect(removed?.origin?.clientSeq).toBe(3);
  expect((await state()).steeringMessage).toBeUndefined();
});
