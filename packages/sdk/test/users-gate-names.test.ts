import { expect, it } from 'vitest';
import { uriOf } from '../src/resources/fileuri.js';
import { ROOT } from '../src/host.js';
import { chatUriFor } from '../src/host/channels.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { memoryAutomations } from '../src/automations/automations.js';
import { shellTerminals } from '../src/machines/terminals.js';
import { echo } from '../../../examples/echo/agent.js';
import {
  RECORD, call, directory, hello, host, listingOne, onDisk, peer, root, signIn, until, watching, withRole,
} from './users-gate-helpers.js';
import type { Bag } from './users-gate-helpers.js';
import type { Turn } from '@microsoft/agent-host-protocol';
import type { WireTurn } from '../src/types/wire.js';
import type { Peer } from '../src/types/rpc.js';

/** A client that serves a directory and answers a watch on it with the channel it is given. */
const publishing = (channel: string): Peer & { seen: { method: string; params: Bag }[] } => {
  const seen: { method: string; params: Bag }[] = [];
  return {
    seen,
    send: () => {}, answered: () => {}, close: () => {},
    request: async (method: string, params: unknown) => (method === 'resourceResolve' ? { uri: (params as Bag).uri, type: 'directory' }
      : method === 'subscribe' ? { snapshot: { resource: channel, state: {}, fromSeq: 0 } } : { channel }),
    notify: (method: string, params: unknown) => { seen.push({ method, params: params as Bag }); },
  };
};

it('reads a session spelt as a file as what it is spelt as', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  // Held under the URI the client asked for, in a scheme of its own.
  expect(await call(admin.client, 'createSession', { channel: 'x:/one', provider: 'claude' })).toHaveProperty('result');
  await call(admin.client, 'subscribe', { channel: 'x:/one' });
  await call(admin.client, 'subscribe', { channel: chatUriFor('x:/one') });

  // A file:read guest who names the session as a file reads nothing of it and drives nothing in it.
  const guest = await withRole(made, 'g');
  expect(await call(guest.client, 'subscribe', { channel: 'file:///one' })).not.toHaveProperty('result');
  await guest.send('file:///one', { type: 'session/titleChanged', title: 'Taken' });
  await guest.send('file:///one', { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'run this' } });
  await guest.send('file:///one/annotations', { type: 'annotations/set', annotations: [] });

  // Nor under the name the session is held by.
  expect(await call(guest.client, 'subscribe', { channel: 'x:/one' })).toMatchObject({ code: -32009, message: expect.stringContaining('session:state') });
  await guest.send('x:/one', { type: 'session/titleChanged', title: 'Taken' });

  /*
   * Nothing taken: what reaches the admin watching the session is the
   * guest's refusal, as every refusal reaches every client of its channel,
   * VS Code's host recording and broadcasting its rejection of a sender it
   * has not authenticated.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2806-L2808
   */
  const acted = admin.seen.seen.filter((one) => one.method === 'action'
    && ['session/titleChanged', 'chat/turnStarted'].includes(String(one.params.action?.type)));
  expect(acted.map((one) => one.params.rejectionReason)).toEqual(['g may not session:rename here']);
  expect(guest.refused()).toEqual([
    'file:///one: file:///one is not a session here',
    'file:///one: file:///one is not a session here',
    'file:///one/annotations: file:///one/annotations is not a session here',
    'x:/one: g may not session:rename here',
  ]);

  // The session still works: the one refusal the admin holds is the guest's.
  await admin.send('x:/one', { type: 'session/titleChanged', title: 'Mine' });
  expect(admin.refused()).toEqual(['x:/one: g may not session:rename here']);
  expect(admin.seen.seen.some((one) => one.method === 'action' && one.params.action?.type === 'session/titleChanged')).toBe(true);
});

