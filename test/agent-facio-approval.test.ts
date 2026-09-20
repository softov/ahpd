import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createFakeModel } from '@facio/agents/testing';
import { pauseForInput } from '@facio/agents';
import { chatReducer, sessionReducer } from '@microsoft/agent-host-protocol';
import type { AskQuestion, ModelAdapter, Policy } from '@facio/agents';
import { createHost } from '../packages/sdk/src/host.js';
import { facioAgent } from '../packages/agent-facio/src/index.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';
import type { HostTool } from '../packages/sdk/src/types/host.js';

/*
 * A facio run that stops for a person, as a client drives it.
 *
 * No network and no real model: the adapter is a script, the store is in
 * memory, and the host is the same `createHost` the daemon uses. Two paths
 * raise a pause: a host tool that declares `effects.destructive`, which
 * facio's own default policy asks about with no policy configured, and a
 * policy the caller passes for a tool that says nothing.
 *
 * What this checks is the whole round trip: an `approval.requested` becomes
 * a tool call plus a `toolConfirmation` entry, `confirm` takes the entry down
 * and puts the decision back into the frozen run, and a run that waits is
 * never reported complete while it waits.
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

/** The entry a pause put on the session, by its kind. */
const needed = (p: ReturnType<typeof peer>, uri: string, kind: string): Record<string, unknown> | undefined =>
  actions(p, uri)
    .filter((e) => e.action.type === 'session/inputNeededSet')
    .map((e) => e.action.request as Record<string, unknown>)
    .find((one) => one.kind === kind);

/** The conversation a client ends up with, built the way a client builds it. */
const reduced = (p: ReturnType<typeof peer>, uri: string, chatUri: string) => {
  let chat: Record<string, unknown> = {
    resource: chatUri, title: '', status: 1, modifiedAt: '', turns: [], queuedMessages: [],
  };
  let session: Record<string, unknown> = {
    resource: uri, provider: 'facio', title: '', status: 1, lifecycle: 'ready',
    defaultChat: chatUri, chats: [], workingDirectories: [], customizations: [],
  };
  for (const one of actions(p, chatUri)) chat = chatReducer(chat as never, one.action as never) as never;
  for (const one of actions(p, uri)) session = sessionReducer(session as never, one.action as never) as never;
  return { chat, session } as {
    chat: { turns: { responseParts: Record<string, unknown>[] }[] };
    session: { inputNeeded?: { id: string; kind: string }[] };
  };
};

/** A policy that asks about the named tools and lets every other one run. */
const asksFor = (names: string[]): Partial<Policy> => ({
  decide: ({ tool }) => (names.includes(tool.name) ? { behavior: 'ask' } : { behavior: 'allow' }),
});

/** A host with one facio agent, ready for as many sessions as a test opens. */
async function talking(model: ModelAdapter, tools: HostTool[], policy: Partial<Policy>) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-facio-'));
  const host = createHost({
    path,
    agents: [facioAgent({ adapter: model, memory: true, policy })],
    tools,
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
  });
  return { host, client, peer: p };
}

/**
 * One connected session and chat, subscribed on both channels.
 *
 * The chat URI is read off the session rather than spelled out: what a
 * session calls its chat is the host's to say, and the entry a backend emits
 * names that same URI even when a client reached the chat under an alias.
 */
async function open(client: Awaited<ReturnType<typeof talking>>['client'], name: string) {
  const uri = `ahp-session:/${name}`;
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'facio' } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chatUri = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { uri, chatUri };
}

/** The action a turn began with, dispatched the way a client dispatches it. */
const begin = (
  client: Awaited<ReturnType<typeof talking>>['client'],
  chatUri: string,
  turnId: string,
  text: string,
): void => {
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text } } },
  });
};

/** A tool that writes something, so a test can see that it ran. */
const writer = (ran: string[]): HostTool => ({
  definition: {
    name: 'write',
    title: 'Write a note',
    description: 'Writes a note somewhere.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  run: (input) => {
    ran.push(String(input.text));
    return `wrote ${String(input.text)}`;
  },
});

/** The ask tool facio pauses on, reached through the host's own tool slot. */
const asker: HostTool = {
  definition: {
    name: 'ask_user',
    title: 'Ask the user',
    description: 'Asks the user a question and waits for the answer.',
    inputSchema: {
      type: 'object',
      properties: { questions: { type: 'array', items: { type: 'object' } } },
      required: ['questions'],
    },
  },
  run: (input) => pauseForInput({ questions: (input.questions ?? []) as AskQuestion[] }),
};

