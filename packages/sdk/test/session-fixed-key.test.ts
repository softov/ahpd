import { expect, it, vi } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Listed, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Session } from '../src/types/session.js';
import type { Peer } from '../src/types/rpc.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { shellTerminals } from '../src/machines/terminals.js';

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

type Note = { channel: string; action: Record<string, unknown>; origin?: { clientId: string; clientSeq: number }; rejectionReason?: string };

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
    // A key that says nothing of `sessionMutable`, which the protocol reads as
    // a key that does not move once the session is created.
    unsaid: {
      type: 'string',
      title: 'Unsaid',
      description: 'Says nothing of whether it moves.',
      enum: ['x', 'y'],
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
        sendMessage: (turnId, text, from) => {
          began.push({ spawn, text });
          return session.sendMessage(turnId, text, from);
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
  // The values the New view's picker held when the session was created, which
  // is what the client sends with `createSession`.
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'fixed', config: initial } });
  // The chat the host minted for the session, read off its state.
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { client, p, uri, chatUri, spawns, set, began };
}

const change = (client: Awaited<ReturnType<typeof opened>>['client'], uri: string, config: Record<string, unknown>) => client.handle({
  method: 'dispatchAction',
  params: { channel: uri, action: { type: 'session/configChanged', config } },
});

/** The chat the host minted for a session, read off its state as a client reads it. */
const mintedChat = async (client: Awaited<ReturnType<typeof opened>>['client'], uri: string): Promise<string> =>
  ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;

const turn = (client: Awaited<ReturnType<typeof opened>>['client'], chatUri: string, text = 'go') => client.handle({
  method: 'dispatchAction',
  params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
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

/*
 * The change is said at once and the backend, which reads a fixed key only
 * when it starts, is started again at the session's next turn boundary, as
 * VS Code relaunches a runtime there: nothing restarts while no turn comes.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L1095-L1101
 */
it('says a fixed key\'s change at once, and starts the backend again only at the next turn', async () => {
  const { client, p, uri, chatUri, spawns, began } = await opened();
  await change(client, uri, { fixed: 'two' });
  await settle();

  expect(spawns).toHaveLength(1);
  const changed = p.notes.filter((one) => one.method === 'action').map((one) => one.params as Note)
    .filter((one) => one.action.type === 'session/configChanged');
  expect(changed.map((one) => one.action.config)).toEqual([{ fixed: 'two' }]);

  void turn(client, chatUri);
  await settle();
  expect(spawns).toHaveLength(2);
  expect(spawns[1]?.settings.fixed).toBe('two');
  expect(began).toEqual([{ spawn: 1, text: 'go' }]);
});

/*
 * The restart is the turn's preparation, so a restart that fails ends the turn
 * said meanwhile in an error in its words, as VS Code's host ends a turn whose
 * preparation failed.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2317-L2336
 */
it('ends the turn that waited on a restart in an error with the failure', async () => {
  const { client, p, uri, chatUri, began } = await opened(undefined, 1);
  void change(client, uri, { fixed: 'two' });
  void turn(client, chatUri);
  await settle();

  // The backend never started, so no turn ran, and the turn that waited is
  // ended with the reason, since the session it was meant for is not there.
  // It is looked for across the channels because the host answers a chat under
  // the name it holds it by.
  expect(began).toEqual([]);
  const said = p.notes
    .filter((one) => one.method === 'action')
    .map((one) => one.params as Note)
    .filter((one) => one.action.turnId === 't1');
  expect(said.map((one) => [one.action.type, one.rejectionReason])).toEqual([
    ['chat/turnStarted', undefined],
    ['chat/error', undefined],
  ]);
  expect(said[1]?.action.part).toMatchObject({ error: { errorType: 'sendFailed', message: 'the backend would not start' } });
});

/*
 * A first message whose start fails ends in its error, and the session, still
 * being created, fails its creation after it and is then announced, as VS
 * Code's host fails a session its first send could not bring up.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2446-L2480
 */
it('fails the creation of a session its first message could not bring up, after the turn\'s error, and announces it, as VS Code\'s host', async () => {
  const { client, p, uri, chatUri } = await opened(undefined, 1);
  void change(client, uri, { fixed: 'two' });
  void turn(client, chatUri);
  await settle();

  const said = p.notes.flatMap((one) => {
    if (one.method === 'root/sessionAdded') return ['root/sessionAdded'];
    if (one.method !== 'action') return [];
    const { action } = one.params as Note;
    return ['chat/turnStarted', 'chat/error', 'session/ready', 'session/creationFailed'].includes(String(action.type))
      ? [String(action.type)]
      : [];
  });
  expect(said).toEqual(['chat/turnStarted', 'chat/error', 'session/creationFailed', 'root/sessionAdded']);
  const failed = p.notes.map((one) => one.params as Note).find((one) => one.action?.type === 'session/creationFailed');
  expect(failed?.action.error).toMatchObject({ errorType: 'sendFailed', message: 'the backend would not start' });
  const read = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { lifecycle: string } };
  };
  expect(read.snapshot.state.lifecycle).toBe('failed');

  // A message sent again tries the start again, and ends in its error.
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { text: 'again', origin: { kind: 'user' } } } },
  });
  await settle();
  const again = p.notes.filter((one) => one.method === 'action').map((one) => one.params as Note)
    .filter((one) => one.action.turnId === 't2');
  expect(again.map((one) => [one.action.type, one.rejectionReason])).toEqual([['chat/turnStarted', undefined], ['chat/error', undefined]]);
  expect(again[1]?.action.part).toMatchObject({ error: { errorType: 'sendFailed', message: 'the backend would not start' } });
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

