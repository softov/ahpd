import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createFakeModel } from '@cofold/agents/testing';
import { chatReducer } from '@microsoft/agent-host-protocol';
import type { ModelAdapter } from '@cofold/agents';
import { createHost } from '../../sdk/src/host.js';
import { cofoldAgent, cofoldTools } from '../src/index.js';
import type { ClientToolRelay } from '../src/index.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { BoundTool } from '../../sdk/src/types/agent.js';

/*
 * A tool a connected client runs, driven through the real host.
 *
 * No network and no real model: the adapter is a script, the store is in
 * memory, and the host is the same `createHost` the daemon uses. The client
 * announces its tool the protocol's way - an `session/activeClientSet`
 * carrying the definitions - then the model calls it, and what this checks
 * is the whole round trip the host and the protocol describe: the call is
 * reported with the client as its `contributor`, nothing on this host runs
 * it, the owning client's `chat/toolCallComplete` is what settles the run,
 * a result from anybody else is refused, and a client that goes away fails
 * its call rather than leaving the turn waiting for ever.
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

/** A fixed number of turns of the event loop, for asserting that nothing happens. */
const settle = async (times = 12): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

type Note = { channel: string; action: Record<string, unknown> };

const actions = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

const types = (p: ReturnType<typeof peer>, channel: string): string[] =>
  actions(p, channel).map((e) => String(e.action.type));

const ended = (p: ReturnType<typeof peer>, chatUri: string): boolean =>
  types(p, chatUri).some((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled');

/** The conversation a client builds from the actions it was sent. */
const reduced = (p: ReturnType<typeof peer>, chatUri: string) => {
  let chat: Record<string, unknown> = {
    resource: chatUri, title: '', status: 1, modifiedAt: '', turns: [], queuedMessages: [],
  };
  for (const one of actions(p, chatUri)) chat = chatReducer(chat as never, one.action as never) as never;
  return chat as {
    turns: { responseParts: Record<string, unknown>[] }[];
    activeTurn?: { responseParts: Record<string, unknown>[] };
  };
};

/** The one tool-call part in a turn's parts, which is what a client draws. */
const callIn = (parts: Record<string, unknown>[]): Record<string, unknown> | undefined =>
  parts.find((one) => one.kind === 'toolCall')?.toolCall as Record<string, unknown> | undefined;

/** The definition a client announces, in the shape `SessionActiveClient.tools` carries. */
const OPEN_FILE = {
  name: 'openFile',
  title: 'Open a file',
  description: 'Open a file in the editor.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
};

/** What the model does: call the client's tool, then answer with a final line. */
const script = (final: string, tool = 'probe__openFile') => [
  { toolCalls: [{ name: tool, input: { path: '/a.txt' }, callId: 'call-1' }] },
  { text: final },
];

/** The result the client sends for a call it ran, in the shape the protocol carries it. */
const OPENED = {
  success: true,
  pastTenseMessage: 'Opened it',
  content: [{ type: 'text', text: 'opened /a.txt' }],
};

/**
 * A running cofold session with one client that says it can run `openFile`.
 *
 * Announced the way the protocol says a client does: dispatching a
 * `session/activeClientSet` whose `tools` are the definitions it provides.
 * The host forces the `clientId` to this connection's, which is what makes
 * the tool `probe__openFile` on the model's list.
 */
async function offering(
  model: ModelAdapter,
  given: { clientId?: string; clientToolTimeoutMs?: number } = {},
) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-cofold-'));
  const host = createHost({
    path,
    agents: [cofoldAgent({ adapter: model, memory: true })],
    ...(given.clientToolTimeoutMs === undefined ? {} : { clientToolTimeoutMs: given.clientToolTimeoutMs }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: {
      clientId: given.clientId ?? 'probe',
      protocolVersions: ['0.9.0'],
      initialSubscriptions: ['ahp-root://'],
    },
  });
  const uri = 'ahp-session:/one';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'cofold' } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chatUri = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: uri,
      action: { type: 'session/activeClientSet', activeClient: { name: 'VS Code', tools: [OPEN_FILE] } },
    },
  });
  await settle();
  return { host, client, peer: p, uri, chatUri };
}

/** The action a turn began with, dispatched the way a client dispatches it. */
const begin = (
  client: Awaited<ReturnType<typeof offering>>['client'],
  chatUri: string,
  turnId: string,
  text: string,
): void => {
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text } } },
  });
};

/** A second connection in the same session, with a client id of its own. */
async function outsider(host: ReturnType<typeof createHost>, clientId = 'other') {
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId, protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  return { client, peer: p };
}

