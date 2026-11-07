import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { chatReducer } from '@microsoft/agent-host-protocol';
import type { ChatAction, ChatState } from '@microsoft/agent-host-protocol';
import { Status } from '../../sdk/src/sessions/catalog.js';
import { idOf, uriOf } from '@ahpd/sdk';
import type { Bag, HostTool } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';
import { gitChanges } from '../../sdk/src/sessions/changes.js';
import { shellTerminals } from '../../sdk/src/machines/terminals.js';
import { acpAgent } from '../src/index.js';
import { anyone, signIn } from './people.js';
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
  throw new Error(`still waiting after ${times} tries`);
};

type Note = { channel: string; action: Record<string, unknown>; origin?: { clientId: string; clientSeq: number } };

const actions = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

/**
 * The types of the actions on one channel, in order.
 *
 * Without `chat/isReadChanged`, which the host sends after a turn's ending and
 * which says what a person has seen rather than what the turn did.
 */
const types = (p: ReturnType<typeof peer>, channel: string): string[] =>
  actions(p, channel).map((e) => String(e.action.type)).filter((type) => type !== 'chat/isReadChanged');

/** Everything the server said, as prose. */
const prose = (p: ReturnType<typeof peer>, chatUri: string): string => actions(p, chatUri)
  .filter((e) => e.action.type === 'chat/delta')
  .map((e) => String(e.action.content))
  .join('');

/** What a changeset holds behind one of its minted URIs. */
const text = async (source: ChangesetSource, uri: string): Promise<string | undefined> =>
  (await source.read?.(uri))?.data;

/** A connected client with one ACP session, watching both its channels. */
async function talking(options: { changes?: ChangesetSource; tools?: HostTool[]; cutTurns?: 'error' | 'complete' } = {}) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-'));
  const host = createHost({
    path,
    agents: [acpAgent({
      command: process.execPath,
      args: [FIXTURE],
      provider: 'acp',
      ...(options.cutTurns === undefined ? {} : { cutTurns: options.cutTurns }),
    })],
    // The composer's `!` prefix is the host's shell, so the host has to hold one.
    terminals: shellTerminals(),
    // And somebody for this window to be, without whom its session has no owner
    // and so no folder it can be told is trusted.
    users: anyone(),
    ...(options.changes === undefined ? {} : { changes: options.changes }),
    ...(options.tools === undefined ? {} : { tools: options.tools }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await signIn(client);
  const uri = 'ahp-session:/one';
  // The window says which folders it trusts, and a session of a folder nobody
  // vouched for is refused rather than started.
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: 'ahp-root://',
      action: { type: 'root/configChanged', config: { workspaceTrust: { enabled: true, trustedUris: [uriOf(path)] } } },
    },
  });
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'acp', workingDirectories: [uriOf(path)] },
  });
  /*
   * The chat, read rather than assumed.
   *
   * What a session calls its chat is the host's to say and the client's to look
   * up - a test that hard-codes it is testing a spelling rather than the lookup
   * every client actually does. It matters twice over here: the entry a client
   * runs its tools from names the chat it is to answer on, and that has to be a
   * channel this client dispatches to.
   */
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as {
    snapshot: { state: { defaultChat: string } };
  }).snapshot.state.defaultChat;
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
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
  });
};

const ended = (p: ReturnType<typeof peer>, chatUri: string): boolean =>
  types(p, chatUri).some((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled');

/** Whether the chat has ended at least this many turns, one per `begin`. */
const finished = (p: ReturnType<typeof peer>, chatUri: string, turns: number): boolean =>
  types(p, chatUri).filter((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled').length >= turns;

/*
 * A client's tool is a tool of the host's own MCP server, which this host calls
 * `host`, so an agent names a call to one the way that server spells it:
 * `mcp__host__<clientId>__<name>`, or the same with the prefix dropped.
 */
const OPEN_FILE = {
  name: 'openFile',
  description: 'Open a file in the editor',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
};

const DROP_BRANCH = {
  name: 'drop_branch',
  description: 'Drop a branch',
  inputSchema: { type: 'object', properties: { branch: { type: 'string' } } },
};

/** A tool of the host's own, which no client provides and nobody owns. */
const HOST_TOOL: HostTool = {
  definition: {
    name: 'list_sessions',
    description: 'List the sessions',
    inputSchema: { type: 'object', properties: {} },
  },
  run: () => 'the sessions',
};

/**
 * A second client in the session, saying it can run these tools.
 *
 * Presence is what carries them: `session/activeClientSet` is the one way a
 * client announces what it provides, and the host tells every chat what it may
 * offer as soon as it does.
 */
async function providing(
  host: ReturnType<typeof createHost>,
  uri: string,
  chatUri: string,
  id: string,
  tools: unknown[] = [OPEN_FILE],
): Promise<void> {
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { channel: 'ahp-root://', clientId: id, protocolVersions: ['0.9.0'] },
  });
  await signIn(client);
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'session/activeClientSet', activeClient: { clientId: id, name: id, tools } } },
  });
}

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
  // The host gathers a part's text for a moment before it sends it, so what
  // arrives for this part is its words in the order the server wrote them -
  // which is what the run of one kind is.
  expect(said.filter((one) => one.partId === kept[2]?.id).map((one) => one.content).join('')).toBe('second thought');
});