const writeScript = (callId: string, text: string) => [
  { toolCalls: [{ name: 'write', input: { text }, callId }] },
  { text: 'done' },
];

it('pauses an approval as a tool call and one entry, and does not complete the turn', async () => {
  const model = createFakeModel({ script: writeScript('call-a', 'hi'), stream: true });
  const { client, peer: p } = await talking(model, [writer([])], asksFor(['write']));
  const { uri, chatUri } = await open(client, 'one');
  begin(client, chatUri, 't1', 'write hi');
  await until(() => needed(p, uri, 'toolConfirmation') !== undefined);

  const entry = needed(p, uri, 'toolConfirmation') as {
    id: string; chat: string; kind: string; turnId: string;
    toolCall: { toolCallId: string; status: string; confirmationTitle?: string; invocationMessage?: string };
  };
  // The entry is self-sufficient: the chat to answer on, the call to name,
  // and the question the person reads.
  expect(entry.chat).toBe(chatUri);
  expect(entry.turnId).toBe('t1');
  expect(entry.id.startsWith('approval:')).toBe(true);
  expect(entry.toolCall.toolCallId).toBe('call-a');
  expect(entry.toolCall.status).toBe('pending-confirmation');
  expect(entry.toolCall.confirmationTitle).toBeDefined();

  // The tool-call action a client draws, opened and then held for a person.
  expect(types(p, chatUri)).toContain('chat/toolCallStart');
  const ready = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallReady');
  expect(ready?.action.confirmationTitle).toBeDefined();
  expect(ready?.action.confirmed).toBeUndefined();

  // And the session says what it wants even to a client that never opened the
  // chat: that is the whole point of the session-level entry.
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { status: number; inputNeeded?: { kind: string }[] } };
  };
  expect(opened.snapshot.state.inputNeeded?.map((one) => one.kind)).toEqual(['toolConfirmation']);

  // Nothing about the turn is reported as over while it waits.
  await settle();
  expect(ended(p, chatUri)).toBe(false);
  expect(types(p, chatUri)).not.toContain('chat/turnComplete');
  expect(reduced(p, uri, chatUri).session.inputNeeded?.map((one) => one.kind)).toEqual(['toolConfirmation']);
});

it('runs an approved tool, takes the entry down and finishes the turn', async () => {
  const ran: string[] = [];
  const model = createFakeModel({ script: writeScript('call-a', 'hi'), stream: true });
  const { client, peer: p } = await talking(model, [writer(ran)], asksFor(['write']));
  const { uri, chatUri } = await open(client, 'one');
  begin(client, chatUri, 't1', 'write hi');
  await until(() => needed(p, uri, 'toolConfirmation') !== undefined);
  const entry = needed(p, uri, 'toolConfirmation') as { id: string };

  // A decision for a call that is not open settles nothing: the entry stays
  // up and the turn stays waiting, which is the difference between matching
  // by id and comparing against whichever request was held last.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', toolCallId: 'nope', approved: true } },
  });
  await settle();
  expect(needed(p, uri, 'toolConfirmation')).toBeDefined();
  expect(ended(p, chatUri)).toBe(false);

  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', toolCallId: 'call-a', approved: true, confirmed: 'user-action' } },
  });
  await until(() => ended(p, chatUri));

  // The tool actually ran, once.
  expect(ran).toEqual(['hi']);
  // Taken down by the id it was set with, and said back so the client that
  // approved it does not leave it on screen.
  const removed = actions(p, uri)
    .filter((e) => e.action.type === 'session/inputNeededRemoved')
    .map((e) => String(e.action.id));
  expect(removed).toEqual([entry.id]);
  const confirmed = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallConfirmed');
  expect(confirmed?.action).toMatchObject({ toolCallId: 'call-a', approved: true, confirmed: 'user-action' });

  const { chat, session } = reduced(p, uri, chatUri);
  expect(session.inputNeeded).toBeUndefined();
  const call = chat.turns[0]?.responseParts.find((one) => one.kind === 'toolCall')?.toolCall as { status: string; confirmed: string };
  expect(call).toMatchObject({ status: 'completed', confirmed: 'user-action' });
  expect(types(p, chatUri).at(-1)).toBe('chat/turnComplete');
});

