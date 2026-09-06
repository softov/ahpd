import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { chatReducer, sessionReducer } from '@microsoft/agent-host-protocol';
import { createHost } from '../packages/sdk/src/host.js';
import { notes } from '../examples/notes/agent.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * The example with tools, driven as a client drives it.
 *
 * Two things are being checked, and the second is the reason this file exists.
 *
 * The first is that `Agent` is sufficient for a backend that stops and asks -
 * that `confirm` and `answer`, which `examples/echo` can only leave empty,
 * are enough to hold a turn open and let it go again.
 *
 * The second is that what the backend emits *reduces*. Every action here is
 * put through the protocol's own `chatReducer` and `sessionReducer`, which is
 * what a client actually runs, rather than being read back out of this host's
 * own snapshot. A snapshot is this host agreeing with itself; the reducer is
 * the other implementation. Every shape defect this repository has had - a
 * bare `inputNeeded`, a result beside its action rather than inside it - was
 * invisible to a host reading its own state and would have been loud here.
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

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Settle until something is true, rather than a fixed number of times. */
const until = async (ready: () => boolean, tries = 60): Promise<void> => {
  for (let i = 0; i < tries && !ready(); i++) await settle(2);
};

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A connected client with one notes session, watching both its channels. */
async function talking(ask = 'writes') {
  const dir = await mkdtemp(join(tmpdir(), 'ahpd-notes-'));
  dirs.push(dir);
  const host = createHost({ path: dir, agents: [notes({ path: dir, pace: 0 })] });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/one';
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'notes', config: { ask } },
  });
  // Read off the session rather than spelled out: what a session calls its chat
  // is the host's to say and every client's to look up.
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chatUri = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { dir, client, peer: p, uri, chatUri };
}

const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown> })
  .filter((e) => e.channel === channel)
  .map((e) => e.action);

const say = (client: { handle(r: { method: string; params: unknown }): unknown }, chatUri: string, text: string): void => {
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: `t${String(Date.now())}`, message: { text } } },
  });
};

/** The conversation a client ends up with, built the way a client builds it. */
const reduced = (p: ReturnType<typeof peer>, uri: string, chatUri: string) => {
  let chat: Record<string, unknown> = {
    resource: chatUri, title: '', status: 1, modifiedAt: '', turns: [], queuedMessages: [],
  };
  let session: Record<string, unknown> = {
    resource: uri, provider: 'notes', title: '', status: 1, lifecycle: 'ready',
    defaultChat: chatUri, chats: [], workingDirectories: [], customizations: [],
  };
  for (const action of actions(p, chatUri)) chat = chatReducer(chat as never, action as never) as never;
  for (const action of actions(p, uri)) session = sessionReducer(session as never, action as never) as never;
  return { chat, session } as {
    chat: { turns: { responseParts: Record<string, unknown>[] }[] };
    session: { inputNeeded?: { id: string; kind: string }[] };
  };
};

it('reads a note without asking, and says what it found', async () => {
  const { dir, client, peer: p, uri, chatUri } = await talking();
  await writeFile(join(dir, 'hello.md'), 'the whole of it\n', 'utf8');

  say(client, chatUri, 'read hello');
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/turnComplete'));

  // Nothing was asked - not on the chat, and not on the session either. A
  // client watching only the catalogue must not see this session light up.
  expect(actions(p, uri).map((a) => a.type)).not.toContain('session/inputNeededSet');
  const ready = actions(p, chatUri).find((a) => a.type === 'chat/toolCallReady');
  expect(ready?.confirmed).toBe('not-needed');

  const { chat } = reduced(p, uri, chatUri);
  const call = chat.turns[0]?.responseParts[0];
  expect(call).toMatchObject({ kind: 'toolCall' });
  // The tool's own output, which lives inside `result` and reaches a client
  // only from there.
  expect((call?.toolCall as { status: string; content: { text: string }[] }).status).toBe('completed');
  expect((call?.toolCall as { content: { text: string }[] }).content[0]?.text).toContain('the whole of it');
});

