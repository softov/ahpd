import { loggerOf } from '../src/log.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { idOf } from '../src/sessions/catalog.js';
import { createHost, echo, machine } from './support/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { fileSessions, memorySessions } from '../src/sessions/sessions.js';
import { sdkVersion } from '../src/version.js';
import { directory, hello, signIn, watching } from './users-gate-helpers.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { HostOptions, HostTool } from '../src/types/host.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { SessionStore } from '../src/types/sessions.js';
import { WAIT_MS } from '../../../tools/wait.ts';
import { WORK } from './support/work.js';

/*
 * A plugin's chat with an origin, an interactivity and tools of its own.
 *
 * A bot runs its Back as a chat of the Front's session: made by the Front's
 * `subagent` call, so a client draws it under that call, and offered
 * `post_message`, which the session's other chats are not. The plugin says so
 * on `startChat`, and the host keeps all three with the chat.
 */

const DIR = WORK;

/** The context every plugin in this repository is handed, without a daemon. */
const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
});

/** Yield between looks until `done` says so. */
const until = async (done: () => boolean, what: string): Promise<void> => {
  const end = Date.now() + WAIT_MS;
  while (Date.now() < end) {
    if (done()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  throw new Error(`${what} never happened in ${WAIT_MS} ms`);
};

/** The opt-in tool the plugin offers one chat. */
const POST: HostTool = {
  definition: { name: 'post_message', title: 'Post', description: 'Post a reply', inputSchema: { type: 'object', properties: {} } },
  run: () => 'posted',
  optIn: true,
};

/** One host, one plugin with `post_message`, and the starts its backend saw, by chat. */
function shaping(store?: SessionStore, more: Partial<HostOptions> = {}) {
  const sessions = store ?? memorySessions();
  const base = echo({ path: DIR, pace: 0 });
  const starts: Start[] = [];
  const agent: Agent = { ...base, create: (start: Start) => { starts.push(start); return base.create(start); } };
  const { host: plugin, contribution } = pluginHost('bots', context());
  plugin.registerTool(POST);
  const { options } = foldHostOptions({
    path: DIR, agents: [agent], ...machine(), sessions, users: directory({ soft: ['session:*', 'chat:*'] }), ...more,
  } as HostOptions, [contribution]);
  return { plugin, host: createHost(options), sessions, starts };
}

/** A watching client signed in as soft, subscribed to `session`. */
async function watch(host: ReturnType<typeof createHost>, session?: string) {
  const seen = watching();
  const client = host.accept(seen);
  await hello(client, 'soft');
  await signIn(client, 'soft');
  const state = session === undefined ? undefined : (await client.handle({ method: 'subscribe', params: { channel: session } }) as {
    snapshot: { state: { chats: { resource: string }[] } };
  }).snapshot.state;
  return { client, seen, state };
}

/** The summary `session/chatAdded` carried for `chat`. */
const added = (seen: ReturnType<typeof watching>, chat: string) => seen.seen
  .map((one) => one.params?.action)
  .find((action) => action?.type === 'session/chatAdded' && action.summary?.resource === chat)?.summary;

/** The tool names the backend was started with for `chat`. */
const toolsOf = (starts: Start[], chat: string): string[] =>
  (starts.find((one) => one.chatUri === chat)?.tools ?? []).map((one) => one.definition.name);

it('opens a chat with the origin, interactivity and tools the plugin named', async () => {
  const { plugin, host, starts } = shaping();
  await watch(host);
  const session = await plugin.startSession({ owner: 'user:soft', workingDirectory: DIR });
  const { seen, state } = await watch(host, session);
  const front = state?.chats[0]?.resource as string;

  const chat = await plugin.startChat(session, {
    origin: { kind: 'tool', chat: front, toolCallId: 'call-1' }, interactivity: 'read-only', tools: ['post_message'],
  });
  await until(() => added(seen, chat) !== undefined, 'the chat was added');

  expect(added(seen, chat)).toMatchObject({ origin: { kind: 'tool', chat: front, toolCallId: 'call-1' }, interactivity: 'read-only' });
  expect(toolsOf(starts, chat)).toContain('post_message');
  // The tool is the chat's alone: the session's own chat is not offered it.
  expect(toolsOf(starts, front)).not.toContain('post_message');
});

it('opens a chat with none of the three as a person\'s, full, on the session\'s tools', async () => {
  const { plugin, host, starts } = shaping();
  await watch(host);
  const session = await plugin.startSession({ owner: 'user:soft', workingDirectory: DIR });
  const { seen } = await watch(host, session);

  const chat = await plugin.startChat(session, {});
  await until(() => added(seen, chat) !== undefined, 'the chat was added');

  expect(added(seen, chat)).toMatchObject({ origin: { kind: 'user' }, interactivity: 'full' });
  expect(toolsOf(starts, chat)).not.toContain('post_message');
});

it('keeps the origin, interactivity and tools in the chat\'s record for a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-chat-shape-'));
  const first = fileSessions({ dir });
  const { plugin, host } = shaping(first);
  await watch(host);
  const session = await plugin.startSession({ owner: 'user:soft', workingDirectory: DIR });
  const { state } = await watch(host, session);
  const front = state?.chats[0]?.resource as string;

  const chat = await plugin.startChat(session, {
    origin: { kind: 'tool', chat: front, toolCallId: 'call-1' }, interactivity: 'hidden', tools: ['post_message'],
  });
  await until(() => first.chats(idOf(session)).some((one) => one.uri === chat), 'the chat was recorded');
  first.close?.();

  const row = fileSessions({ dir }).chats(idOf(session)).find((one) => one.uri === chat);
  expect(row).toMatchObject({ origin: { kind: 'tool', chat: front, toolCallId: 'call-1' }, interactivity: 'hidden', tools: ['post_message'] });
});

