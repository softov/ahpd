import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * A session's entries, held to what its chats hold open.
 *
 * "Host-managed: the host upserts entries with `session/inputNeededSet` as
 * chats raise requests and removes them with `session/inputNeededRemoved` once
 * the underlying request resolves." The reference host keeps an entry while
 * the chat's running turn holds its request open, and takes every entry of a
 * chat down with its turn (sessionInputNeededContribution.ts L40-L83 at
 * a4e689ae). The backend here raises entries and never takes one down, as a
 * backend that forgets is the case this guards.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/state.ts#L243-L245
 */

const DIR = '/tmp/ahpd-input-needed';

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

const settle = async (times = 20): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** The example, with its emitter handed to the case. */
function forgetful(): { agent: Agent; held: () => Start } {
  const base = echo({ path: DIR, pace: 0 });
  let start: Start | undefined;
  return {
    agent: { ...base, provider: 'forgetful', displayName: 'Forgetful', create: (given) => { start = given; return base.create(given); } },
    held: () => start as Start,
  };
}

async function opened() {
  const { agent, held } = forgetful();
  const host = createHost({ path: DIR, agents: [agent] });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  const uri = 'ahp-session:/forgetful';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'forgetful' } });
  await settle();
  const start = held();
  start.emit('chat', { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'go', origin: { kind: 'user' } } });
  /** What a client subscribing now is served of the session's entries. */
  const entries = async (): Promise<Bag[]> => ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as {
    snapshot: { state: { inputNeeded?: Bag[] } };
  }).snapshot.state.inputNeeded ?? [];
  return { start, entries };
}

it('takes a chat\'s entries down with its turn', async () => {
  const { start, entries } = await opened();
  start.emit('chat', { type: 'chat/toolCallStart', turnId: 't1', toolCallId: 'c1', toolName: 'write', displayName: 'Write' });
  start.emit('chat', { type: 'chat/toolCallReady', turnId: 't1', toolCallId: 'c1', invocationMessage: 'Write a file' });
  start.emit('session', {
    type: 'session/inputNeededSet',
    request: { id: 'own', kind: 'toolConfirmation', chat: start.chatUri, turnId: 't1', toolCall: { toolCallId: 'c1', status: 'pending-confirmation' } },
  });
  await settle();
  expect((await entries()).map((one) => one.id)).toEqual(['own']);

  start.emit('chat', { type: 'chat/turnComplete', turnId: 't1', duration: 1 });
  await settle();
  expect(await entries()).toEqual([]);
});

it('takes a question\'s entry down once the question has its response', async () => {
  const { start, entries } = await opened();
  start.emit('chat', { type: 'chat/inputRequested', request: { id: 'q1', message: 'Which one?' } });
  start.emit('session', {
    type: 'session/inputNeededSet',
    request: { id: 'own-q', kind: 'chatInput', chat: start.chatUri, request: { id: 'q1', message: 'Which one?' } },
  });
  await settle();
  expect((await entries()).map((one) => one.id)).toEqual(['own-q']);

  start.emit('chat', { type: 'chat/inputCompleted', requestId: 'q1', response: 'cancel' });
  await settle();
  expect(await entries()).toEqual([]);
});

it('keeps an entry while its call waits on a confirmation', async () => {
  const { start, entries } = await opened();
  start.emit('chat', { type: 'chat/toolCallStart', turnId: 't1', toolCallId: 'c1', toolName: 'write', displayName: 'Write' });
  start.emit('chat', { type: 'chat/toolCallReady', turnId: 't1', toolCallId: 'c1', invocationMessage: 'Write a file' });
  start.emit('session', {
    type: 'session/inputNeededSet',
    request: { id: 'own', kind: 'toolConfirmation', chat: start.chatUri, turnId: 't1', toolCall: { toolCallId: 'c1', status: 'pending-confirmation' } },
  });
  start.emit('chat', { type: 'chat/responsePart', turnId: 't1', part: { id: 'p1', kind: 'markdown', content: 'thinking' } });
  await settle();
  expect((await entries()).map((one) => one.id)).toEqual(['own']);
});