it('keeps a session a backend keeps on disk out of reach of its spelling as a file', async () => {
  const { agent } = listingOne();
  const store = memorySessions();
  const made = host({ users: directory({ g: ['file:read'] }), agents: [agent], sessions: store });
  const guest = await withRole(made, 'g');
  await call(guest.client, 'listSessions', { channel: ROOT });
  expect(await call(guest.client, 'subscribe', { channel: 'file:///disk' })).not.toHaveProperty('result');
  await guest.send('file:///disk', { type: 'session/isReadChanged', isRead: true });
  await guest.send('file:///disk', { type: 'session/configChanged', config: { voice: 'shouty' } });
  expect(store.flags('disk')).toBe(0);
  expect(store.config('disk')).toBeUndefined();
  expect(guest.refused()).toEqual(['file:///disk: file:///disk is not a session here', 'file:///disk: file:///disk is not a session here']);
});

it('needs terminal grants for a terminal this host holds, whatever its scheme', async () => {
  const made = host({
    users: directory({ t: ['terminal:read', 'terminal:write'], g: ['file:read'] }),
    terminals: shellTerminals(),
  });
  const owner = await withRole(made, 't');
  const uri = 'agenthost-terminal:/probe';
  expect(await call(owner.client, 'createTerminal', { channel: uri, cwd: root })).toHaveProperty('result');
  expect(await call(owner.client, 'subscribe', { channel: uri })).toHaveProperty('result');

  const guest = await withRole(made, 'g');
  expect(await call(guest.client, 'subscribe', { channel: uri })).toMatchObject({ code: -32009, message: expect.stringContaining('terminal:output') });
  await guest.send(uri, { type: 'terminal/input', data: 'echo GUEST-$((6*7))\n' });
  expect(guest.refused()).toEqual([`${uri}: g may not terminal:input here`]);

  // The shell is live, so a negative is asserted against a positive.
  await owner.send(uri, { type: 'terminal/input', data: 'echo OWNER-$((1+1))\n' });
  expect(await until(owner.seen, uri, 'OWNER-2')).not.toContain('GUEST-42');
});

it('keeps terminals and sessions from being named after each other', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  // A terminal named after a live session, and one in its provider's scheme.
  expect(await call(admin.client, 'createTerminal', { channel: 'claude:/one', cwd: root })).toMatchObject({ code: -32003 });
  expect(await call(admin.client, 'createTerminal', { channel: 'ahp-session:/one', cwd: root })).toMatchObject({ code: -32003 });
  // A name in a provider's scheme is a session's even with no session under it.
  expect(await call(admin.client, 'createTerminal', { channel: 'claude:/two', cwd: root })).toMatchObject({ code: -32003 });
  // And a session named after a terminal.
  expect(await call(admin.client, 'createTerminal', { channel: 'vscode:/two', cwd: root })).toHaveProperty('result');
  expect(await call(admin.client, 'createSession', { channel: 'vscode:/two', provider: 'claude' })).toMatchObject({ code: -32003 });
});


it('refuses turns for a name that is nobody\'s session or chat', async () => {
  const one = { ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' };
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write'] }),
    agents: [{
      ...one,
      list: async () => [onDisk('one')],
      // One turn as the wire carries it, which the host reads the message out
      // of and nothing else - `echo` casts its own the same way.
      transcript: async () => ([
        { uuid: 'u0', message: { role: 'user', content: 'said 0' } },
      ] as Bag[] as WireTurn<Turn>[]),
    }],
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'subscribe', { channel: 'ahp-session:/one' })).toHaveProperty('result');
  // A terminal the client named after the session's *id*, which is a name in
  // the terminal space and no session of this host's.
  const terminal = 'ahp-terminal:/one';
  expect(await call(admin.client, 'createTerminal', { channel: terminal, cwd: root })).toHaveProperty('result');
  expect(await call(admin.client, 'subscribe', { channel: terminal })).toHaveProperty('result');

  /*
   * The turns of a session named `one`, sent to everyone watching a terminal
   * that is called that.
   *
   * `fetchTurns` reads the id out of whatever channel it is given, so a name
   * in another space is answered with a session's transcript - which host/30
   * task 08 says is never how a session's id is read.
   */
  await call(admin.client, 'fetchTurns', { channel: terminal, cursor: '1' });
  expect(admin.seen.seen.filter((said) => said.method === 'action' && said.params.channel === terminal)).toEqual([]);
  // And the session's own chat still pages, to a client watching it, on its
  // chat's channel.
  expect(await call(admin.client, 'subscribe', { channel: chatUriFor('ahp-session:/one') })).toHaveProperty('result');
  await call(admin.client, 'fetchTurns', { channel: chatUriFor('ahp-session:/one'), cursor: '1' });
  expect(admin.seen.seen.filter((said) => said.method === 'action'
    && said.params.action?.type === 'chat/turnsLoaded')).not.toEqual([]);
});

