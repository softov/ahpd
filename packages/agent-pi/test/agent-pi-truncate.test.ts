import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Agent, Bag, Start } from '../../sdk/src/types/index.js';
import { createHost } from '../../sdk/src/host.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import { piAgent } from '../src/agent.js';
import { forget } from '../src/catalog.js';
import type { BackendOptions, PiBackend } from '../src/backend.js';
import type { PiModel } from '../src/models.js';
import { piSession } from '../src/session.js';
import type { OpenPi } from '../src/session.js';

/*
 * A truncation asked for by a client, through the host.
 *
 * The session-level cases in `agent-pi.test.ts` hand `rewindAt` over
 * directly; this drives the host that decides which point to hand over -
 * `endPoint` on a `chat/truncated` dispatch - and checks that the session the
 * host restarts is asked to move pi's leaf there. It is the same shape as the
 * cofold backend's through-the-host truncation case.
 */

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-pi-truncate-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); forget(); });

/** Let a run's zero-delay work finish; nothing here waits on a real model. */
const until = async (check: () => boolean, times = 400): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((done) => { setTimeout(done, 0); });
  }
  throw new Error(`still waiting after ${times} tries`);
};

/** A pi that ends every turn at once and records the truncation it was asked for. */
function fakePi() {
  let listener: ((event: AgentSessionEvent) => void) | undefined;
  const asked: Bag[] = [];
  const opens: BackendOptions[] = [];
  let refuses = 0;
  const backend: PiBackend = {
    id: 'pi-session-1',
    file: undefined,
    subscribe: (one) => { listener = one; return () => { listener = undefined; }; },
    prompt: async () => { listener?.({ type: 'agent_settled', aborted: false }); },
    steer: async () => 'queued',
    sendCustomMessage: async () => {},
    appendEntry: () => {},
    clearSteering: () => {},
    resume: async () => false,
    abort: async () => { listener?.({ type: 'agent_settled', aborted: true }); },
    models: async (): Promise<PiModel[]> => [],
    leaf: () => 'entry-1',
    promptAfter: () => undefined,
    levels: () => ['off'],
    startsOn: () => undefined,
    resources: () => ({ skills: [], prompts: [], extensions: [] }),
    modelSelection: () => undefined,
    supportsVision: () => false,
    setModel: async () => true,
    rename: () => {},
    truncate: async (entryId) => {
      asked.push({ kind: 'truncate', entryId });
      if (refuses > 0) { refuses -= 1; return false; }
      return true;
    },
    useEnv: async () => {},
    dispose: () => {},
  };
  return {
    backend,
    asked,
    opens,
    refuseTruncateOnce: () => { refuses = 1; },
    open: (async (options: BackendOptions) => { opens.push(options); return backend; }) as OpenPi,
  };
}

it('accepts a truncation through the host and truncates the restarted session', async () => {
  const pi = fakePi();
  const base = piAgent({ sessionDir: join(root, 'pi') }, [root], async () => []);
  const agent: Agent = {
    ...base,
    create: (start) => piSession({ sessionDir: join(root, 'pi') }, start, pi.open),
  };
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
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'pi' } });
  // The chat the host minted for the session, read off its state.
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });

  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' } } },
  });
  const told = (type: string): boolean => notes
    .filter((one) => one.method === 'action')
    .some((one) => String((((one.params as Bag).action) as Bag).type) === type);
  await until(() => told('chat/turnComplete'));

  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/truncated', turnId: 't1' } },
  });
  // The host restarts the session, and pi opens lazily on the turn after it.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'again' } } },
  });
  await until(() => pi.asked.some((one) => one.kind === 'truncate'));
  expect(pi.asked.find((one) => one.kind === 'truncate')?.entryId).toBe('entry-1');
  // The host holds this client's subscriptions until it is told the peer is
  // gone, and a session left subscribed keeps a timer alive in the worker.
  client.close();
});

/*
 * A cut pi refuses, logged, and the turn runs on pi's leaf.
 *
 * The reference host holds a truncation before its agent cuts and logs a cut
 * that fails (agentSideEffects.ts L1982-L1986 at a4e689ae), so a client that
 * truncated sees its next turn run.
 */
it('runs the turn after pi refused the truncation, and logs the refusal', async () => {
  const pi = fakePi();
  pi.refuseTruncateOnce();
  const sent: { channel: string; action: Bag }[] = [];
  const start: Start = {
    uri: 'ahp-session:/s1',
    chatUri: 'ahp-chat:/s1',
    settings: {},
    workingDirectory: root,
    schema: () => ({}),
    emit: (channel, action) => { sent.push({ channel, action }); },
    rewindAt: 'entry-7',
  } as Start;
  const session = piSession({}, start, pi.open);
  const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});

  session.sendMessage('t1', 'hello');
  await until(() => sent.some((one) => one.action.type === 'chat/turnComplete'));
  expect(sent.filter((one) => one.action.type === 'chat/error')).toEqual([]);
  expect(pi.opens).toHaveLength(1);
  expect(pi.asked.filter((one) => one.kind === 'truncate')).toHaveLength(1);
  expect(warned.mock.calls.some(([line]) => String(line).includes('refused to move the leaf back to entry-7'))).toBe(true);
  warned.mockRestore();
  session.close();
});
