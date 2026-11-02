import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { textOf } from '@cofold/agents';
import { createFakeModel } from '@cofold/agents/testing';
import { createFileStore } from '@cofold/store-file';
import type { ModelAdapter, ModelReply, ModelStreamEvent } from '@cofold/agents';
import { Status } from '../../sdk/src/sessions/catalog.js';
import { idOf } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';
import { shellTerminals } from '../../sdk/src/machines/terminals.js';
import { chatReducer } from '@microsoft/agent-host-protocol';
import type { ChatAction, ChatState } from '@microsoft/agent-host-protocol';
import { cofoldAgent, cofoldTools, sessionIdOf } from '../src/index.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { BoundTool } from '../../sdk/src/types/agent.js';
import type { HostTool } from '../../sdk/src/types/host.js';
import { fakePty } from '../../sdk/test/support/pty.js';
import { callsIn, openedFrom, replayed } from '../../sdk/test/support/replay.js';
import { undeclaredIn } from '../../sdk/test/support/wire.js';

/*
 * One cofold turn, as a client drives it.
 *
 * No network and no real model: the adapter is a script, the store is in
 * memory, and the host is the same `createHost` the daemon uses. What this
 * checks is that a cofold `RunEvent` reaches the client as the `chat/*`
 * action it means, in the order AHP requires, and that the two actions a
 * client sends back - cancel and a host tool's call - reach cofold.
 */

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

/** Let the run's zero-delay work finish, up to a point; no wall-clock waiting on a real model. */
const until = async (check: () => boolean, times = 400): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 0); });
  }
  throw new Error(`still waiting after ${times} tries`);
};

type Note = { channel: string; action: Record<string, unknown> };

const actions = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

const types = (p: ReturnType<typeof peer>, channel: string): string[] =>
  actions(p, channel).map((e) => String(e.action.type));

/** A connected client with one cofold session, watching both its channels. */
async function talking(
  model: ModelAdapter,
  tools: HostTool[] = [],
  extra: Parameters<typeof cofoldAgent>[0] = {},
) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-cofold-'));
  const agent = cofoldAgent({ adapter: model, memory: true, ...extra });
  const host = createHost({
    path,
    agents: [agent],
    ...(tools.length > 0 ? { tools } : {}),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/one';
  const chatUri = 'ahp-chat:/one';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'cofold' } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { host, client, peer: p, uri, chatUri, agent };
}

/** The action a turn began with, dispatched the way a client dispatches it. */
const begin = (client: Awaited<ReturnType<typeof talking>>['client'], chatUri: string, turnId: string, text: string): void => {
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text } } },
  });
};

const ended = (p: ReturnType<typeof peer>, chatUri: string): boolean =>
  types(p, chatUri).some((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled');

it('turns text into turnStarted, an opened part, deltas and turnComplete, in that order', async () => {
  const model = createFakeModel({ script: [{ text: 'hello there' }], stream: true });
  const { client, peer: p, chatUri } = await talking(model);
  begin(client, chatUri, 't1', 'hi');
  await until(() => ended(p, chatUri));

  const order = types(p, chatUri).filter((type) => type === 'chat/turnStarted'
    || type === 'chat/responsePart'
    || type === 'chat/delta');
  expect(order.slice(0, 3)).toEqual(['chat/turnStarted', 'chat/responsePart', 'chat/delta']);
  expect(types(p, chatUri)).toContain('chat/turnComplete');
  expect(types(p, chatUri).at(-1)).toBe('chat/turnComplete');

  const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: { content: string }[] }[] } };
  };
  expect(opened.snapshot.state.turns).toHaveLength(1);
  expect(opened.snapshot.state.turns[0]?.responseParts[0]?.content).toBe('hello there');
});

it('keeps the origin a client sent with the message, on the wire and in the catalogue', async () => {
  /*
   * `Message.origin` is required by the protocol and a client may only send
   * `MessageKind.User`, and a client keys its own rendering off it: a turn that
   * comes back without one draws the person's words as a system line rather
   * than as their message. It went missing at the SDK boundary, which forwarded
   * `message.text` and `message.model` and dropped the rest, and cofold writes
   * `origin` only from the `from` it is handed.
   */
  const model = createFakeModel({ script: [{ text: 'ok' }], stream: true });
  const { client, peer: p, chatUri } = await talking(model);
  const sent = { text: 'who am i', origin: { kind: 'user' }, _meta: { probe: 'origin' } };
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: sent } },
  });
  await until(() => ended(p, chatUri));

  const started = actions(p, chatUri).find((e) => e.action.type === 'chat/turnStarted');
  expect(started?.action.message).toMatchObject(sent);

  const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { message: unknown }[] } };
  };
  expect(opened.snapshot.state.turns[0]?.message).toMatchObject(sent);
});

it('carries the model a turn runs on, on the message', async () => {
  const model = createFakeModel({ script: [{ text: 'ok' }], stream: true });
  const { client, peer: p, chatUri } = await talking(model);
  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi', model: { id: 'open_router/x' } } },
    },
  });
  await until(() => ended(p, chatUri));

  const started = actions(p, chatUri).find((e) => e.action.type === 'chat/turnStarted');
  expect((started?.action.message as { model?: { id?: string } }).model?.id).toBe('open_router/x');
});

it('carries the configured model when the turn names none', async () => {
  const model = createFakeModel({ script: [{ text: 'ok' }], stream: true });
  const { client, peer: p, chatUri } = await talking(model, [], { model: 'open_router/y' });
  begin(client, chatUri, 't1', 'hi');
  await until(() => ended(p, chatUri));

  const started = actions(p, chatUri).find((e) => e.action.type === 'chat/turnStarted');
  expect((started?.action.message as { model?: { id?: string } }).model?.id).toBe('open_router/y');
});

