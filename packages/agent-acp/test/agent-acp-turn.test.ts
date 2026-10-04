import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { chatReducer } from '@microsoft/agent-host-protocol';
import type { ChatAction, ChatState } from '@microsoft/agent-host-protocol';
import { Status } from '../../sdk/src/catalog.js';
import { idOf } from '@ahpd/sdk';
import type { Bag } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';
import { gitChanges } from '../../sdk/src/changes.js';
import { shellTerminals } from '../../sdk/src/terminals.js';
import { acpAgent } from '../src/index.js';
import type { ChangesetFile, ChangesetSource } from '../../sdk/src/types/changes.js';
import type { Peer } from '../../sdk/src/types/rpc.js';

/*
 * One ACP turn, as a client drives it.
 *
 * The server is a real subprocess (`test/fixtures/acp-server.mjs`), so the
 * handshake, the framing and the shutdown are the protocol's rather than a
 * mock's. What this checks is that one `session/update` reaches the client as
 * the `chat/*` action it means, in the order AHP requires, and that the two
 * actions a client sends back - a cancel and nothing else yet - reach the
 * server.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: async () => {},
  };
}

/** Let the subprocess's work finish, up to a point; the fixture never sleeps. */
const until = async (check: () => boolean | Promise<boolean>, times = 2000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (await check()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
};

type Note = { channel: string; action: Record<string, unknown> };

const actions = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

const types = (p: ReturnType<typeof peer>, channel: string): string[] =>
  actions(p, channel).map((e) => String(e.action.type));

/** Everything the server said, as prose. */
const prose = (p: ReturnType<typeof peer>, chatUri: string): string => actions(p, chatUri)
  .filter((e) => e.action.type === 'chat/delta')
  .map((e) => String(e.action.content))
  .join('');

/** What a changeset holds behind one of its minted URIs. */
const text = async (source: ChangesetSource, uri: string): Promise<string | undefined> =>
  (await source.read?.(uri))?.data;

/** A connected client with one ACP session, watching both its channels. */
async function talking(options: { changes?: ChangesetSource } = {}) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-'));
  const host = createHost({
    path,
    agents: [acpAgent({ command: process.execPath, args: [FIXTURE], provider: 'acp' })],
    // The composer's `!` prefix is the host's shell, so the host has to hold one.
    terminals: shellTerminals(),
    ...(options.changes === undefined ? {} : { changes: options.changes }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/one';
  const chatUri = 'ahp-chat:/one';
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'acp', workingDirectories: [`file://${path}`] },
  });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  opened.push({ client, uri });
  return { host, client, peer: p, uri, chatUri, path };
}

/** The sessions this file started, so each one's subprocess is stopped. */
const opened: { client: ReturnType<ReturnType<typeof createHost>['accept']>; uri: string }[] = [];

afterEach(async () => {
  for (const one of opened.splice(0)) {
    await one.client.handle({ method: 'disposeSession', params: { channel: one.uri } });
  }
});

/** The action a turn began with, dispatched the way a client dispatches it. */
const begin = (client: Awaited<ReturnType<typeof talking>>['client'], chatUri: string, turnId: string, text: string): void => {
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text } } },
  });
};

const ended = (p: ReturnType<typeof peer>, chatUri: string): boolean =>
  types(p, chatUri).some((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled');

it('turns one prompt into turnStarted, an opened part, deltas and turnComplete, in that order', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'hi');
  await until(() => ended(p, chatUri));

  const order = types(p, chatUri).filter((type) => type === 'chat/turnStarted'
    || type === 'chat/responsePart'
    || type === 'chat/delta');
  expect(order.slice(0, 3)).toEqual(['chat/turnStarted', 'chat/responsePart', 'chat/delta']);
  expect(types(p, chatUri)).toContain('chat/turnComplete');
  expect(types(p, chatUri).at(-1)).toBe('chat/turnComplete');
  expect(types(p, chatUri).filter((type) => type === 'chat/turnStarted')).toHaveLength(1);

  const snapshot = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: { content?: string }[] }[] } };
  };
  expect(snapshot.snapshot.state.turns).toHaveLength(1);
  expect(snapshot.snapshot.state.turns[0]?.responseParts[0]?.content).toBe('hello there');
});