/*
 * A key whose schema says nothing of `sessionMutable`.
 *
 * "Only properties with `sessionMutable: true` in the config schema may be
 * changed", so such a key is fixed the way `sessionMutable: false` is. No VS
 * Code client sends one on a running session: it writes a key there only when
 * the schema says `sessionMutable` (sessionConfigProperties.ts L131-L133 at
 * a4e689ae).
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts#L604-L608
 */
it('refuses a key that says nothing of moving after the first turn, and never asks the backend', async () => {
  const { client, p, uri, chatUri, spawns, set } = await opened();
  await turn(client, chatUri);
  await settle();

  await change(client, uri, { unsaid: 'y' });
  await settle();

  const refused = actions(p, uri).find((one) => one.rejectionReason !== undefined);
  expect(refused?.rejectionReason).toBe('unsaid is fixed once the session has started');
  expect(set.map((one) => one.key)).not.toContain('unsaid');
  expect(spawns).toHaveLength(1);
});

it('starts the session again for a key that says nothing of moving, before the first turn', async () => {
  const { client, chatUri, uri, spawns, set, began } = await opened();
  void change(client, uri, { unsaid: 'y' });
  void turn(client, chatUri);
  await settle();

  expect(spawns).toHaveLength(2);
  expect(spawns[1]?.settings.unsaid).toBe('y');
  expect(set.map((one) => one.key)).not.toContain('unsaid');
  expect(began).toEqual([{ spawn: 1, text: 'go' }]);
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

/*
 * A running session publishes each key as its backend declared it, as VS Code's
 * host publishes an agent's schema, so a VS Code window draws what it would
 * draw there: no chip for a key that may not move.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2475-L2492
 */
it('shows a running session its fixed key as declared, and a new one still pickable', async () => {
  const { client, uri } = await opened();

  const running = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { config: { schema: { properties: Record<string, Bag> }; values: Record<string, unknown> } } };
  };
  expect(running.snapshot.state.config.schema.properties.fixed).toMatchObject({ sessionMutable: false });
  expect(running.snapshot.state.config.schema.properties.fixed?.readOnly).toBeUndefined();
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
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'fixed', config: { fixed: 'one', computer: 'computer://a' } },
  });
  const chatUri = await mintedChat(client, uri);

  // It reaches the session's schema as the plugin declared it, though no
  // backend ever declared it.
  const running = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { config: { schema: { properties: Record<string, Bag> } } } };
  };
  expect(running.snapshot.state.config.schema.properties.computer).toMatchObject({ sessionMutable: false });
  expect(running.snapshot.state.config.schema.properties.computer?.readOnly).toBeUndefined();

  await turn(client, chatUri);
  await settle();
  await change(client, uri, { computer: 'computer://b' });
  await settle();
  const refused = actions(p, uri).filter((one) => one.rejectionReason !== undefined).at(-1);
  expect(refused?.rejectionReason).toBe('computer is fixed once the session has started');
});