it('refuses a tool origin that names a chat of another session', async () => {
  const { plugin, host } = shaping();
  await watch(host);
  const one = await plugin.startSession({ owner: 'user:soft', workingDirectory: DIR });
  const two = await plugin.startSession({ owner: 'user:soft', workingDirectory: DIR });
  const { state } = await watch(host, two);
  const elsewhere = state?.chats[0]?.resource as string;

  await expect(plugin.startChat(one, { origin: { kind: 'tool', chat: elsewhere, toolCallId: 'call-1' } }))
    .rejects.toThrow(`${elsewhere} is not a chat of ${one}`);
});

it('refuses a tool the plugin did not register, and a value the protocol does not have', async () => {
  const { plugin, host } = shaping();
  await watch(host);
  const session = await plugin.startSession({ owner: 'user:soft', workingDirectory: DIR });

  expect(() => plugin.startChat(session, { tools: ['bash'] })).toThrow(/tools bash/);
  expect(() => plugin.startChat(session, { interactivity: 'readOnly' as 'read-only' })).toThrow(/interactivity/);
  expect(() => plugin.startChat(session, { origin: { kind: 'fork' } as never })).toThrow(/origin/);
});

/** Every refusal the host put on the wire to this client. */
const refusals = (seen: ReturnType<typeof watching>): string[] => seen.seen
  .filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')
  .map((one) => String(one.params.rejectionReason));

/** The error a turn on `chat` ended with, where it ended with one. */
const ended = (seen: ReturnType<typeof watching>, chat: string, turnId: string) => seen.seen
  .map((one) => one.params)
  .find((params) => params?.channel === chat && params.action?.type === 'chat/error' && params.action.turnId === turnId)?.action.part?.error;

/** A plugin's chat in a fresh session, made with `interactivity`, and a client subscribed to it. */
async function chatting(interactivity: 'full' | 'read-only') {
  const { plugin, host } = shaping();
  await watch(host);
  const session = await plugin.startSession({ owner: 'user:soft', workingDirectory: DIR });
  const chat = await plugin.startChat(session, { interactivity });
  const { client, seen } = await watch(host, session);
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  const send = (action: Record<string, unknown>) => client.handle({ method: 'dispatchAction', params: { channel: chat, action } });
  const turn = (turnId: string) => send({
    type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' },
  });
  return { chat, seen, send, turn };
}

