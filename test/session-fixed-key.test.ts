import { expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { echo } from '../examples/echo/agent.js';
import type { Agent, Start } from '../packages/sdk/src/types/agent.js';
import type { Bag } from '../packages/sdk/src/types/common.js';
import type { Session } from '../packages/sdk/src/types/session.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * A key that may not move once the session runs.
 *
 * Every fixed key but this host's own is declared by the backend that reads
 * it - Claude's `thinking`, the computer plugin's `computer` - and before the
 * first turn the host starts the backend again so the value a person picked
 * in the New view is the value the session runs with. After the first turn it
 * is refused, and the running session shows it as a read-only chip.
 *
 * The backend here is the example with one fixed key and one mutable one
 * added, so the whole path is exercised without a CLI, a plugin or Docker.
 */

const DIR = '/tmp/ahpd-fixed-key';

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

type Note = { channel: string; action: Record<string, unknown>; rejectionReason?: string };

const actions = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

/** The fixed/mutable halves of the schema, over the example's own `voice`. */
const wire = (): Bag => ({
  type: 'object',
  properties: {
    fixed: {
      type: 'string',
      title: 'Fixed',
      description: 'Read when the backend starts.',
      enum: ['one', 'two'],
      sessionMutable: false,
    },
    mutable: {
      type: 'string',
      title: 'Mutable',
      description: 'Moves on a running session.',
      enum: ['a', 'b'],
      sessionMutable: true,
    },
  },
});

/** What each spawn was handed, which is where a fixed value has to arrive. */
interface Spawn { settings: Record<string, unknown> }

/**
 * The example backend with a fixed key, a mutable key, and a record of every
 * start and every turn.
 */
function backend(failOn?: number) {
  const base = echo({ path: DIR, pace: 0 });
  const spawns: Spawn[] = [];
  const set: { key: string; value: unknown }[] = [];
  const began: { spawn: number; text: string }[] = [];
  const agent: Agent = {
    ...base,
    provider: 'fixed',
    displayName: 'Fixed backend',
    schema: (): Bag => ({
      type: 'object',
      properties: { ...(base.schema().properties as Bag), ...(wire().properties as Bag) },
    }),
    defaults: () => ({ ...base.defaults(), fixed: 'one', mutable: 'a' }),
    create: (start: Start): Session => {
      const spawn = spawns.length;
      if (spawn === failOn) throw new Error('the backend would not start');
      spawns.push({ settings: { ...start.settings } });
      const session = base.create(start);
      return {
        ...session,
        begin: (turnId, text, model, from) => {
          began.push({ spawn, text });
          session.begin(turnId, text, model, from);
        },
        setConfig: (key, value) => {
          set.push({ key, value });
          return true;
        },
      };
    },
  };
  return { agent, spawns, set, began };
}

/** A client with one session of that backend, watching both its channels. */
async function opened(initial: Record<string, unknown> = { fixed: 'one', mutable: 'a' }, failOn?: number) {
  const { agent, spawns, set, began } = backend(failOn);
  const p = peer();
  const host = createHost({ path: DIR, agents: [agent] });
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/fixed';
  const chatUri = 'ahp-chat:/fixed';
  // The values the New view's picker held when the session was created, which
  // is what the client sends with `createSession`.
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'fixed', config: initial } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { client, p, uri, chatUri, spawns, set, began };
}

const change = (client: Awaited<ReturnType<typeof opened>>['client'], uri: string, config: Record<string, unknown>) => client.handle({
  method: 'dispatchAction',
  params: { channel: uri, action: { type: 'session/configChanged', config } },
});

const turn = (client: Awaited<ReturnType<typeof opened>>['client'], chatUri: string, text = 'go') => client.handle({
  method: 'dispatchAction',
  params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text } } },
});

it('starts the session again for a fixed key, and the first turn lands there', async () => {
  const { client, uri, chatUri, spawns, began } = await opened();
  expect(spawns).toHaveLength(1);

  // The two arrive back to back, as the first send does: the whole config,
  // then the turn, with nothing waiting for the host in between.
  void change(client, uri, { fixed: 'two' });
  void turn(client, chatUri);
  await settle();

  expect(spawns).toHaveLength(2);
  expect(spawns[1]?.settings.fixed).toBe('two');
  // The turn ran in the backend that was started for it, not the one on its
  // way out.
  expect(began).toEqual([{ spawn: 1, text: 'go' }]);
});