it('runs a turn on the model the turn names, with no model in the session config', async () => {
  /*
   * The session schema has no `model`, so a new session's config carries none.
   * The choice a picker sends arrives on the message, and the turn has to run
   * on it: the endpoint, the key and the model id all come from that reference.
   */
  const home = mkdtempSync(join(tmpdir(), 'ahpd-cofold-turn-model-'));
  const was = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  mkdirSync(join(home, 'cofold'), { recursive: true });
  writeFileSync(join(home, 'cofold', 'config.json'), JSON.stringify({
    providers: [
      { id: 'open_router', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k-open' },
      { id: 'moonshot', baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'k-moon' },
    ],
  }));
  const real = globalThis.fetch;
  let listed = 0;
  const sent: { url: string; body: Record<string, unknown>; authorization: unknown }[] = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: string; headers?: Record<string, string> }) => {
    const url = String(input);
    if (url.endsWith('/models')) {
      listed += 1;
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    sent.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown>, authorization: init?.headers?.authorization });
    return new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  try {
    const host = createHost({ path: mkdtempSync(join(tmpdir(), 'ahpd-cofold-turn-picked-')), agents: [cofoldAgent({ memory: true })] });
    const p = peer();
    const client = host.accept(p);
    await client.handle({
      method: 'initialize',
      params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
    });
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/picked', provider: 'cofold' } });
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/picked' } });
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: 'ahp-chat:/picked',
        action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi', model: { id: 'moonshot/moonshotai/kimi-k3.1-pro' } } },
      },
    });
    await until(() => ended(p, 'ahp-chat:/picked'));
    expect(sent.at(-1)?.url).toBe('https://api.moonshot.ai/v1/chat/completions');
    expect(sent.at(-1)?.body.model).toBe('moonshotai/kimi-k3.1-pro');
    expect(sent.at(-1)?.authorization).toBe('Bearer k-moon');
    await until(() => listed >= 2);
  }
  finally {
    globalThis.fetch = real;
    if (was === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = was;
  }
});

it('keeps a delta a plain action and starts no second turn from it', async () => {
  const model = createFakeModel({ script: [{ text: 'one two' }], stream: true });
  const { client, peer: p, chatUri } = await talking(model);
  begin(client, chatUri, 't1', 'hi');
  await until(() => ended(p, chatUri));

  const deltas = actions(p, chatUri).filter((e) => e.action.type === 'chat/delta');
  expect(deltas.length).toBeGreaterThan(0);
  for (const one of deltas) {
    // The cofold event and its seq are not on the wire; the action is AHP's.
    expect(Object.keys(one.action).sort()).toEqual(['content', 'partId', 'turnId', 'type']);
  }
  expect(types(p, chatUri).filter((type) => type === 'chat/turnStarted')).toHaveLength(1);
});

it('sends a reasoning delta as chat/reasoning and not as response text', async () => {
  const model = createFakeModel({ script: [{ text: 'the answer', reasoning: 'weighing it up' }], stream: true });
  const { client, peer: p, chatUri } = await talking(model);
  begin(client, chatUri, 't1', 'hi');
  await until(() => ended(p, chatUri));

  const reasoning = actions(p, chatUri).filter((e) => e.action.type === 'chat/reasoning');
  expect(reasoning.map((e) => String(e.action.content))).toContain('weighing it up');
  const prose = actions(p, chatUri).filter((e) => e.action.type === 'chat/delta');
  expect(prose.map((e) => String(e.action.content)).join('')).toBe('the answer');
  expect(prose.map((e) => String(e.action.content)).join('')).not.toContain('weighing it up');
});

it('opens the thinking part once, so a client folds one block however many deltas arrive', async () => {
  /*
   * A thinking model that streams in three pieces. `createFakeModel` yields its
   * reasoning as one delta, and the bug this covers needs more than one: each
   * delta used to announce the part again, and a client appends on that.
   */
  let ids = 0;
  const message = (): ModelReply['message'] => ({
    id: `m${++ids}`,
    role: 'assistant',
    source: 'model',
    createdAt: new Date().toISOString(),
    parts: [
      { type: 'reasoning', text: 'weighing it up' },
      { type: 'text', text: 'the answer' },
    ],
  });
  const thinker: ModelAdapter = {
    id: 'thinker',
    modelId: 'thinker',
    features: { tools: true, streaming: true, images: false, structuredOutput: false, reasoning: true },
    complete: async () => ({ message: message(), usage: { inputTokens: 1, outputTokens: 1 }, finish: 'stop' }),
    stream: async function* (): AsyncIterable<ModelStreamEvent> {
      yield { type: 'reasoning.delta', text: 'weighing ' };
      yield { type: 'reasoning.delta', text: 'it ' };
      yield { type: 'reasoning.delta', text: 'up' };
      yield { type: 'text.delta', text: 'the answer' };
      yield { type: 'done', reply: { message: message(), usage: { inputTokens: 1, outputTokens: 1 }, finish: 'stop' } };
    },
  };
  const { client, peer: p, chatUri } = await talking(thinker);
  begin(client, chatUri, 't1', 'hi');
  await until(() => ended(p, chatUri));

  // One announcement, not one per delta: `chat/responsePart` *appends*.
  const announcements = actions(p, chatUri).filter((e) => e.action.type === 'chat/responsePart'
    && (e.action.part as { kind?: string } | undefined)?.kind === 'reasoning');
  expect(announcements).toHaveLength(1);
  // And it is empty: the deltas after it are what fill it, so a client that
  // applies both does not read the first piece twice.
  expect((announcements[0]?.action.part as { content?: string }).content).toBe('');

  /*
   * The client's own fold, which is what the screen is drawn from. Before this
   * was fixed the transcript drew one thinking block per delta while the
   * snapshot - built by the host from the transcript - had one.
   */
  let state = { turns: [], status: 0, modifiedAt: 'now' } as unknown as ChatState;
  for (const one of actions(p, chatUri)) {
    // The notes hold whatever the host dispatched, so the fold gets the
    // protocol's action union spelled out where it is handed over.
    state = chatReducer(state, one.action as unknown as ChatAction);
  }
  const parts = state.turns.flatMap((turn) => turn.responseParts)
    .filter((part) => part.kind === 'reasoning');
  expect(parts).toHaveLength(1);
  expect((parts[0] as { content: string }).content).toBe('weighing it up');
  // The markdown part is announced the same way: once, empty, and filled by its deltas.
  const prose = state.turns.flatMap((turn) => turn.responseParts)
    .filter((part) => part.kind === 'markdown');
  expect(prose).toHaveLength(1);
  expect((prose[0] as { content: string }).content).toBe('the answer');
});