it('opens a part for a message that is only whitespace, and streams each chunk as it came', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'blank it');
  await until(() => ended(p, chatUri));

  type Part = { id: string; kind: string; content?: string; toolCall?: { toolCallId: string } };
  const kept = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: Part[] }[] } };
  }).snapshot.state.turns[0]?.responseParts ?? [];
  // Any text opens its part, as VS Code's agents open one for whatever their
  // runtime sends.
  expect(kept.map((part) => part.kind)).toEqual(['reasoning', 'markdown', 'toolCall', 'reasoning', 'markdown']);
  expect(kept.map((part) => part.content ?? part.toolCall?.toolCallId))
    .toEqual(['first thought', ' ', 'call-2', 'second thought', ' \nthe answer']);
  // A prose part's own id; a tool call part has none, as the protocol declares it.
  expect(kept.map((part) => part.id)).toEqual(['t1:0', 't1:1', undefined, 't1:3', 't1:4']);

  // What streamed into each part, however the host gathered the deltas.
  const said = actions(p, chatUri).map((e) => e.action);
  const streamed = new Map<string, string>();
  for (const one of said.filter((action) => action.type === 'chat/delta')) {
    streamed.set(String(one.partId), `${streamed.get(String(one.partId)) ?? ''}${String(one.content)}`);
  }
  expect([...streamed]).toEqual([['t1:1', ' '], ['t1:4', ' \nthe answer']]);
  expect(said.filter((one) => one.type === 'chat/responsePart').map((one) => (one.part as Part).id))
    .toEqual(['t1:0', 't1:1', 't1:3', 't1:4']);
});

it('draws no call of its own for a plan, which no call of the agent\'s carried', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'plan it');
  await until(() => ended(p, chatUri));

  // A plan update is no tool call, so it is no row of the chat, as VS Code
  // draws nothing for a plan notification that is no tool call.
  expect(actions(p, chatUri).some((e) => String(e.action.type).startsWith('chat/toolCall'))).toBe(false);
  const kept = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: { kind: string }[] }[] } };
  }).snapshot.state.turns[0]?.responseParts ?? [];
  // The words that followed it, and nothing for the plan.
  expect(kept.map((part) => part.kind)).toEqual(['markdown']);
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

it('opens a call the agent reported for a client\'s tool with that client on the row', async () => {
  const { host, client, peer: p, uri, chatUri } = await talking();
  await providing(host, uri, chatUri, 'a');

  // Named the way the host's MCP server spells the tool.
  begin(client, chatUri, 't1', 'report client=mcp__host__a__openFile');
  await until(() => finished(p, chatUri, 1));
  // And said about a client's tool in the title alone, which is all an agent
  // that names no `name` leaves behind for a call to be recognised by.
  begin(client, chatUri, 't2', 'report a client tool by title ctitle=mcp__host__a__openFile');
  await until(() => finished(p, chatUri, 2));

  const starts = actions(p, chatUri).filter((e) => e.action.type === 'chat/toolCallStart');
  expect(starts.map((e) => e.action.toolCallId)).toEqual(['call-client-1', 'call-client-1']);
  for (const one of starts) {
    expect(one.action.contributor).toEqual({ kind: 'client', clientId: 'a' });
  }

  // Said again on the ready, which is where the protocol stops taking one: a
  // contributor that arrives after the start is ignored, so both carry it.
  const readies = actions(p, chatUri).filter((e) => e.action.type === 'chat/toolCallReady'
    && e.action.toolCallId === 'call-client-1');
  expect(readies).toHaveLength(2);
  for (const one of readies) {
    expect(one.action.contributor).toEqual({ kind: 'client', clientId: 'a' });
  }

  // And the rows the snapshot draws, which is what a client subscribing now
  // reads.
  type Part = { kind: string; toolCall?: { toolCallId?: string; contributor?: Bag } };
  const kept = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: Part[] }[] } };
  }).snapshot.state.turns.flatMap((turn) => turn.responseParts).filter((part) => part.kind === 'toolCall');
  expect(kept.map((part) => part.toolCall?.contributor))
    .toEqual([{ kind: 'client', clientId: 'a' }, { kind: 'client', clientId: 'a' }]);
});