it('asks before it writes, and writes once it is allowed', async () => {
  const { dir, client, peer: p, uri, chatUri } = await talking();
  say(client, chatUri, 'write shopping bread and milk');
  await until(() => actions(p, uri).some((a) => a.type === 'session/inputNeededSet'));

  // The session says what is wanted, so a client that never subscribed to the
  // chat still knows somebody is being asked.
  const asked = actions(p, uri).find((a) => a.type === 'session/inputNeededSet');
  const request = asked?.request as { id: string; kind: string; chat: string; turnId: string };
  expect(request.kind).toBe('toolConfirmation');
  expect(request.chat).toBe(chatUri);
  const before = reduced(p, uri, chatUri);
  expect(before.session.inputNeeded?.map((one) => one.kind)).toEqual(['toolConfirmation']);
  // And nothing is on disk while it is still a question.
  await expect(readFile(join(dir, 'shopping.md'), 'utf8')).rejects.toThrow();

  void client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: { type: 'chat/toolCallConfirmed', toolCallId: request.id, approved: true, confirmed: 'user-action' },
    },
  });
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/turnComplete'));

  expect(await readFile(join(dir, 'shopping.md'), 'utf8')).toBe('bread and milk\n');
  const after = reduced(p, uri, chatUri);
  // Taken off the session by the same id it was put on with.
  expect(after.session.inputNeeded).toBeUndefined();
  const call = after.chat.turns[0]?.responseParts[0]?.toolCall as { status: string; confirmed: string };
  expect(call).toMatchObject({ status: 'completed', confirmed: 'user-action' });
});

it('writes nothing when it is told not to', async () => {
  const { dir, client, peer: p, uri, chatUri } = await talking();
  say(client, chatUri, 'write secrets everything');
  await until(() => actions(p, uri).some((a) => a.type === 'session/inputNeededSet'));
  const request = actions(p, uri).find((a) => a.type === 'session/inputNeededSet')?.request as { id: string };

  void client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: { type: 'chat/toolCallConfirmed', toolCallId: request.id, approved: false, reason: 'denied' },
    },
  });
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/turnComplete'));

  await expect(readFile(join(dir, 'secrets.md'), 'utf8')).rejects.toThrow();
  const { chat, session } = reduced(p, uri, chatUri);
  expect(session.inputNeeded).toBeUndefined();
  expect((chat.turns[0]?.responseParts[0]?.toolCall as { status: string }).status).toBe('cancelled');
  // And the turn says so, rather than ending as though the tool had run.
  const told = chat.turns[0]?.responseParts.at(-1) as { content?: string };
  expect(told.content).toContain('Left secrets.md alone');
});

it('asks which note when the line did not say, and reads the one named', async () => {
  const { dir, client, peer: p, uri, chatUri } = await talking();
  await writeFile(join(dir, 'monday.md'), 'washing\n', 'utf8');

  say(client, chatUri, 'read');
  await until(() => actions(p, uri).some((a) => a.type === 'session/inputNeededSet'));

  const request = actions(p, uri).find((a) => a.type === 'session/inputNeededSet')?.request as {
    id: string; kind: string; request: { questions: { options: { id: string }[] }[] };
  };
  // The other kind of question: not a tool call, and answered by its own id.
  expect(request.kind).toBe('chatInput');
  expect(request.request.questions[0]?.options.map((one) => one.id)).toEqual(['monday.md']);
  // `chat/inputRequested` opens its own response part, the way toolCallStart
  // does - so exactly one is in the transcript, not two.
  const asking = reduced(p, uri, chatUri);
  const open = (asking.chat as unknown as { activeTurn: { responseParts: { kind: string }[] } }).activeTurn;
  expect(open.responseParts.map((one) => one.kind)).toEqual(['inputRequest']);

  void client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: {
        type: 'chat/inputCompleted',
        requestId: request.id,
        response: 'accept',
        answers: { name: { value: { kind: 'selected', optionId: 'monday.md' } } },
      },
    },
  });
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/turnComplete'));

  const { chat, session } = reduced(p, uri, chatUri);
  expect(session.inputNeeded).toBeUndefined();
  const kinds = chat.turns[0]?.responseParts.map((one) => one.kind);
  expect(kinds).toEqual(['inputRequest', 'toolCall', 'markdown']);
  expect((chat.turns[0]?.responseParts[1]?.toolCall as { content: { text: string }[] }).content[0]?.text)
    .toContain('washing');
  expect(dirs).toContain(dir);
});

it('will not treat a name as a path', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  say(client, chatUri, 'write ../escaped nope');
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/turnComplete'));

  // Refused before any tool call exists, so there is nothing to approve.
  expect(actions(p, chatUri).map((a) => a.type)).not.toContain('chat/toolCallStart');
  expect(actions(p, uri).map((a) => a.type)).not.toContain('session/inputNeededSet');
});