it('reports a host tool call as three actions and gives its result back to the model', async () => {
  const model = createFakeModel({
    script: [
      { toolCalls: [{ name: 'lookup', input: { query: 'x' } }] },
      { text: 'done' },
    ],
    stream: true,
  });
  const tool: HostTool = {
    definition: {
      name: 'lookup',
      title: 'Look something up',
      description: 'Looks a word up.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    run: (input) => `found ${String(input.query)}`,
  };
  const { client, peer: p, chatUri } = await talking(model, [tool]);
  begin(client, chatUri, 't1', 'find x');
  await until(() => ended(p, chatUri));

  const calls = types(p, chatUri).filter((type) => type.startsWith('chat/toolCall'));
  expect(calls).toEqual(['chat/toolCallStart', 'chat/toolCallReady', 'chat/toolCallComplete']);
  const done = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete');
  expect(done?.action.toolCallId).toBeTruthy();
  expect(done?.action.result).toMatchObject({ success: true });
  expect((done?.action.result as { content: { text: string }[] }).content[0]?.text).toBe('found x');

  // The tool's return value is what the second model step was given back.
  const second = model.requests[1];
  expect(second).toBeDefined();
  expect(JSON.stringify(second?.messages)).toContain('found x');
});

it('keeps two turns in one cofold session and finishes both', async () => {
  const model = createFakeModel({ script: [{ text: 'noted' }, { text: 'again' }], stream: true });
  const { client, peer: p, chatUri } = await talking(model);
  begin(client, chatUri, 't1', 'remember the number 41');
  await until(() => ended(p, chatUri));
  begin(client, chatUri, 't2', 'what came before');
  await until(() => types(p, chatUri).filter((type) => type === 'chat/turnComplete').length === 2);

  expect(types(p, chatUri).filter((type) => type === 'chat/turnStarted')).toHaveLength(2);
  expect(types(p, chatUri).filter((type) => type === 'chat/turnComplete')).toHaveLength(2);
  // The second turn's history carries the first, so both ran on one
  // conversation rather than each starting over.
  expect(JSON.stringify(model.requests[1]?.messages)).toContain('remember the number 41');
});

/** A model that streams one delta and then waits, so a cancel lands mid-turn. */
function heldModel(): ModelAdapter {
  let ids = 0;
  const reply = (text: string): ModelReply => ({
    message: {
      id: `m${++ids}`,
      role: 'assistant',
      source: 'model',
      createdAt: new Date().toISOString(),
      parts: [{ type: 'text', text }],
    },
    usage: { inputTokens: 1, outputTokens: 1 },
    finish: 'stop',
  });
  const held: ModelAdapter = {
    id: 'held',
    modelId: 'held',
    features: { tools: true, streaming: true, images: false, structuredOutput: false, reasoning: false },
    complete: async () => reply('complete'),
    stream: async function* (request): AsyncIterable<ModelStreamEvent> {
      yield { type: 'text.delta', text: 'waiting' };
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) { resolve(); return; }
        request.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      if (request.signal.aborted) return;
      yield { type: 'done', reply: reply('finished') };
    },
  };
  return held;
}

it('ends the running turn on a cancel that names no turn', async () => {
  const { client, peer: p, chatUri } = await talking(heldModel());
  begin(client, chatUri, 't1', 'hi');
  await until(() => types(p, chatUri).includes('chat/delta'));

  // A client with no id to give means the running turn, and the host hands
  // this backend that turn's own id.
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: '', duration: 0 } },
  });
  await until(() => types(p, chatUri).includes('chat/turnCancelled'));

  const said = types(p, chatUri);
  expect(said.filter((type) => type === 'chat/turnCancelled')).toHaveLength(1);
  expect(said.at(-1)).toBe('chat/turnCancelled');
});

it('ends a cancelled turn as turnCancelled, once', async () => {
  const { client, peer: p, chatUri } = await talking(heldModel());
  begin(client, chatUri, 't1', 'hi');
  await until(() => types(p, chatUri).includes('chat/delta'));

  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  await until(() => types(p, chatUri).includes('chat/turnCancelled'));

  const said = types(p, chatUri);
  expect(said.filter((type) => type === 'chat/turnCancelled')).toHaveLength(1);
  expect(said).not.toContain('chat/turnComplete');
  expect(said.at(-1)).toBe('chat/turnCancelled');
});

/** The envelope that answers the dispatch this client numbered `clientSeq`. */
const answer = (p: ReturnType<typeof peer>, chatUri: string, clientSeq: number) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note & { origin?: { clientId?: string; clientSeq?: number }; rejectionReason?: string })
  .find((e) => e.channel === chatUri && e.origin?.clientId === 'probe' && e.origin.clientSeq === clientSeq);

/** The chat as a client's reducer folds what the host said on it. */
const fold = (p: ReturnType<typeof peer>, chatUri: string): ChatState => actions(p, chatUri)
  .reduce((state, one) => chatReducer(state, one.action as unknown as ChatAction), { turns: [], status: 0, modifiedAt: 'now' } as unknown as ChatState);