it('gives each of two clients the call it owns', async () => {
  const { host, client, peer: p, uri, chatUri } = await talking();
  await providing(host, uri, chatUri, 'a');
  await providing(host, uri, chatUri, 'b');
  begin(client, chatUri, 't1', 'report client=mcp__host__a__openFile client=mcp__host__b__openFile');
  await until(() => ended(p, chatUri));

  // Two clients in one session may both provide `openFile`, and the model is
  // offered one list: each call belongs to the client whose tool it names.
  const starts = actions(p, chatUri).filter((e) => e.action.type === 'chat/toolCallStart');
  expect(starts.map((e) => [e.action.toolCallId, e.action.contributor])).toEqual([
    ['call-client-1', { kind: 'client', clientId: 'a' }],
    ['call-client-2', { kind: 'client', clientId: 'b' }],
  ]);
});

it('reads a name that is not a client\'s tool before a title that is', async () => {
  const { host, client, peer: p, uri, chatUri } = await talking({ tools: [HOST_TOOL] });
  await providing(host, uri, chatUri, 'a');
  // The agent named the tool it called, and the name is no client's. The title
  // spells one, and a title is only read when the agent named none.
  begin(client, chatUri, 't1', 'report client=mcp__host__list_sessions ctitle=mcp__host__a__openFile');
  await until(() => ended(p, chatUri));

  const starts = actions(p, chatUri).filter((e) => e.action.type === 'chat/toolCallStart');
  expect(starts.map((e) => e.action.toolName)).toEqual(['mcp__host__list_sessions']);
  expect(starts[0]?.action.contributor).toBeUndefined();
});

it('gives no contributor to a tool of the host\'s or the agent\'s own', async () => {
  const { host, client, peer: p, uri, chatUri } = await talking({ tools: [HOST_TOOL] });
  await providing(host, uri, chatUri, 'a');
  // The host's own tool, as the agent sees it beside the clients', and a tool
  // the agent has itself. Neither is a client's, so neither is a client's to
  // run.
  begin(client, chatUri, 't1', 'report client=mcp__host__list_sessions client=count_lines');
  await until(() => ended(p, chatUri));

  const starts = actions(p, chatUri).filter((e) => e.action.type === 'chat/toolCallStart');
  expect(starts.map((e) => e.action.toolName)).toEqual(['mcp__host__list_sessions', 'count_lines']);
  expect(starts.map((e) => e.action.contributor)).toEqual([undefined, undefined]);
});

it('keeps the contributor through the chat reducer, and the snapshot agrees', async () => {
  const { host, client, peer: p, uri, chatUri } = await talking();
  await providing(host, uri, chatUri, 'a');
  begin(client, chatUri, 't1', 'report client=mcp__host__a__openFile');
  await until(() => ended(p, chatUri));

  // What a client draws from the actions alone, which is the fold a contributor
  // arriving too late would be missing from.
  type Part = { kind: string; toolCall?: { toolCallId?: string; contributor?: Bag } };
  let state = { turns: [], status: 0, modifiedAt: 'now' } as unknown as ChatState;
  for (const one of actions(p, chatUri)) {
    state = chatReducer(state, one.action as unknown as ChatAction);
  }
  const drawn = state.turns.flatMap((turn) => turn.responseParts) as unknown as Part[];
  expect(drawn.find((part) => part.kind === 'toolCall')?.toolCall?.contributor)
    .toEqual({ kind: 'client', clientId: 'a' });

  const kept = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: Part[] }[] } };
  }).snapshot.state.turns.flatMap((turn) => turn.responseParts);
  expect(kept.find((part) => part.kind === 'toolCall')?.toolCall?.contributor)
    .toEqual({ kind: 'client', clientId: 'a' });
});

it('raises the session entry a client reads when its call starts running', async () => {
  const { host, client, peer: p, uri, chatUri } = await talking();
  await providing(host, uri, chatUri, 'a');
  begin(client, chatUri, 't1', 'report client=mcp__host__a__openFile');
  await until(() => ended(p, chatUri));

  // A client that runs its tools from the session rather than from the chat
  // finds the call here, and the entry is what asks it.
  const sets = actions(p, uri).filter((e) => e.action.type === 'session/inputNeededSet');
  expect(sets).toHaveLength(1);
  expect(sets[0]?.action.request).toMatchObject({
    kind: 'toolClientExecution',
    chat: chatUri,
    turnId: 't1',
    clientId: 'a',
    toolCall: {
      toolCallId: 'call-client-1',
      // The name the client announced, not the one the model was offered.
      toolName: 'openFile',
      status: 'running',
      contributor: { kind: 'client', clientId: 'a' },
    },
  });
});

it('names a client\'s call in its row by the name the client announced', async () => {
  const { host, client, peer: p, uri, chatUri } = await talking();
  await providing(host, uri, chatUri, 'a');
  begin(client, chatUri, 't1', 'report client=mcp__host__a__openFile');
  await until(() => ended(p, chatUri));

  // The tool the client has, as VS Code's agents strip their client tool
  // server's prefix: the row and the entry name the same tool.
  const start = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallStart' && e.action.toolCallId === 'call-client-1');
  expect(start?.action).toMatchObject({ toolName: 'openFile', contributor: { kind: 'client', clientId: 'a' } });
  const set = actions(p, uri).find((e) => e.action.type === 'session/inputNeededSet');
  expect((set?.action.request as Bag | undefined)?.toolCall).toMatchObject({ toolName: 'openFile', displayName: start?.action.displayName });
});

