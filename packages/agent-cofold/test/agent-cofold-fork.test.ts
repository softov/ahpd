import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { textOf } from '@cofold/agents';
import { createFakeModel } from '@cofold/agents/testing';
import { createFileStore } from '@cofold/store-file';
import type { ModelAdapter, Policy } from '@cofold/agents';
import type { Agent, Bag, Session, Start } from '@ahpd/sdk';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import { createHost } from '../../sdk/src/host.js';
import { chatUriFor } from '../../sdk/src/host/channels.js';
import { cofoldAgent } from '../src/index.js';
import type { Peer } from '../../sdk/src/types/rpc.js';

/*
 * A cofold conversation cut at a turn.
 *
 * AHP means two things by a cut: a fork continues from a turn under a new id
 * and leaves the original whole, and a rewind keeps the id and drops what
 * followed the turn. Both are `Store.sessions` doing the work - `fork` and
 * `truncate` - before the first turn of the new session runs, so what these
 * check is the bridge: which point it hands over, that the store was cut where
 * the client asked, and that a cut which cannot be made fails the turn rather
 * than continuing from the wrong place.
 */

/*
 * Let the run's work finish, up to a point; no waiting on a real model.
 *
 * Bounded by the clock and polled with `setImmediate`, not counted in timer
 * ticks: a zero-delay timer on Windows can take fifteen milliseconds, which
 * made a count of ticks the slowest part of every case. A wait that runs out
 * fails, so a condition that can never hold is not passed by waiting.
 */
const WAIT_MS = 10_000;
const tick = (): Promise<void> => new Promise((r) => { setImmediate(r); });

const until = async (check: () => boolean): Promise<void> => {
  const deadline = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`still waiting after ${WAIT_MS} ms`);
    await tick();
  }
};

/** The same, for a condition only the store or an async read can answer. */
const untilAsync = async (check: () => Promise<boolean>): Promise<void> => {
  const deadline = Date.now() + WAIT_MS;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(`still waiting after ${WAIT_MS} ms`);
    await tick();
  }
};

type Note = { channel: 'session' | 'chat' | 'terminal'; action: Bag };

/** One session's channels, collected the way the host would dispatch them. */
function channels() {
  const notes: Note[] = [];
  return {
    notes,
    emit: (channel: 'session' | 'chat' | 'terminal', action: Bag): void => { notes.push({ channel, action }); },
    types: (channel: string): string[] =>
      notes.filter((one) => one.channel === channel).map((one) => String(one.action.type)),
    failure: (): Bag | undefined =>
      notes.find((one) => one.action.type === 'chat/error')?.action,
  };
}

/** A directory a store and a workspace can both live under. */
const place = (): { root: string; sweep: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-cofold-fork-'));
  return { root: join(dir, 'store'), sweep: join(dir, 'work') };
};

/** A policy that lets every tool run; nothing here uses one, but a pause would hang a turn. */
const allowAll = (): Partial<Policy> => ({ decide: () => ({ behavior: 'allow' }) });

const backend = (root: string, model: ModelAdapter): Agent =>
  cofoldAgent({ adapter: model, store: root, policy: allowAll() });

/** Open one session on a backend, with everything the harness would have handed it. */
function open(agent: Agent, id: string, workingDirectory: string, extra: Partial<Start> = {}) {
  const view = channels();
  const session: Session = agent.create({
    uri: `ahp-session:/${id}`,
    chatUri: `ahp-chat:/${id}`,
    settings: agent.defaults(),
    workingDirectory,
    schema: () => agent.schema(),
    emit: view.emit,
    // The host always resolves this, and its own answer when the deployment
    // said nothing is ten minutes.
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
    ...extra,
  });
  return { session, view, uri: `ahp-session:/${id}`, chatUri: `ahp-chat:/${id}` };
}