it('keeps a delta a plain action and sends reasoning as chat/reasoning', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'think it through');
  await until(() => ended(p, chatUri));

  const deltas = actions(p, chatUri).filter((e) => e.action.type === 'chat/delta');
  expect(deltas.length).toBeGreaterThan(0);
  for (const one of deltas) {
    // The ACP update and its session id are not on the wire; the action is AHP's.
    expect(Object.keys(one.action).sort()).toEqual(['content', 'partId', 'turnId', 'type']);
  }

  const prose = deltas.map((e) => String(e.action.content)).join('');
  expect(prose).toBe('hello there');
  const reasoning = actions(p, chatUri).filter((e) => e.action.type === 'chat/reasoning');
  expect(reasoning.map((e) => String(e.action.content)).join('')).toBe('weighing it up');
  // The one part is opened once, before the thinking it fills.
  const openedThinking = actions(p, chatUri).filter((e) => e.action.type === 'chat/responsePart'
    && (e.action.part as { kind?: string } | undefined)?.kind === 'reasoning');
  expect(openedThinking).toHaveLength(1);
  const order = types(p, chatUri);
  expect(order.indexOf('chat/responsePart')).toBeLessThan(order.indexOf('chat/reasoning'));
});

it('opens a part per run of one kind, in the order the server wrote them', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'ponder it');
  await until(() => ended(p, chatUri));

  type Part = { id: string; kind: string; content?: string; toolCall?: { toolCallId: string } };
  const kept = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: Part[] }[] } };
  }).snapshot.state.turns[0]?.responseParts ?? [];
  expect(kept.map((part) => part.kind)).toEqual(['reasoning', 'toolCall', 'reasoning', 'markdown']);
  expect(kept.map((part) => part.content ?? part.toolCall?.toolCallId))
    .toEqual(['first thought', 'call-2', 'second thought', 'the answer']);
  expect(new Set(kept.map((part) => part.id)).size).toBe(4);

  // Each text part is announced once, before the first chunk that fills it,
  // and every chunk names the part it belongs to.
  const said = actions(p, chatUri).map((e) => e.action);
  const announced = said.filter((action) => action.type === 'chat/responsePart')
    .map((action) => (action.part as Part).id);
  expect(announced).toEqual([kept[0]?.id, kept[2]?.id, kept[3]?.id]);
  for (const action of said.filter((one) => one.type === 'chat/reasoning' || one.type === 'chat/delta')) {
    expect(said.findIndex((one) => one.type === 'chat/responsePart' && (one.part as Part).id === action.partId))
      .toBeLessThan(said.indexOf(action));
  }
  expect(said.filter((one) => one.partId === kept[2]?.id).map((one) => one.content)).toEqual(['second ', 'thought']);
});

it('opens no part for a message that is only whitespace, and keeps the whitespace an answer starts with', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'blank it');
  await until(() => ended(p, chatUri));

  type Part = { id: string; kind: string; content?: string; toolCall?: { toolCallId: string } };
  const kept = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: Part[] }[] } };
  }).snapshot.state.turns[0]?.responseParts ?? [];
  expect(kept.map((part) => part.kind)).toEqual(['reasoning', 'toolCall', 'reasoning', 'markdown']);
  expect(kept.map((part) => part.content ?? part.toolCall?.toolCallId))
    .toEqual(['first thought', 'call-2', 'second thought', ' \nthe answer']);
  expect(kept.map((part) => part.id)).toEqual(['t1:0', 'call-2', 't1:2', 't1:3']);

  // The held whitespace goes out with the words it came before, in their part.
  const said = actions(p, chatUri).map((e) => e.action);
  expect(said.filter((one) => one.type === 'chat/delta').map((one) => [one.partId, one.content]))
    .toEqual([['t1:3', ' \nthe answer']]);
  expect(said.filter((one) => one.type === 'chat/responsePart').map((one) => (one.part as Part).id))
    .toEqual(['t1:0', 't1:2', 't1:3']);
});

