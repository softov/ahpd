import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { Status } from '../../sdk/src/catalog.js';
import { idOf } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';
import { shellTerminals } from '../../sdk/src/terminals.js';
import { acpAgent } from '../src/index.js';
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
const until = async (check: () => boolean, times = 2000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
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

/** A connected client with one ACP session, watching both its channels. */
async function talking() {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-'));
  const host = createHost({
    path,
    agents: [acpAgent({ command: process.execPath, args: [FIXTURE], provider: 'acp' })],
    // The composer's `!` prefix is the host's shell, so the host has to hold one.
    terminals: shellTerminals(),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/one';
  const chatUri = 'ahp-chat:/one';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'acp' } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  opened.push({ client, uri });
  return { host, client, peer: p, uri, chatUri };
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
