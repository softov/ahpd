import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { chatReducer, sessionReducer } from '@microsoft/agent-host-protocol';
import { createHost } from '../src/host.js';
import { Status } from '../src/sessions/catalog.js';
import { notes } from '../../../examples/notes/agent.js';
import type { Peer } from '../src/types/rpc.js';

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
  if (!ready()) throw new Error(`still waiting after ${tries} tries`);
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

// A refused envelope is left out, as a client leaves it.
const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown>; rejectionReason?: string })
  .filter((e) => e.channel === channel && e.rejectionReason === undefined)
  .map((e) => e.action);

const say = (client: { handle(r: { method: string; params: unknown }): unknown }, chatUri: string, text: string): void => {
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: `t${String(Date.now())}`, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
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
    session: { status: number; inputNeeded?: { id: string; kind: string }[] };
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
        answers: { name: { state: 'submitted', value: { kind: 'selected', value: 'monday.md' } } },
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

  // The stop names the running turn, as a client's does.
  const running = actions(p, chatUri).find((a) => a.type === 'chat/turnStarted')?.turnId;
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: running, duration: 0 } },
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
  // The session's status is what its reducer made of the actions it was
  // sent, so a client subscribing now reads the bits a watching client holds,
  // and the input-needed bit left with the question. Its activity is read
  // without the read bit, which is the person's and not the turn's.
  const activity = (status: number): number => status & (Status.IsRead - 1);
  expect(activity(opened.snapshot.state.status)).toBe(activity(session.status));
  expect(opened.snapshot.state.status & (Status.InputNeeded & ~Status.InProgress)).toBe(0);
  // And the session's row, which aggregates its chats, says it is idle.
  const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string; status: number }[];
  };
  expect(activity(listed.items.find((one) => one.resource === uri)?.status ?? 0)).toBe(Status.Idle);
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
  const { dir, client, peer: p, uri, chatUri } = await talking();
  /*
   * After the first turn, which is when the key is fixed.
   *
   * Before it, an immutable key is still the session being created
   * differently: the host starts the backend again with the new value rather
   * than refusing, which is what makes the value a person picked in the New
   * view the one the session runs with. Once something has been said the key
   * is refused here, and never reaches `setConfig`.
   */
  await writeFile(join(dir, 'hello.md'), 'the whole of it\n', 'utf8');
  say(client, chatUri, 'read hello');
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/turnComplete'));
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
  expect(why.rejectionReason).toBe('tone is fixed once the session has started');
});

it('takes one its schema marks mutable, and refuses a value its list does not offer', async () => {
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
  // A value the property's list does not offer, refused by the host in the
  // reference host's words, which name the key and the value.
  // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L144-L148
  const why = p.notes.filter((n) => n.method === 'action').at(-1)?.params as { rejectionReason?: string };
  expect(why.rejectionReason).toBe('Session configuration \'ask\' does not offer \'sometimes\'.');
});
