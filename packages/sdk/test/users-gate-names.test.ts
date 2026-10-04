import { expect, it } from 'vitest';
import { ROOT } from '../src/host.js';
import { memorySessions } from '../src/sessions.js';
import { memoryAutomations } from '../src/automations.js';
import { shellTerminals } from '../src/terminals.js';
import { echo } from '../../../examples/echo/agent.js';
import {
  RECORD, call, directory, hello, host, listingOne, peer, root, signIn, until, watching, withRole,
} from './users-gate-helpers.js';
import type { Bag } from './users-gate-helpers.js';
import type { Peer } from '../src/types/rpc.js';

/** A peer that answers a relayed `createResourceWatch` with the channel it is given. */
const publishing = (channel: string): Peer & { seen: { method: string; params: Bag }[] } => {
  const seen: { method: string; params: Bag }[] = [];
  return {
    seen,
    send: () => {}, answered: () => {}, close: () => {},
    request: async () => ({ channel }),
    notify: (method: string, params: unknown) => { seen.push({ method, params: params as Bag }); },
  };
};

it('reads a session spelt as a file or as a watch as what it is spelt as', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write'], g: ['file:read', 'virtual:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  await call(admin.client, 'subscribe', { channel: 'claude:/one' });
  await call(admin.client, 'subscribe', { channel: 'ahp-chat:/one' });

  // A file:read guest who names the session as a file reads nothing of it and drives nothing in it.
  const guest = await withRole(made, 'g');
  expect(await call(guest.client, 'subscribe', { channel: 'file:///one' })).not.toHaveProperty('result');
  await guest.send('file:///one', { type: 'session/titleChanged', title: 'Taken' });
  await guest.send('file:///one', { type: 'chat/turnStarted', turnId: 't1', message: { text: 'run this' } });
  await guest.send('file:///one/annotations', { type: 'annotations/set', annotations: [] });

  // Nor by a relayed watch named after the session: the name is the session's.
  const owner = made.accept(publishing('x:/one'));
  await hello(owner, 'plugin'); await signIn(owner, 'g');
  expect(await call(guest.client, 'createResourceWatch', { channel: ROOT, uri: 'virtual://plugin/src' })).toMatchObject({ code: -32003 });
  expect(await call(guest.client, 'subscribe', { channel: 'x:/one' })).toMatchObject({ code: -32009, message: expect.stringContaining('session:state') });
  await guest.send('x:/one', { type: 'session/titleChanged', title: 'Taken' });

  const acted = admin.seen.seen.filter((one) => one.method === 'action'
    && ['session/titleChanged', 'chat/turnStarted'].includes(String(one.params.action?.type)));
  expect(acted).toEqual([]);
  expect(guest.refused()).toEqual([
    'file:///one: file:///one is not a session here',
    'file:///one: file:///one is not a session here',
    'file:///one/annotations: file:///one/annotations is not a session here',
    'claude:/one: g may not session:rename here',
  ]);

  // The session and a watch under a name of its own both still work.
  await admin.send('ahp-session:/one', { type: 'session/titleChanged', title: 'Mine' });
  expect(admin.refused()).toEqual([]);
  expect(admin.seen.seen.some((one) => one.method === 'action' && one.params.action?.type === 'session/titleChanged')).toBe(true);
  const own = made.accept(publishing('x:/w'));
  await hello(own, 'second'); await signIn(own, 'g');
  expect(await call(guest.client, 'createResourceWatch', { channel: ROOT, uri: 'virtual://second/src' })).toMatchObject({ result: { channel: 'x:/w' } });
  expect(await call(guest.client, 'subscribe', { channel: 'x:/w' })).toMatchObject({ result: { snapshot: { resource: 'x:/w' } } });
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
  // A terminal named after a live session, in its held name or another.
  expect(await call(admin.client, 'createTerminal', { channel: 'claude:/one', cwd: root })).toMatchObject({ code: -32003 });
  expect(await call(admin.client, 'createTerminal', { channel: 'ahp-session:/one', cwd: root })).toMatchObject({ code: -32003 });
  // A name in a provider's scheme is a session's even with no session under it.
  expect(await call(admin.client, 'createTerminal', { channel: 'claude:/two', cwd: root })).toMatchObject({ code: -32003 });
  // And a session named after a terminal.
  expect(await call(admin.client, 'createTerminal', { channel: 'vscode:/two', cwd: root })).toHaveProperty('result');
  expect(await call(admin.client, 'createSession', { channel: 'vscode:/two', provider: 'claude' })).toMatchObject({ code: -32003 });
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
    params: { clientId: 'stranger', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT, 'claude:/one', 'ahp-session:/one', 'ahp-terminal:/t'] },
  }) as { snapshots: { resource: string }[] };
  expect(hand.snapshots.map((one) => one.resource)).toEqual([ROOT]);
  await admin.send('claude:/one', { type: 'session/titleChanged', title: 'Private' });
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
  const resume = { clientId: 'a', subscriptions: [ROOT, 'claude:/one'], lastSeenServerSeq: 0 };

  // Nobody signed in resumes nothing it may not read; somebody else signed in is told the id is not theirs.
  expect(await call(made.accept(peer()), 'reconnect', resume)).toMatchObject({ result: { missing: ['claude:/one'] } });
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
  expect(await call(back, 'reconnect', { ...resume, clientId: 'g' })).toMatchObject({ result: { missing: ['claude:/one'] } });
  expect(guest.refused()).toEqual([]);
});

