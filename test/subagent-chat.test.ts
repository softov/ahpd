import { expect, it } from 'vitest';
import type { Agent, Listed, Start } from '../packages/sdk/src/types/agent.js';
import type { Bag } from '../packages/sdk/src/types/common.js';
import type { Session } from '../packages/sdk/src/types/session.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';
import { checker } from '../tools/wire.mjs';

/*
 * The host's worker-chat seam, driven by a backend that has no harness.
 *
 * A subagent is a conversation inside one tool call of another chat, and the
 * protocol gives it a home: a read-only chat whose origin is that call and a
 * `subagent` content on the call that names it. The backend can see the call
 * and what the harness said about it; the host is the only thing that knows
 * what a chat URI looks like, what a catalogue row says and which turn a part
 * belongs to. This is the seam between them, without the Claude SDK in the
 * way - and the three actions it produces are checked against the protocol's
 * own declarations, because a shape this host invents is one a client drops.
 */

const { createHost } = await import('../packages/sdk/src/host.js');

/** Every frame the host put on the wire, in order. */
const wire: { method: string; params: Record<string, unknown> }[] = [];

function peer(): Peer {
  return {
    send: () => {},
    notify: (method, params) => { wire.push({ method, params: params as Record<string, unknown> }); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Every action dispatched on one channel, in order. */
const on = (channel: string): Bag[] => wire
  .filter((one) => one.method === 'action' && one.params.channel === channel)
  .map((one) => one.params.action as Bag);

/**
 * A backend whose turn spawns a worker and writes one part into it.
 *
 * The smallest thing that exercises every half of the seam: the call is opened
 * on the lead chat first, so the link has something to be appended to.
 */
function spawning(): Agent {
  const agent: Agent = {
    provider: 'fake',
    displayName: 'Fake',
    schema: () => ({ type: 'object', properties: {} }),
    defaults: () => ({}),
    list: async (): Promise<Listed[]> => [],
    create: (start: Start): Session => {
      let title = 'Fake session';
      const turns: Bag[] = [];
      let active: Bag | undefined;
      const chat: Session = {
        uri: start.uri,
        chatUri: start.chatUri,
        models: () => [],
        agentId: () => start.uri,
        customizations: () => [],
        allTurns: () => turns,
        activity: () => (active ? 'Thinking' : undefined),
        status: () => (active ? 8 : 1),
        title: () => title,
        modifiedAt: () => new Date().toISOString(),
        workingDirectories: () => ['file:///tmp'],
        settings: () => ({}),
        sessionState: () => ({
          resource: start.uri, provider: 'fake', title, status: active ? 8 : 1, lifecycle: 'ready',
          defaultChat: start.chatUri, chats: [{ resource: start.chatUri, title }], workingDirectories: ['file:///tmp'],
          customizations: [], config: { schema: start.schema(), values: {} },
        }),
        chatState: () => ({
          resource: start.chatUri, title, status: active ? 8 : 1, modifiedAt: new Date().toISOString(),
          turns, ...(active ? { activeTurn: active } : {}), queuedMessages: [], interactivity: 'full',
        }),
        begin: (turnId, text) => {
          active = { id: turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } }, responseParts: [], usage: undefined };
          start.emit('chat', { type: 'chat/turnStarted', turnId, startedAt: active.startedAt, message: active.message });
          /*
           * The spawning call, opened before the worker exists - which is the
           * ordinary order, because the assistant frame that names the call
           * arrives before any of the worker's frames do.
           */
          start.emit('chat', { type: 'chat/toolCallStart', turnId, toolCallId: 'toolu_task', toolName: 'Task', displayName: 'Task' });
          start.emit('chat', {
            type: 'chat/toolCallReady', turnId, toolCallId: 'toolu_task',
            invocationMessage: 'Task', confirmed: 'not-needed',
          });
          const worker = start.subagent?.('toolu_task', {
            title: 'Explore',
            agentName: 'Explore',
            description: 'List files',
            prompt: 'list the files',
          });
          if (!worker) return;
          worker.emit({
            type: 'chat/responsePart', turnId: worker.turnId,
            part: { id: 'w1', kind: 'markdown', content: 'working' },
          });
          // A second ask for the same call is the same chat, not a second one.
          start.subagent?.('toolu_task', { title: 'Explore', prompt: 'list the files' });
          // A worker spawned from inside that worker's call.
          const inner = start.subagent?.('toolu_inner', {
            title: 'Inner', prompt: 'go deeper', parentToolCallId: 'toolu_task',
          });
          inner?.end('complete');
          worker.end('complete');
          active = undefined;
          turns.push({ id: turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } }, responseParts: [], state: 'complete', duration: 1, usage: undefined });
          start.emit('chat', { type: 'chat/turnComplete', turnId, duration: 1 });
        },
        cancel: () => {},
        queue: () => {},
        unqueue: () => {},
        setDraft: () => {},
        reorder: () => {},
        confirm: () => {},
        answer: () => {},
        setCustomizationEnabled: async () => false,
        startMcpServer: async () => false,
        stopMcpServer: async () => false,
        close: () => {},
      };
      return chat;
    },
  };
  return agent;
}

