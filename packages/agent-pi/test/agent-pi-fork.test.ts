import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Agent, Bag, Start } from '../../sdk/src/types/index.js';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/clientcalls.js';
import { createHost } from '../../sdk/src/host.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import { piAgent } from '../src/agent.js';
import { forget } from '../src/catalog.js';
import type { BackendOptions, PiBackend } from '../src/backend.js';
import { resumeOrCreate } from '../src/backend.js';
import type { PiModel } from '../src/models.js';
import { loadPi } from '../src/pi.js';
import { piSession } from '../src/session.js';
import type { OpenPi } from '../src/session.js';

/*
 * A fork asked for by a client, through the host.
 *
 * The session-level cases in `agent-pi-disk.test.ts` hand `forkAt` over directly;
 * this drives the host that decides which point to hand over - `forkPoint` on
 * a `createChat` with `source.kind: 'fork'` - and checks that the session the
 * host opens for the new chat is asked to branch at it. It is the same shape as
 * the cofold backend's through-the-host fork case.
 */

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-pi-fork-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); forget(); });

/** Let a run's zero-delay work finish; nothing here waits on a real model. */
const until = async (check: () => boolean, times = 400): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((done) => { setTimeout(done, 0); });
  }
};

/** A pi that ends every turn at once, at a leaf of its own. */
function fakePi() {
  let listener: ((event: AgentSessionEvent) => void) | undefined;
  const opens: BackendOptions[] = [];
  const backend: PiBackend = {
    id: 'pi-session-1',
    file: undefined,
    subscribe: (one) => { listener = one; return () => { listener = undefined; }; },
    prompt: async () => { listener?.({ type: 'agent_settled' }); },
    steer: async () => {},
    abort: async () => { listener?.({ type: 'agent_settled' }); },
    models: async (): Promise<PiModel[]> => [],
    leaf: () => 'entry-1',
    levels: () => ['off'],
    chosen: () => undefined,
    choose: async () => true,
    rename: () => {},
    rewind: async () => true,
    close: () => {},
  };
  return {
    backend,
    opens,
    open: (async (options: BackendOptions) => { opens.push(options); return backend; }) as OpenPi,
  };
}

it('accepts a fork through the host and opens the new chat at that turn', async () => {
  const pi = fakePi();
  const base = piAgent({ sessionDir: join(root, 'pi') }, [root], async () => []);
  const agent: Agent = {
    ...base,
    create: (start) => piSession({ sessionDir: join(root, 'pi') }, start, pi.open),
  };
  // The backend has to say it can, or the host refuses before it asks.
  expect(agent.chats?.fork).toBe(true);
  const host = createHost({ path: join(root, 'host'), agents: [agent] });
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
  const chatUri = 'ahp-chat:/one';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'pi' } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });

  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } } },
  });
  const told = (type: string): boolean => notes
    .filter((one) => one.method === 'action')
    .some((one) => String((((one.params as Bag).action) as Bag).type) === type);
  await until(() => told('chat/turnComplete'));

  await client.handle({
    method: 'createChat',
    params: { channel: uri, chat: 'ahp-chat:/forked', source: { kind: 'fork', chat: chatUri, turnId: 't1' } },
  });
  // The new session opens pi lazily, on the turn after it.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-chat:/forked', action: { type: 'chat/turnStarted', turnId: 't2', message: { text: 'again' } } },
  });
  await until(() => pi.opens.some((one) => one.forkAt !== undefined));
  // The source conversation and the point the turn ended at, which is what a
  // fork copies through rather than the prompt the turn began with.
  expect(pi.opens.at(-1)?.resume).toBe('pi-session-1');
  expect(pi.opens.at(-1)?.forkAt).toBe('entry-1');
  client.close();
});

it('refuses a session asked to fork and rewind at once, writing nothing', async () => {
  /*
   * A pi that opens through pi's own session manager, so a fork really writes
   * the file it would really write. The refusal has to be proven to leave
   * nothing behind, and a fake that never writes would say that about any
   * placement of the check.
   */
  const sdk = await loadPi();
  const sessionDir = join(root, 'pi');
  const source = sdk.SessionManager.create(root, sessionDir);
  source.appendMessage({ role: 'user', content: 'hello', timestamp: Date.now() });
  const leaf = source.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'Hi.' }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-opus-5',
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
  } as never);
  const before = readdirSync(sessionDir);

  const fake = fakePi();
  const opens: BackendOptions[] = [];
  const open = (async (options: BackendOptions) => {
    opens.push(options);
    resumeOrCreate(sdk, options);
    return fake.backend;
  }) as OpenPi;
  const sent: { channel: string; action: Bag }[] = [];
  const start: Start = {
    uri: 'ahp-session:/s1',
    chatUri: 'ahp-chat:/s1',
    settings: {},
    workingDirectory: root,
    sessionDir,
    schema: () => ({}),
    emit: (channel, action) => { sent.push({ channel, action }); },
    // The host always resolves this, and its own answer when the deployment
    // said nothing is ten minutes.
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
    resume: source.getSessionId(),
    // A real leaf, so a branch made before the refusal would have succeeded
    // and left a file behind rather than failing on an entry pi cannot find.
    forkAt: leaf,
    rewindAt: leaf,
  } as Start;
  const session = piSession({ sessionDir }, start, open);

  session.begin('t1', 'hello');
  await until(() => sent.some((one) => one.action.type === 'chat/error'));
  const failure = sent.find((one) => one.action.type === 'chat/error')?.action;
  expect(((failure?.part as Bag).error as Bag).message).toContain('cannot fork and rewind at once');
  // No branch was made, so the directory holds the source session and nothing
  // else. Checked before the seam was reached at all, which is the other way
  // of saying it, and which is what keeps a file from being written.
  expect(readdirSync(sessionDir)).toEqual(before);
  expect(opens).toHaveLength(0);
  session.close();
});