it('keeps a change the backend took while the session was being started again', async () => {
  const base = echo({ path: DIR, pace: 0 });
  /** The answer to the pending `setConfig`, given as the old backend is closed for the restart. */
  let answer: (said: true) => void = () => {};
  const agent: Agent = {
    ...base,
    provider: 'fixed',
    displayName: 'Fixed backend',
    schema: (): Bag => ({ type: 'object', properties: { ...(base.schema().properties as Bag), ...(wire().properties as Bag) } }),
    defaults: () => ({ ...base.defaults(), fixed: 'one', mutable: 'a' }),
    create: (start: Start): Session => {
      const session = base.create(start);
      return {
        ...session,
        setConfig: (key) => (key === 'mutable' ? new Promise<true>((resolve) => { answer = resolve; }) : true),
        close: () => { answer(true); session.close(); },
      };
    },
  };
  const store = memorySessions();
  const host = createHost({ path: DIR, agents: [agent], sessions: store });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/fixed', provider: 'fixed', config: { fixed: 'one', mutable: 'a' } } });
  void change(client, 'ahp-session:/fixed', { mutable: 'b' });
  await settle();
  // The restart closes the old backend, which is when it answers.
  void change(client, 'ahp-session:/fixed', { fixed: 'two' });
  await settle();
  expect(store.config('fixed')).toMatchObject({ fixed: 'two', mutable: 'b' });
});

/*
 * A change the running backend takes is handed to it at once, and the turn
 * after it goes to the backend its relaunch into the machine brings up, as
 * VS Code says a change at once and relaunches at the next turn boundary.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L1095-L1101
 */
it('hands a change to the running backend, and a turn after it to the backend its relaunch into a machine brings up, in order', async () => {
  const base = echo({ path: DIR, pace: 0 });
  /** What each backend was told, by the spawn it was. */
  const said: string[] = [];
  let spawned = 0;
  const agent: Agent = {
    ...base,
    provider: 'fixed',
    displayName: 'Fixed backend',
    schema: (): Bag => ({ type: 'object', properties: { ...(base.schema().properties as Bag), ...(wire().properties as Bag) } }),
    defaults: () => ({ ...base.defaults(), fixed: 'one', mutable: 'a' }),
    create: (start: Start): Session => {
      const spawn = spawned;
      spawned += 1;
      const session = base.create(start);
      return {
        ...session,
        sendMessage: (turnId, text, from) => { said.push(`${spawn}: begin ${text}`); return session.sendMessage(turnId, text, from); },
        setConfig: (key, value) => { said.push(`${spawn}: ${key}=${String(value)}`); return true; },
      };
    },
  };
  /** Holds the machine back until the test lets it go, which is the window a restart is in. */
  let made: (id: string) => void = () => {};
  const host = createHost({
    path: DIR,
    agents: [agent],
    sessionConfig: {
      computer: { type: 'string', title: 'Computer', description: 'Where it runs.', sessionMutable: false },
    },
    computers: {
      create: () => new Promise<string>((resolve) => { made = resolve; }),
      how: async () => undefined,
    } as never,
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/boxed', provider: 'fixed', config: { fixed: 'one', mutable: 'a' } } });
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/boxed' } });
  void change(client, 'ahp-session:/boxed', { computer: 'disposable:box' });
  await settle();
  // Both are sent back to back, as the first send does: the change reaches
  // the backend still running, and the turn is the session's next turn
  // boundary, where its relaunch into the machine runs.
  void change(client, 'ahp-session:/boxed', { mutable: 'b' });
  void turn(client, await mintedChat(client, 'ahp-session:/boxed'), 'go');
  // And one on another channel, which this connection sent after them.
  void client.handle({ method: 'dispatchAction', params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { defaultShell: '/bin/sh' } } } });
  await settle();
  made('m1');
  await settle();
  expect(said).toEqual(['0: mutable=b', '1: begin go']);
  const echoed = p.notes.filter((n) => n.method === 'action').map((n) => (n.params as Note).action)
    .filter((action) => action.type === 'root/configChanged' || (action.type === 'session/configChanged' && (action.config as Bag).mutable === 'b'))
    .map((action) => String(action.type));
  expect(echoed).toEqual(['session/configChanged', 'root/configChanged']);
});