it('keeps every name to one kind of thing', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write', 'virtual:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  const relay = async (clientId: string, channel: string) => {
    const owner = made.accept(publishing(channel));
    await hello(owner, clientId); await signIn(owner, 'a');
    return await call(admin.client, 'createResourceWatch', { channel: ROOT, uri: `virtual://${clientId}/src` });
  };
  // A relayed watch named after a session, and a session named after a relayed watch.
  expect(await relay('first', 'claude:/one')).toMatchObject({ code: -32003 });
  expect(await relay('second', 'claude:/later')).toMatchObject({ code: -32003 });
  expect(await relay('third', 'x:/later')).toMatchObject({ result: { channel: 'x:/later' } });
  expect(await call(admin.client, 'createSession', { channel: 'x:/later', provider: 'claude' })).toMatchObject({ code: -32003 });
  // A chat named in a space this host keeps for something else.
  for (const chat of ['file:///c', 'ahp-root://c', 'ahp-session:/c', 'ahp-terminal:/c', 'claude:/c', 'x:/later']) {
    expect(await call(admin.client, 'createChat', { channel: 'claude:/one', chat })).toMatchObject({ code: -32003 });
  }
  expect(await call(admin.client, 'createChat', { channel: 'claude:/one', chat: 'peer:/two' })).toHaveProperty('result');
  // A terminal named after a chat, or a channel of a session.
  for (const channel of ['peer:/two', 'claude:/one/annotations', 'claude:/one/changeset/x', 'file:///t', 'ahp-chat:/t']) {
    expect(await call(admin.client, 'createTerminal', { channel, cwd: root })).toMatchObject({ code: -32003 });
  }
  // A session named after a terminal, in the name it was asked for.
  expect(await call(admin.client, 'createTerminal', { channel: 'vscode:/three', cwd: root })).toHaveProperty('result');
  expect(await call(admin.client, 'createSession', { channel: 'vscode:/three', provider: 'claude' })).toMatchObject({ code: -32003 });
  expect(await call(admin.client, 'createSession', { channel: 'file:///four', provider: 'claude' })).toMatchObject({ code: -32003 });
});

it('relays only a change of files from the client that keeps a watch', async () => {
  const made = host({ users: directory({ a: ['file:read', 'session:read', 'session:write', 'virtual:read'] }) });
  const admin = await withRole(made, 'a');
  const seen = publishing('x:/w');
  const owner = made.accept(seen);
  await hello(owner, 'plugin'); await signIn(owner, 'a');
  expect(await call(admin.client, 'createResourceWatch', { channel: ROOT, uri: 'virtual://plugin/src' })).toMatchObject({ result: { channel: 'x:/w' } });
  await call(admin.client, 'subscribe', { channel: 'x:/w' });
  owner.handle({ method: 'dispatchAction', params: { channel: 'x:/w', action: { type: 'resourceWatch/changed', changes: { items: [] } } } });
  owner.handle({ method: 'dispatchAction', params: { channel: 'x:/w', action: { type: 'session/titleChanged', title: 'Injected' } } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const relayed = admin.seen.seen.filter((one) => one.method === 'action' && one.params.channel === 'x:/w' && one.params.rejectionReason === undefined);
  expect(relayed.map((one) => one.params.action.type)).toEqual(['resourceWatch/changed']);
  expect(seen.seen.filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')
    .map((one) => one.params.rejectionReason)).toEqual(['x:/w is not a session here']);
});

it('keeps a session\'s marks out of a file named after it', async () => {
  const { agent } = listingOne();
  const made = host({ users: directory({ a: ['file:read', 'session:read', 'session:write'], g: ['file:read'] }), agents: [agent] });
  const admin = await withRole(made, 'a');
  await admin.send('claude:/disk/annotations', {
    type: 'annotations/set',
    annotation: { id: 'a1', origin: { session: 'claude:/disk' }, resource: 'file:///x', resolved: false, entries: [{ id: 'e1', text: 'private' }] },
  });
  expect(admin.refused()).toEqual([]);
  expect(JSON.stringify(await call(admin.client, 'subscribe', { channel: 'claude:/disk/annotations' }))).toContain('private');
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
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'virtual:read'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  await admin.send('claude:/one', { type: 'session/titleChanged', title: 'Private' });
  // The person's own publisher, which goes away.
  const first = made.accept(answering('first'));
  await hello(first, 'pub'); await signIn(first, 'a');
  first.close();

  const stranger = answering('stranger');
  const back = made.accept(stranger);
  const resumed = await call(back, 'reconnect', { clientId: 'pub', subscriptions: [ROOT, 'claude:/one'], lastSeenServerSeq: 0 }) as { result: { type: string; missing: string[]; actions: Bag[] } };
  expect(resumed.result).toMatchObject({ type: 'replay', missing: ['claude:/one'] });
  expect(resumed.result.actions.filter((one) => one.channel !== ROOT)).toEqual([]);
  // Nothing published under the id reaches it, and nobody else may sign in on it.
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'virtual://pub/x' })).not.toMatchObject({ result: { data: 'stranger' } });
  expect(stranger.asked).toEqual([]);
  expect(await call(back, 'authenticate', { channel: ROOT, resource: RECORD.resource, token: 'g' })).toMatchObject({ code: -32003 });

  // The person who holds it signs in, and it is theirs again.
  await signIn(back, 'a');
  expect(await call(back, 'subscribe', { channel: 'claude:/one' })).toHaveProperty('result');
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'virtual://pub/x' })).toMatchObject({ result: { data: 'stranger' } });
});