it('holds the plan in one call, which each update rewrites and the turn closes', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'plan it');
  await until(() => ended(p, chatUri));

  // One row for two plans: opened and readied by the first, rewritten by each
  // one after it, and completed by the turn ending rather than by an update.
  const plan = actions(p, chatUri).filter((e) => e.action.toolCallId === 't1:plan'
    && String(e.action.type).startsWith('chat/toolCall'));
  expect(plan.map((e) => e.action.type)).toEqual([
    'chat/toolCallStart',
    'chat/toolCallReady',
    'chat/toolCallContentChanged',
    'chat/toolCallContentChanged',
    'chat/toolCallComplete',
  ]);
  // Nothing in the protocol says when the agent has finished writing a plan,
  // so the call is still running when the second one arrives and completes
  // after both.
  expect(plan[2]?.action.content).toEqual([
    { type: 'text', text: '- [ ] Read the file (in_progress)' },
    { type: 'text', text: '- [ ] Write the answer' },
  ]);
  expect(plan[4]?.action.result).toMatchObject({
    success: true,
    content: [
      { type: 'text', text: '- [x] Read the file' },
      { type: 'text', text: '- [ ] Write the answer (in_progress)' },
    ],
  });

  /*
   * The client's own fold, which is what the screen is drawn from: one part,
   * holding the last plan, which the snapshot has to agree with.
   */
  let state = { turns: [], status: 0, modifiedAt: 'now' } as unknown as ChatState;
  for (const one of actions(p, chatUri)) {
    state = chatReducer(state, one.action as unknown as ChatAction);
  }
  const parts = state.turns.flatMap((turn) => turn.responseParts) as { kind: string; toolCall?: {
    toolCallId: string; toolName?: string; status?: string; success?: boolean; content?: unknown;
  } }[];
  const held = parts.filter((part) => part.kind === 'toolCall' && part.toolCall?.toolCallId === 't1:plan');
  expect(held).toHaveLength(1);
  expect(held[0]?.toolCall).toMatchObject({ toolName: 'plan', status: 'completed', success: true });
  expect(held[0]?.toolCall?.content).toEqual([
    { type: 'text', text: '- [x] Read the file' },
    { type: 'text', text: '- [ ] Write the answer (in_progress)' },
  ]);

  const kept = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: { kind: string; toolCall?: { content?: unknown } }[] }[] } };
  }).snapshot.state.turns[0]?.responseParts ?? [];
  // The plan call and the words that followed it, which are a part of their own.
  expect(kept.map((part) => part.kind)).toEqual(['toolCall', 'markdown']);
  expect(kept[0]?.toolCall?.content).toEqual([
    { type: 'text', text: '- [x] Read the file' },
    { type: 'text', text: '- [ ] Write the answer (in_progress)' },
  ]);
});

it('reports a tool call as start, ready and complete, with its result', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'use a tool');
  await until(() => ended(p, chatUri));

  const calls = types(p, chatUri).filter((type) => type.startsWith('chat/toolCall'));
  expect(calls).toEqual(['chat/toolCallStart', 'chat/toolCallReady', 'chat/toolCallComplete']);

  const done = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete');
  expect(done?.action.toolCallId).toBe('call-1');
  expect(done?.action.result).toMatchObject({ success: true });
  expect((done?.action.result as { content: { text: string }[] }).content[0]?.text).toBe('file body');
});

it('readies a call the agent started later with the arguments it announced it with', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'start it later');
  await until(() => ended(p, chatUri));

  // The call was announced `pending` with its arguments and the update that
  // started it carried a status alone, so the arguments the ready carries can
  // only be the ones the call was holding.
  const readies = actions(p, chatUri).filter((e) => e.action.type === 'chat/toolCallReady'
    && e.action.toolCallId === 'call-later');
  expect(readies).toHaveLength(1);
  expect(readies[0]?.action.toolInput).toBe('{"url":"https://example.test/page"}');
});

it('completes a call the agent announced and finished at once, with its content', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'take it whole');
  await until(() => ended(p, chatUri));

  // One update carrying both the opening and the end: the row is opened and
  // closed at once, and the result is what the update said rather than empty.
  const calls = actions(p, chatUri).filter((e) => String(e.action.type).startsWith('chat/toolCall'));
  expect(calls.map((e) => e.action.type)).toEqual(['chat/toolCallStart', 'chat/toolCallReady', 'chat/toolCallComplete']);
  expect(calls[2]?.action.result).toMatchObject({ success: true });
  expect((calls[2]?.action.result as { content: { text: string }[] }).content[0]?.text).toBe('the whole body');
});

it('asks nothing on the way to a call the agent is still holding, and the question readies it', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'hold it');
  await until(() => types(p, uri).includes('session/inputNeededSet'));

  // The call arrived `pending`, which is the agent saying it has not started it.
  // A `not-needed` here would be a claim that nobody is going to be asked, and
  // the server asks one instruction later.
  const readies = actions(p, chatUri).filter((e) => e.action.type === 'chat/toolCallReady'
    && e.action.toolCallId === 'call-hold');
  expect(readies).toHaveLength(1);
  expect(readies[0]?.action.confirmed).toBeUndefined();
  expect(readies[0]?.action.toolInput).toBe('{"branch":"main"}');

  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-hold', approved: true },
    },
  });
  await until(() => ended(p, chatUri));
  expect(prose(p, chatUri)).toContain('perm=yes-once');

  // The agent said what the call was going to do while the question stood.
  // Arguments arriving after it are a reason to say them again, and a status
  // that starts the call is not a reason to say nobody will be asked: the
  // question is the call's readiness from then on.
  const later = actions(p, chatUri).filter((e) => e.action.type === 'chat/toolCallReady'
    && e.action.toolCallId === 'call-hold');
  expect(later).toHaveLength(1);
  expect(later.some((e) => e.action.confirmed === 'not-needed')).toBe(false);
});