/**
 * A session being started again into a machine the test makes by calling
 * `made`, a record of what each backend was told, and a backend whose
 * `begin` throws when `throws` is set.
 */
const intoMachine = async (throws = false) => {
  const base = echo({ path: DIR, pace: 0 });
  const said: string[] = [];
  let spawned = 0;
  const agent: Agent = {
    ...base,
    provider: 'fixed',
    displayName: 'Fixed backend',
    schema: (): Bag => ({ type: 'object', properties: { ...(base.schema().properties as Bag), ...(wire().properties as Bag) } }),
    defaults: () => ({ ...base.defaults(), fixed: 'one', mutable: 'a' }),
    create: (start: Start): Session => {
      const spawn = spawned;
      spawned += 1;
      const session = base.create(start);
      return {
        ...session,
        sendMessage: (turnId, text, from) => {
          said.push(`${spawn}: begin ${text}`);
          if (throws && spawn > 0) throw new Error('the backend fell over');
          return session.sendMessage(turnId, text, from);
        },
      };
    },
  };
  const machine = { made: (_id: string): void => {} };
  const host = createHost({
    path: DIR,
    agents: [agent],
    sessionConfig: {
      computer: { type: 'string', title: 'Computer', description: 'Where it runs.', sessionMutable: false },
    },
    computers: {
      create: () => new Promise<string>((resolve) => { machine.made = resolve; }),
      how: async () => undefined,
    } as never,
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/boxed', provider: 'fixed', config: { fixed: 'one', mutable: 'a' } } });
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/boxed' } });
  void change(client, 'ahp-session:/boxed', { computer: 'disposable:box' });
  await settle();
  return { host, p, client, said, machine };
};

/*
 * A turn sent while its session is started again is said at once, and handed
 * to the session that comes up: the restart is the turn's preparation, as VS
 * Code's host shows a turn running while the work its send needs is done.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2241-L2316
 */
it('says a turn sent while its session is started again at once, and begins it once the session is up', async () => {
  const { p, client, said, machine } = await intoMachine();
  const chat = await mintedChat(client, 'ahp-session:/boxed');
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  void client.handle({ method: 'dispatchAction', params: { channel: chat, clientSeq: 7, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'go' } } } });
  await settle();
  expect(actions(p, chat).filter((note) => note.action.type === 'chat/turnStarted').map((note) => note.origin?.clientSeq)).toEqual([7]);
  expect(said).toEqual([]);
  machine.made('m1');
  await settle();
  expect(said).toEqual(['1: begin go']);
  expect(actions(p, chat).filter((note) => note.action.type === 'chat/turnStarted').map((note) => note.origin?.clientSeq)).toEqual([7]);
});

/*
 * A turn stopped while its session is started again is never handed to the
 * session that comes up, as VS Code's host sends nothing for a turn cancelled
 * while its send is prepared.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2307-L2310
 */
it('sends nothing for a turn stopped while its session is started again', async () => {
  const { p, client, said, machine } = await intoMachine();
  const chat = await mintedChat(client, 'ahp-session:/boxed');
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  void client.handle({ method: 'dispatchAction', params: { channel: chat, clientSeq: 7, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'go' } } } });
  await settle();
  void client.handle({ method: 'dispatchAction', params: { channel: chat, clientSeq: 8, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } } });
  await settle();
  expect(actions(p, chat).map((note) => [note.action.type, note.origin?.clientSeq])).toEqual([
    ['chat/turnStarted', 7],
    ['chat/turnCancelled', 8],
  ]);
  machine.made('m1');
  await settle();
  expect(said).toEqual([]);
});