/** A turn has said how it ended - completed, cancelled or failed. */
const finished = (view: ReturnType<typeof channels>): boolean =>
  view.types('chat').some((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled' || type === 'chat/error');

/** Run one turn and wait for its end, with the notes cleared so the wait is for this one. */
const runTurn = async (
  opened: { session: Session; view: ReturnType<typeof channels> },
  turnId: string,
  text: string,
): Promise<void> => {
  opened.view.notes.length = 0;
  opened.session.sendMessage(turnId, text);
  await until(() => finished(opened.view));
};

/**
 * One conversation of three turns.
 *
 * The script has an answer for each turn and one more for whatever a test
 * continues with, so the model never runs out mid-case.
 */
const threeTurns = async () => {
  const { root, sweep } = place();
  const model = createFakeModel({
    script: [
      { text: 'answer one' },
      { text: 'answer two' },
      { text: 'answer three' },
      { text: 'answer four' },
    ],
    stream: true,
  });
  const agent = backend(root, model);
  const one = open(agent, 'one', sweep);
  await runTurn(one, 't1', 'question one');
  await runTurn(one, 't2', 'question two');
  await runTurn(one, 't3', 'question three');
  return { root, sweep, agent, one };
};

/** What a session's transcript says each turn was asked, in order. */
const questions = async (agent: Agent, id: string): Promise<(string | undefined)[]> =>
  (await agent.transcript?.(id))?.map((turn) => (turn.message as Bag | undefined)?.text as string | undefined) ?? [];

/** Wait until a session's transcript has the number of turns the cut should have left. */
const waitTurns = async (agent: Agent, id: string, count: number): Promise<void> =>
  untilAsync(async () => (await agent.transcript?.(id))?.length === count);

/**
 * A point the session watched run, or a failed case.
 *
 * `forkPoint` and `endPoint` are optional and answer nothing for a turn this
 * process did not watch; a case about a cut is about a point that is there, so
 * the absence is a broken test rather than a value to pass on.
 */
const pointOf = (value: string | undefined): string => {
  if (value === undefined) throw new Error('the session recorded no point for the turn this case cuts at');
  return value;
};

it('forks at a turn into a conversation of its own and leaves the source whole', async () => {
  const { agent, one, sweep } = await threeTurns();
  const point = pointOf(one.session.forkPoint?.('t2'));
  const source = String(one.session.agentId());

  // The host forks a chat by resuming the conversation it copies and naming
  // the prompt to resume at; the target id is the backend's to mint.
  const forked = open(agent, 'one', sweep, { resume: source, forkAt: point });
  const target = String(forked.session.agentId());
  expect(target).not.toBe(source);
  await waitTurns(agent, target, 2);
  expect(await questions(agent, target)).toEqual(['question one', 'question two']);
  // The original is untouched, which is the whole difference from a rewind.
  expect(await questions(agent, source)).toEqual(['question one', 'question two', 'question three']);

  // The fork goes on as itself: what it says now is not in the source.
  await runTurn(forked, 't4', 'question four');
  expect(await questions(agent, target)).toEqual(['question one', 'question two', 'question four']);
  expect(await questions(agent, source)).toEqual(['question one', 'question two', 'question three']);
});

it('rewinds the same conversation to a turn, dropping what followed', async () => {
  const { agent, one, sweep } = await threeTurns();
  const id = String(one.session.agentId());
  const at = pointOf(one.session.endPoint?.('t2'));

  const rewound = open(agent, 'one', sweep, { resume: id, rewindAt: at });
  expect(String(rewound.session.agentId())).toBe(id);
  await waitTurns(agent, id, 2);
  expect(await questions(agent, id)).toEqual(['question one', 'question two']);

  // The dropped run went with its turn and the claim is free, so the next turn
  // runs rather than being refused `writer_busy` by a writer that outlived the
  // turn the rewind dropped.
  await runTurn(rewound, 't4', 'question four');
  expect(rewound.view.types('chat')).not.toContain('chat/error');
  expect(await questions(agent, id)).toEqual(['question one', 'question two', 'question four']);
});

/*
 * An agent that offers a fork forks at any turn that ended, restored ones
 * included, as VS Code's Copilot restores each turn under the boundary its
 * fork and truncate cut at.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L882-L888
 */
it('answers, for a turn read back after a restart, the point the run that wrote it ended at', async () => {
  const { root, agent, one, sweep } = await threeTurns();
  const id = String(one.session.agentId());
  const watched = ['t1', 't2', 't3'].map((turn) => pointOf(one.session.forkPoint?.(turn)));
  await one.session.close();

  // A restart: a fresh backend reads the conversation and resumes it on what
  // it read, in the host's order.
  const again = backend(root, createFakeModel({ script: [{ text: 'answer four' }], stream: true }));
  const seed = (await again.transcript?.(id)) ?? [];
  expect(seed.map((turn) => turn.id)).toEqual(['t1', 't2', 't3']);
  const readBack = open(again, 'one', sweep, { resume: id, seed });
  expect(seed.map((turn) => readBack.session.forkPoint?.(String(turn.id)))).toEqual(watched);
  expect(seed.map((turn) => readBack.session.endPoint?.(String(turn.id)))).toEqual(watched);
  expect(readBack.session.forkPoint?.('nobody')).toBeUndefined();
  // The capability is the backend's; the point is the session's, and a host
  // offers the control only when both are there.
  expect(again.chats?.fork).toBe(true);

  // A fork at a turn read back copies the conversation through it.
  const forked = open(again, 'one', sweep, { resume: id, forkAt: pointOf(readBack.session.forkPoint?.('t2')) });
  const target = String(forked.session.agentId());
  await waitTurns(again, target, 2);
  expect(await questions(again, target)).toEqual(['question one', 'question two']);
  expect(await questions(agent, id)).toEqual(['question one', 'question two', 'question three']);
});

it('answers no point for a turn handed in a seed no read of the store named', async () => {
  const { root, one, sweep } = await threeTurns();
  const id = String(one.session.agentId());
  await one.session.close();
  // The turns come from one backend's read, and the session from another
  // that read nothing.
  const reader = backend(root, createFakeModel({ script: [], stream: true }));
  const seed = (await reader.transcript?.(id)) ?? [];
  const fresh = backend(root, createFakeModel({ script: [], stream: true }));
  const unnamed = open(fresh, 'one', sweep, { resume: id, seed });
  expect(unnamed.session.forkPoint?.('t1')).toBeUndefined();
  expect(unnamed.session.endPoint?.('t1')).toBeUndefined();
});

it('refuses a session asked to fork and rewind at once', async () => {
  const { agent, one, sweep } = await threeTurns();
  const both = open(agent, 'one', sweep, {
    resume: String(one.session.agentId()),
    forkAt: pointOf(one.session.forkPoint?.('t2')),
    rewindAt: pointOf(one.session.endPoint?.('t2')),
  });
  await runTurn(both, 't4', 'question four');
  const failure = both.view.failure();
  expect(failure).toBeDefined();
  expect(String(((failure?.part as Bag).error as Bag).message)).toMatch(/cannot fork and rewind at once/);
});

it('fails the turn when the point is not in the conversation, rather than continuing', async () => {
  const { root, agent, one, sweep } = await threeTurns();
  const store = createFileStore({ root });
  const id = String(one.session.agentId());
  const before = (await store.sessions.listMessages({ sessionId: id })).length;

  const bad = open(agent, 'one', sweep, { resume: id, rewindAt: 'no-such-message' });
  await runTurn(bad, 't4', 'question four');
  expect(bad.view.types('chat')).toContain('chat/error');
  // The refusal lands before any run: a turn that failed must not have
  // appended the question it was asked.
  expect((await store.sessions.listMessages({ sessionId: id })).length).toBe(before);
});

/**
 * Wait until a fork has landed, failing on its own message after a wall-clock
 * limit inside the case's.
 *
 * `Store.sessions.fork` writes the target's messages first and then each kept
 * run's record, events and steps, so the fork is whole once the messages are
 * there and every source run that ended inside them has all of its events and
 * steps in the target.
 */
const landed = async (store: ReturnType<typeof createFileStore>, source: string, target: string, ms = 2000): Promise<void> => {
  const limit = Date.now() + ms;
  const runs = await store.runs.list({ sessionId: source });
  const whole = async (): Promise<boolean> => {
    const kept = new Set((await store.sessions.listMessages({ sessionId: target })).map((message) => message.id));
    if (kept.size === 0) return false;
    for (const run of runs) {
      if (run.lastMessageId === undefined || !kept.has(run.lastMessageId)) continue;
      const from = { sessionId: source, runId: run.runId };
      const to = { sessionId: target, runId: run.runId };
      if ((await store.runs.listEvents(to)).length !== (await store.runs.listEvents(from)).length) return false;
      if ((await store.runs.listSteps(to)).length !== (await store.runs.listSteps(from)).length) return false;
    }
    return true;
  };
  for (;;) {
    // A target the fork has not made yet is `not_found`, which is not landed.
    if (await whole().catch(() => false)) return;
    if (Date.now() > limit) throw new Error(`timed out waiting for the fork of ${source} to land in ${target}`);
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

it('copies the kept turns with their records, not just their text', async () => {
  // The same fork, asserted on the store rather than on the transcript, so the
  // two views cannot agree by accident. The cut is at the message the forked
  // turn ended with - a fork copies the conversation through the turn it names,
  // answer included - so both of the first two turns come whole.
  const { root, agent, one, sweep } = await threeTurns();
  const store = createFileStore({ root });
  const id = String(one.session.agentId());
  expect((await store.sessions.listMessages({ sessionId: id })).map(textOf)).toEqual([
    'question one', 'answer one', 'question two', 'answer two', 'question three', 'answer three',
  ]);

  const forked = open(agent, 'one', sweep, { resume: id, forkAt: pointOf(one.session.forkPoint?.('t2')) });
  const target = String(forked.session.agentId());
  // The target session does not exist until the fork lands, and asking for its
  // messages before that is `not_found` rather than an empty list.
  const copied = async (): Promise<string[]> => {
    try {
      return (await store.sessions.listMessages({ sessionId: target })).map(textOf);
    }
    catch {
      return [];
    }
  };
  await landed(store, id, target);
  expect(await copied()).toEqual(['question one', 'answer one', 'question two', 'answer two']);
  // Every kept turn is a whole turn, so every kept run came with it.
  const runs = await store.runs.list({ sessionId: target });
  expect(runs.map((run) => run.status)).toEqual(['completed', 'completed']);
  expect(runs.every((run) => run.inputMessageId !== undefined && run.lastMessageId !== undefined)).toBe(true);
});

it('still opens a session when neither was asked', () => {
  const { root, sweep } = place();
  const model = createFakeModel({ script: [{ text: 'unused' }], stream: true });
  const agent = backend(root, model);
  const session = open(agent, 'plain', sweep).session;
  expect(session.uri).toBe('ahp-session:/plain');
  expect(session.forkPoint?.('t1')).toBeUndefined();
});

/*
 * The same two cuts, as a client asks for them.
 *
 * The session-level cases above hand `forkAt` and `rewindAt` over directly;
 * these drive the host that decides which point to hand over - `forkPoint` on
 * `createChat` with `source.kind: 'fork'`, `endPoint` on a `chat/truncated`
 * dispatch - so the two halves are checked against each other rather than
 * against the test's idea of which id means what.
 */

/** A connected client with one cofold session, watching both its channels. */
async function throughHost(root: string) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-cofold-fork-host-'));
  const model = createFakeModel({
    script: [{ text: 'answer one' }, { text: 'answer two' }, { text: 'answer three' }, { text: 'answer four' }],
    stream: true,
  });
  const agent = cofoldAgent({ adapter: model, store: root, policy: allowAll() });
  const host = createHost({ path, agents: [agent] });
  const notes: { method: string; params: unknown }[] = [];
  const peer: Peer = {
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
  const client = host.accept(peer);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/one';
  const chatUri = chatUriFor(uri);
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'cofold' } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { client, notes, uri, chatUri };
}

/** The chat actions the host told this client about, in order. */
const told = (notes: { method: string; params: unknown }[], channel: string): Bag[] =>
  notes
    .filter((one) => one.method === 'action')
    .map((one) => one.params as { channel: string; action: Bag })
    .filter((one) => one.channel === channel)
    .map((one) => one.action);

/** Ask for one turn the way a client does, and wait for it to end. */
const say = async (
  through: Awaited<ReturnType<typeof throughHost>>,
  chatUri: string,
  turnId: string,
  text: string,
): Promise<void> => {
  through.notes.length = 0;
  await through.client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
  });
  await until(() => told(through.notes, chatUri).some((action) =>
    action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled' || action.type === 'chat/error'));
};

it('forks through the host, from the source chat into a chat of its own', async () => {
  const { root } = place();
  const through = await throughHost(root);
  await say(through, through.chatUri, 't1', 'question one');
  await say(through, through.chatUri, 't2', 'question two');
  await say(through, through.chatUri, 't3', 'question three');

  const forkedChat = 'ahp-chat:/one/fork';
  await through.client.handle({
    method: 'createChat',
    params: { channel: through.uri, chat: forkedChat, source: { kind: 'fork', chat: through.chatUri, turnId: 't2' } },
  });
  // Watched as a client watches it, which is what tells `say` its turn ended.
  await through.client.handle({ method: 'subscribe', params: { channel: forkedChat } });

  const store = createFileStore({ root });
  // The cut is a store call the session makes before its first turn, so the
  // target appears a moment after the chat does.
  const targets = async (): Promise<string[]> =>
    (await store.sessions.list({})).map((record) => record.sessionId).filter((id) => id !== 'one');
  await untilAsync(async () => (await targets()).length === 1);
  const target = String((await targets())[0]);
  // Through the chosen turn, answer included: the host hands the backend the
  // point the turn ended at, and the copy stops there.
  await untilAsync(async () => {
    try {
      return (await store.sessions.listMessages({ sessionId: target })).length === 4;
    }
    catch {
      return false;
    }
  });
  expect((await store.sessions.listMessages({ sessionId: target })).map(textOf))
    .toEqual(['question one', 'answer one', 'question two', 'answer two']);

  // The forked chat is a chat of the host's now: what is said in it lands in
  // the new conversation and not in the one it was copied from.
  await say(through, forkedChat, 't4', 'question four');
  expect((await store.sessions.listMessages({ sessionId: target })).map(textOf))
    .toEqual(['question one', 'answer one', 'question two', 'answer two', 'question four', 'answer four']);
  expect((await store.sessions.listMessages({ sessionId: 'one' })).map(textOf))
    .toEqual(['question one', 'answer one', 'question two', 'answer two', 'question three', 'answer three']);
});

it('rewinds through the host, under the id the session already had', async () => {
  const { root } = place();
  const through = await throughHost(root);
  await say(through, through.chatUri, 't1', 'question one');
  await say(through, through.chatUri, 't2', 'question two');
  await say(through, through.chatUri, 't3', 'question three');

  const store = createFileStore({ root });
  await through.client.handle({
    method: 'dispatchAction',
    params: { channel: through.chatUri, action: { type: 'chat/truncated', turnId: 't2' } },
  });
  await untilAsync(async () => (await store.sessions.listMessages({ sessionId: 'one' })).length === 4);
  expect((await store.sessions.listMessages({ sessionId: 'one' })).map(textOf))
    .toEqual(['question one', 'answer one', 'question two', 'answer two']);

  // The client's edit-and-resend: the same chat carries on under the same
  // session, with the turns it dropped gone.
  await say(through, through.chatUri, 't4', 'question four');
  expect((await store.sessions.listMessages({ sessionId: 'one' })).map(textOf))
    .toEqual(['question one', 'answer one', 'question two', 'answer two', 'question four', 'answer four']);
  expect(told(through.notes, through.chatUri).some((action) => action.type === 'chat/error')).toBe(false);
});