it('answers no channel a connection may not read in its handshake', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  expect(await call(admin.client, 'createTerminal', { channel: 'ahp-terminal:/t', cwd: root })).toHaveProperty('result');

  const seen = watching();
  const stranger = made.accept(seen);
  const hand = await stranger.handle({
    method: 'initialize',
    params: { clientId: 'stranger', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT, 'ahp-session:/one', 'ahp-terminal:/t'] },
  }) as { snapshots: { resource: string }[] };
  expect(hand.snapshots.map((one) => one.resource)).toEqual([ROOT]);
  await admin.send('ahp-session:/one', { type: 'session/titleChanged', title: 'Private' });
  await admin.send('ahp-terminal:/t', { type: 'terminal/input', data: 'echo SECRET\n' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(seen.seen.filter((one) => one.method === 'action' && one.params.channel !== ROOT)).toEqual([]);
});

it('resumes a client id for a person signed in only when it is theirs, and only what they may read', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  const guest = await withRole(made, 'g');
  // From where the client's cursor stands past an action this host holds, so
  // each answer is a replay that names what it cannot have.
  await admin.send('ahp-session:/one', { type: 'session/titleChanged', title: 'One' });
  const read = await admin.client.handle({ method: 'subscribe', params: { channel: ROOT } }) as { snapshot: { fromSeq: number } };
  const resume = { clientId: 'a', subscriptions: [ROOT, 'ahp-session:/one'], lastSeenServerSeq: read.snapshot.fromSeq };

  // Nobody signed in resumes nothing it may not read; somebody else signed in is told the id is not theirs.
  expect(await call(made.accept(peer()), 'reconnect', resume)).toMatchObject({ result: { missing: ['ahp-session:/one'] } });
  const other = made.accept(peer());
  await hello(other, 'elsewhere'); await signIn(other, 'g');
  expect(await call(other, 'reconnect', resume)).toMatchObject({ code: -32008 });

  // The person who held it resumes it.
  const same = made.accept(peer());
  await hello(same, 'again'); await signIn(same, 'a');
  expect(await call(same, 'reconnect', resume)).toMatchObject({ result: { missing: [] } });

  // And a person resuming their own id gets back only what they may read.
  const back = made.accept(peer());
  await hello(back, 'later'); await signIn(back, 'g');
  expect(await call(back, 'reconnect', { ...resume, clientId: 'g' })).toMatchObject({ result: { missing: ['ahp-session:/one'] } });
  expect(guest.refused()).toEqual([]);
});