/*
 * A change to a key the schema declares is checked by the schema and said, and
 * a value its backend could not take is the backend's to log, as VS Code's
 * host says a config change its checks passed and then applies it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13576-L13679
 */
it('says a change to a key its backend declares, and keeps it when the backend would not take the value', async () => {
  const base = echo({ path: DIR, pace: 0 });
  const agent: Agent = {
    ...base,
    provider: 'fixed',
    displayName: 'Fixed backend',
    schema: (): Bag => ({ type: 'object', properties: { ...(base.schema().properties as Bag), ...(wire().properties as Bag) } }),
    defaults: () => ({ ...base.defaults(), fixed: 'one', mutable: 'a' }),
    create: (start: Start): Session => ({ ...base.create(start), setConfig: () => 'the backend would not take it' }),
  };
  const store = memorySessions();
  const host = createHost({ path: DIR, agents: [agent], sessions: store });
  const p = peer();
  const client = host.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/kept', provider: 'fixed', config: { fixed: 'one', mutable: 'a' } } });
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/kept' } });
  await client.handle({ method: 'dispatchAction', params: { channel: 'ahp-session:/kept', clientSeq: 3, action: { type: 'session/configChanged', config: { mutable: 'b' } } } });
  await settle();
  const answered = actions(p, 'ahp-session:/kept').filter((note) => note.origin?.clientSeq === 3);
  expect(answered.map((note) => [note.action.type, note.rejectionReason])).toEqual([['session/configChanged', undefined]]);
  expect(store.config('kept')).toMatchObject({ mutable: 'b' });
});

/*
 * A fixed key's change is said before the session starts again, and the
 * restart is its side effect, as VS Code's host says a config change at once.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13654-L13661
 */
it('says a change that starts the session again before the session is up', async () => {
  const { p } = await intoMachine();
  const said = actions(p, 'ahp-session:/boxed').filter((note) => note.action.type === 'session/configChanged' && note.origin !== undefined);
  expect(said.map((note) => [(note.action.config as Bag).computer, note.rejectionReason])).toEqual([['disposable:box', undefined]]);
});

/** The action envelopes a peer was sent. */
const notesOf = (r: ReturnType<typeof peer>): Note[] => r.notes.filter((n) => n.method === 'action').map((n) => n.params as Note);

/*
 * A client's dispatches wait in one queue, whichever of its connections sent
 * them, as VS Code's host keys its queue by client id.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L12501-L12507
 */
it('holds a dispatch behind its client\'s waiting one, sent on another connection of that client', async () => {
  const { host, client, machine } = await intoMachine();
  // The turn is the session's next turn boundary, where its relaunch into the
  // machine runs, and what the client sends after it waits for the relaunch.
  void turn(client, await mintedChat(client, 'ahp-session:/boxed'), 'go');
  await settle();
  void client.handle({ method: 'dispatchAction', params: { channel: await mintedChat(client, 'ahp-session:/boxed'), action: { type: 'chat/draftChanged', draft: { text: 'go', origin: { kind: 'user' } } } } });
  await settle();
  const q = peer();
  const again = host.accept(q);
  await again.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
  void again.handle({ method: 'dispatchAction', params: { channel: 'ahp-root://', clientSeq: 9, action: { type: 'root/configChanged', config: { defaultShell: '/bin/sh' } } } });
  await settle();
  expect(notesOf(q).some((note) => note.action.type === 'root/configChanged')).toBe(false);
  machine.made('m1');
  await settle();
  expect(notesOf(q).filter((note) => note.action.type === 'root/configChanged').map((note) => note.rejectionReason)).toEqual([undefined]);
});