/**
 * What a client watching the session has been told is still being asked for.
 *
 * Folded from the two actions the protocol raises an entry with rather than
 * read off a snapshot, because what the cases below check is the pair: a call
 * raises one entry and its answer takes that same entry away.
 */
const needed = (p: ReturnType<typeof peer>, uri: string): Record<string, unknown>[] => {
  const open = new Map<string, Record<string, unknown>>();
  for (const one of actions(p, uri)) {
    if (one.action.type === 'session/inputNeededSet') {
      const request = one.action.request as Record<string, unknown>;
      open.set(String(request.id), request);
    }
    if (one.action.type === 'session/inputNeededRemoved') open.delete(String(one.action.id));
  }
  return [...open.values()];
};

type Client = Awaited<ReturnType<typeof offering>>['client'];

/** A client's own word on the call it ran, dispatched the way the protocol says. */
const complete = (client: Client, chatUri: string, result: Record<string, unknown>): Promise<unknown> =>
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/toolCallComplete', toolCallId: 'call-1', result } },
  });

/** The call has been opened and filled in, which is when the client may run it. */
const called = (p: ReturnType<typeof peer>, chatUri: string): boolean =>
  types(p, chatUri).includes('chat/toolCallReady');

/** One `chat/toolCallComplete` result from the run, the shape a client reads. */
const completion = (p: ReturnType<typeof peer>, chatUri: string): Record<string, unknown> | undefined =>
  actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete')?.action.result as
    Record<string, unknown> | undefined;

it('offers a client tool, reports its call against that client and waits', async () => {
  const model = createFakeModel({ script: script('opened'), stream: true });
  const { client, peer: p, chatUri } = await offering(model);
  begin(client, chatUri, 't1', 'open it');
  await until(() => called(p, chatUri));

  // Offered to the model under the name the host gave it.
  expect(model.requests[0]?.tools.map((one) => one.name)).toContain('probe__openFile');

  // Reported with the client as the call's contributor.
  const start = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallStart');
  expect(start?.action.toolName).toBe('probe__openFile');
  expect(start?.action.contributor).toEqual({ kind: 'client', clientId: 'probe' });
  const ready = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallReady');
  expect(ready?.action.contributor).toEqual({ kind: 'client', clientId: 'probe' });
  // `not-needed` is about a person's approval, not about who executes: it is
  // what moves the call to `running`, where the owning client begins.
  expect(ready?.action.confirmed).toBe('not-needed');

  // Nothing here ran it: still one model step in, no completion, no ending.
  await settle();
  expect(model.requests).toHaveLength(1);
  expect(ended(p, chatUri)).toBe(false);
  expect(types(p, chatUri)).not.toContain('chat/toolCallComplete');

  // A client that subscribes reads the owner off the snapshot part too.
  const chat = reduced(p, chatUri);
  const call = callIn(chat.activeTurn?.responseParts ?? []);
  expect(call).toMatchObject({ status: 'running', contributor: { kind: 'client', clientId: 'probe' } });
});

it('lets the owning client stream into its call and refuses anybody else', async () => {
  const model = createFakeModel({ script: script('done'), stream: true });
  const { host, client, peer: p, chatUri } = await offering(model);
  begin(client, chatUri, 't1', 'open it');
  await until(() => called(p, chatUri));

  // The call has an owner, so a second client may not write into it.
  const other = await outsider(host);
  await other.client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/toolCallContentChanged',
        toolCallId: 'call-1',
        content: [{ type: 'text', text: 'not mine' }],
      },
    },
  });
  await settle();
  expect(actions(p, chatUri).some((e) => e.action.type === 'chat/toolCallContentChanged')).toBe(false);
  expect(other.peer.notes.some((n) => n.method === 'action'
    && typeof (n.params as { rejectionReason?: unknown }).rejectionReason === 'string')).toBe(true);

  // The owner's is relayed, which is the half `toolCallOwner` decides.
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/toolCallContentChanged',
        toolCallId: 'call-1',
        content: [{ type: 'text', text: 'opening /a.txt' }],
      },
    },
  });
  await settle();
  const streamed = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallContentChanged');
  expect(streamed?.action).toMatchObject({ toolCallId: 'call-1' });
});