it('answers the turn that waited on a restart with the failure', async () => {
  const { client, p, uri, chatUri, began } = await opened(undefined, 1);
  void change(client, uri, { fixed: 'two' });
  void turn(client, chatUri);
  await settle();

  // The backend never started, so no turn ran - and the turn that waited is
  // refused with the reason rather than left waiting on a session that is
  // not there. The refusal is looked for across the channels because the
  // host answers a chat under the name it holds it by, not the client's.
  expect(began).toEqual([]);
  const refused = p.notes
    .filter((one) => one.method === 'action')
    .map((one) => one.params as Note)
    .find((one) => one.rejectionReason === 'the backend would not start');
  expect(refused).toBeDefined();
});

it('does not start anything again for a value that did not move', async () => {
  const { client, uri, spawns, began } = await opened();
  // What VS Code pushes on the first send: the whole bag, including the
  // value the session already holds.
  await change(client, uri, { fixed: 'one', mutable: 'a' });
  await settle();

  expect(spawns).toHaveLength(1);
  expect(began).toEqual([]);
});

it('refuses a fixed key after the first turn, and keeps the value it had', async () => {
  const { client, p, uri, chatUri, spawns } = await opened();
  await turn(client, chatUri);
  await settle();

  await change(client, uri, { fixed: 'two' });
  await settle();

  const refused = actions(p, uri).find((one) => one.rejectionReason !== undefined);
  expect(refused?.rejectionReason).toBe('fixed is fixed once the session has started');
  expect(spawns).toHaveLength(1);
  expect(spawns[0]?.settings.fixed).toBe('one');
});

it('does not keep a refused value for the next chat in the session', async () => {
  const { client, uri, chatUri, spawns } = await opened();
  await turn(client, chatUri);
  await settle();
  await change(client, uri, { fixed: 'two' });
  await settle();

  // A second chat is spawned from the session's config, so a refused value
  // left there would move it to what was just refused.
  await client.handle({ method: 'createChat', params: { channel: uri, chat: 'ahp-chat:/fixed-second' } });
  await settle();
  expect(spawns.map((one) => one.settings.fixed)).toEqual(['one', 'one']);
});

it('does not start anything again for a default the session was never given', async () => {
  // Created with nothing, so it runs on the default; the first send then
  // names that default, which is agreeing rather than moving.
  const { client, uri, spawns } = await opened({});
  await change(client, uri, { fixed: 'one' });
  await settle();
  expect(spawns).toHaveLength(1);
});

it('hands a mutable key to the backend before the first turn, without restarting', async () => {
  const { client, uri, spawns, set } = await opened();
  await change(client, uri, { mutable: 'b' });
  await settle();

  expect(spawns).toHaveLength(1);
  expect(set).toEqual([{ key: 'mutable', value: 'b' }]);
});

it('shows a running session its fixed key read-only, and a new one still pickable', async () => {
  const { client, uri } = await opened();

  const running = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { config: { schema: { properties: Record<string, Bag> }; values: Record<string, unknown> } } };
  };
  expect(running.snapshot.state.config.schema.properties.fixed).toMatchObject({
    sessionMutable: true,
    readOnly: true,
  });
  expect(running.snapshot.state.config.schema.properties.mutable?.readOnly).toBeUndefined();
  expect(running.snapshot.state.config.values.fixed).toBe('one');

  const offered = await client.handle({
    method: 'resolveSessionConfig',
    params: { channel: 'ahp-root://', provider: 'fixed' },
  }) as { schema: { properties: Record<string, Bag> } };
  // The new-session form is where the value is chosen, so it stays settable
  // there and the gate is what refuses it afterwards.
  expect(offered.schema.properties.fixed).toMatchObject({ sessionMutable: false });
  expect(offered.schema.properties.fixed?.readOnly).toBeUndefined();
});

it('treats a key a plugin contributed the same way', async () => {
  const { agent } = backend();
  const p = peer();
  const host = createHost({
    path: DIR,
    agents: [agent],
    // What the computer plugin registers: a key read when the backend starts.
    sessionConfig: {
      computer: {
        type: 'string',
        title: 'Computer',
        description: 'The computer://<id> this session runs in.',
        sessionMutable: false,
      },
    },
  });
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/contributed';
  const chatUri = 'ahp-chat:/contributed';
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'fixed', config: { fixed: 'one', computer: 'computer://a' } },
  });

  // It reaches the session's schema, and a running session draws it read-only
  // even though no backend ever declared it.
  const running = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { config: { schema: { properties: Record<string, Bag> } } } };
  };
  expect(running.snapshot.state.config.schema.properties.computer).toMatchObject({
    sessionMutable: true,
    readOnly: true,
  });

  await turn(client, chatUri);
  await settle();
  await change(client, uri, { computer: 'computer://b' });
  await settle();
  const refused = actions(p, uri).filter((one) => one.rejectionReason !== undefined).at(-1);
  expect(refused?.rejectionReason).toBe('computer is fixed once the session has started');
});