it('refuses a client\'s turn, queued message and resume in a plugin\'s read-only chat', async () => {
  const { chat, seen, send, turn } = await chatting('read-only');

  await turn('t1');
  await until(() => ended(seen, chat, 't1') !== undefined, 'the turn was ended');
  expect(ended(seen, chat, 't1')).toMatchObject({ errorType: 'readOnly', message: 'This chat is read-only.' });

  await send({ type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { text: 'and then', origin: { kind: 'user' } } });
  await send({ type: 'chat/turnResume', turnId: 't1' });
  await until(() => refusals(seen).length >= 2, 'both were refused');
  expect(refusals(seen)).toEqual(['This chat is read-only.', 'This chat is read-only.']);
});

it('runs a client\'s turn in a plugin\'s full chat', async () => {
  const { chat, seen, turn } = await chatting('full');

  await turn('t1');
  await until(() => seen.seen.some((one) => one.params?.channel === chat && one.params.action?.type === 'chat/turnComplete'), 'the turn completed');
  expect(ended(seen, chat, 't1')).toBeUndefined();
  expect(refusals(seen)).toEqual([]);
});

/**
 * A host whose first agent is the plugin's own front, `front`, loaded before
 * the plugin `work` and its agent `work`, and the starts each backend saw.
 */
function fronted(withWork = true) {
  const sessions = memorySessions();
  const frontBase = echo({ path: DIR, pace: 0 });
  const workBase = echo({ path: DIR, pace: 0 });
  const starts: { provider: string; start: Start }[] = [];
  const front: Agent = { ...frontBase, provider: 'front', create: (start: Start) => { starts.push({ provider: 'front', start }); return frontBase.create(start); } };
  const work: Agent = { ...workBase, provider: 'work', create: (start: Start) => { starts.push({ provider: 'work', start }); return workBase.create(start); } };
  const { host: plugin, contribution } = pluginHost('bots', context());
  plugin.registerAgent(front);
  const contributions = [contribution];
  if (withWork) {
    const other = pluginHost('work', context());
    other.host.registerAgent(work);
    contributions.push(other.contribution);
  }
  const { options } = foldHostOptions({
    path: DIR, agents: [], ...machine(), sessions, users: directory({ soft: ['session:*', 'chat:*'] }),
  } as HostOptions, contributions);
  return { plugin, host: createHost(options), starts };
}

it('runs a plugin chat that names no agent, in its own front\'s session, on the first agent that is not the plugin\'s', async () => {
  const { plugin, host, starts } = fronted();
  await watch(host);
  const session = await plugin.startSession({ owner: 'user:soft', workingDirectory: DIR, provider: 'front' });
  const { seen } = await watch(host, session);

  const chat = await plugin.startChat(session, {});
  await until(() => added(seen, chat) !== undefined, 'the chat was added');

  expect(starts.find((one) => one.start.chatUri === chat)?.provider).toBe('work');
});

it('refuses a plugin chat that names no agent where the plugin\'s own front is the only agent', async () => {
  const { plugin, host } = fronted(false);
  await watch(host);
  const session = await plugin.startSession({ owner: 'user:soft', workingDirectory: DIR, provider: 'front' });

  await expect(plugin.startChat(session, {})).rejects.toThrow('No agent provider registered for: (none)');
});

it('hands the backend the session\'s owner on every start, a chat of the session\'s too', async () => {
  const { plugin, host, starts } = shaping();
  await watch(host);
  const session = await plugin.startSession({ owner: 'user:soft', workingDirectory: DIR });
  const { seen } = await watch(host, session);
  const chat = await plugin.startChat(session, {});
  await until(() => added(seen, chat) !== undefined, 'the chat was added');

  expect(starts.map((one) => one.owner)).toEqual(['user:soft', 'user:soft']);
});

it('offers a session tool a plugin named for its chat, where the session tools are off, and to that chat alone', async () => {
  const { hostTools } = await import('../src/tools/index.js');
  const { plugin, host, starts } = shaping(undefined, { sessionTools: false, tools: hostTools() });
  await watch(host);
  const session = await plugin.startSession({ owner: 'user:soft', workingDirectory: DIR });
  const { seen, state } = await watch(host, session);
  const front = state?.chats[0]?.resource as string;

  const chat = await plugin.startChat(session, { tools: ['post_message', 'send_message'] });
  await until(() => added(seen, chat) !== undefined, 'the chat was added');

  expect(toolsOf(starts, chat)).toEqual(expect.arrayContaining(['post_message', 'send_message']));
  expect(toolsOf(starts, front)).not.toContain('send_message');
});