it('keeps every name to one kind of thing', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  // A chat named outside `ahp-chat:`, refused as VS Code's host refuses it.
  // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatMinting.ts#L57-L60
  for (const chat of ['file:///c', 'ahp-root://c', 'ahp-session:/c', 'ahp-terminal:/c', 'claude:/c', 'peer:/two']) {
    expect(await call(admin.client, 'createChat', { channel: 'ahp-session:/one', chat }))
      .toMatchObject({ code: -32602, message: `Chat URI must use the ahp-chat scheme: ${chat}` });
  }
  expect(await call(admin.client, 'createChat', { channel: 'ahp-session:/one', chat: 'ahp-chat:/two' })).toHaveProperty('result');
  // A terminal named after a chat, or a channel of a session.
  for (const channel of ['ahp-chat:/two', 'ahp-session:/one/annotations', 'ahp-session:/one/changeset/x', 'file:///t', 'ahp-chat:/t']) {
    expect(await call(admin.client, 'createTerminal', { channel, cwd: root })).toMatchObject({ code: -32003 });
  }
  // A session named after a terminal, in the name it was asked for.
  expect(await call(admin.client, 'createTerminal', { channel: 'vscode:/three', cwd: root })).toHaveProperty('result');
  expect(await call(admin.client, 'createSession', { channel: 'vscode:/three', provider: 'claude' })).toMatchObject({ code: -32003 });
  expect(await call(admin.client, 'createSession', { channel: 'file:///four', provider: 'claude' })).toMatchObject({ code: -32003 });
});

it('hears a change of files only from the client a watch was asked of, on the channel it answered', async () => {
  const made = host({ users: directory({ a: ['file:read', 'session:read', 'session:write', 'vscode-agent-client:read'] }) });
  const admin = await withRole(made, 'a');
  const seen = publishing('x:/w');
  const owner = made.accept(seen);
  await hello(owner, 'plugin'); await signIn(owner, 'a');
  const { result } = await call(admin.client, 'createResourceWatch', { channel: ROOT, uri: 'vscode-agent-client://plugin/file/-/src' }) as { result: { channel: string } };
  expect(await call(admin.client, 'subscribe', { channel: result.channel })).toHaveProperty('result');
  await owner.handle({ method: 'action', params: { channel: 'x:/w', serverSeq: 1, action: { type: 'resourceWatch/changed', changes: { items: [{ uri: 'file:///src/a', type: 'added' }] } } } });
  await owner.handle({ method: 'action', params: { channel: 'x:/w', serverSeq: 2, action: { type: 'session/titleChanged', title: 'Injected' } } });
  await owner.handle({ method: 'dispatchAction', params: { channel: result.channel, clientSeq: 1, action: { type: 'resourceWatch/changed', changes: { items: [] } } } });
  const told = admin.seen.seen.filter((one) => one.method === 'action' && one.params.channel === result.channel && one.params.rejectionReason === undefined);
  expect(told.map((one) => one.params.action.changes.items)).toEqual([[{ uri: 'vscode-agent-client://plugin/file/-/src/a', type: 'added' }]]);
  expect(seen.seen.filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')
    .map((one) => one.params.rejectionReason)).toEqual(['Server-only action: resourceWatch/changed']);
});

it('keeps a session\'s marks out of a file named after it', async () => {
  const { agent } = listingOne();
  const made = host({ users: directory({ a: ['file:read', 'session:read', 'session:write'], g: ['file:read'] }), agents: [agent] });
  const admin = await withRole(made, 'a');
  await admin.send('ahp-session:/disk/annotations', {
    type: 'annotations/set',
    annotation: { id: 'a1', origin: { session: 'ahp-session:/disk' }, resource: 'file:///x', resolved: false, entries: [{ id: 'e1', text: 'private' }] },
  });
  expect(admin.refused()).toEqual([]);
  expect(JSON.stringify(await call(admin.client, 'subscribe', { channel: 'ahp-session:/disk/annotations' }))).toContain('private');
  const guest = await withRole(made, 'g');
  expect(JSON.stringify(await call(guest.client, 'subscribe', { channel: 'file:///disk/annotations' }))).not.toContain('private');
});

