import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { chatReducer, sessionReducer } from '@microsoft/agent-host-protocol';
import { createHost } from '../src/host.js';
import { Status } from '../src/sessions/catalog.js';
import { notes } from '../../../examples/notes/agent.js';
import type { Start } from '../src/types/agent.js';
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
async function talking(autoApprove = 'default') {
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
    params: { channel: uri, provider: 'notes', config: { autoApprove } },
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

// A command picked from the slash menu runs, as VS Code's providers run the commands they offer.
it('runs /read and /write picked from the slash menu as the commands they are offered as', async () => {
  const { dir, client, peer: p, chatUri } = await talking('autoApprove');
  await writeFile(join(dir, 'hello.md'), 'the whole of it\n', 'utf8');
  say(client, chatUri, '/read hello');
  await until(() => actions(p, chatUri).filter((a) => a.type === 'chat/turnComplete').length === 1);
  say(client, chatUri, '/write other some words');
  await until(() => actions(p, chatUri).filter((a) => a.type === 'chat/turnComplete').length === 2);
  const tools = actions(p, chatUri).filter((a) => a.type === 'chat/toolCallStart').map((a) => a.toolName);
  expect(tools).toEqual(['readNote', 'writeNote']);
  expect(await readFile(join(dir, 'other.md'), 'utf8')).toBe('some words\n');
});

// The approvals key is VS Code's autoApprove, its name and levels
// (src/vs/platform/agentHost/common/agentHostSchema.ts L387-L405 at 6b68d3fe).
it('says in its help what asks under the approvals level in force', async () => {
  const all = await talking('autoApprove');
  say(all.client, all.chatUri, 'help');
  await until(() => actions(all.peer, all.chatUri).some((a) => a.type === 'chat/turnComplete'));
  const { chat: quiet } = reduced(all.peer, all.uri, all.chatUri);
  const told = String(quiet.turns[0]?.responseParts[0]?.content);
  expect(told).toContain('- `write <name> <text>` - write one.');
  expect(told).not.toContain('I will ask before I do');

  const manual = await talking('default');
  say(manual.client, manual.chatUri, 'help');
  await until(() => actions(manual.peer, manual.chatUri).some((a) => a.type === 'chat/turnComplete'));
  const { chat: careful } = reduced(manual.peer, manual.uri, manual.chatUri);
  const said = String(careful.turns[0]?.responseParts[0]?.content);
  expect(said).toContain('- `write <name> <text>` - write one. I will ask before I do.');
  expect(said).toContain('- `read <name>` - read one. Leave the name out');
});

/*
 * A finished turn carries its state and the message as the client sent it,
 * which a client reads of every turn it is served:
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L797
 */
it('keeps a finished turn complete, with the message as the client sent it', async () => {
  const { dir, client, peer: p, uri, chatUri } = await talking();
  await writeFile(join(dir, 'hello.md'), 'the whole of it\n', 'utf8');
  say(client, chatUri, 'read hello');
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/turnComplete'));
  await client.handle({ method: 'disposeSession', params: { channel: uri } });
  // Disposed, the session is the backend's own copy alone, which a listing
  // shows as an external session once the root asks for those, as VS Code's.
  await client.handle({ method: 'dispatchAction', params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { showExternalSessions: 'last30Days' } } } });
  // Opened again from the backend's own record of it, which is what a later client reads.
  const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string }[];
  };
  const row = await client.handle({ method: 'subscribe', params: { channel: listed.items[0]?.resource ?? '' } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const opened = await client.handle({ method: 'subscribe', params: { channel: row.snapshot.state.defaultChat } }) as {
    snapshot: { state: { turns: { state?: string; message: { origin?: { kind: string } } }[] } };
  };
  expect(opened.snapshot.state.turns[0]?.state).toBe('complete');
  expect(opened.snapshot.state.turns[0]?.message.origin).toEqual({ kind: 'user' });
});

/*
 * A turn whose work throws ends in `chat/error`, as VS Code's host ends a
 * failed send:
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2329-L2337
 */
