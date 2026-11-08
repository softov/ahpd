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
 * the underlying request resolves." The reference host raises an entry from
 * the chat's state while the chat's running turn holds its request open, under
 * an id of its own, and takes every entry of a chat down with its turn; no
 * agent raises one (sessionInputNeededContribution.ts L19-L83 at 6b68d3fe).
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
function forgetful(drafts: boolean): { agent: Agent; held: () => Start } {
  const base = echo({ path: DIR, pace: 0 });
  let start: Start | undefined;
  return {
    agent: {
      ...base,
      provider: 'forgetful',
      displayName: 'Forgetful',
      // A backend that keeps a draft answer or none, as the case asks.
      create: (given) => { start = given; return drafts ? { ...base.create(given), setAnswer: () => true } : base.create(given); },
    },
    held: () => start as Start,
  };
}

async function opened(drafts = true) {
  const { agent, held } = forgetful(drafts);
  const host = createHost({ path: DIR, agents: [agent] });
  const p = peer();
  const client = host.accept(p);
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
  const chat = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } })
    .snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  /** A client's action on the chat, and the refusal it met, if any. */
  const sent = async (clientSeq: number, action: Bag): Promise<string | undefined> => {
    await client.handle({ method: 'dispatchAction', params: { channel: chat, clientSeq, action } });
    await settle();
    return p.notes
      .filter((one) => one.method === 'action')
      .map((one) => one.params as { origin?: { clientSeq: number }; rejectionReason?: string })
      .find((one) => one.origin?.clientSeq === clientSeq)?.rejectionReason;
  };
  /** Every action said on the chat, in order. */
  const said = (): Bag[] => p.notes
    .filter((one) => one.method === 'action')
    .map((one) => one.params as { channel: string; action: Bag })
    .filter((one) => one.channel === chat)
    .map((one) => one.action);
  return { start, entries, sent, said };
}

/*
 * A draft answer is the request's synced answer state, which the reducer
 * keeps on the request whatever the backend keeps; the reference host takes
 * one for every agent.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L355-L356
 */
it('takes a draft answer for a backend that keeps no drafts, and says it to the chat', async () => {
  const { start, sent, said } = await opened(false);
  start.emit('chat', {
    type: 'chat/inputRequested',
    request: { id: 'q1', message: 'Who?', questions: [{ id: 'name', kind: 'text', message: 'Your name' }] },
  });
  await settle();
  const answer = { state: 'draft', value: { kind: 'text', value: 'An' } };
  expect(await sent(1, { type: 'chat/inputAnswerChanged', requestId: 'q1', questionId: 'name', answer })).toBeUndefined();
  expect(said().filter((one) => one.type === 'chat/inputAnswerChanged')).toEqual([
    { type: 'chat/inputAnswerChanged', requestId: 'q1', questionId: 'name', answer },
  ]);
});

/** A question with one required field, held open in the running turn. */
const asked = (start: Start): void => {
  start.emit('chat', {
    type: 'chat/inputRequested',
    request: { id: 'q1', message: 'Who?', questions: [{ id: 'name', kind: 'text', message: 'Your name', required: true }] },
  });
};

/*
 * An answer held to the request it answers: "`response` is `'accept'` but
 * required questions do not have submitted answers" and "`answer.state`
 * requires a value but `answer.value` is absent" SHOULD each be rejected. No
 * VS Code client can tell: its host hands answers on unchecked, and its clients
 * send what their forms hold.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L356-L358
 */
it('refuses an acceptance that leaves a required question with no answer', async () => {
  const { start, sent } = await opened();
  asked(start);
  await settle();
  expect(await sent(1, { type: 'chat/inputCompleted', requestId: 'q1', response: 'accept' }))
    .toBe('name is required and has no submitted answer');
  expect(await sent(2, {
    type: 'chat/inputCompleted', requestId: 'q1', response: 'accept',
    answers: { name: { state: 'submitted', value: { kind: 'text', value: 'Ana' } } },
  })).toBeUndefined();
});

/*
 * A draft is not a submitted answer, synced to the request or carried by the
 * completion: the reducer records the request's answers with the completion's
 * laid over them, and the row asks each required question for a submitted one.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L874
 */
it('refuses an acceptance whose required question holds only a draft', async () => {
  const { start, sent } = await opened();
  asked(start);
  await settle();
  const draft = { state: 'draft', value: { kind: 'text', value: 'An' } };
  expect(await sent(1, { type: 'chat/inputAnswerChanged', requestId: 'q1', questionId: 'name', answer: draft })).toBeUndefined();
  expect(await sent(2, { type: 'chat/inputCompleted', requestId: 'q1', response: 'accept' }))
    .toBe('name is required and has no submitted answer');
  expect(await sent(3, { type: 'chat/inputCompleted', requestId: 'q1', response: 'accept', answers: { name: draft } }))
    .toBe('name is required and has no submitted answer');
  expect(await sent(4, {
    type: 'chat/inputCompleted', requestId: 'q1', response: 'accept',
    answers: { name: { state: 'submitted', value: { kind: 'text', value: 'Ana' } } },
  })).toBeUndefined();
});

