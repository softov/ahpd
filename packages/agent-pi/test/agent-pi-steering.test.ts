import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { Agent, Bag } from '../../sdk/src/types/index.js';
import { createHost } from '../../sdk/src/host.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import { piAgent } from '../src/agent.js';
import { piSession } from '../src/session.js';
import { fakePi, root, streamed } from './fake-pi.js';

/*
 * Steering and stops, through the host, in a pi session.
 *
 * pi gives back no single message it has queued, so the host refuses the
 * removal of the steering message pi holds while the turn runs.
 * https://github.com/microsoft/agent-host-protocol/blob/ff7d6a1c7b4f5e47925d3ce1c3bcf685266a6d49/docs/specification/chat-channel.md#steering-messages
 *
 * A turn pi is still preparing - opening pi, choosing its model, reading what
 * was attached - takes no steering and sends no prompt once it is stopped.
 */

/** Let a run's zero-delay work finish; nothing here waits on a real model. */
const until = async (check: () => boolean, times = 2000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((done) => { setTimeout(done, 0); });
  }
  throw new Error(`still waiting after ${times} tries`);
};

it('refuses to take back a steering message pi holds, and keeps it in the chat', async () => {
  const pi = fakePi();
  pi.hold();
  const base = piAgent({ sessionDir: join(root, 'pi') }, [root], async () => []);
  const agent: Agent = { ...base, create: (start) => piSession({ sessionDir: join(root, 'pi') }, start, pi.open) };
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
  const uri = 'ahp-session:/steering';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'pi', workingDirectories: [`file://${root}`] } });
  // The chat the host minted for the session, read off its state.
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  const dispatch = (clientSeq: number, action: Bag): void => {
    void client.handle({ method: 'dispatchAction', params: { channel: chatUri, clientSeq, action } });
  };
  /** The envelope that answers the dispatch this client numbered `clientSeq`. */
  const answer = (clientSeq: number): Bag | undefined => notes
    .filter((one) => one.method === 'action')
    .map((one) => one.params as Bag)
    .find((envelope) => (envelope.origin as Bag | undefined)?.clientSeq === clientSeq);

  dispatch(1, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'list it', origin: { kind: 'user' } } });
  await until(() => pi.asked.some((one) => one.kind === 'prompt'));
  dispatch(2, { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { origin: { kind: 'user' }, text: 'actually, stop' } });
  await until(() => pi.asked.some((one) => one.kind === 'steer'));
  expect(answer(2)?.rejectionReason).toBeUndefined();

  dispatch(3, { type: 'chat/pendingMessageRemoved', kind: 'steering', id: 's1' });
  await until(() => answer(3) !== undefined);
  expect(answer(3)?.rejectionReason).toBe('Cannot change a steering message while it is being processed.');
  const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as { snapshot: { state: Bag } };
  expect(opened.snapshot.state.steeringMessage).toMatchObject({ id: 's1', message: { text: 'actually, stop' } });
  client.close();
});

it('lets go of the steering pi holds when the turn it was sent into is stopped', async () => {
  // https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/AGENTS.md?plain=1#L617
  const pi = fakePi();
  pi.hold();
  const base = piAgent({ sessionDir: join(root, 'pi') }, [root], async () => []);
  const agent: Agent = { ...base, create: (start) => piSession({ sessionDir: join(root, 'pi') }, start, pi.open) };
  const host = createHost({ path: join(root, 'host'), agents: [agent] });
  const peer: Peer = { send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} };
  const client = host.accept(peer);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/stopped-steering';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'pi', workingDirectories: [`file://${root}`] } });
  // The chat the host minted for the session, read off its state.
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  const dispatch = (clientSeq: number, action: Bag): void => {
    void client.handle({ method: 'dispatchAction', params: { channel: chatUri, clientSeq, action } });
  };
  const state = async (): Promise<Bag> =>
    ((await client.handle({ method: 'subscribe', params: { channel: chatUri } })) as { snapshot: { state: Bag } }).snapshot.state;

  dispatch(1, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'list it', origin: { kind: 'user' } } });
  await until(() => pi.asked.some((one) => one.kind === 'prompt'));
  dispatch(2, { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { origin: { kind: 'user' }, text: 'and the tests' } });
  await until(() => pi.asked.some((one) => one.kind === 'steer'));
  dispatch(3, { type: 'chat/turnCancelled', turnId: 't1', duration: 0 });
  await until(() => pi.asked.some((one) => one.kind === 'abort'));
  expect(pi.asked.some((one) => one.kind === 'clearSteering')).toBe(true);
  for (let i = 0; i < 50 && (await state()).steeringMessage !== undefined; i++) await new Promise((done) => { setTimeout(done, 0); });
  expect((await state()).steeringMessage).toBeUndefined();
  client.close();
});