it('ends a turn whose work throws in chat/error, as VS Code ends a failed send', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ahpd-notes-'));
  dirs.push(dir);
  const heard: Record<string, unknown>[] = [];
  const session = await notes({ path: dir, pace: 0 }).create({
    uri: 'ahp-session:/broken',
    chatUri: 'ahp-chat:/broken',
    settings: { autoApprove: 'autoApprove' },
    clientToolTimeoutMs: 1000,
    schema: () => ({}),
    emit: (_channel: string, action: Record<string, unknown>) => { heard.push(action); },
    // The changeset's hook is the one call the work makes outside a tool's own guard.
    onFileEdit: () => { throw new Error('the changeset is gone'); },
  } as unknown as Start);
  session.sendMessage('t1', 'write hello there', { origin: { kind: 'user' } });
  await until(() => heard.some((a) => a.type === 'chat/error'));
  expect(heard.find((a) => a.type === 'chat/error')).toMatchObject({
    turnId: 't1',
    part: { kind: 'error', error: { errorType: 'sendFailed', message: 'the changeset is gone' } },
  });
  expect(heard.some((a) => a.type === 'chat/turnComplete')).toBe(false);
  expect((session.chatState() as { turns: { state?: string }[] }).turns[0]?.state).toBe('error');
});

// A stop ends the work it parked, as VS Code aborts a stopped turn's work.
it('says nothing more of a turn after its stop, though a question or a call was parked in it', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  say(client, chatUri, 'write held something');
  await until(() => actions(p, uri).some((a) => a.type === 'session/inputNeededSet'));
  const running = actions(p, chatUri).find((a) => a.type === 'chat/turnStarted')?.turnId;
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: running, duration: 0 } },
  });
  await settle();
  const said = actions(p, chatUri);
  const stopped = said.findLastIndex((a) => a.type === 'chat/turnCancelled');
  expect(said.slice(stopped + 1).map((a) => a.type)
    .filter((type) => type === 'chat/responsePart' || type === 'chat/delta' || type === 'chat/toolCallConfirmed')).toEqual([]);
});

// A row carries the moment its session began, as VS Code lists a session.
it('lists a finished session with the moment it began', async () => {
  const { dir, client, peer: p, uri, chatUri } = await talking();
  await writeFile(join(dir, 'hello.md'), 'the whole of it\n', 'utf8');
  // Long enough that the session's start and its turn's end are two moments.
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  say(client, chatUri, 'read hello');
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/turnComplete'));
  await client.handle({ method: 'disposeSession', params: { channel: uri } });
  // Disposed, the session is the backend's own copy alone, which a listing
  // shows as an external session once the root asks for those, as VS Code's.
  await client.handle({ method: 'dispatchAction', params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { showExternalSessions: 'last30Days' } } } });
  const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { createdAt: string; modifiedAt: string }[];
  };
  expect(Date.parse(listed.items[0]?.createdAt ?? '')).toBeLessThan(Date.parse(listed.items[0]?.modifiedAt ?? ''));
});

it('asks before it writes, and writes once it is allowed', async () => {
  const { dir, client, peer: p, uri, chatUri } = await talking();
  say(client, chatUri, 'write shopping bread and milk');
  await until(() => actions(p, uri).some((a) => a.type === 'session/inputNeededSet'));

  // The session says what is wanted, so a client that never subscribed to the
  // chat still knows somebody is being asked.
  const asked = actions(p, uri).find((a) => a.type === 'session/inputNeededSet');
  const request = asked?.request as { id: string; kind: string; chat: string; turnId: string; toolCall: { toolCallId: string } };
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
      // The call the entry names, as a client answers the entry's call.
      action: { type: 'chat/toolCallConfirmed', turnId: request.turnId, toolCallId: request.toolCall.toolCallId, approved: true, confirmed: 'user-action' },
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

/*
 * A client's decision on a call is said once, as the client's: the host says
 * it in the backend's place, and the backend's own word on the call it already
 * moved is not said again, as VS Code's host echoes a client's confirmation
 * once and no provider says one of its own.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1878-L1904
 */
it('says a client\'s decision on a call once, as the client\'s, as VS Code\'s host', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  say(client, chatUri, 'write shopping bread and milk');
  await until(() => actions(p, uri).some((a) => a.type === 'session/inputNeededSet'));
  const asked = actions(p, uri).find((a) => a.type === 'session/inputNeededSet');
  const request = asked?.request as { id: string; turnId: string; toolCall: { toolCallId: string } };
  void client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      clientSeq: 7,
      action: { type: 'chat/toolCallConfirmed', turnId: request.turnId, toolCallId: request.toolCall.toolCallId, approved: true, confirmed: 'user-action' },
    },
  });
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/turnComplete'));
  const confirmed = p.notes
    .filter((n) => n.method === 'action')
    .map((n) => n.params as { channel: string; action: Record<string, unknown>; origin?: { clientId: string; clientSeq: number } })
    .filter((e) => e.channel === chatUri && e.action.type === 'chat/toolCallConfirmed');
  expect(confirmed.map((e) => e.origin)).toEqual([{ clientId: 'probe', clientSeq: 7 }]);
});