it('denies a tool, carries the reason and does not run it', async () => {
  const ran: string[] = [];
  const model = createFakeModel({ script: writeScript('call-a', 'hi'), stream: true });
  const { client, peer: p } = await talking(model, [writer(ran)], asksFor(['write']));
  const { uri, chatUri } = await open(client, 'one');
  begin(client, chatUri, 't1', 'write hi');
  await until(() => needed(p, uri, 'toolConfirmation') !== undefined);
  const entry = needed(p, uri, 'toolConfirmation') as { id: string };

  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', toolCallId: 'call-a', approved: false, reason: 'denied' } },
  });
  await until(() => ended(p, chatUri));

  expect(ran).toEqual([]);
  const confirmed = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallConfirmed');
  // The reason the model is given, said back as well so the client can draw
  // why the row was cancelled rather than only that it was.
  expect(String(confirmed?.action.reason)).toContain('declined');
  expect(JSON.stringify(model.requests[1]?.messages)).toContain('declined');

  const { chat, session } = reduced(p, uri, chatUri);
  expect(session.inputNeeded).toBeUndefined();
  expect(actions(p, uri).some((e) => e.action.type === 'session/inputNeededRemoved' && e.action.id === entry.id)).toBe(true);
  const call = chat.turns[0]?.responseParts.find((one) => one.kind === 'toolCall')?.toolCall as { status: string };
  expect(call.status).toBe('cancelled');
  expect(types(p, chatUri)).toContain('chat/turnComplete');
});

it('keeps two open approvals independent, each answered by its own call id', async () => {
  const ran: string[] = [];
  const model = createFakeModel({
    script: [
      { toolCalls: [{ name: 'write', input: { text: 'a' }, callId: 'call-a' }] },
      { toolCalls: [{ name: 'write', input: { text: 'b' }, callId: 'call-b' }] },
      { text: 'done a' },
      { text: 'done b' },
    ],
    stream: true,
  });
  const { client, peer: p } = await talking(model, [writer(ran)], asksFor(['write']));
  const a = await open(client, 'a');
  const b = await open(client, 'b');
  begin(client, a.chatUri, 't1', 'write a');
  await until(() => needed(p, a.uri, 'toolConfirmation') !== undefined);
  begin(client, b.chatUri, 't1', 'write b');
  await until(() => needed(p, b.uri, 'toolConfirmation') !== undefined);

  // Both are open at once, each named by its own call id.
  expect((needed(p, a.uri, 'toolConfirmation') as { toolCall: { toolCallId: string } }).toolCall.toolCallId).toBe('call-a');
  expect((needed(p, b.uri, 'toolConfirmation') as { toolCall: { toolCallId: string } }).toolCall.toolCallId).toBe('call-b');

  // Answer the first only. The second is another session's, so nothing this
  // one does may touch it.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: a.chatUri, action: { type: 'chat/toolCallConfirmed', toolCallId: 'call-a', approved: true, confirmed: 'user-action' } },
  });
  await until(() => ended(p, a.chatUri));

  expect(ended(p, b.chatUri)).toBe(false);
  expect(actions(p, b.uri).some((e) => e.action.type === 'session/inputNeededRemoved')).toBe(false);
  expect(reduced(p, b.uri, b.chatUri).session.inputNeeded?.map((one) => one.kind)).toEqual(['toolConfirmation']);

  // And the second still runs from its own answer rather than a settled one.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: b.chatUri, action: { type: 'chat/toolCallConfirmed', toolCallId: 'call-b', approved: true, confirmed: 'user-action' } },
  });
  await until(() => ended(p, b.chatUri));
  expect(ran.sort()).toEqual(['a', 'b']);
  expect(reduced(p, a.uri, a.chatUri).session.inputNeeded).toBeUndefined();
  expect(reduced(p, b.uri, b.chatUri).session.inputNeeded).toBeUndefined();
});