it('gives a connection no claim on a client id another person holds', async () => {
  const made = host({ users: directory({ a: ['file:read', 'virtual:read'], g: ['file:read'] }) });
  const admin = await withRole(made, 'a');
  const first = made.accept(answering('first'));
  await hello(first, 'pub'); await signIn(first, 'a');
  first.close();

  const other = answering('other');
  const again = made.accept(other);
  await hello(again, 'pub');
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'virtual://pub/x' })).not.toMatchObject({ result: { data: 'other' } });
  expect(other.asked).toEqual([]);
  expect(await call(again, 'authenticate', { channel: ROOT, resource: RECORD.resource, token: 'g' })).toMatchObject({ code: -32003, message: expect.stringContaining('pub') });

  const theirs = answering('theirs');
  const own = made.accept(theirs);
  await hello(own, 'pub'); await signIn(own, 'a');
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'virtual://pub/x' })).toMatchObject({ result: { data: 'theirs' } });
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
  const definition = { title: 'nightly', enabled: true, message: { text: 'review' }, session: { provider: 'claude', workingDirectories: [`file://${root}`] }, triggers: [] };
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
  await admin.send('claude:/one', { type: 'terminal/input', data: 'echo no\n' });
  await admin.send('claude:/one', { type: 'automation/removed', resource: 'ahp-automation:/n' });
  await admin.send('claude:/one', { type: 'root/configChanged', config: { defaultShell: '/bin/sh' } });
  await admin.send('file:///x', { type: 'automationRun/cancelRequested', resource: 'ahp-automation-run:/r' });
  await admin.send('ahp-automations://', { type: 'annotations/set', annotations: [] });
  await admin.send('ahp-automations://', { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } });
  expect(admin.refused().slice(before)).toEqual([
    'ahp-terminal:/t: ahp-terminal:/t is not a session here',
    'claude:/one: claude:/one is not a terminal here',
    'claude:/one: claude:/one is not an automation channel here',
    'claude:/one: claude:/one is not the root here',
    'file:///x: file:///x is not an automation channel here',
    'ahp-automations://: ahp-automations:// is not a session here',
    'ahp-automations://: ahp-automations:// is not a session here',
  ]);
  expect(JSON.stringify(store.get('ahp-automation:/n'))).toContain('review');
});

it('keeps a name in a provider\'s scheme for a session, before anything has listed it', async () => {
  const { agent } = listingOne();
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write', 'virtual:read'] }),
    agents: [agent],
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createTerminal', { channel: 'claude:/disk', cwd: root })).toMatchObject({ code: -32003 });
  const owner = made.accept(publishing('claude:/disk'));
  await hello(owner, 'evil');
  expect(await call(admin.client, 'createResourceWatch', { channel: ROOT, uri: 'virtual://evil/src' })).toMatchObject({ code: -32003 });
  // The session is still reachable once it is listed.
  await call(admin.client, 'listSessions', { channel: ROOT });
  expect(await call(admin.client, 'subscribe', { channel: 'claude:/disk' })).toMatchObject({ result: { snapshot: { resource: 'claude:/disk' } } });
  await admin.send('ahp-session:/disk', { type: 'session/isReadChanged', isRead: true });
  expect(admin.refused()).toEqual([]);
  // A chat in a provider's scheme is refused too; any other scheme is a chat's to take.
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  expect(await call(admin.client, 'createChat', { channel: 'claude:/one', chat: 'claude:/side' })).toMatchObject({ code: -32003 });
  expect(await call(admin.client, 'createChat', { channel: 'claude:/one', chat: 'peer:/side' })).toHaveProperty('result');
});