/** A steering message, dispatched the way a client dispatches it, under the number the client gave it. */
const steer = (client: Awaited<ReturnType<typeof talking>>['client'], chatUri: string, clientSeq: number, id: string, text: string): void => {
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, clientSeq, action: { type: 'chat/pendingMessageSet', kind: 'steering', id, message: { text } } },
  });
};

it('answers a steering message with its own action, holds it, and takes it out once the run has read it', async () => {
  const waiting: (() => void)[] = [];
  const tool: HostTool = {
    definition: {
      name: 'lookup',
      title: 'Look something up',
      description: 'Looks a word up.',
      inputSchema: { type: 'object', properties: {} },
    },
    run: () => new Promise<string>((resolve) => { waiting.push(() => resolve('found x')); }),
  };
  const model = createFakeModel({
    script: [{ toolCalls: [{ name: 'lookup', input: {} }] }, { text: 'done' }],
    stream: true,
  });
  const { client, peer: p, chatUri } = await talking(model, [tool]);
  begin(client, chatUri, 't1', 'find x');
  await until(() => waiting.length === 1);

  steer(client, chatUri, 9, 's1', 'look for y instead');
  await until(() => answer(p, chatUri, 9) !== undefined);
  // The client's own action is what answers it, and every client's fold holds
  // the message while the run has not read it.
  expect(answer(p, chatUri, 9)?.action).toMatchObject({ type: 'chat/pendingMessageSet', kind: 'steering', id: 's1' });
  expect(answer(p, chatUri, 9)?.rejectionReason).toBeUndefined();
  expect(fold(p, chatUri).steeringMessage).toMatchObject({ id: 's1', message: { text: 'look for y instead' } });

  waiting[0]?.();
  await until(() => ended(p, chatUri));
  // The next step read it, and it was taken out once it had.
  expect(JSON.stringify(model.requests[1]?.messages)).toContain('look for y instead');
  expect(actions(p, chatUri).filter((e) => e.action.type === 'chat/pendingMessageRemoved').map((e) => e.action))
    .toEqual([{ type: 'chat/pendingMessageRemoved', kind: 'steering', id: 's1' }]);
  expect(fold(p, chatUri).steeringMessage).toBeUndefined();
  expect(types(p, chatUri).filter((type) => type === 'chat/turnStarted')).toHaveLength(1);
});

/**
 * A model whose first answer is held until `release`, and whose later answers
 * come at once. A steering message sent while the first answer is held reaches
 * a run that has no step left to read it.
 */
function gatedModel(): { model: ModelAdapter; release: () => void; asked: string[] } {
  let ids = 0;
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const asked: string[] = [];
  const reply = (text: string): ModelReply => ({
    message: {
      id: `m${++ids}`,
      role: 'assistant',
      source: 'model',
      createdAt: new Date().toISOString(),
      parts: [{ type: 'text', text }],
    },
    usage: { inputTokens: 1, outputTokens: 1 },
    finish: 'stop',
  });
  const model: ModelAdapter = {
    id: 'gated',
    modelId: 'gated',
    features: { tools: true, streaming: true, images: false, structuredOutput: false, reasoning: false },
    complete: async () => reply('complete'),
    stream: async function* (request): AsyncIterable<ModelStreamEvent> {
      asked.push(JSON.stringify(request.messages));
      if (asked.length === 1) {
        yield { type: 'text.delta', text: 'working' };
        await gate;
      }
      yield { type: 'done', reply: reply(`answer ${asked.length}`) };
    },
  };
  return { model, release, asked };
}

it('runs a steering message the run never took in as a turn of its own, named by the message', async () => {
  const { model, release, asked } = gatedModel();
  const { client, peer: p, chatUri } = await talking(model);
  begin(client, chatUri, 't1', 'first');
  await until(() => types(p, chatUri).includes('chat/delta'));

  steer(client, chatUri, 4, 's1', 'one more thing');
  await until(() => answer(p, chatUri, 4) !== undefined);
  release();
  await until(() => types(p, chatUri).filter((type) => type === 'chat/turnComplete').length === 2);

  // The message became the next turn's prompt, and that turn names it, which
  // is what takes it out of every client's fold.
  const started = actions(p, chatUri).filter((e) => e.action.type === 'chat/turnStarted').map((e) => e.action);
  expect(started).toHaveLength(2);
  expect(started[1]).toMatchObject({ queuedMessageId: 's1', message: { text: 'one more thing' } });
  expect(asked[1]).toContain('one more thing');
  expect(fold(p, chatUri).steeringMessage).toBeUndefined();
});

it('names the cofold session id from the AHP URI in one place', () => {
  expect(sessionIdOf('ahp-session:/one')).toBe('one');
  expect(sessionIdOf('ahp-session:/a/b')).toBe('a/b');
});

it('says what a step said even when the adapter did not stream it', async () => {
  // No `model.delta` at all: the whole reply arrives with `model.completed`,
  // and without the fallback this turn would finish having said nothing.
  const model = createFakeModel({ script: [{ text: 'not streamed', reasoning: 'thought it' }], stream: false });
  const { client, peer: p, chatUri } = await talking(model);
  begin(client, chatUri, 't1', 'hi');
  await until(() => ended(p, chatUri));

  const prose = actions(p, chatUri)
    .filter((e) => e.action.type === 'chat/delta')
    .map((e) => String(e.action.content))
    .join('');
  expect(prose).toBe('not streamed');
  const reasoning = actions(p, chatUri)
    .filter((e) => e.action.type === 'chat/reasoning')
    .map((e) => String(e.action.content))
    .join('');
  expect(reasoning).toBe('thought it');

  const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: { content?: string }[] }[] } };
  };
  // In the order the reply holds them, as the transcript reads it back.
  expect(opened.snapshot.state.turns[0]?.responseParts.map((part) => part.content)).toEqual(['thought it', 'not streamed']);
});