it('opens no entry for a call the agent has not started', async () => {
  const { host, client, peer: p, uri, chatUri } = await talking();
  await providing(host, uri, chatUri, 'a');
  begin(client, chatUri, 't1', 'report client=mcp__host__a__openFile cstatus=pending');
  await until(() => ended(p, chatUri));

  // The row is drawn and attributed, and nobody is asked to run it: `pending`
  // is the agent saying it has not started the call, and the ready that asks
  // goes out when it does.
  const starts = actions(p, chatUri).filter((e) => e.action.type === 'chat/toolCallStart');
  expect(starts.map((e) => e.action.contributor)).toEqual([{ kind: 'client', clientId: 'a' }]);
  expect(types(p, chatUri)).not.toContain('chat/toolCallReady');
  expect(types(p, uri)).not.toContain('session/inputNeededSet');
});

it('leaves no entry for a call the agent has finished as it announced it', async () => {
  const { host, client, peer: p, uri, chatUri } = await talking();
  await providing(host, uri, chatUri, 'a');
  begin(client, chatUri, 't1', 'report client=mcp__host__a__openFile cdone');
  await until(() => ended(p, chatUri));

  /*
   * The row is drawn, attributed and closed at once, and nothing is left asking
   * anybody to run it: the entry its ready raised went with its completion, as
   * VS Code's host syncs a call's entry with each action on the call.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L67-L157
   */
  const calls = actions(p, chatUri).filter((e) => String(e.action.type).startsWith('chat/toolCall'));
  expect(calls.map((e) => e.action.type))
    .toEqual(['chat/toolCallStart', 'chat/toolCallReady', 'chat/toolCallComplete']);
  expect(calls[0]?.action.contributor).toEqual({ kind: 'client', clientId: 'a' });
  const raised = actions(p, uri).filter((e) => e.action.type === 'session/inputNeededSet')
    .map((e) => (e.action.request as Bag).id);
  const removed = actions(p, uri).filter((e) => e.action.type === 'session/inputNeededRemoved').map((e) => e.action.id);
  expect(removed).toEqual(raised);
});

it('asks a client to run the call once the person allows it', async () => {
  const { host, client, peer: p, uri, chatUri } = await talking();
  await providing(host, uri, chatUri, 'a', [DROP_BRANCH]);
  begin(client, chatUri, 't1', 'hold ctool=mcp__host__a__drop_branch');
  await until(() => types(p, uri).includes('session/inputNeededSet'));

  // The question is the row's readiness while it stands, and nobody has been
  // asked to run anything: the call is `pending` until the person answers.
  expect(actions(p, uri).filter((e) => e.action.type === 'session/inputNeededSet'
    && (e.action.request as Bag).kind === 'toolClientExecution')).toEqual([]);

  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-hold', approved: true },
    },
  });
  await until(() => ended(p, chatUri));

  // An allowed call is one that runs, so this is where the client is asked -
  // the mapping's own ready never comes for a call a question has stood on.
  const entry = actions(p, uri).find((e) => e.action.type === 'session/inputNeededSet'
    && (e.action.request as Bag).kind === 'toolClientExecution');
  expect(entry?.action.request).toMatchObject({
    clientId: 'a',
    toolCall: { toolCallId: 'call-hold', toolName: 'drop_branch', status: 'running' },
  });

  const start = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallStart'
    && e.action.toolCallId === 'call-hold');
  expect(start?.action.contributor).toEqual({ kind: 'client', clientId: 'a' });
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
  // The shell is the host's own, so the block is the one a `!command` builds,
  // titled by the call it belongs to.
  expect(content[0]).toMatchObject({ type: 'terminal', title: 'Paint and preview', isPty: false });
  expect(String((content[0] as Bag).resource)).toContain('terminal');
  // The file, as the edit a client draws, from a source that holds no sides
  // of a call's own: the block names the file as it is.
  expect(content[1]).toEqual({
    type: 'fileEdit',
    after: { uri: uriOf(join(path, 'painted.txt')), content: { uri: uriOf(join(path, 'painted.txt')) } },
  });

  // And the turn's changeset holds both of its sides, the before side being
  // what the diff carried rather than anything still on disk.
  expect(changes.seen).toEqual([
    { turnId: 't1', path: join(path, 'painted.txt'), phase: 'before' },
    { turnId: 't1', path: join(path, 'painted.txt'), phase: 'after' },
  ]);
});