it('stops asking when the session is told to stop asking', async () => {
  const { dir, client, peer: p, uri, chatUri } = await talking('never');
  say(client, chatUri, 'write quiet no questions');
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/turnComplete'));

  expect(actions(p, uri).map((a) => a.type)).not.toContain('session/inputNeededSet');
  expect(await readFile(join(dir, 'quiet.md'), 'utf8')).toBe('no questions\n');
});

it('changes when it asks on a session that is already running', async () => {
  const { client, peer: p, uri, chatUri } = await talking('never');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'session/configChanged', config: { ask: 'always' } } },
  });
  await settle();

  // Confirmed back, because a mode applied in silence leaves each client
  // showing whatever it last chose for itself.
  expect(actions(p, uri).some((a) => a.type === 'session/configChanged'
    && (a.config as { ask?: string }).ask === 'always')).toBe(true);

  // And reading asks now, which it did not a moment ago.
  say(client, chatUri, 'read anything');
  await until(() => actions(p, uri).some((a) => a.type === 'session/inputNeededSet'));
  expect(actions(p, uri).find((a) => a.type === 'session/inputNeededSet')).toBeDefined();
});

it('lets a cancelled turn go rather than leaving it waiting for an answer', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  say(client, chatUri, 'write held something');
  await until(() => actions(p, uri).some((a) => a.type === 'session/inputNeededSet'));

  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: '' } },
  });
  await settle();

  // The question goes with the turn. A session that keeps it reports
  // `InputNeeded` for the rest of its life, over a promise nothing settles.
  const { session } = reduced(p, uri, chatUri);
  expect(session.inputNeeded).toBeUndefined();
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { status: number; inputNeeded?: unknown[] } };
  };
  expect(opened.snapshot.state.inputNeeded).toBeUndefined();
  expect(opened.snapshot.state.status).toBe(1);
});

/*
 * The two fields the host reads off a backend's schema.
 *
 * `host.ts` imports no backend and used to hold four Claude key names, routing
 * `permissionMode`, `model`, `effortLevel` and `outputStyle` by name and
 * refusing `thinking` by name. Nothing about any of that was a fact about the
 * host: they are properties of whatever schema a backend published, and what
 * the generic layer needs to know is declared there. `notes` advertises no
 * Claude key at all, which is what makes it the honest place to check.
 */
it('refuses a key its schema marks immutable, without the backend being asked', async () => {
  const { client, peer: p, uri } = await talking();
  /*
   * Echoes, not refusals.
   *
   * A refusal is an `action` envelope carrying the very action it declined,
   * so counting by action type alone counts the no as a yes - which is what
   * this test did before it was corrected.
   */
  const echoed = () => p.notes
    .filter((n) => n.method === 'action')
    .map((n) => n.params as { channel: string; action: { type: string }; rejectionReason?: string })
    .filter((n) => n.channel === uri && n.rejectionReason === undefined
      && n.action.type === 'session/configChanged').length;
  const before = echoed();
  await client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'session/configChanged', config: { tone: 'terse' } } },
  });
  await settle();
  expect(echoed()).toBe(before);
  const why = p.notes.filter((n) => n.method === 'action').at(-1)?.params as { rejectionReason?: string };
  // Naming the key, which containment could not tell had been named.
  expect(why.rejectionReason).toBe('tone is fixed when the session is created');
});

it('takes one its schema marks mutable, and says so in the backend\'s words when the value is wrong', async () => {
  const { client, peer: p, uri } = await talking();
  await client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'session/configChanged', config: { ask: 'never' } } },
  });
  await settle();
  expect(actions(p, uri).some((a) => a.type === 'session/configChanged'
    && (a.config as { ask?: string }).ask === 'never')).toBe(true);

  await client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'session/configChanged', config: { ask: 'sometimes' } } },
  });
  await settle();
  // The backend's sentence, not the host's: only it knows whether the key or
  // the value was the problem, and saying "no such key" about a bad value
  // would tell a client to stop drawing a control that works.
  const why = p.notes.filter((n) => n.method === 'action').at(-1)?.params as { rejectionReason?: string };
  /*
   * The whole sentence, because the weak half was the assertion.
   *
   * `toContain('sometimes')` matched the value the test itself supplied, so
   * it passed on any message that echoed the bad input back - including one
   * that never named the key or said what the valid answers were, which is
   * the entire thing this test exists to check.
   */
  expect(why.rejectionReason).toBe('ask is one of writes, always or never - not sometimes');
});
