import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createFakeModel } from '@cofold/agents/testing';
import type { ModelAdapter, ModelReply, ModelStreamEvent } from '@cofold/agents';
import { createHost } from '../packages/sdk/src/host.js';
import { chatReducer } from '@microsoft/agent-host-protocol';
import type { ChatAction, ChatState } from '@microsoft/agent-host-protocol';
import { cofoldAgent, cofoldTools, sessionIdOf } from '../packages/agent-cofold/src/index.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';
import type { BoundTool } from '../packages/sdk/src/types/agent.js';
import type { HostTool } from '../packages/sdk/src/types/host.js';

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
};

type Note = { channel: string; action: Record<string, unknown> };

const actions = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

const types = (p: ReturnType<typeof peer>, channel: string): string[] =>
  actions(p, channel).map((e) => String(e.action.type));

/** A connected client with one cofold session, watching both its channels. */
async function talking(model: ModelAdapter, tools: HostTool[] = []) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-cofold-'));
  const host = createHost({
    path,
    agents: [cofoldAgent({ adapter: model, memory: true })],
    ...(tools.length > 0 ? { tools } : {}),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/one';
  const chatUri = 'ahp-chat:/one';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'cofold' } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { host, client, peer: p, uri, chatUri };
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
  /*
   * The markdown part is announced the same way - once, before the run, empty -
   * and only its count is asserted here. This peer sees the *live* object the
   * deltas keep writing into, where a socket sees the announcement as it was
   * when it was sent; the count is the same on both.
   */
  expect(state.turns.flatMap((turn) => turn.responseParts)
    .filter((part) => part.kind === 'markdown')).toHaveLength(1);
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

it('ends a cancelled turn as turnCancelled, once', async () => {
  /** A model that streams one delta and then waits, so a cancel lands mid-turn. */
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
  const { client, peer: p, chatUri } = await talking(held);
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
  expect(opened.snapshot.state.turns[0]?.responseParts[0]?.content).toBe('not streamed');
});

it('does not offer a tool a client runs, because nothing here can answer it', () => {
  const definition: BoundTool['definition'] = { name: 'lookup', description: 'Looks a word up.', inputSchema: { type: 'object', properties: {} } };
  const mine: BoundTool = { definition, run: () => 'mine' };
  const theirs: BoundTool = { definition: { ...definition, name: 'theirs' }, owner: 'client-1' };
  expect(cofoldTools([mine, theirs]).map((one) => one.name)).toEqual(['lookup']);
});