it('does not offer a tool a client runs, because nothing here can answer it', () => {
  const definition: BoundTool['definition'] = { name: 'lookup', description: 'Looks a word up.', inputSchema: { type: 'object', properties: {} } };
  const mine: BoundTool = { definition, run: () => 'mine' };
  const theirs: BoundTool = { definition: { ...definition, name: 'theirs' }, owner: 'client-1' };
  expect(cofoldTools([mine, theirs]).map((one) => one.name)).toEqual(['lookup']);
});

it('offers a tool whose schema carries $comment, without the comments', () => {
  const inputSchema = {
    type: 'object',
    $comment: 'top',
    properties: {
      word: { type: 'string', $comment: 'nested' },
      list: { type: 'array', items: { type: 'string', $comment: 'item' } },
      $comment: { type: 'string' },
    },
  } as unknown as NonNullable<BoundTool['definition']['inputSchema']>;
  const [tool] = cofoldTools([{ definition: { name: 'lookup', description: 'Looks a word up.', inputSchema }, run: () => 'ok' }]);
  expect(tool?.toModelDefinition().input).toEqual({
    type: 'object',
    properties: {
      word: { type: 'string' },
      list: { type: 'array', items: { type: 'string' } },
      $comment: { type: 'string' },
    },
  });
});

it('leaves out a tool whose schema cofold refuses, and offers the rest', () => {
  const plain: BoundTool = { definition: { name: 'plain', description: 'Plain.', inputSchema: { type: 'object', properties: {} } }, run: () => 'ok' };
  const refused: BoundTool = {
    definition: { name: 'refused', description: 'Uses $ref.', inputSchema: { type: 'object', $ref: '#/x' } as unknown as NonNullable<BoundTool['definition']['inputSchema']> },
    run: () => 'ok',
  };
  expect(cofoldTools([refused, plain]).map((one) => one.name)).toEqual(['plain']);
});

it('runs a !command in a shell rather than asking a model', async () => {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-cofold-bang-'));
  const host = createHost({
    path,
    agents: [cofoldAgent({ adapter: createFakeModel({ script: [{ text: 'never asked' }], stream: true }), memory: true })],
    terminals: shellTerminals(),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/bang';
  const chatUri = 'ahp-chat:/bang';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'cofold' } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });

  begin(client, chatUri, 't1', '!echo cofold-ran-it');
  // A real shell, which can take seconds to start on Windows.
  await until(() => ended(p, chatUri), 4000);

  // The host's shell, not the model: one tool call named `terminal`, completed
  // with what the shell printed. Before `ran` existed here this turn was handed
  // to cofold as the prompt `!echo cofold-ran-it`.
  const start = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallStart');
  expect(start?.action).toMatchObject({ toolName: 'terminal' });
  // The command as typed, not the JSON-quoted string, so the terminal row shows
  // the command a person would run.
  const ready = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallReady');
  expect(ready?.action.toolInput).toBe('echo cofold-ran-it');
  const completed = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete');
  expect((completed?.action.result as { success: boolean }).success).toBe(true);
  expect(JSON.stringify(completed?.action.result)).toContain('cofold-ran-it');

  // And in the snapshot, not only in the stream, with the call finished rather
  // than left `streaming` for a client that subscribed afterwards.
  const kept = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: { kind?: string; toolCall?: { toolName: string; status: string } }[] }[] } };
  }).snapshot.state.turns;
  expect(kept.at(-1)?.responseParts[0]?.kind).toBe('toolCall');
  expect(kept.at(-1)?.responseParts[0]?.toolCall?.toolName).toBe('terminal');
  expect(kept.at(-1)?.responseParts[0]?.toolCall?.status).toBe('completed');
});

/*
 * The reference host's own `!` command: a `terminal` call whose content names
 * the terminal as soon as it opens.
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L65-L117
 */
it('names a !command\'s terminal while it runs, and holds the call a watching client holds', async () => {
  const pty = fakePty();
  const host = createHost({
    path: mkdtempSync(join(tmpdir(), 'ahpd-cofold-bang-')),
    agents: [cofoldAgent({ adapter: createFakeModel({ script: [{ text: 'never asked' }], stream: true }), memory: true })],
    terminals: shellTerminals({ pty: pty.spawn }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/bang';
  const chatUri = 'ahp-chat:/bang';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'cofold' } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  const opened = openedFrom(await client.handle({ method: 'subscribe', params: { channel: chatUri } }));
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: '!make preview', origin: { kind: 'user' } } } },
  });
  const changed = (): Note['action'] | undefined => actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallContentChanged')?.action;
  await until(() => changed() !== undefined);

  // The command as the call's intention and its line, as the reference starts its own.
  expect(actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallStart')?.action.intention).toBe('make preview');
  expect(actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallReady')?.action)
    .toMatchObject({ invocationMessage: 'make preview', toolInput: 'make preview', confirmed: 'not-needed' });
  const named = { type: 'terminal', resource: expect.stringMatching(/^ahp-terminal:/), title: 'Terminal', isPty: true };
  expect(changed()?.content).toEqual([named]);
  expect(changed()).not.toHaveProperty('_meta');
  // A client that subscribes while the command runs reads the running call a
  // watching client holds, not one still being written.
  const during = openedFrom(await client.handle({ method: 'subscribe', params: { channel: chatUri } }));
  expect(callsIn(during.state)).toEqual(callsIn(replayed(opened, p.notes, chatUri)));

  pty.say('built\r\n');
  pty.exit(0);
  await until(() => ended(p, chatUri));
  const done = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete');
  expect((done?.action.result as { content: unknown[] }).content).toEqual([
    { ...named, result: { exitCode: 0, preview: 'built\r\n' } },
    { type: 'text', text: 'built\r\n' },
  ]);
  const late = await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  expect(callsIn(openedFrom(late).state)).toEqual(callsIn(replayed(opened, p.notes, chatUri)));
  expect(undeclaredIn([...p.notes, { asked: 'subscribe', params: { channel: chatUri }, result: late }])).toEqual([]);
});