it('shows a diff as both sides the call said, with the lines each lacks', async () => {
  const changes = gitChanges();
  const { client, peer: p, chatUri, path } = await talking({ changes });
  begin(client, chatUri, 't1', 'paint it');
  await until(() => ended(p, chatUri));

  const done = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete');
  const edit = (done?.action.result as { content: Bag[] }).content[1] as { before?: Bag; after?: Bag };
  const file = uriOf(join(path, 'painted.txt'));
  // Both sides are the diff's own texts, held as the call's, and the counts
  // are the lines each has that the other lacks, so a client draws a diff.
  expect(edit).toMatchObject({ type: 'fileEdit', before: { uri: file }, after: { uri: file }, diff: { added: 1, removed: 1 } });
  expect(await text(changes, String((edit.before?.content as Bag).uri))).toBe('a blank canvas\n');
  expect(await text(changes, String((edit.after?.content as Bag).uri))).toBe('a line of paint\n');
});

it('holds the before side a diff carried, which the file itself no longer has', async () => {
  const changes = gitChanges();
  const { client, peer: p, chatUri, path } = await talking({ changes });
  begin(client, chatUri, 't1', 'paint it');
  await until(() => ended(p, chatUri));

  // The host gave the session the name its client asked for, which is what its
  // changeset is keyed by. The `after` side is read off the file, so the row is
  // only whole once that read has landed.
  let row: ChangesetFile | undefined;
  await until(async () => {
    row = (await changes.state?.(path, 'ahp-session:/one', 'turn/t1'))?.files[0];
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

  const before = types(p, chatUri).length;
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  await until(() => types(p, chatUri).includes('chat/turnCancelled'));

  /*
   * The stop is said when it is taken. The fixture holds the prompt open
   * until `session/cancel` arrives, and a turn handed after the stop runs only
   * once the backend has let the stopped one go, so its end is what proves the
   * notification reached the server, and the turn it ended is not ended twice.
   */
  begin(client, chatUri, 't2', 'hi');
  await until(() => actions(p, chatUri).slice(before).some((e) => e.action.type === 'chat/turnComplete' && e.action.turnId === 't2'));
  const said = actions(p, chatUri);
  expect(said.filter((e) => e.action.type === 'chat/turnCancelled').map((e) => e.action.turnId)).toEqual(['t1']);
  expect(said.filter((e) => e.action.type === 'chat/turnComplete').map((e) => e.action.turnId)).toEqual(['t2']);
});

/*
 * A steering message to this backend is refused, a turn running or not: it
 * has no `sendSteeringMessage`, and the reference host refuses steering to a
 * provider that cannot take it, in its words (agentService.ts L13526-L13529
 * at 6b68d3fe).
 */
it('refuses a steering message with nothing running, as it cannot steer', async () => {
  const { client, peer: p, chatUri } = await talking();
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, clientSeq: 8, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'now', origin: { kind: 'user' } } } },
  });
  await until(() => actions(p, chatUri).some((e) => e.origin?.clientSeq === 8));

  const answers = actions(p, chatUri).filter((e) => e.origin?.clientSeq === 8);
  expect(answers.map((e) => (e as Note & { rejectionReason?: string }).rejectionReason))
    .toEqual(['The session provider does not support steering messages.']);
  expect(types(p, chatUri)).not.toContain('chat/turnStarted');
});

it('stops nothing on a cancel that names no turn', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'please wait');
  await until(() => types(p, chatUri).includes('chat/delta'));

  // A stop stops the turn it names: one naming none is said as sent, and the
  // running turn is still there for the stop that names it.
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: '', duration: 0 } },
  });
  await until(() => types(p, chatUri).includes('chat/turnCancelled'));
  const before = types(p, chatUri).length;
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  // A turn handed after the stop runs once the backend has let the stopped one go.
  begin(client, chatUri, 't2', 'hi');
  await until(() => actions(p, chatUri).slice(before).some((e) => e.action.type === 'chat/turnComplete' && e.action.turnId === 't2'));

  const said = actions(p, chatUri).filter((e) => e.action.type === 'chat/turnCancelled');
  expect(said.map((e) => e.action.turnId)).toEqual(['', 't1']);
});

it('says no activity while a turn thinks, runs a tool and answers', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'think then tool');
  await until(() => ended(p, chatUri));

  // A chat's activity is a wait before its turn can run, as VS Code's host
  // says one; this turn's work is in its own parts.
  const said = [...actions(p, chatUri), ...actions(p, uri)]
    .filter((e) => (e.action.type === 'chat/activityChanged' || e.action.type === 'session/activityChanged') && e.action.activity !== undefined);
  expect(said).toEqual([]);
});

