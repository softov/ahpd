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
 * The backend here is the example with a slow turn and a `steer` that holds
 * what it is handed, as an agent holds a correction until its next tool call:
 * the message stays the chat's steering message while the turn runs, which is
 * the window a second `chat/pendingMessageSet` under its id arrives in.
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
        steer: (id, text) => {
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
    params: { channel: chatUri, clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'first words here' } } },
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
  return { p, chatUri, steers, steer, queue };
}

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
 * not (agentService.ts L13513-L13516 at a4e689ae). The example has no `steer`.
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

  expect(envelopes(p, chatUri).find((one) => one.origin?.clientSeq === 1)?.rejectionReason).toBe('This backend cannot take a message mid-turn');
  expect(envelopes(p, chatUri).some((one) => one.action.type === 'chat/turnStarted')).toBe(false);
});