const asking = (client: { handle(r: { method: string; params: unknown }): Promise<unknown> }) =>
  async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => await client.handle({ method, params });

async function running() {
  wire.length = 0;
  const host = createHost({ path: '/tmp', agents: [spawning()] });
  const client = host.accept(peer());
  const ask = asking(client);
  await ask('initialize', {
    channel: 'ahp-root://', clientId: 'sub', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'],
  });
  const uri = 'ahp-session:/sub';
  const chatUri = 'ahp-chat:/sub';
  await ask('createSession', { channel: uri, provider: 'fake' });
  await ask('subscribe', { channel: uri });
  await ask('subscribe', { channel: chatUri });
  await settle();
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'spawn one' } } },
  });
  await settle();
  const worker = `ahp-chat://subagent/${Buffer.from(uri, 'utf8').toString('base64url')}/${encodeURIComponent('toolu_task')}`;
  const inner = `ahp-chat://subagent/${Buffer.from(uri, 'utf8').toString('base64url')}/${encodeURIComponent('toolu_inner')}`;
  return { ask, client, uri, chatUri, worker, inner };
}

it('announces a worker chat, opens its turn and links it from the call', async () => {
  const { ask, uri, worker } = await running();

  const added = on(uri).filter((one) => one.type === 'session/chatAdded');
  expect(added).toHaveLength(2); // the worker, and the worker inside it
  const workerRow = added.find((one) => (one.summary as Bag).resource === worker);
  expect(workerRow).toBeDefined();
  const summary = workerRow?.summary as Bag;
  const lead = `ahp-chat://default/${Buffer.from(uri, 'utf8').toString('base64url')}`;
  expect(summary).toMatchObject({
    title: 'Explore',
    interactivity: 'read-only',
    origin: { kind: 'tool', chat: lead, toolCallId: 'toolu_task' },
  });

  // Its turn opened with the prompt the parent gave it, which a subscriber
  // reads from the chat's own state.
  const answer = await ask('subscribe', { channel: worker }) as { snapshot: { state: Bag } };
  const turns = (answer.snapshot.state.turns as Bag[]) ?? [];
  expect(turns).toHaveLength(1);
  expect(turns[0]?.message).toMatchObject({ text: 'list the files' });

  const linked = wire
    .filter((one) => one.method === 'action' && (one.params.action as Bag | undefined)?.type === 'chat/toolCallContentChanged')
    .map((one) => one.params.action as Bag);
  expect(linked).toHaveLength(1);
  const content = linked[0]?.content as Bag[];
  expect(content).toHaveLength(1);
  expect(content[0]).toMatchObject({ type: 'subagent', resource: worker, title: 'Explore', agentName: 'Explore', description: 'List files' });
});

it('answers a subscribe to the worker with its own state, and refuses a turn on it', async () => {
  const { ask, client, worker } = await running();

  const answer = await ask('subscribe', { channel: worker }) as { snapshot: { resource: string; state: Bag } };
  expect(answer.snapshot.resource).toBe(worker);
  const parts = (answer.snapshot.state.turns as Bag[]) ?? [];
  const active = answer.snapshot.state.activeTurn as Bag | undefined;
  const drawn = active !== undefined ? active.responseParts as Bag[] : (parts.at(-1)?.responseParts as Bag[] ?? []);
  expect(drawn.some((one) => one.id === 'w1')).toBe(true);
  expect(answer.snapshot.state).toMatchObject({ interactivity: 'read-only' });

  void client.handle({
    method: 'dispatchAction',
    params: { channel: worker, action: { type: 'chat/turnStarted', turnId: 'nope', message: { text: 'hello' } } },
  });
  await settle();
  const refused = wire.filter((one) => one.method === 'action' && one.params.channel === worker
    && typeof one.params.rejectionReason === 'string');
  expect(refused).toHaveLength(1);
  expect(String(refused[0]?.params.rejectionReason)).toContain('read-only');
});

it('names the worker chat that spawned a nested one as its parent', async () => {
  const { uri, worker, inner } = await running();
  const added = on(uri).filter((one) => one.type === 'session/chatAdded');
  const innerRow = added.find((one) => (one.summary as Bag).resource === inner);
  expect((innerRow?.summary as Bag).origin).toEqual({ kind: 'tool', chat: worker, toolCallId: 'toolu_inner' });
});

it('removes the worker chats when the session is disposed', async () => {
  const { ask, uri } = await running();
  await ask('disposeSession', { channel: uri });
  await settle();
  const removed = on(uri).filter((one) => one.type === 'session/chatRemoved');
  expect(removed.length).toBe(2);
});

it('sends nothing the protocol does not declare', async () => {
  await running();
  const check = checker();
  const defects = wire.flatMap((frame) => check.frame(frame));
  expect(defects.map((one) => `${one.def} ${one.at} ${one.what}`)).toEqual([]);
});