it("runs a !command in the host's shell rather than asking the server", async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', '!echo acp-ran-it');
  await until(() => ended(p, chatUri));

  // The host's shell, not the ACP server: one tool call named `terminal`,
  // completed with what the shell printed, as the host's local command.
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

/*
 * A command sent as a turn while a turn runs is taken, as a question is: said
 * at once, it takes the running turn's place as the reducer replaces the active
 * turn, and the host runs it at once as its local command, with the turn in
 * front of it still waiting on its server, as the reference host runs its
 * local commands ahead of the admission a question waits on.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L14-L41
 */
it('runs a !command sent as a turn during a turn at once, in that turn\'s place', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'hold it');
  await until(() => types(p, uri).includes('session/inputNeededSet'));
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, clientSeq: 6, action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '!echo acp-took' } } },
  });
  await until(() => actions(p, chatUri).some((e) => e.action.type === 'chat/turnComplete' && e.action.turnId === 't2'));
  const took = actions(p, chatUri).filter((e) => e.origin?.clientSeq === 6);
  expect(took.map((e) => (e as Note & { rejectionReason?: string }).rejectionReason)).toEqual([undefined]);
  expect(took[0]?.action).toMatchObject({ type: 'chat/turnStarted', turnId: 't2' });
  const completed = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete' && e.action.turnId === 't2');
  expect(JSON.stringify(completed?.action.result)).toContain('acp-took');
  // The turn it took the place of is in no history.
  const held = (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { id: string }[] } };
  }).snapshot.state;
  expect(held.turns.map((turn) => turn.id)).toEqual(['t2']);
});

/*
 * A command that waits its turn is queued, and runs as the queued message's
 * turn once the one in front of it ends.
 */
it('runs a !command queued behind a turn once that turn ends', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'hold it');
  await until(() => types(p, uri).includes('session/inputNeededSet'));
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, clientSeq: 7, action: { type: 'chat/pendingMessageSet', kind: 'queued', id: 't2', message: { origin: { kind: 'user' }, text: '!echo acp-queued' } } },
  });
  await until(() => types(p, chatUri).includes('chat/pendingMessageSet'));
  const answers = () => actions(p, chatUri).filter((e) => e.origin?.clientSeq === 7);
  expect(answers().map((e) => e.action)).toEqual([
    expect.objectContaining({ type: 'chat/pendingMessageSet', kind: 'queued', id: 't2' }),
  ]);

  client.handle({
    method: 'dispatchAction',
    params: {
      channel: chatUri,
      action: { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-hold', approved: true },
    },
  });
  await until(() => finished(p, chatUri, 2));
  // Once: the turn the command runs as is the queued message's.
  expect(actions(p, chatUri).some((e) => e.action.type === 'chat/turnStarted' && e.action.queuedMessageId === 't2')).toBe(true);
  expect(answers()).toHaveLength(1);
});

/** A client's queued message, as `chat/pendingMessageSet` names it. */
const queue = (client: Awaited<ReturnType<typeof talking>>['client'], chatUri: string, id: string, text: string): Promise<unknown> =>
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/pendingMessageSet', kind: 'queued', id, message: { text, origin: { kind: 'user' } } } },
  });

/** The queued message each turn started from, in the order the turns started. */
const startedFrom = (p: ReturnType<typeof peer>, chatUri: string): unknown[] => actions(p, chatUri)
  .filter((e) => e.action.type === 'chat/turnStarted').map((e) => e.action.queuedMessageId);

/*
 * A failed turn starts nothing behind it, as the reference host drains its
 * queue after a success alone, and a client taking a message back while nothing
 * runs starts the head.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L55-L90
 */
it('starts nothing behind a failed turn, and the head once a client takes a message back', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'hold it erroratend');
  await until(() => types(p, uri).includes('session/inputNeededSet'));
  await queue(client, chatUri, 'waiting', 'second');
  await queue(client, chatUri, 'later', 'third');
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/toolCallConfirmed', turnId: 't1', toolCallId: 'call-hold', approved: true } },
  });
  await until(() => types(p, chatUri).includes('chat/error'));
  expect(startedFrom(p, chatUri)).toEqual([undefined]);

  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/pendingMessageRemoved', kind: 'queued', id: 'waiting' } },
  });
  await until(() => startedFrom(p, chatUri).length === 2);
  expect(startedFrom(p, chatUri)).toEqual([undefined, 'later']);
  await until(() => finished(p, chatUri, 1));
});

/*
 * A client's reorder while nothing runs runs the reference host's drain, which
 * starts the head of a queue a stop left waiting.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L71-L90
 */
it('starts the head once a client reorders a stopped turn\'s queue', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'please wait');
  await until(() => types(p, chatUri).includes('chat/delta'));
  await queue(client, chatUri, 'waiting', 'second');
  await queue(client, chatUri, 'later', 'third');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  await until(() => types(p, chatUri).includes('chat/turnCancelled'));
  expect(startedFrom(p, chatUri)).toEqual([undefined]);

  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/queuedMessagesReordered', order: ['later', 'waiting'] } },
  });
  await until(() => startedFrom(p, chatUri).length === 2);
  expect(startedFrom(p, chatUri)).toEqual([undefined, 'later']);
  await until(() => finished(p, chatUri, 2));
});