/*
 * A turn said is the chat's, so it is sent once its session is up whether or
 * not the connection that sent it is still there, as VS Code's host sends a
 * turn it said.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1815
 */
it('begins a turn that waited on a restart after its connection left', async () => {
  const { client, said, machine } = await intoMachine();
  void turn(client, await mintedChat(client, 'ahp-session:/boxed'), 'go');
  await settle();
  client.close();
  machine.made('m1');
  await settle();
  expect(said).toEqual(['1: begin go']);
});

/*
 * A dispatch that waited is applied whatever became of the connection that
 * sent it, and every client of its channel is told, as VS Code's host runs a
 * client's queued dispatch.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L12507-L12649
 */
it('applies a dispatch that waited on a restart after its connection left', async () => {
  const { host, client, machine } = await intoMachine();
  const chat = await mintedChat(client, 'ahp-session:/boxed');
  const q = peer();
  const other = host.accept(q);
  await other.handle({ method: 'initialize', params: { clientId: 'other', protocolVersions: ['0.9.0'] } });
  await other.handle({ method: 'subscribe', params: { channel: chat } });
  void client.handle({ method: 'dispatchAction', params: { channel: chat, clientSeq: 4, action: { type: 'chat/draftChanged', draft: { text: 'half', origin: { kind: 'user' } } } } });
  await settle();
  client.close();
  machine.made('m1');
  await settle();
  expect(notesOf(q).filter((note) => note.action.type === 'chat/draftChanged').map((note) => [note.origin?.clientId, note.origin?.clientSeq]))
    .toEqual([['probe', 4]]);
});

/*
 * A backend that throws as it is handed the turn ends the turn in an error in
 * its words, as VS Code's host ends a turn whose send throws.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2317-L2336
 */
it('ends a waiting turn the backend throws on in an error', async () => {
  const { p, client, said, machine } = await intoMachine(true);
  const chat = await mintedChat(client, 'ahp-session:/boxed');
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  void turn(client, chat, 'first');
  await settle();
  machine.made('m1');
  await settle();
  expect(said).toEqual(['1: begin first']);
  const ended = actions(p, chat).filter((note) => note.action.turnId === 't1');
  expect(ended.map((note) => [note.action.type, note.rejectionReason])).toEqual([
    ['chat/turnStarted', undefined],
    ['chat/error', undefined],
  ]);
  expect(ended[1]?.action.part).toMatchObject({ error: { errorType: 'sendFailed', message: 'the backend fell over' } });
});

/*
 * A dispatch waits on what the host must have before it can apply it for as
 * long as that takes, and the client's next dispatch waits behind it, as VS
 * Code's host queues a client's dispatches with no time limit.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L12492-L12507
 */
it('applies a dispatch that waited on a restart however long it took, and the next behind it', async () => {
  const { p, client, machine } = await intoMachine();
  const chat = await mintedChat(client, 'ahp-session:/boxed');
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  // The turn is the session's next turn boundary, where its relaunch into the
  // machine runs, and what the client sends after it waits for the relaunch.
  void turn(client, chat, 'first');
  await settle();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    void client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/draftChanged', draft: { text: 'go', origin: { kind: 'user' } } } } });
    void client.handle({ method: 'dispatchAction', params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { defaultShell: '/bin/sh' } } } });
    await vi.advanceTimersByTimeAsync(61_000);
  }
  finally { vi.useRealTimers(); }
  await settle();
  // The answers to the client's own two dispatches, which carry its origin.
  const notes = (): Note[] => p.notes.filter((n) => n.method === 'action').map((n) => n.params as Note)
    .filter((note) => note.origin !== undefined && (note.action.type === 'chat/draftChanged' || note.action.type === 'root/configChanged'));
  expect(notes()).toEqual([]);
  machine.made('m1');
  await settle();
  expect(notes().map((note) => [note.action.type, note.rejectionReason])).toEqual([
    ['chat/draftChanged', undefined],
    ['root/configChanged', undefined],
  ]);
});