/** A peer that answers every request with its own name, and keeps what it was asked. */
const answering = (name: string): Peer & { asked: string[]; seen: { method: string; params: Bag }[] } => {
  const asked: string[] = [];
  const seen: { method: string; params: Bag }[] = [];
  return {
    asked, seen,
    send: () => {}, answered: () => {}, close: () => {},
    request: async (method: string) => { asked.push(method); return { data: name, encoding: 'utf-8' }; },
    notify: (method: string, params: unknown) => { seen.push({ method, params: params as Bag }); },
  };
};

it('resumes another person\'s client id with nothing it may not read, and no claim on it until they sign in', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'vscode-agent-client:read'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  await admin.send('ahp-session:/one', { type: 'session/titleChanged', title: 'Private' });
  // The person's own publisher, which goes away.
  const first = made.accept(answering('first'));
  const said = await hello(first, 'pub') as { snapshots: { fromSeq: number }[] }; await signIn(first, 'a');
  first.close();

  const stranger = answering('stranger');
  const back = made.accept(stranger);
  const resumed = await call(back, 'reconnect', { clientId: 'pub', subscriptions: [ROOT, 'ahp-session:/one'], lastSeenServerSeq: said.snapshots[0]?.fromSeq ?? 0 }) as { result: { type: string; missing: string[]; actions: Bag[] } };
  expect(resumed.result).toMatchObject({ type: 'replay', missing: ['ahp-session:/one'] });
  expect(resumed.result.actions.filter((one) => one.channel !== ROOT)).toEqual([]);
  // A read of what it serves waits for somebody who holds the id, and nobody else may sign in on it.
  const read = call(admin.client, 'resourceRead', { channel: ROOT, uri: 'vscode-agent-client://pub/file/-/x' });
  expect(await call(back, 'authenticate', { channel: ROOT, resource: RECORD.resource, token: 'g' })).toMatchObject({ code: -32003 });
  expect(stranger.asked).toEqual([]);

  // The person who holds it signs in, and it is theirs again: the read goes to it.
  await signIn(back, 'a');
  expect(await read).toMatchObject({ result: { data: 'stranger' } });
  expect(await call(back, 'subscribe', { channel: 'ahp-session:/one' })).toHaveProperty('result');
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'vscode-agent-client://pub/file/-/x' })).toMatchObject({ result: { data: 'stranger' } });
});

it('gives a connection no claim on a client id another person holds', async () => {
  const made = host({ users: directory({ a: ['file:read', 'vscode-agent-client:read'], g: ['file:read'] }) });
  const admin = await withRole(made, 'a');
  const first = made.accept(answering('first'));
  await hello(first, 'pub'); await signIn(first, 'a');
  first.close();

  const other = answering('other');
  const again = made.accept(other);
  await hello(again, 'pub');
  const read = call(admin.client, 'resourceRead', { channel: ROOT, uri: 'vscode-agent-client://pub/file/-/x' });
  expect(await call(again, 'authenticate', { channel: ROOT, resource: RECORD.resource, token: 'g' })).toMatchObject({ code: -32003, message: expect.stringContaining('pub') });
  expect(other.asked).toEqual([]);

  const theirs = answering('theirs');
  const own = made.accept(theirs);
  await hello(own, 'pub'); await signIn(own, 'a');
  expect(await read).toMatchObject({ result: { data: 'theirs' } });
  expect(other.asked).toEqual([]);
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'vscode-agent-client://pub/file/-/x' })).toMatchObject({ result: { data: 'theirs' } });
});