it('fails the turn, and not the daemon, when there is no model to run on', async () => {
  // No adapter, no model option, and a harness file that names none: building
  // the agent throws. That throw used to escape `startTurn` and end the process.
  const home = mkdtempSync(join(tmpdir(), 'ahpd-cofold-home-'));
  const was = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  try {
    const host = createHost({ path: mkdtempSync(join(tmpdir(), 'ahpd-cofold-')), agents: [cofoldAgent({ memory: true })] });
    const p = peer();
    const client = host.accept(p);
    await client.handle({
      method: 'initialize',
      params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
    });
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/none', provider: 'cofold' } });
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/none' } });
    begin(client, 'ahp-chat:/none', 't1', 'hi');
    const failure = () => actions(p, 'ahp-chat:/none').find((e) => e.action.type === 'chat/error');
    await until(() => failure() !== undefined);
    const part = failure()?.action.part as { error?: { message?: string }; resumable?: unknown };
    const message = String(part?.error?.message);
    expect(message).toContain('add "model"');
    expect(message).toContain(join(home, 'cofold', 'config.json'));
    // A turn that never ran is not a turn a resume can put back: there is
    // nothing the session could cut to and run again.
    expect(part).not.toHaveProperty('resumable');
  }
  finally {
    if (was === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = was;
  }
});

/**
 * The status the catalogue announced as a turn ended.
 *
 * The host moves the session's row on every chat action, reading the status
 * as that action passes; the row sent right after the ending is the one a
 * client's list is left with when nothing else about the session moves.
 */
const statusAtEnd = (p: ReturnType<typeof peer>, uri: string, chatUri: string, type: string): unknown => {
  const at = p.notes.findIndex((n) => n.method === 'action'
    && (n.params as Note).channel === chatUri
    && (n.params as Note).action.type === type);
  if (at < 0) return undefined;
  // By id: the row is published under the provider's name, whatever the
  // client created the session as.
  const row = p.notes.slice(at + 1).find((n) => n.method === 'root/sessionSummaryChanged'
    && idOf((n.params as { session: string }).session) === idOf(uri));
  const status = (row?.params as { changes: { status?: unknown } } | undefined)?.changes.status;
  // Without the read bit, which is the person's and not the turn's.
  return typeof status === 'number' ? status & ~Status.IsRead : status;
};

it('announces the session idle with the turnComplete that ends its turn', async () => {
  const model = createFakeModel({ script: [{ text: 'hello there' }], stream: true });
  const { client, peer: p, uri, chatUri } = await talking(model);
  begin(client, chatUri, 't1', 'hi');
  await until(() => ended(p, chatUri));
  expect(statusAtEnd(p, uri, chatUri, 'chat/turnComplete')).toBe(Status.Idle);
});

it('announces the session idle with the turnCancelled that ends its turn', async () => {
  const { client, peer: p, uri, chatUri } = await talking(heldModel());
  begin(client, chatUri, 't1', 'hi');
  await until(() => types(p, chatUri).includes('chat/delta'));
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  await until(() => types(p, chatUri).includes('chat/turnCancelled'));
  expect(statusAtEnd(p, uri, chatUri, 'chat/turnCancelled')).toBe(Status.Idle);
});

/** A model that fails its first `failures` calls and then answers `text`. */
function failingModel(failures: number, text = 'recovered'): ModelAdapter {
  const answers = createFakeModel({ script: [{ text }], stream: true });
  let left = failures;
  return {
    ...answers,
    id: 'failing',
    complete: async (request) => {
      if (left > 0) { left--; throw new Error('the model gave up'); }
      return answers.complete(request);
    },
    stream: async function* (request): AsyncIterable<ModelStreamEvent> {
      if (left > 0) { left--; throw new Error('the model gave up'); }
      yield* answers.stream!(request);
    },
  };
}

it('announces the session failed with the chat/error that ends its turn', async () => {
  const { client, peer: p, uri, chatUri } = await talking(failingModel(1));
  begin(client, chatUri, 't1', 'hi');
  await until(() => types(p, chatUri).includes('chat/error'));
  expect(types(p, chatUri)).toContain('chat/error');
  expect(statusAtEnd(p, uri, chatUri, 'chat/error')).toBe(Status.Error);
});

it('marks a failed run resumable, on the stream and on the turn', async () => {
  /*
   * The host's check for `chat/turnResume` reads the last part of the newest
   * turn, and a client that folded the stream reads the same part from the
   * action. A resume the snapshot does not offer is one no client shows.
   */
  const { client, peer: p, chatUri } = await talking(failingModel(1));
  begin(client, chatUri, 't1', 'hi');
  await until(() => types(p, chatUri).includes('chat/error'));

  const said = actions(p, chatUri).find((e) => e.action.type === 'chat/error');
  expect(said?.action.part).toMatchObject({ kind: 'error', resumable: true });

  const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { state: string; responseParts: { kind?: string; resumable?: boolean }[] }[] } };
  };
  const turn = opened.snapshot.state.turns.at(-1);
  expect(turn?.state).toBe('error');
  expect(turn?.responseParts.at(-1)).toMatchObject({ kind: 'error', resumable: true });
});

/** Ask for the turn that failed to run again, the way a client's control does. */
const resume = (client: Awaited<ReturnType<typeof talking>>['client'], chatUri: string, turnId: string): void => {
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnResume', turnId } },
  });
};