/**
 * A host over one pi session whose model list, read as pi opens, waits for
 * `release`: a turn begun is still being prepared until then.
 */
async function preparing() {
  const pi = fakePi();
  pi.hold();
  let release = (): void => {};
  const gate = new Promise<void>((done) => { release = done; });
  const backend = { ...pi.backend, models: async () => { await gate; return pi.backend.models(); } };
  const base = piAgent({ sessionDir: join(root, 'pi') }, [root], async () => []);
  const agent: Agent = { ...base, create: (start) => piSession({ sessionDir: join(root, 'pi') }, start, async () => backend) };
  const host = createHost({ path: join(root, 'host'), agents: [agent] });
  const peer: Peer = { send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} };
  const client = host.accept(peer);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/preparing';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'pi', workingDirectories: [`file://${root}`] } });
  // The chat the host minted for the session, read off its state.
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  const dispatch = (clientSeq: number, action: Bag): void => {
    void client.handle({ method: 'dispatchAction', params: { channel: chatUri, clientSeq, action } });
  };
  return { pi, release, client, dispatch };
}

/*
 * A stop that comes while a turn is prepared leaves it unsent, as the
 * reference host checks for a cancel after each step of a turn's preparation.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2307-L2316
 */
it('sends no prompt for a turn stopped while pi prepares it', async () => {
  const { pi, release, client, dispatch } = await preparing();
  dispatch(1, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'list it', origin: { kind: 'user' } } });
  await until(() => pi.asked.some((one) => one.kind === 'useEnv'));
  dispatch(2, { type: 'chat/turnCancelled', turnId: 't1', duration: 0 });
  await until(() => pi.asked.some((one) => one.kind === 'abort'));
  // The next turn waits on the same opening, so its prompt comes after the
  // stopped one would have.
  dispatch(3, { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { text: 'and now this', origin: { kind: 'user' } } });
  release();
  await until(() => pi.asked.some((one) => one.kind === 'prompt'));
  expect(pi.asked.filter((one) => one.kind === 'prompt').map((one) => one.text)).toEqual(['and now this']);
  client.close();
});

/*
 * A steering message set while pi prepares the turn is declined until pi has
 * the turn's prompt, and the host hands it again on the turn's next action, as
 * the reference host hands pending steering until its agent takes it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1943-L1948
 */
it('steers a turn with a message set while pi prepares it, once pi has its prompt', async () => {
  const { pi, release, client, dispatch } = await preparing();
  dispatch(1, { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'list it', origin: { kind: 'user' } } });
  await until(() => pi.asked.some((one) => one.kind === 'useEnv'));
  dispatch(2, { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { origin: { kind: 'user' }, text: 'and the tests' } });
  release();
  await until(() => pi.asked.some((one) => one.kind === 'prompt'));
  // What pi writes next is the turn's next action.
  for (const event of streamed([{ type: 'text', text: 'Listing.' }])) pi.raise(event);
  await until(() => pi.asked.some((one) => one.kind === 'steer'));
  const kinds = pi.asked.map((one) => one.kind);
  expect(kinds.indexOf('steer')).toBeGreaterThan(kinds.indexOf('prompt'));
  expect(pi.asked.find((one) => one.kind === 'steer')?.text).toBe('and the tests');
  client.close();
});