it('keeps every family of action to its own kind of channel', async () => {
  const store = memoryAutomations();
  const made = host({
    users: directory({
      a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write', 'automation:read', 'automation:write', 'config:write'],
      g: ['file:read'],
    }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
    automations: store,
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  const definition = { title: 'nightly', enabled: true, message: { text: 'review' }, session: { provider: 'claude', workingDirectories: [uriOf(root)] }, triggers: [] };
  await admin.send('ahp-automations://', { type: 'automation/createRequested', resource: 'ahp-automation:/n', definition });
  expect(admin.refused()).toEqual([]);
  expect(store.get('ahp-automation:/n')).toBeDefined();

  // A file:read guest reaches no automation through a channel of another kind.
  const guest = await withRole(made, 'g');
  await guest.send('file:///x', { type: 'automation/createRequested', resource: 'ahp-automation:/pwn', definition });
  await guest.send('ahp-automations://', { type: 'automation/createRequested', resource: 'ahp-automation:/pwn2', definition });
  await guest.send('file:///x', { type: 'automation/updateRequested', resource: 'ahp-automation:/n', changes: { message: { text: 'exfiltrate' } } });
  await guest.send('ahp-otlp://logs', { type: 'automation/removed', resource: 'ahp-automation:/n' });
  expect(store.get('ahp-automation:/pwn')).toBeUndefined();
  expect(store.get('ahp-automation:/pwn2')).toBeUndefined();
  expect(JSON.stringify(store.get('ahp-automation:/n'))).toContain('review');
  expect(guest.refused()).toEqual([
    'file:///x: file:///x is not an automation channel here',
    'ahp-automations://: g may not automation:create here',
    'file:///x: file:///x is not an automation channel here',
    'ahp-otlp://logs: ahp-otlp://logs is not an automation channel here',
  ]);

  // Nor does anybody, with every grant, on a channel of another kind.
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  expect(await call(admin.client, 'createTerminal', { channel: 'ahp-terminal:/t', cwd: root })).toHaveProperty('result');
  const before = admin.refused().length;
  await admin.send('ahp-terminal:/t', { type: 'session/titleChanged', title: 'x' });
  await admin.send('ahp-session:/one', { type: 'terminal/input', data: 'echo no\n' });
  await admin.send('ahp-session:/one', { type: 'automation/removed', resource: 'ahp-automation:/n' });
  await admin.send('ahp-session:/one', { type: 'root/configChanged', config: { defaultShell: '/bin/sh' } });
  await admin.send('file:///x', { type: 'automationRun/cancelRequested', resource: 'ahp-automation-run:/r' });
  await admin.send('ahp-automations://', { type: 'annotations/set', annotations: [] });
  await admin.send('ahp-automations://', { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } });
  expect(admin.refused().slice(before)).toEqual([
    'ahp-terminal:/t: ahp-terminal:/t is not a session here',
    'ahp-session:/one: ahp-session:/one is not a terminal here',
    'ahp-session:/one: ahp-session:/one is not an automation channel here',
    'ahp-session:/one: ahp-session:/one is not the root here',
    'file:///x: file:///x is not an automation channel here',
    'ahp-automations://: ahp-automations:// is not a session here',
    'ahp-automations://: ahp-automations:// is not a session here',
  ]);
  expect(JSON.stringify(store.get('ahp-automation:/n'))).toContain('review');
});

it('keeps a name in a provider\'s scheme for a session, before anything has listed it', async () => {
  const { agent } = listingOne();
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write'] }),
    agents: [agent],
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createTerminal', { channel: 'claude:/disk', cwd: root })).toMatchObject({ code: -32003 });
  // The session is reachable once it is listed, under the name it is listed by.
  await call(admin.client, 'listSessions', { channel: ROOT });
  expect(await call(admin.client, 'subscribe', { channel: 'ahp-session:/disk' })).toMatchObject({ result: { snapshot: { resource: 'ahp-session:/disk' } } });
  await admin.send('ahp-session:/disk', { type: 'session/isReadChanged', isRead: true });
  expect(admin.refused()).toEqual([]);
  // A chat named in a provider's scheme is refused as any chat outside
  // `ahp-chat:` is, in VS Code's words.
  // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatMinting.ts#L57-L60
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  expect(await call(admin.client, 'createChat', { channel: 'ahp-session:/one', chat: 'claude:/side' }))
    .toMatchObject({ code: -32602, message: 'Chat URI must use the ahp-chat scheme: claude:/side' });
  expect(await call(admin.client, 'createChat', { channel: 'ahp-session:/one', chat: 'ahp-chat:/side' })).toHaveProperty('result');
});

it('keeps a terminal named like a session\'s marks what it is once the session is listed', async () => {
  const { agent } = listingOne();
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write'] }),
    agents: [agent],
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  const terminal = 'y:/disk/annotations';
  expect(await call(admin.client, 'createTerminal', { channel: terminal, cwd: root })).toHaveProperty('result');
  await admin.send('ahp-session:/disk/annotations', {
    type: 'annotations/set',
    annotation: { id: 'a1', origin: { session: 'ahp-session:/disk' }, resource: 'file:///x', resolved: false, entries: [{ id: 'e1', text: 'private' }] },
  });
  await call(admin.client, 'listSessions', { channel: ROOT });

  // The terminal is still the terminal.
  const shell = await call(admin.client, 'subscribe', { channel: terminal });
  expect(shell).toMatchObject({ result: { snapshot: { resource: terminal } } });
  expect(JSON.stringify(shell)).not.toContain('private');
  await admin.send(terminal, { type: 'terminal/input', data: 'echo MARKS-$((2+3))\n' });
  expect(admin.refused()).toEqual([]);
  expect(await until(admin.seen, terminal, 'MARKS-5')).toContain('MARKS-5');
});

it('binds a client id to the person who reconnects under it first', async () => {
  const made = host({ users: directory({ g: ['file:read'], h: ['file:read', 'vscode-agent-client:read'] }) });
  const x = made.accept(answering('x-unsigned'));
  await hello(x, 'x');
  x.close();
  const g = made.accept(answering('g-conn'));
  await hello(g, 'g'); await signIn(g, 'g');
  expect(await call(g, 'reconnect', { clientId: 'x', subscriptions: [ROOT], lastSeenServerSeq: 0 })).toHaveProperty('result');
  const h = made.accept(answering('h-conn'));
  await hello(h, 'x');
  expect(await call(h, 'authenticate', { channel: ROOT, resource: RECORD.resource, token: 'h' })).toMatchObject({ code: -32003 });
  const reader = await withRole(made, 'h');
  expect(await call(reader.client, 'resourceRead', { channel: ROOT, uri: 'vscode-agent-client://x/file/-/f' })).toMatchObject({ result: { data: 'g-conn' } });
});

it('routes nothing to a person removed while connected, and binds no id to a connection without one', async () => {
  let standing = true;
  const users = directory({ a: ['file:read', 'vscode-agent-client:read'], p: ['file:read'], q: ['file:read'] });
  const verify = users.verify;
  users.verify = async (token) => {
    const held = await verify(token);
    return held === undefined || token !== 'p' ? held : { ...held, standing: () => standing };
  };
  const made = host({ users });
  const admin = await withRole(made, 'a');
  const publisher = made.accept(answering('p-conn'));
  await hello(publisher, 'pub'); await signIn(publisher, 'p');
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'vscode-agent-client://pub/file/-/f' })).toMatchObject({ result: { data: 'p-conn' } });
  standing = false;
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'vscode-agent-client://pub/file/-/f' })).not.toMatchObject({ result: { data: 'p-conn' } });

  // Two people who name no client id are not one id, and neither is routed to.
  const one = made.accept(answering('one'));
  await one.handle({ method: 'initialize', params: { protocolVersions: ['0.9.0'] } });
  expect(await call(one, 'authenticate', { channel: ROOT, resource: RECORD.resource, token: 'p' })).toHaveProperty('result');
  const two = made.accept(answering('two'));
  await two.handle({ method: 'initialize', params: { protocolVersions: ['0.9.0'] } });
  expect(await call(two, 'authenticate', { channel: ROOT, resource: RECORD.resource, token: 'q' })).toHaveProperty('result');
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'vscode-agent-client://anonymous/file/-/f' })).not.toMatchObject({ result: { data: expect.anything() } });
});