it('runs a failed turn again on chat/turnResume, with its prompt said once', async () => {
  const model = failingModel(1);
  const { client, peer: p, chatUri, agent } = await talking(model);
  begin(client, chatUri, 't1', 'hi');
  await until(() => types(p, chatUri).includes('chat/error'));

  resume(client, chatUri, 't1');
  await until(() => types(p, chatUri).includes('chat/turnComplete'));

  const said = types(p, chatUri);
  // The reopen is the client's own action echoed first, and then the run says
  // what it did, as a live run does.
  expect(said.filter((type) => type === 'chat/turnResume')).toHaveLength(1);
  expect(said.indexOf('chat/turnResume')).toBeGreaterThan(said.indexOf('chat/error'));
  expect(said.at(-1)).toBe('chat/turnComplete');
  expect(said.filter((type) => type === 'chat/turnStarted')).toHaveLength(1);
  // The cut dropped the failed prompt with what the run wrote after it, so the
  // conversation holds the prompt once rather than once per attempt.
  const transcript = await agent.transcript?.('one') ?? [];
  expect(transcript.map((turn) => (turn.message as { text?: string } | undefined)?.text)).toEqual(['hi']);
});

it('resumes a conversation\'s first turn by dropping the session and starting it again', async () => {
  /*
   * A first turn has no turn before it to cut to, so the cut is the session
   * itself. What the store is checked for is the two halves of that: a record
   * made again, and the workspace the one before it ran on.
   */
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-cofold-first-'));
  const root = join(dir, 'store');
  const work = join(dir, 'work');
  mkdirSync(work, { recursive: true });
  const host = createHost({
    path: join(dir, 'host'),
    agents: [cofoldAgent({ adapter: failingModel(1), store: root })],
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/first';
  const chatUri = 'ahp-chat:/first';
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'cofold', workingDirectories: [work] },
  });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  begin(client, chatUri, 't1', 'hi');
  await until(() => types(p, chatUri).includes('chat/error'));

  const store = createFileStore({ root });
  const [before] = await store.sessions.list({});
  expect(before?.workspace).toBe(work);
  const id = String(before?.sessionId);

  resume(client, chatUri, 't1');
  await until(() => types(p, chatUri).includes('chat/turnComplete'));

  const after = await store.sessions.get({ sessionId: id });
  expect(after?.workspace).toBe(work);
  expect(after?.createdAt).not.toBe(before?.createdAt);
  const messages = await store.sessions.listMessages({ sessionId: id });
  expect(messages.filter((one) => textOf(one) === 'hi')).toHaveLength(1);
});

it('leaves a resumed turn that fails again with one more error part, resumable again', async () => {
  const model = failingModel(2);
  const { client, peer: p, chatUri } = await talking(model);
  begin(client, chatUri, 't1', 'hi');
  await until(() => types(p, chatUri).filter((type) => type === 'chat/error').length === 1);

  resume(client, chatUri, 't1');
  await until(() => types(p, chatUri).filter((type) => type === 'chat/error').length === 2);

  const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { state: string; responseParts: { kind?: string; resumable?: boolean }[] }[] } };
  };
  // The same turn, reopened rather than a second one beside it, with the new
  // failure on it and the old one kept.
  expect(opened.snapshot.state.turns).toHaveLength(1);
  const turn = opened.snapshot.state.turns[0];
  expect(turn?.state).toBe('error');
  expect(turn?.responseParts.map((part) => part.kind)).toEqual(['error', 'error']);
  expect(turn?.responseParts.at(-1)?.resumable).toBe(true);
});

it('starts a message queued during a resume once the resume has failed', async () => {
  const model = failingModel(2);
  const { client, peer: p, chatUri } = await talking(model);
  begin(client, chatUri, 't1', 'hi');
  await until(() => types(p, chatUri).includes('chat/error'));

  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnResume', turnId: 't1' } },
  });
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/pendingMessageSet', kind: 'queued', id: 'q2', message: { text: 'two' } } },
  });
  await until(() => types(p, chatUri).includes('chat/turnComplete'));

  // The failed resume ends its turn as any failure does, and the queue moves
  // on from there rather than waiting on a turn nobody will finish.
  const said = types(p, chatUri);
  const failedAgain = said.lastIndexOf('chat/error');
  expect(said.filter((type) => type === 'chat/error')).toHaveLength(2);
  expect(said.lastIndexOf('chat/turnStarted')).toBeGreaterThan(failedAgain);
  const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { state: string; message: { text?: string } }[] } };
  };
  expect(opened.snapshot.state.turns.map((turn) => [turn.message.text, turn.state])).toEqual([['hi', 'error'], ['two', 'complete']]);
});

it('answers no for a resume the session cannot make', async () => {
  /*
   * The host checks the three conditions before it calls the session, and the
   * session checks them again because it is a contract of its own. What is
   * tested here is the session's answer: a turn running, the session closed, a
   * turn that is not the newest or not in error, and one whose error says no
   * resume.
   */
  const agent = cofoldAgent({ memory: true });
  const open = (seed: Record<string, unknown>[]) => agent.create({
    uri: 'ahp-session:/answers',
    chatUri: 'ahp-chat:/answers',
    settings: agent.defaults(),
    workingDirectory: mkdtempSync(join(tmpdir(), 'ahpd-cofold-answers-')),
    schema: () => agent.schema(),
    emit: () => {},
    clientToolTimeoutMs: 600_000,
    seed,
  });
  const failed = (id: string, resumable: boolean): Record<string, unknown> => ({
    id,
    state: 'error',
    message: { text: id },
    responseParts: [{
      kind: 'error',
      error: { errorType: 'turnFailed', message: 'the model gave up' },
      ...(resumable ? { resumable: true } : {}),
    }],
  });
  const done = (id: string): Record<string, unknown> => ({
    id,
    state: 'complete',
    message: { text: id },
    responseParts: [{ kind: 'markdown', content: 'an answer' }],
  });

  // Not the newest turn.
  expect(open([done('t1'), failed('t2', true)]).resume?.('t1')).toBe(false);
  // The newest turn, but it did not fail.
  expect(open([done('t1')]).resume?.('t1')).toBe(false);
  // The newest turn failed, and its error does not offer a resume.
  expect(open([done('t1'), failed('t2', false)]).resume?.('t2')).toBe(false);
  // It offers one, but only to a process that watched the turn before it run:
  // this one was read back off a seed, so there is no point to cut to.
  expect(open([done('t1'), failed('t2', true)]).resume?.('t2')).toBe(false);
  // Closed.
  const closed = open([failed('t1', true)]);
  await closed.close();
  expect(closed.resume?.('t1')).toBe(false);

  // A turn still running has nothing to reopen yet.
  const busy = cofoldAgent({ adapter: heldModel(), memory: true }).create({
    uri: 'ahp-session:/busy',
    chatUri: 'ahp-chat:/busy',
    settings: {},
    workingDirectory: mkdtempSync(join(tmpdir(), 'ahpd-cofold-busy-')),
    schema: () => ({}),
    emit: () => {},
    clientToolTimeoutMs: 600_000,
  });
  busy.begin('t1', 'hi');
  expect(busy.resume?.('t1')).toBe(false);
  await busy.close();
});