it('settles the call from the owning client and gives the model the result', async () => {
  const model = createFakeModel({ script: script('done'), stream: true });
  const { client, peer: p, chatUri } = await offering(model);
  begin(client, chatUri, 't1', 'open it');
  await until(() => called(p, chatUri));

  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/toolCallComplete',
        toolCallId: 'call-1',
        result: { success: true, pastTenseMessage: 'Opened it', content: [{ type: 'text', text: 'opened /a.txt' }] },
      },
    },
  });
  await until(() => ended(p, chatUri));

  // The model's next step carries the client's text as the tool result.
  expect(JSON.stringify(model.requests[1]?.messages)).toContain('opened /a.txt');
  // The row is closed from what actually happened, not from the client's
  // action relayed a second time: one completion, and the turn is over.
  const done = completion(p, chatUri);
  expect(done).toMatchObject({ success: true, content: [{ type: 'text', text: 'opened /a.txt' }] });
  expect(types(p, chatUri).filter((type) => type === 'chat/toolCallComplete')).toHaveLength(1);
  const call = callIn(reduced(p, chatUri).turns[0]?.responseParts ?? []);
  expect(call).toMatchObject({ status: 'completed', success: true });
  expect(types(p, chatUri).at(-1)).toBe('chat/turnComplete');
});

it('refuses a result from a client that does not own the call', async () => {
  const model = createFakeModel({ script: script('done'), stream: true });
  const { host, client, peer: p, chatUri } = await offering(model);
  begin(client, chatUri, 't1', 'open it');
  await until(() => called(p, chatUri));

  // Somebody else, answering for work it did not do.
  const other = await outsider(host);
  await other.client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/toolCallComplete',
        toolCallId: 'call-1',
        result: { success: true, pastTenseMessage: 'Opened it', content: [{ type: 'text', text: 'not mine' }] },
      },
    },
  });

  // Refused, in the host's words, and the call is still waiting.
  const refused = other.peer.notes
    .filter((n) => n.method === 'action')
    .map((n) => n.params as { rejectionReason?: unknown });
  expect(refused.some((one) => typeof one.rejectionReason === 'string')).toBe(true);
  await settle();
  expect(model.requests).toHaveLength(1);
  expect(ended(p, chatUri)).toBe(false);
  expect(types(p, chatUri)).not.toContain('chat/toolCallComplete');

  // The owner still settles it afterwards.
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/toolCallComplete',
        toolCallId: 'call-1',
        result: { success: true, pastTenseMessage: 'Opened it', content: [{ type: 'text', text: 'opened /a.txt' }] },
      },
    },
  });
  await until(() => ended(p, chatUri));
  expect(JSON.stringify(model.requests[1]?.messages)).toContain('opened /a.txt');
});

it('fails a call whose client went away and finishes the turn', async () => {
  const model = createFakeModel({ script: script('carried on'), stream: true });
  const { client, peer: p, uri, chatUri } = await offering(model);
  begin(client, chatUri, 't1', 'open it');
  await until(() => called(p, chatUri));

  // The protocol's way a client stops being active: it lets the session go,
  // which takes its tools with it and fails the call it was running.
  await client.handle({ method: 'unsubscribe', params: { channel: uri } });
  await until(() => ended(p, chatUri));

  const done = completion(p, chatUri);
  expect(done?.success).toBe(false);
  const error = done?.error as { message?: string } | undefined;
  expect(error?.message).toContain('no longer here');
  // The failure is the tool result the model read, and the run went on.
  expect(JSON.stringify(model.requests[1]?.messages)).toContain('no longer here');
  expect(types(p, chatUri).at(-1)).toBe('chat/turnComplete');
});

it('raises one entry for a call a client runs, and removes it when the client answers', async () => {
  const model = createFakeModel({ script: script('done'), stream: true });
  const { client, peer: p, uri, chatUri } = await offering(model);
  begin(client, chatUri, 't1', 'open it');
  await until(() => needed(p, uri).length > 0);

  /*
   * The call is a client's to run, so it is asked for on the session and not
   * only on the chat: a second window, or a plugin, that subscribed to the
   * session alone finds the call there, named for the client that must run it.
   */
  const entries = needed(p, uri);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ kind: 'toolClientExecution', chat: chatUri, turnId: 't1', clientId: 'probe' });
  expect(entries[0]?.toolCall).toMatchObject({
    toolCallId: 'call-1',
    // The name the client announced it under, not the `probe__openFile` the
    // model was offered: that is the name a failure of it is reported under.
    toolName: 'openFile',
    status: 'running',
    contributor: { kind: 'client', clientId: 'probe' },
  });

  // Answered, the call is no longer anything a client is being asked for.
  await complete(client, chatUri, OPENED);
  await until(() => ended(p, chatUri));
  expect(needed(p, uri)).toHaveLength(0);
});