/**
 * The status the catalogue announced as a turn ended.
 *
 * The first row carrying a status said after the action of `type` that ended
 * turn `turnId`, or the first such action where no turn is named, once that
 * row is said: the row a client's list is left with when nothing else about
 * the session moves. A running session's moves are said together once they
 * have been quiet for 100 ms, as VS Code's host flushes a session marked dirty.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L212-L330
 */
const statusAtEnd = async (p: ReturnType<typeof peer>, uri: string, chatUri: string, type: string, turnId?: string): Promise<unknown> => {
  const rowAfter = () => {
    const at = p.notes.findIndex((n) => n.method === 'action'
      && (n.params as Note).channel === chatUri
      && (n.params as Note).action.type === type
      && (turnId === undefined || (n.params as Note).action.turnId === turnId));
    // By id: the row is published under the provider's name, whatever the
    // client created the session as.
    return at < 0 ? undefined : p.notes.slice(at + 1).find((n) => n.method === 'root/sessionSummaryChanged'
      && idOf((n.params as { session: string }).session) === idOf(uri)
      && (n.params as { changes: { status?: unknown } }).changes.status !== undefined);
  };
  await until(() => rowAfter() !== undefined);
  const status = (rowAfter()?.params as { changes: { status?: unknown } } | undefined)?.changes.status;
  // Without the read bit, which is the person's and not the turn's.
  return typeof status === 'number' ? status & ~Status.IsRead : status;
};

it('announces the session idle with the turnComplete that ends its turn', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'hi');
  await until(() => ended(p, chatUri));
  expect(await statusAtEnd(p, uri, chatUri, 'chat/turnComplete')).toBe(Status.Idle);
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
  expect(await statusAtEnd(p, uri, chatUri, 'chat/turnCancelled')).toBe(Status.Idle);
});

it('announces the session failed with the chat/error that ends its turn', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'fail');
  await until(() => types(p, chatUri).includes('chat/error'));
  expect(types(p, chatUri)).toContain('chat/error');
  expect(await statusAtEnd(p, uri, chatUri, 'chat/error')).toBe(Status.Error);
});

it('announces the session idle with the turnComplete that ends a !command', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  // A first message the agent answers, which announces the session: one made
  // fresh is provisional until its first send, as VS Code's host keeps it.
  // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L10835-L10841
  begin(client, chatUri, 't1', 'hi');
  expect(await statusAtEnd(p, uri, chatUri, 'chat/turnComplete', 't1')).toBe(Status.Idle);
  const command = 't2';
  begin(client, chatUri, command, '!echo acp-ran-it');
  await until(() => types(p, chatUri).filter((type) => type === 'chat/turnComplete').length === 2);
  /*
   * The status a client's list holds once the command's moves were quiet:
   * idle, whether the command's running was said or its moves were coalesced
   * into a row that says only what moved since the last one said. Read from
   * the session's announcement and every row after it, as a list holds them.
   */
  const told = () => p.notes.filter((n) => (n.method === 'root/sessionSummaryChanged'
    && idOf((n.params as { session: string }).session) === idOf(uri))
    || (n.method === 'root/sessionAdded' && idOf((n.params as { summary: { resource: string } }).summary.resource) === idOf(uri)));
  const commandEnd = p.notes.findIndex((n) => n.method === 'action' && (n.params as Note).channel === chatUri
    && (n.params as Note).action.type === 'chat/turnComplete' && (n.params as Note).action.turnId === command);
  await until(() => p.notes.slice(commandEnd + 1).some((n) => told().includes(n)));
  const held = told()
    .map((n) => (n.params as { summary?: { status?: unknown } }).summary?.status ?? (n.params as { changes?: { status?: unknown } }).changes?.status)
    .filter((status) => typeof status === 'number')
    .at(-1) as number;
  expect(held & ~Status.IsRead).toBe(Status.Idle);
});

/**
 * The turn the server stopped it with, as the error a client was given.
 *
 * `end_turn` is the answer and is in here as the case the others are read
 * against: one fixture case per stop reason the protocol names.
 */
const stoppedWith = async (reason: string, cutTurns?: 'error' | 'complete'): Promise<{ type?: string | undefined; error?: Bag }> => {
  const { client, peer: p, chatUri } = await talking(cutTurns === undefined ? {} : { cutTurns });
  begin(client, chatUri, 't1', `tell me something stop=${reason}`);
  await until(() => ended(p, chatUri) || types(p, chatUri).includes('chat/error'));
  const part = actions(p, chatUri).find((e) => e.action.type === 'chat/error')?.action.part as
    { error?: Bag } | undefined;
  return { type: types(p, chatUri).at(-1), ...(part === undefined ? {} : { error: part.error }) };
};