it('clears a failure when the next turn starts', async () => {
  const { client, peer: p, uri, chatUri } = await talking(failingModel(1));
  begin(client, chatUri, 't1', 'hi');
  await until(() => types(p, chatUri).includes('chat/error'));
  expect(statusAtEnd(p, uri, chatUri, 'chat/error')).toBe(Status.Error);
  begin(client, chatUri, 't2', 'again');
  await until(() => types(p, chatUri).includes('chat/turnComplete'));
  expect(statusAtEnd(p, uri, chatUri, 'chat/turnComplete')).toBe(Status.Idle);
});

it('announces the session idle with the turnComplete that ends a !command', async () => {
  const host = createHost({
    path: mkdtempSync(join(tmpdir(), 'ahpd-cofold-bang-')),
    agents: [cofoldAgent({ adapter: createFakeModel({ script: [{ text: 'never asked' }], stream: true }), memory: true })],
    terminals: shellTerminals(),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/bang';
  const chatUri = 'ahp-chat:/bang';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'cofold' } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  begin(client, chatUri, 't1', '!echo cofold-ran-it');
  await until(() => ended(p, chatUri), 4000);
  expect(types(p, chatUri)).toContain('chat/toolCallComplete');
  expect(statusAtEnd(p, uri, chatUri, 'chat/turnComplete')).toBe(Status.Idle);
});

it('starts a queued turn only after the one before it has ended', async () => {
  const model = createFakeModel({ script: [{ text: 'first' }, { text: 'second' }], stream: true });
  const { client, peer: p, chatUri } = await talking(model);
  begin(client, chatUri, 't1', 'one');
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/pendingMessageSet', kind: 'queued', id: 'q2', message: { text: 'two' } } },
  });
  await until(() => types(p, chatUri).filter((type) => type === 'chat/turnComplete').length === 2);
  const said = actions(p, chatUri).map((e) => String(e.action.type));
  const first = said.indexOf('chat/turnComplete');
  const next = said.lastIndexOf('chat/turnStarted');
  expect(said.filter((type) => type === 'chat/turnStarted')).toHaveLength(2);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(next).toBeGreaterThan(first);
});

it('titles a session after the first line of what was said', async () => {
  const model = createFakeModel({ script: [{ text: 'ok' }], stream: true });
  const { client, peer: p, uri, chatUri } = await talking(model);
  begin(client, chatUri, 't1', 'Fix the build\nand the tests');
  await until(() => ended(p, chatUri));

  // One line, and the line is the first one: a row that carries the rest of
  // the message is a row drawn as a paragraph.
  const snapshot = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { title: string } };
  };
  expect(actions(p, uri).filter((e) => e.action.type === 'session/titleChanged').map((e) => e.action.title))
    .toEqual(['Fix the build']);
  expect(snapshot.snapshot.state.title).toBe('Fix the build');
});

it('says the title after the turn has started', async () => {
  const model = createFakeModel({ script: [{ text: 'ok' }], stream: true });
  const { client, peer: p, uri, chatUri } = await talking(model);
  begin(client, chatUri, 't1', 'say hi');
  await until(() => ended(p, chatUri));

  // VS Code draws the message a second time when the title comes first.
  const said = p.notes.filter((n) => n.method === 'action').map((n) => n.params as Note);
  const started = said.findIndex((e) => e.channel === chatUri && e.action.type === 'chat/turnStarted');
  const titled = said.findIndex((e) => e.channel === uri && e.action.type === 'session/titleChanged');
  expect(started).toBeGreaterThanOrEqual(0);
  expect(titled).toBeGreaterThan(started);
});

it('keeps a one-line message of seventy characters whole', async () => {
  const line = 'a'.repeat(70);
  const model = createFakeModel({ script: [{ text: 'ok' }], stream: true });
  const { client, peer: p, uri, chatUri } = await talking(model);
  begin(client, chatUri, 't1', line);
  await until(() => ended(p, chatUri));

  const snapshot = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { title: string } };
  };
  expect(snapshot.snapshot.state.title).toBe(line);
});

it('gives the catalogue row the same title as the live session', async () => {
  const model = createFakeModel({ script: [{ text: 'ok' }], stream: true });
  const { client, peer: p, uri, chatUri } = await talking(model);
  begin(client, chatUri, 't1', 'Fix the build\nand the tests');
  await until(() => ended(p, chatUri));

  // A row read from the store and a session read live are the same title, or a
  // client listing once and opening the row sees it named twice.
  const live = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { title: string } };
  }).snapshot.state.title;
  const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { title: string }[];
  };
  expect(live).toBe('Fix the build');
  expect(listed.items.map((one) => one.title)).toContain('Fix the build');
});
