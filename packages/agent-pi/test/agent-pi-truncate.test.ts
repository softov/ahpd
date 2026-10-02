import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
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
};

/** A pi that ends every turn at once and records the rewind it was asked for. */
function fakePi() {
  let listener: ((event: AgentSessionEvent) => void) | undefined;
  const asked: Bag[] = [];
  const opens: BackendOptions[] = [];
  let refuses = 0;
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
    rewind: async (entryId) => {
      asked.push({ kind: 'rewind', entryId });
      if (refuses > 0) { refuses -= 1; return false; }
      return true;
    },
    close: () => {},
  };
  return {
    backend,
    asked,
    opens,
    refuseRewindOnce: () => { refuses = 1; },
    open: (async (options: BackendOptions) => { opens.push(options); return backend; }) as OpenPi,
  };
}

it('accepts a truncation through the host and rewinds the restarted session', async () => {
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
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
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
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/truncated', turnId: 't1' } },
  });
  // The host restarts the session, and pi opens lazily on the turn after it.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't2', message: { text: 'again' } } },
  });
  await until(() => pi.asked.some((one) => one.kind === 'rewind'));
  expect(pi.asked.find((one) => one.kind === 'rewind')?.entryId).toBe('entry-1');
  // The host holds this client's subscriptions until it is told the peer is
  // gone, and a session left subscribed keeps a timer alive in the worker.
  client.close();
});

it('opens again for the turn after pi refused the rewind', async () => {
  const pi = fakePi();
  pi.refuseRewindOnce();
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

  session.begin('t1', 'hello');
  await until(() => sent.some((one) => one.action.type === 'chat/error'));
  const failure = sent.find((one) => one.action.type === 'chat/error')?.action;
  expect(((failure?.part as Bag).error as Bag).message).toContain('refused');
  expect(pi.opens).toHaveLength(1);

  // The session is not broken: the next turn opens pi and tries the truncation.
  session.begin('t2', 'again');
  await until(() => pi.asked.filter((one) => one.kind === 'rewind').length === 2);
  expect(pi.opens).toHaveLength(2);
  expect(pi.asked.filter((one) => one.kind === 'rewind')).toHaveLength(2);
  session.close();
});