it('opens, readies and completes a call whose first word was its end', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'jump to it');
  await until(() => ended(p, chatUri));

  // A row closed without ever being opened is a completion for a call nobody
  // drew, so the same three actions a call announced up front goes out here.
  const calls = actions(p, chatUri).filter((e) => String(e.action.type).startsWith('chat/toolCall'));
  expect(calls.map((e) => e.action.type)).toEqual(['chat/toolCallStart', 'chat/toolCallReady', 'chat/toolCallComplete']);
  expect(calls[0]?.action).toMatchObject({ toolCallId: 'call-jump', toolName: 'count_lines' });
  expect(calls[2]?.action.result).toMatchObject({ success: true });

  const kept = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: { kind?: string; toolCall?: { toolCallId: string; status: string } }[] }[] } };
  }).snapshot.state.turns[0]?.responseParts ?? [];
  expect(kept.map((part) => part.kind)).toEqual(['toolCall']);
  expect(kept[0]?.toolCall?.status).toBe('completed');
});

/** A changeset source that only remembers what it was asked to observe. */
function recorder(): { source: ChangesetSource; seen: { turnId: string; path: string; phase: string }[] } {
  const seen: { turnId: string; path: string; phase: string }[] = [];
  return {
    seen,
    source: {
      scopes: () => [],
      state: async () => undefined,
      summary: () => undefined,
      observe: (_dir, _session, turnId, path, phase) => { seen.push({ turnId, path, phase }); },
    },
  };
}

it('shows a call\'s terminal and diff content, and records the diff in the changeset', async () => {
  const changes = recorder();
  const { client, peer: p, chatUri, path } = await talking({ changes: changes.source });
  begin(client, chatUri, 't1', 'paint it');
  await until(() => ended(p, chatUri));

  const done = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete');
  const content = (done?.action.result as { content: Bag[] }).content;
  // The shell is the host's own, so the block is the one a `!command` builds.
  expect(content[0]).toMatchObject({ type: 'terminal', title: 'Terminal', isPty: false });
  expect(String((content[0] as Bag).resource)).toContain('terminal');
  // The file, as the edit a client draws: the after side is the file itself,
  // and there is no before here because no URI names what a file used to be.
  expect(content[1]).toEqual({
    type: 'fileEdit',
    after: { uri: `file://${join(path, 'painted.txt')}`, content: { uri: `file://${join(path, 'painted.txt')}` } },
  });

  // And the turn's changeset holds both of its sides, the before side being
  // what the diff carried rather than anything still on disk.
  expect(changes.seen).toEqual([
    { turnId: 't1', path: join(path, 'painted.txt'), phase: 'before' },
    { turnId: 't1', path: join(path, 'painted.txt'), phase: 'after' },
  ]);
});

it('holds the before side a diff carried, which the file itself no longer has', async () => {
  const changes = gitChanges();
  const { client, peer: p, chatUri, path } = await talking({ changes });
  begin(client, chatUri, 't1', 'paint it');
  await until(() => ended(p, chatUri));

  // The host gave the session the provider's own id, which is what its
  // changeset is keyed by. The `after` side is read off the file, so the row is
  // only whole once that read has landed.
  let row: ChangesetFile | undefined;
  await until(async () => {
    row = (await changes.state?.(path, 'acp:/one', 'turn/t1'))?.files[0];
    return row?.edit.after !== undefined;
  });
  // The file on disk is what the agent left, so the before side can only be
  // the one the diff said - which is what a review reads to show both sides.
  expect(await text(changes, row?.edit.before?.content?.uri as string)).toBe('a blank canvas\n');
  expect(await text(changes, row?.edit.after?.content?.uri as string)).toBe('a line of paint\n');
});

it('shows a diff of a file outside the session without recording it', async () => {
  const changes = recorder();
  const { client, peer: p, chatUri } = await talking({ changes: changes.source });
  begin(client, chatUri, 't1', 'edit it away');
  await until(() => ended(p, chatUri));

  const done = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete');
  expect((done?.action.result as { content: Bag[] }).content[0]).toMatchObject({ type: 'fileEdit' });
  expect(changes.seen).toEqual([]);
});

