import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { Agent, Bag } from '../../sdk/src/types/index.js';
import { createHost } from '../../sdk/src/host.js';
import { shellTerminals } from '../../sdk/src/machines/terminals.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import { undeclaredIn } from '../../sdk/test/support/wire.js';
import { callsIn, openedFrom, replayed } from '../../sdk/test/support/replay.js';
import { piAgent } from '../src/agent.js';
import { piSession } from '../src/session.js';
import { fakePi, root, streamed } from './fake-pi.js';

/*
 * What a pi session sends, read by the protocol's own schema.
 *
 * Through the host, as a client meets it: every action on every channel, and
 * the chat a client reads when it subscribes after the turns. A call pi ran and
 * a person's own shell command each hold a tool call part.
 */

/** Let a run's zero-delay work finish; nothing here waits on a real model. */
const until = async (check: () => boolean, times = 2000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((done) => { setTimeout(done, 0); });
  }
};

it('sends calls as the protocol declares them, and a late client reads them the same way', async () => {
  const pi = fakePi();
  pi.hold();
  const base = piAgent({ sessionDir: join(root, 'pi') }, [root], async () => []);
  const agent: Agent = { ...base, create: (start) => piSession({ sessionDir: join(root, 'pi') }, start, pi.open) };
  const host = createHost({ path: join(root, 'host'), agents: [agent], terminals: shellTerminals() });
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
  const uri = 'ahp-session:/declared';
  const chatUri = 'ahp-chat:/declared';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'pi', workingDirectories: [`file://${root}`] } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  const opened = openedFrom(await client.handle({ method: 'subscribe', params: { channel: chatUri } }));
  const ended = (): number => notes
    .filter((one) => one.method === 'action')
    .filter((one) => String(((one.params as Bag).action as Bag).type) === 'chat/turnComplete').length;
  // A client's message as the protocol declares one, with its origin.
  const begin = (turnId: string, text: string): void => {
    void client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text, origin: { kind: 'user' } } } },
    });
  };

  begin('t1', 'list it');
  await until(() => pi.opens.length > 0 && pi.asked.some((one) => one.kind === 'prompt'));
  for (const event of streamed([
    { type: 'text', text: 'looking' },
    { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } },
  ])) pi.raise(event);
  pi.raise({ type: 'agent_settled', aborted: false });
  await until(() => ended() >= 1);

  begin('t2', '!echo declared');
  await until(() => ended() >= 2);

  const late = await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  const calls = ((((late as Bag).snapshot as Bag).state as Bag).turns as Bag[])
    .flatMap((turn) => turn.responseParts as Bag[])
    .filter((part) => part.kind === 'toolCall');
  expect(calls).toHaveLength(2);
  expect(undeclaredIn([...notes, { asked: 'subscribe', params: { channel: chatUri }, result: late }])).toEqual([]);
  expect(callsIn(openedFrom(late).state)).toEqual(callsIn(replayed(opened, notes, chatUri)));
  client.close();
});