it('asks a call of the one client whose tool it is, and refuses the other', async () => {
  const model = createFakeModel({ script: script('done', 'a__openFile'), stream: true });
  const { host, client, peer: p, uri, chatUri } = await offering(model, { clientId: 'a' });
  // A second client in the same session, providing the same tool.
  const other = await outsider(host, 'b');
  await other.client.handle({ method: 'subscribe', params: { channel: uri } });
  await other.client.handle({
    method: 'dispatchAction',
    params: {
      channel: uri,
      action: { type: 'session/activeClientSet', activeClient: { name: 'Other editor', tools: [OPEN_FILE] } },
    },
  });
  await settle();

  begin(client, chatUri, 't1', 'open it');
  await until(() => needed(p, uri).length > 0);
  // Both clients' tools are on the model's list, one name each.
  expect(model.requests[0]?.tools.map((one) => one.name))
    .toEqual(expect.arrayContaining(['a__openFile', 'b__openFile']));
  // The entry names the client the call belongs to, which is whose tool the
  // model actually called.
  expect(needed(p, uri)[0]).toMatchObject({ clientId: 'a' });

  // The other client answers for work it did not do, and is refused.
  await complete(other.client, chatUri, { ...OPENED, content: [{ type: 'text', text: 'not mine' }] });
  await settle();
  const refused = other.peer.notes
    .filter((n) => n.method === 'action')
    .map((n) => n.params as { rejectionReason?: unknown });
  expect(refused.some((one) => typeof one.rejectionReason === 'string')).toBe(true);
  expect(model.requests).toHaveLength(1);
  expect(ended(p, chatUri)).toBe(false);

  // The client the call is out with settles it, and the run goes on.
  await complete(client, chatUri, OPENED);
  await until(() => ended(p, chatUri));
  expect(JSON.stringify(model.requests[1]?.messages)).toContain('opened /a.txt');
  expect(needed(p, uri)).toHaveLength(0);
});

it('fails a call nobody answers in the time the host allows, and the turn finishes', async () => {
  const model = createFakeModel({ script: script('carried on'), stream: true });
  const { client, peer: p, uri, chatUri } = await offering(model, { clientToolTimeoutMs: 30 });
  begin(client, chatUri, 't1', 'open it');
  await until(() => needed(p, uri).length > 0);

  // Nobody answers. A client that has gone quiet without going away must not
  // block the turn for ever, so the host calls the call failed.
  await until(() => ended(p, chatUri));
  const done = completion(p, chatUri);
  expect(done?.success).toBe(false);
  expect((done?.error as { message?: string } | undefined)?.message).toContain('got no answer from probe');
  // The failure is the tool result the model read, and the run went on.
  expect(JSON.stringify(model.requests[1]?.messages)).toContain('got no answer from probe');
  expect(types(p, chatUri).at(-1)).toBe('chat/turnComplete');
  // And nothing is being asked for any more.
  expect(needed(p, uri)).toHaveLength(0);
});

it('carries a client\'s text and names the image it could not pass', async () => {
  const model = createFakeModel({ script: script('done'), stream: true });
  const { client, peer: p, uri, chatUri } = await offering(model);
  begin(client, chatUri, 't1', 'open it');
  await until(() => needed(p, uri).length > 0);

  await complete(client, chatUri, {
    success: true,
    pastTenseMessage: 'Opened it',
    content: [
      { type: 'text', text: 'here is the page' },
      { type: 'embeddedResource', data: 'AAAA', contentType: 'image/png' },
    ],
  });
  await until(() => ended(p, chatUri));

  /*
   * A cofold tool answers text and nothing else, so the client's own words
   * travel as text and the image is named, with its type and its size, rather
   * than dropped: an answer that quietly left out a block would be a lie about
   * what the client sent.
   */
  const read = JSON.stringify(model.requests[1]?.messages);
  expect(read).toContain('here is the page');
  expect(read).toContain('[image/png, 3 bytes]');
});

it('does not offer a tool nobody can run', () => {
  const definition: BoundTool['definition'] = {
    name: 'ghost',
    description: 'Nothing runs this.',
    inputSchema: { type: 'object', properties: {} },
  };
  const ghost: BoundTool = { definition };
  const mine: BoundTool = { definition: { ...definition, name: 'mine' }, run: () => 'ran' };
  const theirs: BoundTool = { definition: { ...definition, name: 'theirs' }, owner: 'client-1' };
  const relay: ClientToolRelay = { call: async () => '' };

  // With a session to reply on, the client's own tool is offered; the one
  // with neither an owner nor an implementation still is not.
  expect(cofoldTools([ghost, mine, theirs], relay).map((one) => one.name)).toEqual(['mine', 'theirs']);
});
