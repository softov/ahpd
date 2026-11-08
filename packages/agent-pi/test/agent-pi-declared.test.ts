import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { Agent, Bag, Start } from '../../sdk/src/types/index.js';
import { createHost } from '../../sdk/src/host.js';
import { shellTerminals } from '../../sdk/src/machines/terminals.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import { undeclaredIn } from '../../sdk/test/support/wire.js';
import { callsIn, openedFrom, replayed } from '../../sdk/test/support/replay.js';
import { fakePty } from '../../sdk/test/support/pty.js';
import { piAgent } from '../src/agent.js';
import { piSession } from '../src/session.js';
import { fakePi, opened, root, settled as settledPi, streamed } from './fake-pi.js';

/** The space a command is typed after, which keeps it out of a POSIX shell's history; PowerShell, Windows' shell here, keeps none. */
const HISTORY_SPACE = process.platform === 'win32' ? '' : ' ';

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
  throw new Error(`still waiting after ${times} tries`);
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
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'pi', workingDirectories: [`file://${root}`] } });
  // The chat the host minted for the session, read off its state.
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  const opened = openedFrom(await client.handle({ method: 'subscribe', params: { channel: chatUri } }));
  const ended = (): number => notes
    .filter((one) => one.method === 'action')
    .filter((one) => String(((one.params as Bag).action as Bag).type) === 'chat/turnComplete').length;
  // A client's message as the protocol declares one, with its origin.
  const begin = (turnId: string, text: string): void => {
    void client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
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
  // And its shells, which Windows will not remove the case's folder under.
  await host.close();
});

/*
 * What a host seeds a chat and a session with, read by the same schema.
 *
 * A session's own state is what a host opens a channel with, so a field no
 * type declares there reaches every client the seed is served to: a running
 * turn's `state`, and a property's `scope` in the schema a session states
 * when its host handed it none. The session's `status`, its people and its
 * chat rows are the host's, laid over this state when it seeds the channel,
 * so the keys read here are the ones the session adds.
 */
it('builds a running chat and its session with no key the protocol does not declare', async () => {
  // A start built with no schema, which is the one road to the session's own.
  const { session, pi } = opened({ schema: undefined } as unknown as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settledPi();
  const served = (resource: string, state: Bag) => ({ asked: 'subscribe', params: { channel: resource }, result: { snapshot: { resource, state, fromSeq: 0 } } });
  const { resource: _resource, ...sessionState } = session.sessionState();
  const found = undeclaredIn([served('ahp-chat:/s1', session.chatState()), served('ahp-session:/s1', sessionState)]);
  expect(found.filter((one) => one.includes('undeclared key'))).toEqual([]);
  session.close();
});

/*
 * The reference host's own `!` command: a `terminal` call whose content names
 * the terminal as soon as it opens.
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L65-L117
 */
it('runs a person\'s command as a terminal call that names its terminal while it runs', async () => {
  const pty = fakePty();
  const pi = fakePi();
  const base = piAgent({ sessionDir: join(root, 'pi') }, [root], async () => []);
  const agent: Agent = { ...base, create: (start) => piSession({ sessionDir: join(root, 'pi') }, start, pi.open) };
  const host = createHost({ path: join(root, 'host'), agents: [agent], terminals: shellTerminals({ pty: pty.spawn }) });
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
  const uri = 'ahp-session:/banged';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'pi', workingDirectories: [`file://${root}`] } });
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  const opened = openedFrom(await client.handle({ method: 'subscribe', params: { channel: chatUri } }));
  const sent = (type: string): Bag | undefined => notes
    .filter((one) => one.method === 'action')
    .map((one) => (one.params as Bag).action as Bag)
    .find((action) => action.type === type);
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: '!make preview', origin: { kind: 'user' } } } },
  });
  /*
   * The command's shell names its terminal once it has printed its prompt, the
   * command is typed into it, and the shell integration's mark that it
   * finished ends it, as the reference host runs its own `!` command.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L52-L117
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/shellCommandExecution.ts#L224-L285
   */
  await until(() => pty.started.length > 0);
  pty.say('\u001b]633;A\u0007$ \u001b]633;B\u0007');
  await until(() => sent('chat/toolCallContentChanged') !== undefined && pty.typed.at(-1) === `${HISTORY_SPACE}make preview\r`);

  expect(sent('chat/toolCallStart')).toMatchObject({ toolName: 'terminal', displayName: 'Terminal', intention: 'make preview' });
  expect(sent('chat/toolCallReady')).toMatchObject({ invocationMessage: 'make preview', toolInput: 'make preview' });
  // Named by VS Code's link for a call's terminal, which the host serves.
  const named = { type: 'terminal', resource: expect.stringMatching(/^agenthost-terminal:\/\/shell\//), title: 'Terminal', isPty: true };
  expect(sent('chat/toolCallContentChanged')?.content).toEqual([named]);
  expect(sent('chat/toolCallContentChanged')).not.toHaveProperty('_meta');
  const during = openedFrom(await client.handle({ method: 'subscribe', params: { channel: chatUri } }));
  expect(callsIn(during.state)).toEqual(callsIn(replayed(opened, notes, chatUri)));

  pty.say('\u001b]633;C\u0007built\r\n\u001b]633;D;0\u0007\u001b]633;A\u0007$ ');
  await until(() => sent('chat/turnComplete') !== undefined);
  expect((sent('chat/toolCallComplete')?.result as Bag).content).toEqual([
    { ...named, result: { exitCode: 0, preview: 'built' } },
    { type: 'text', text: 'built' },
  ]);
  const late = await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  expect(callsIn(openedFrom(late).state)).toEqual(callsIn(replayed(opened, notes, chatUri)));
  expect(undeclaredIn([...notes, { asked: 'subscribe', params: { channel: chatUri }, result: late }])).toEqual([]);
  client.close();
});