it('writes nothing when it is told not to', async () => {
  const { dir, client, peer: p, uri, chatUri } = await talking();
  say(client, chatUri, 'write secrets everything');
  await until(() => actions(p, uri).some((a) => a.type === 'session/inputNeededSet'));
  const request = actions(p, uri).find((a) => a.type === 'session/inputNeededSet')?.request as { turnId: string; toolCall: { toolCallId: string } };

  void client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: { type: 'chat/toolCallConfirmed', turnId: request.turnId, toolCallId: request.toolCall.toolCallId, approved: false, reason: 'denied' },
    },
  });
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/turnComplete'));

  // The denial is said once, by the host, as VS Code's host echoes a client's
  // confirmation and hands it to its agent, which says none of its own
  // (src/vs/platform/agentHost/node/agentSideEffects.ts L1878-L1904 at 6b68d3fe).
  expect(actions(p, chatUri).filter((a) => a.type === 'chat/toolCallConfirmed')).toHaveLength(1);
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
    id: string; kind: string; request: { id: string; questions: { options: { id: string }[] }[] };
  };
  // The other kind of question: not a tool call, and answered by the id of the
  // request the entry carries.
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
        requestId: request.request.id,
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
  const { dir, client, peer: p, uri, chatUri } = await talking('autoApprove');
  say(client, chatUri, 'write quiet no questions');
  await until(() => actions(p, chatUri).some((a) => a.type === 'chat/turnComplete'));

  expect(actions(p, uri).map((a) => a.type)).not.toContain('session/inputNeededSet');
  expect(await readFile(join(dir, 'quiet.md'), 'utf8')).toBe('no questions\n');
});

it('changes when it asks on a session that is already running', async () => {
  const { client, peer: p, uri, chatUri } = await talking('autoApprove');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'session/configChanged', config: { autoApprove: 'default' } } },
  });
  await settle();

  // Confirmed back, because a mode applied in silence leaves each client
  // showing whatever it last chose for itself.
  expect(actions(p, uri).some((a) => a.type === 'session/configChanged'
    && (a.config as { autoApprove?: string }).autoApprove === 'default')).toBe(true);

  // And writing asks now, which it did not a moment ago.
  say(client, chatUri, 'write anything at all');
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
  // The session's status is its chats' aggregate as the host keeps it, as
  // VS Code's state manager does, so a client subscribing now reads it idle,
  // and the input-needed bit left with the question. Its activity is read
  // without the read bit, which is the person's and not the turn's.
  const activity = (status: number): number => status & (Status.IsRead - 1);
  expect(activity(opened.snapshot.state.status)).toBe(Status.Idle);
  expect(opened.snapshot.state.status & (Status.InputNeeded & ~Status.InProgress)).toBe(0);
  expect(session.status & (Status.InputNeeded & ~Status.InProgress)).toBe(0);
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

/*
 * A value its property's list does not offer is refused in the reference
 * host's words for one, since a client draws a property with a list as a
 * picker of exactly those values.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L144-L148
 */
it('takes one its schema marks mutable, and refuses a value its list does not offer in the reference host\'s words', async () => {
  const { client, peer: p, uri } = await talking();
  await client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'session/configChanged', config: { autoApprove: 'autoApprove' } } },
  });
  await settle();
  expect(actions(p, uri).some((a) => a.type === 'session/configChanged'
    && (a.config as { autoApprove?: string }).autoApprove === 'autoApprove')).toBe(true);

  await client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'session/configChanged', config: { autoApprove: 'sometimes' } } },
  });
  await settle();
  // The whole sentence, naming the key and the value it does not offer.
  const why = p.notes.filter((n) => n.method === 'action').at(-1)?.params as { rejectionReason?: string };
  expect(why.rejectionReason).toBe('Session configuration \'autoApprove\' does not offer \'sometimes\'.');
});
