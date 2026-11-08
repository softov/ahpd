import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { Bag, Session, Start } from '@ahpd/sdk';
import { uriOf } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';
import { fileSessions } from '../../sdk/src/sessions/sessions.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import { replayedTurns } from '../src/transcript.js';
import { anyone, signIn } from './people.js';
import { WAIT_MS } from '../../../tools/wait.ts';

const fixture = fileURLToPath(new URL('./fixtures/recorded-turn-server.mjs', import.meta.url));
const made: string[] = [];
const closed: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closed.splice(0).reverse()) await close();
  for (const path of made.splice(0)) await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
const scratch = () => {
  const path = mkdtempSync(join(tmpdir(), 'acp-recorded-'));
  made.push(path);
  return path;
};
const until = async (check: () => boolean | Promise<boolean>) => {
  for (const end = Date.now() + WAIT_MS; Date.now() < end;) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('the recorded turn did not finish');
};
const agentAt = async (path: string, ids = true) => {
  vi.resetModules();
  const { acpAgent } = await import('../src/index.js');
  return acpAgent({
    provider: 'recorded-acp', command: process.execPath,
    args: [fixture, ...(ids ? [] : ['--no-message-id'])],
    env: { ACP_TEST_HISTORY: join(path, 'native.json') }, hostTools: false,
  });
};

it.each([true, false])('records the first valid assistant messageId once per caller turn, not each chunk or tool (%s)', async (ids) => {
  const path = scratch();
  const agent = await agentAt(path, ids);
  const recorded = vi.fn();
  const endings: string[] = [];
  const start: Start = {
    uri: 'ahp-session:/recorded', chatUri: 'ahp-chat:/recorded',
    settings: {}, schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel, action) => {
      if (action.type === 'chat/turnComplete') endings.push(String(action.turnId));
    },
    trusted: () => true, workingDirectory: path,
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS, onTurnRecorded: recorded,
  };
  const session: Session = await agent.create(start);
  closed.push(async () => { session.close(); });
  for (const turn of ['caller-one', 'caller-two']) {
    session.sendMessage(turn, turn);
    await until(() => endings.includes(turn));
  }
  expect(recorded.mock.calls).toEqual(ids ? [
    ['caller-one', 'native-message-1-first'],
    ['caller-two', 'native-message-2-first'],
  ] : []);
});

it('uses only the first nonblank string assistant messageId in each replayed turn, and keeps no-id fallback ephemeral', () => {
  const user = (text: string): SessionUpdate => ({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text } });
  const answer = (messageId: unknown): SessionUpdate => ({ sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text: 'answer' } }) as SessionUpdate;
  const updates: SessionUpdate[] = [
    { ...user('one'), messageId: 'not-a-user-anchor' } as SessionUpdate,
    { ...answer(undefined), _meta: { messageId: 'not-a-native-field' } }, answer(''), answer('  '), answer(42),
    answer('first-native'), answer('first-native'), answer('second-native'),
    user('two'), answer('another-native'),
  ];
  expect(replayedTurns(updates, '2026-11-06T00:00:00Z').map((turn) => turn.turnId)).toEqual(['first-native', 'another-native']);
  const missing = [user('old'), answer(undefined)];
  const first = replayedTurns(missing, '2026-11-06T00:00:00Z')[0]?.turnId;
  expect(first).toMatch(/^[a-f0-9-]{36}$/);
  expect(replayedTurns(missing, '2026-11-06T00:00:00Z')[0]?.turnId).not.toBe(first);
});

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;
const state = async (client: Client, channel: string): Promise<Bag> =>
  (await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: Bag } }).snapshot.state;
const openHost = async (path: string, ids = true) => {
  const host = createHost({ path, agents: [await agentAt(path, ids)], users: anyone(), sessions: fileSessions({ dir: join(path, 'sessions') }) });
  closed.push(() => host.close());
  const peer: Peer = { send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: async () => {} };
  const client = host.accept(peer);
  await client.handle({ method: 'initialize', params: { clientId: 'recorded-test', protocolVersions: ['1.0.0'], initialSubscriptions: ['ahp-root://'] } });
  await signIn(client);
  await client.handle({ method: 'dispatchAction', params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { workspaceTrust: { enabled: true, trustedUris: [uriOf(path)] } } } } });
  return { host, client };
};
const run = async (client: Client, chat: string, turnId: string, text: string) => {
  await client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } } });
  await until(async () => ((await state(client, chat)).turns as Bag[]).some((turn) => turn.id === turnId && turn.state === 'complete'));
};

it.each([true, false])('reopens fileSessions with isolated native chat histories and caller identities only when message IDs exist (%s)', async (ids) => {
  const path = scratch();
  const first = await openHost(path, ids);
  const uri = 'ahp-session:/caller-container';
  await first.client.handle({ method: 'createSession', params: { channel: uri, provider: 'recorded-acp', workingDirectories: [uriOf(path)] } });
  const main = String((await state(first.client, uri)).defaultChat);
  const peer = 'ahp-chat:/recorded-peer';
  await first.client.handle({ method: 'createChat', params: { channel: uri, chat: peer } });
  await run(first.client, main, 'caller-main', 'main marker');
  await run(first.client, peer, 'caller-peer', 'peer marker');
  await run(first.client, main, 'caller-next', 'main continuation');
  if (ids) await run(first.client, main, 'caller-without-id', '[without-id] keeps its own turn');
  await first.host.close();
  const second = await openHost(path, ids);
  expect((await state(second.client, uri)).defaultChat).toBe(main);
  for (const [chat, caller, marker] of [[main, 'caller-main', 'main marker'], [peer, 'caller-peer', 'peer marker']] as const) {
    const turns = (await state(second.client, chat)).turns as Bag[];
    const turn = ids ? turns.find((one) => one.id === caller) : turns.find((one) => String((one.message as Bag).text) === marker);
    expect(turn, `${chat}: the original caller turn must remain addressable`).toBeDefined();
    expect(JSON.stringify(turn?.responseParts)).toContain(marker);
    if (!ids) expect(turn?.id).not.toBe(caller);
    expect(JSON.stringify(turns)).not.toContain(chat === main ? 'peer marker' : 'main marker');
  }
  const mainTurns = (await state(second.client, main)).turns as Bag[];
  if (ids) {
    expect(mainTurns.slice(0, 2).map((turn) => turn.id)).toEqual(['caller-main', 'caller-next']);
    expect(mainTurns).toHaveLength(3);
    expect(mainTurns[2]?.id).not.toBe('caller-without-id');
    expect((mainTurns[2]?.message as Bag).text).toBe('[without-id] keeps its own turn');
  }
  await run(second.client, main, 'caller-after-restart', 'after restart');
  await second.host.close();
  const third = await openHost(path, ids);
  const again = (await state(third.client, main)).turns as Bag[];
  if (ids) {
    expect(again.slice(0, 2).map((turn) => turn.id)).toEqual(['caller-main', 'caller-next']);
    expect(again).toHaveLength(4);
    expect(again[3]?.id).toBe('caller-after-restart');
  }
  expect(JSON.stringify(again)).toContain('after restart');
  const peerAgain = (await state(third.client, peer)).turns as Bag[];
  expect(peerAgain).toHaveLength(1);
  if (ids) expect(peerAgain[0]?.id).toBe('caller-peer');
});