it('keeps a watch or a terminal named like a session\'s marks what it is once the session is listed', async () => {
  const { agent } = listingOne();
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write', 'virtual:read'] }),
    agents: [agent],
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  const watch = 'x:/disk/annotations';
  const terminal = 'y:/disk/annotations';
  const seen = publishing(watch);
  const owner = made.accept(seen);
  await hello(owner, 'plugin'); await signIn(owner, 'a');
  expect(await call(admin.client, 'createResourceWatch', { channel: ROOT, uri: 'virtual://plugin/src' })).toMatchObject({ result: { channel: watch } });
  expect(await call(admin.client, 'createTerminal', { channel: terminal, cwd: root })).toHaveProperty('result');
  await admin.send('claude:/disk/annotations', {
    type: 'annotations/set',
    annotation: { id: 'a1', origin: { session: 'claude:/disk' }, resource: 'file:///x', resolved: false, entries: [{ id: 'e1', text: 'private' }] },
  });
  await call(admin.client, 'listSessions', { channel: ROOT });

  // The watch is still the watch: its snapshot, and its owner's change reaches its subscriber.
  const opened = await call(admin.client, 'subscribe', { channel: watch });
  expect(opened).toMatchObject({ result: { snapshot: { resource: watch } } });
  expect(JSON.stringify(opened)).not.toContain('private');
  owner.handle({ method: 'dispatchAction', params: { channel: watch, action: { type: 'resourceWatch/changed', changes: { items: [] } } } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(seen.seen.filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')).toEqual([]);
  expect(admin.seen.seen.some((one) => one.method === 'action' && one.params.channel === watch && one.params.action?.type === 'resourceWatch/changed')).toBe(true);

  // And the terminal is still the terminal.
  const shell = await call(admin.client, 'subscribe', { channel: terminal });
  expect(shell).toMatchObject({ result: { snapshot: { resource: terminal } } });
  expect(JSON.stringify(shell)).not.toContain('private');
  await admin.send(terminal, { type: 'terminal/input', data: 'echo MARKS-$((2+3))\n' });
  expect(admin.refused()).toEqual([]);
  expect(await until(admin.seen, terminal, 'MARKS-5')).toContain('MARKS-5');
});

it('binds a client id to the person who reconnects under it first', async () => {
  const made = host({ users: directory({ g: ['file:read'], h: ['file:read', 'virtual:read'] }) });
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
  expect(await call(reader.client, 'resourceRead', { channel: ROOT, uri: 'virtual://x/f' })).toMatchObject({ result: { data: 'g-conn' } });
});

it('routes nothing to a person removed while connected, and binds no id to a connection without one', async () => {
  let standing = true;
  const users = directory({ a: ['file:read', 'virtual:read'], p: ['file:read'], q: ['file:read'] });
  const verify = users.verify;
  users.verify = async (token) => {
    const held = await verify(token);
    return held === undefined || token !== 'p' ? held : { ...held, standing: () => standing };
  };
  const made = host({ users });
  const admin = await withRole(made, 'a');
  const publisher = made.accept(answering('p-conn'));
  await hello(publisher, 'pub'); await signIn(publisher, 'p');
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'virtual://pub/f' })).toMatchObject({ result: { data: 'p-conn' } });
  standing = false;
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'virtual://pub/f' })).not.toMatchObject({ result: { data: 'p-conn' } });

  // Two people who name no client id are not one id, and neither is routed to.
  const one = made.accept(answering('one'));
  await one.handle({ method: 'initialize', params: { protocolVersions: ['0.9.0'] } });
  expect(await call(one, 'authenticate', { channel: ROOT, resource: RECORD.resource, token: 'p' })).toHaveProperty('result');
  const two = made.accept(answering('two'));
  await two.handle({ method: 'initialize', params: { protocolVersions: ['0.9.0'] } });
  expect(await call(two, 'authenticate', { channel: ROOT, resource: RECORD.resource, token: 'q' })).toHaveProperty('result');
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'virtual://anonymous/f' })).not.toMatchObject({ result: { data: expect.anything() } });
});