it('answers a config change that waited on the catalogue however long it took', async () => {
  let listed: (rows: Listed[]) => void = () => {};
  const agent: Agent = { ...echo({ path: DIR, pace: 0 }), list: () => new Promise((resolve) => { listed = resolve; }) };
  const store = memorySessions();
  const host = createHost({ path: DIR, agents: [agent], sessions: store });
  const p = peer();
  const client = host.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    void change(client, 'echo:/nowhere', { voice: 'shouty' });
    await vi.advanceTimersByTimeAsync(61_000);
  }
  finally { vi.useRealTimers(); }
  await settle();
  expect(actions(p, 'echo:/nowhere')).toEqual([]);
  listed([]);
  await settle();
  expect(actions(p, 'echo:/nowhere').map((note) => note.rejectionReason)).toEqual(['No agent for session: echo:/nowhere']);
  expect(store.config('nowhere')).toBeUndefined();
});

/** A host whose machines are made when the test says, with a shell for terminals. */
const heldMachines = () => {
  const base = echo({ path: DIR, pace: 0 });
  const agent: Agent = {
    ...base,
    provider: 'fixed',
    displayName: 'Fixed backend',
    schema: (): Bag => ({ type: 'object', properties: { ...(base.schema().properties as Bag), ...(wire().properties as Bag) } }),
    defaults: () => ({ ...base.defaults(), fixed: 'one', mutable: 'a' }),
  };
  const machine = { made: (_id: string): void => {}, failed: (_error: Error): void => {} };
  const host = createHost({
    path: DIR,
    agents: [agent],
    terminals: shellTerminals(),
    sessionConfig: {
      computer: { type: 'string', title: 'Computer', description: 'Where it runs.', sessionMutable: false },
    },
    computers: {
      create: () => new Promise<string>((resolve, reject) => { machine.made = resolve; machine.failed = reject; }),
      how: async () => undefined,
    } as never,
  });
  return { host, machine };
};

/** A request's answer or its refusal, whichever came. */
const asked = async (client: { handle(r: { method: string; params: Record<string, unknown> }): Promise<unknown> }, method: string, params: Record<string, unknown>) =>
  client.handle({ method, params }).then((result) => ({ result }), (error: { code: number }) => error);

it('claims a new session\'s names while its machine is made, and lets them go when it fails', async () => {
  const { host, machine } = heldMachines();
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
  const first = asked(client, 'createSession', { channel: 'ahp-session:/boxed', provider: 'fixed', config: { computer: 'disposable:box' } });
  await settle();
  expect(await asked(client, 'createSession', { channel: 'x:/boxed', provider: 'fixed' })).toMatchObject({ code: -32003 });
  expect(await asked(client, 'createTerminal', { channel: 'ahp-session:/boxed', cwd: DIR })).toMatchObject({ code: -32003 });
  machine.made('m1');
  expect(await first).toHaveProperty('result');

  const failing = asked(client, 'createSession', { channel: 'ahp-session:/gone', provider: 'fixed', config: { computer: 'disposable:box' } });
  await settle();
  machine.failed(new Error('no machine'));
  expect(await failing).not.toHaveProperty('result');
  expect(await asked(client, 'createSession', { channel: 'x:/gone', provider: 'fixed' })).toHaveProperty('result');
});

it('keeps a session\'s chat names while the session starts again', async () => {
  const { host, machine } = heldMachines();
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/boxed', provider: 'fixed', config: { fixed: 'one', mutable: 'a' } } });
  expect(await asked(client, 'createChat', { channel: 'ahp-session:/boxed', chat: 'ahp-chat:/side' })).toHaveProperty('result');
  void change(client, 'ahp-session:/boxed', { computer: 'disposable:box' });
  await settle();
  // The session is being started again into its machine: its chats are gone
  // from the backend and not yet back, and their names are still its.
  expect(await asked(client, 'createTerminal', { channel: 'ahp-chat:/side', cwd: DIR })).toMatchObject({ code: -32003 });
  machine.made('m1');
  await settle();
  expect(await asked(client, 'createTerminal', { channel: 'ahp-chat:/side', cwd: DIR })).toMatchObject({ code: -32003 });
});