it('ends a turn the server stopped for its own reasons as an error naming the reason', async () => {
  for (const reason of ['max_tokens', 'max_turn_requests', 'refusal']) {
    const stopped = await stoppedWith(reason);
    // Not a finished answer: a turn that stopped early is not what was asked
    // for, and AHP has no field saying a completed turn was cut short.
    expect(stopped.type).toBe('chat/error');
    // The reason is the error's type, so a client can tell the three apart
    // without reading the sentence.
    expect(stopped.error?.errorType).toBe(reason);
    expect(String(stopped.error?.message)).not.toBe('');
  }
});

/*
 * A record whose `cutTurns` is `complete` completes them, as VS Code's agents
 * complete a turn the model ended at a limit or by declining.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L568-L576
 */
it('completes a turn the server stopped at a limit or by declining when the record says cutTurns complete', async () => {
  for (const reason of ['max_tokens', 'max_turn_requests', 'refusal']) {
    expect((await stoppedWith(reason, 'complete')).type).toBe('chat/turnComplete');
  }
});

it('completes an end_turn, and words a refusal as the agent declining', async () => {
  expect((await stoppedWith('end_turn')).type).toBe('chat/turnComplete');
  // A refusal is the agent declining, and its sentence says so.
  expect(String((await stoppedWith('refusal')).error?.message)).toContain('declined');
});

it('ends a turn whose prompt failed as a failed send, in the failure\'s own words', async () => {
  const { client, peer: p, chatUri } = await talking();
  begin(client, chatUri, 't1', 'tell me something erroratend');
  await until(() => types(p, chatUri).includes('chat/error'));
  const part = actions(p, chatUri).find((e) => e.action.type === 'chat/error')?.action.part as { error?: Bag } | undefined;
  expect(part?.error).toEqual({ errorType: 'sendFailed', message: expect.stringContaining('the model gave up at the end') });
});

it('completes a turn whose stop reason this bridge does not know', async () => {
  // The protocol will name reasons a bridge built before it has not heard of,
  // and a stop it cannot describe is better read as an answer.
  expect((await stoppedWith('something_newer')).type).toBe('chat/turnComplete');
});

/** The title a client subscribed to the session reads, and how it came to be. */
const named = async (
  client: Awaited<ReturnType<typeof talking>>['client'],
  p: ReturnType<typeof peer>,
  uri: string,
): Promise<{ last: string; said: unknown[] }> => {
  const snapshot = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { title: string } };
  };
  return {
    last: snapshot.snapshot.state.title,
    said: actions(p, uri).filter((e) => e.action.type === 'session/titleChanged').map((e) => e.action.title),
  };
};

it('titles a session after the first line of what was said', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', 'Fix the build\nand the tests');
  await until(() => ended(p, chatUri));

  // One line, and the line is the first one: a row that carries the rest of
  // the message is a row drawn as a paragraph.
  const title = await named(client, p, uri);
  expect(title.said).toEqual(['Fix the build']);
  expect(title.last).toBe('Fix the build');
});

it('titles a session a command opened with the command, until its first message replaces it', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', '!echo acp-ran-it');
  await until(() => finished(p, chatUri, 1));
  // A provisional title, as VS Code's host seeds one from a local command.
  expect((await named(client, p, uri)).last).toBe('echo acp-ran-it');

  begin(client, chatUri, 't2', 'Fix the build');
  await until(() => finished(p, chatUri, 2));
  const title = await named(client, p, uri);
  expect(title.said).toEqual(['echo acp-ran-it', 'Fix the build']);
  expect(title.last).toBe('Fix the build');
});

it('keeps a one-line message of seventy characters whole', async () => {
  const line = 'a'.repeat(70);
  const { client, peer: p, uri, chatUri } = await talking();
  begin(client, chatUri, 't1', line);
  await until(() => ended(p, chatUri));

  expect((await named(client, p, uri)).last).toBe(line);
});

it('lets the agent replace the title the first message gave', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  // `name` is the fixture's script for a `session_info_update`, which is what
  // an agent says instead of answering.
  begin(client, chatUri, 't1', 'name this one');
  await until(() => ended(p, chatUri));

  const title = await named(client, p, uri);
  expect(title.said).toEqual(['name this one', 'Naming the work']);
  expect(title.last).toBe('Naming the work');
});

it('keeps a person\'s name when the agent offers one afterwards', async () => {
  const { client, peer: p, uri, chatUri } = await talking();
  await client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'session/titleChanged', title: 'Mine, thanks' } },
  });
  begin(client, chatUri, 't1', 'name this one');
  await until(() => ended(p, chatUri));

  // A name somebody chose is not the agent's to replace, so the one title on
  // the wire is the person's.
  const title = await named(client, p, uri);
  expect(title.said).toEqual(['Mine, thanks']);
  expect(title.last).toBe('Mine, thanks');
});