it('ends a cancelled turn as turnCancelled, once, with the cancel reaching the server', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'please wait');
  await until(() => types(p, chatUri).includes('chat/delta'));

  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  await until(() => types(p, chatUri).includes('chat/turnCancelled'));

  /*
   * The fixture holds the prompt open until `session/cancel` arrives, so this
   * turn ending at all is what proves the notification reached the server.
   */
  const said = types(p, chatUri);
  expect(said.filter((type) => type === 'chat/turnCancelled')).toHaveLength(1);
  expect(said).not.toContain('chat/turnComplete');
  expect(said.at(-1)).toBe('chat/turnCancelled');
});

it("runs a !command in the host's shell rather than asking the server", async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', '!echo acp-ran-it');
  await until(() => ended(p, chatUri));

  // The host's shell, not the ACP server: one tool call named `terminal`,
  // completed with what the shell printed. Before `ran` existed here the host
  // refused the turn, because the bridge had no way to hold it.
  const start = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallStart');
  expect(start?.action).toMatchObject({ toolName: 'terminal' });
  const completed = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete');
  expect((completed?.action.result as { success: boolean }).success).toBe(true);
  expect(JSON.stringify(completed?.action.result)).toContain('acp-ran-it');
  // The turn closes, so a client does not keep it open.
  expect(types(p, chatUri)).toContain('chat/turnComplete');

  // And in the snapshot, not only in the stream, with the call finished rather
  // than left `running` for a client that subscribed afterwards.
  const kept = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: { kind?: string; toolCall?: { toolName: string; status: string } }[] }[] } };
  }).snapshot.state.turns;
  expect(kept.at(-1)?.responseParts[0]?.kind).toBe('toolCall');
  expect(kept.at(-1)?.responseParts[0]?.toolCall?.toolName).toBe('terminal');
  expect(kept.at(-1)?.responseParts[0]?.toolCall?.status).toBe('completed');
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
  return (row?.params as { changes: { status?: unknown } } | undefined)?.changes.status;
};

it('announces the session idle with the turnComplete that ends its turn', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'hi');
  await until(() => ended(p, chatUri));
  expect(statusAtEnd(p, uri, chatUri, 'chat/turnComplete')).toBe(Status.Idle);
});

it('announces the session idle with the turnCancelled that ends its turn', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'please wait');
  await until(() => types(p, chatUri).includes('chat/delta'));
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  await until(() => types(p, chatUri).includes('chat/turnCancelled'));
  expect(statusAtEnd(p, uri, chatUri, 'chat/turnCancelled')).toBe(Status.Idle);
});

it('announces the session failed with the chat/error that ends its turn', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'fail');
  await until(() => types(p, chatUri).includes('chat/error'));
  expect(types(p, chatUri)).toContain('chat/error');
  expect(statusAtEnd(p, uri, chatUri, 'chat/error')).toBe(Status.Error);
});

it('announces the session idle with the turnComplete that ends a !command', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', '!echo acp-ran-it');
  await until(() => ended(p, chatUri));
  expect(statusAtEnd(p, uri, chatUri, 'chat/turnComplete')).toBe(Status.Idle);
});

/**
 * The turn the server stopped it with, as the error a client was given.
 *
 * `end_turn` is the answer and is in here as the case the others are read
 * against: one fixture case per stop reason the protocol names.
 */
const stoppedWith = async (reason: string): Promise<{ type?: string | undefined; error?: Bag }> => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', `tell me something stop=${reason}`);
  await until(() => ended(p, chatUri) || types(p, chatUri).includes('chat/error'));
  const part = actions(p, chatUri).find((e) => e.action.type === 'chat/error')?.action.part as
    { error?: Bag } | undefined;
  return { type: types(p, chatUri).at(-1), ...(part === undefined ? {} : { error: part.error }) };
};

it('ends a turn the server stopped for its own reasons as an error naming the reason', async () => {
  for (const reason of ['max_tokens', 'max_turn_requests', 'refusal']) {
    const stopped = await stoppedWith(reason);
    // Not a finished answer: a turn that stopped early is not what was asked for.
    expect(stopped.type).toBe('chat/error');
    // The reason is the error's type, so a client can tell the three apart
    // without reading the sentence.
    expect(stopped.error?.errorType).toBe(reason);
    expect(String(stopped.error?.message)).not.toBe('');
  }
});

it('completes an end_turn, and words a refusal as the agent declining', async () => {
  expect((await stoppedWith('end_turn')).type).toBe('chat/turnComplete');
  // A refusal is the agent declining, and its sentence says so.
  expect(String((await stoppedWith('refusal')).error?.message)).toContain('declined');
});

it('completes a turn whose stop reason this bridge does not know', async () => {
  // The protocol will name reasons a bridge built before it has not heard of,
  // and a stop it cannot describe is better read as an answer.
  expect((await stoppedWith('something_newer')).type).toBe('chat/turnComplete');
});