it('mirrors a question at the session and answers it back into the run', async () => {
  const questions: AskQuestion[] = [
    { id: 'which', question: 'Which note?', header: 'Note', options: [{ label: 'monday' }, { label: 'tuesday' }] },
  ];
  const model = createFakeModel({
    script: [
      { toolCalls: [{ name: 'ask_user', input: { questions }, callId: 'call-q' }] },
      { text: 'noted' },
    ],
    stream: true,
  });
  const { client, peer: p } = await talking(model, [asker], asksFor([]));
  const { uri, chatUri } = await open(client, 'one');
  begin(client, chatUri, 't1', 'ask me');
  await until(() => needed(p, uri, 'chatInput') !== undefined);

  const entry = needed(p, uri, 'chatInput') as {
    id: string;
    chat: string;
    request: { id: string; message: string; questions: { id: string; kind: string; message: string; options: { id: string; label: string }[] }[] };
  };
  expect(entry.chat).toBe(chatUri);
  expect(entry.request.questions).toHaveLength(1);
  expect(entry.request.questions[0]).toMatchObject({ id: 'which', kind: 'single-select', message: 'Which note?' });
  expect(entry.request.questions[0]?.options.map((one) => one.label)).toEqual(['monday', 'tuesday']);
  // A question is not a completion either.
  await settle();
  expect(ended(p, chatUri)).toBe(false);

  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/inputCompleted',
        requestId: entry.request.id,
        response: 'accept',
        // The protocol's own answer shape, two levels in, which is what a
        // client actually sends.
        answers: { which: { state: 'submitted', value: { kind: 'selected', value: 'monday' } } },
      },
    },
  });
  await until(() => ended(p, chatUri));

  const done = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete');
  expect(JSON.stringify(done?.action.result)).toContain('monday');
  expect(actions(p, uri).some((e) => e.action.type === 'session/inputNeededRemoved' && e.action.id === entry.id)).toBe(true);
  expect(reduced(p, uri, chatUri).session.inputNeeded).toBeUndefined();
  // The model was given the answer rather than an empty form.
  expect(JSON.stringify(model.requests[1]?.messages)).toContain('monday');
});

it('declines a question as a deny rather than an empty answer', async () => {
  const questions: AskQuestion[] = [{ id: 'which', question: 'Which note?' }];
  const model = createFakeModel({
    script: [
      { toolCalls: [{ name: 'ask_user', input: { questions }, callId: 'call-q' }] },
      { text: 'noted' },
    ],
    stream: true,
  });
  const { client, peer: p } = await talking(model, [asker], asksFor([]));
  const { uri, chatUri } = await open(client, 'one');
  begin(client, chatUri, 't1', 'ask me');
  await until(() => needed(p, uri, 'chatInput') !== undefined);
  const entry = needed(p, uri, 'chatInput') as { id: string; request: { id: string } };

  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: { type: 'chat/inputCompleted', requestId: entry.request.id, response: 'decline' },
    },
  });
  await until(() => ended(p, chatUri));

  const done = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete');
  const result = done?.action.result as { success: boolean; error?: { message: string } };
  expect(result.success).toBe(false);
  expect(result.error?.message).toContain('declined');
  expect(actions(p, uri).some((e) => e.action.type === 'session/inputNeededRemoved' && e.action.id === entry.id)).toBe(true);
  expect(reduced(p, uri, chatUri).session.inputNeeded).toBeUndefined();
});

it('asks about a destructive host tool with no policy configured', async () => {
  const ran: string[] = [];
  const model = createFakeModel({ script: writeScript('c1', 'note'), stream: true });
  // No `policy` option: the pause has to come from the tool's own effects and
  // facio's default policy, which is what a JSON-configured daemon can reach.
  const { client, peer: p } = await talking(model, [{ ...writer(ran), effects: { writes: true, destructive: true } }], {});
  const { uri, chatUri } = await open(client, 'destructive');
  begin(client, chatUri, 't1', 'write it');
  await until(() => needed(p, uri, 'toolConfirmation') !== undefined);

  expect(needed(p, uri, 'toolConfirmation')).toBeDefined();
  // Asked, so not run, and the turn is not over.
  expect(ran).toEqual([]);
  expect(types(p, chatUri)).not.toContain('chat/turnComplete');
});

it('runs a host tool that says nothing about itself', async () => {
  const ran: string[] = [];
  const model = createFakeModel({ script: writeScript('c2', 'plain'), stream: true });
  const { client, peer: p } = await talking(model, [writer(ran)], {});
  const { uri, chatUri } = await open(client, 'no-effects');
  begin(client, chatUri, 't1', 'write it');
  await until(() => ended(p, chatUri));

  expect(needed(p, uri, 'toolConfirmation')).toBeUndefined();
  expect(ran).toEqual(['plain']);
});