it('refuses a draft answer that carries no value of the kind it names', async () => {
  const { start, sent } = await opened();
  asked(start);
  await settle();
  expect(await sent(1, { type: 'chat/inputAnswerChanged', requestId: 'q1', questionId: 'name', answer: { state: 'draft', value: { kind: 'text' } } }))
    .toBe('The answer to name has no text value');
  expect(await sent(2, { type: 'chat/inputAnswerChanged', requestId: 'q1', questionId: 'name', answer: { state: 'draft' } }))
    .toBe('The answer to name has no value');
  expect(await sent(3, { type: 'chat/inputAnswerChanged', requestId: 'q1', questionId: 'name', answer: { state: 'skipped' } }))
    .toBeUndefined();
});

/*
 * The answer kinds are `@nonexhaustive`, and the row names a kind missing its
 * payload: a value of a kind the protocol does not list names none, and is
 * taken.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L583-L595
 */
it('takes an answer of a kind the protocol does not list', async () => {
  const { start, sent } = await opened();
  asked(start);
  await settle();
  expect(await sent(1, {
    type: 'chat/inputAnswerChanged', requestId: 'q1', questionId: 'name',
    answer: { state: 'draft', value: { kind: 'colour', value: '#00f' } },
  })).toBeUndefined();
});

it('raises a call\'s confirmation under VS Code\'s id, and takes it down with its turn', async () => {
  const { start, entries } = await opened();
  start.emit('chat', { type: 'chat/toolCallStart', turnId: 't1', toolCallId: 'c1', toolName: 'write', displayName: 'Write' });
  start.emit('chat', { type: 'chat/toolCallReady', turnId: 't1', toolCallId: 'c1', invocationMessage: 'Write a file' });
  await settle();
  expect((await entries()).map((one) => [one.id, one.kind, one.turnId]))
    .toEqual([[`toolConfirmation:${start.chatUri}:t1:c1`, 'toolConfirmation', 't1']]);

  start.emit('chat', { type: 'chat/turnComplete', turnId: 't1', duration: 1 });
  await settle();
  expect(await entries()).toEqual([]);
});

it('raises a question under VS Code\'s id, and takes it down once the question has its response', async () => {
  const { start, entries } = await opened();
  start.emit('chat', { type: 'chat/inputRequested', request: { id: 'q1', message: 'Which one?' } });
  await settle();
  expect(await entries()).toEqual([
    { id: `chatInput:${start.chatUri}:q1`, kind: 'chatInput', chat: start.chatUri, request: { id: 'q1', message: 'Which one?' } },
  ]);

  start.emit('chat', { type: 'chat/inputCompleted', requestId: 'q1', response: 'cancel' });
  await settle();
  expect(await entries()).toEqual([]);
});

/*
 * An entry names a call in the state its kind is raised for: the reference
 * host raises a confirmation at a pending confirmation, a client execution
 * while the call runs with a client contributor, and an authentication at
 * auth-required. A call still being announced is in none of them, and an
 * entry a backend raises itself is not said.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L105-L157
 */
it('raises nothing for a call still being announced, nor for an entry a backend raises itself', async () => {
  const { start, entries } = await opened();
  start.emit('chat', { type: 'chat/toolCallStart', turnId: 't1', toolCallId: 'c1', toolName: 'write', displayName: 'Write' });
  for (const [id, kind] of [['own', 'toolConfirmation'], ['client', 'toolClientExecution'], ['auth', 'toolAuthentication']] as const) {
    start.emit('session', {
      type: 'session/inputNeededSet',
      request: { id, kind, chat: start.chatUri, turnId: 't1', toolCall: { toolCallId: 'c1', status: 'streaming' } },
    });
  }
  await settle();
  expect(await entries()).toEqual([]);
});

it('keeps a call\'s entry while it waits on a confirmation', async () => {
  const { start, entries } = await opened();
  start.emit('chat', { type: 'chat/toolCallStart', turnId: 't1', toolCallId: 'c1', toolName: 'write', displayName: 'Write' });
  start.emit('chat', { type: 'chat/toolCallReady', turnId: 't1', toolCallId: 'c1', invocationMessage: 'Write a file' });
  start.emit('chat', { type: 'chat/responsePart', turnId: 't1', part: { id: 'p1', kind: 'markdown', content: 'thinking' } });
  await settle();
  expect((await entries()).map((one) => one.id)).toEqual([`toolConfirmation:${start.chatUri}:t1:c1`]);
});
