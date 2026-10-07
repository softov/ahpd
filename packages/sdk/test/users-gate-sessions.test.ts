import { expect, it } from 'vitest';
import { ROOT } from '../src/host.js';
import { uriOf } from '../src/resources.js';
import { memorySessions } from '../src/sessions.js';
import { memoryAutomations } from '../src/automations.js';
import { echo } from '../../../examples/echo/agent.js';
import {
  call, directory, file, hello, host, listingOne, onDisk, peer, root, signIn, withRole,
} from './users-gate-helpers.js';
import type { ChangesetSource } from '../src/types/changes.js';
import type { Owner } from '../src/types/usage.js';

it('reads a session held under its provider\'s scheme as a session, and a file as a file', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write'], m: ['session:read'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = made.accept(peer());
  await hello(admin, 'admin'); await signIn(admin, 'a');
  expect(await call(admin, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  const session = 'claude:/one';
  const opened = await call(admin, 'subscribe', { channel: session }) as { result: { snapshot: { state: { defaultChat?: string; chats?: { resource: string }[] } } } };
  const chat = opened.result.snapshot.state.defaultChat ?? opened.result.snapshot.state.chats?.[0]?.resource;
  expect(chat).toBeDefined();

  // A member who may read sessions and not files reads it, and its chat.
  const member = made.accept(peer());
  await hello(member, 'member'); await signIn(member, 'm');
  expect(await call(member, 'subscribe', { channel: session })).toHaveProperty('result');
  expect(await call(member, 'subscribe', { channel: chat })).toHaveProperty('result');
  expect(await call(member, 'subscribe', { channel: uriOf(file) })).toMatchObject({ code: -32009 });

  // A guest who may read files and not sessions reads neither of them.
  const guest = made.accept(peer());
  await hello(guest, 'guest'); await signIn(guest, 'g');
  expect(await call(guest, 'subscribe', { channel: session })).toMatchObject({ code: -32009 });
  expect(await call(guest, 'subscribe', { channel: chat })).toMatchObject({ code: -32009 });

  // A chat the client named itself, whose scheme says nothing about whose it is.
  expect(await call(admin, 'createChat', { channel: session, chat: 'peer:/two' })).toHaveProperty('result');
  expect(await call(member, 'subscribe', { channel: 'peer:/two' })).toHaveProperty('result');
  expect(await call(guest, 'subscribe', { channel: 'peer:/two' })).toMatchObject({ code: -32009, message: expect.stringContaining('session:state') });
});

it('needs a session\'s write group to drive one, and the act it is refused is the one it did', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write'], w: ['session:write'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  await call(admin.client, 'subscribe', { channel: 'claude:/one' });

  // A member who may drive sessions and not read files drives it, by either name.
  const member = await withRole(made, 'w');
  await member.send('claude:/one', { type: 'session/titleChanged', title: 'Held' });
  await member.send('ahp-session:/one', { type: 'session/titleChanged', title: 'Given' });
  expect(member.refused()).toEqual([]);
  expect(admin.seen.seen.filter((one) => one.method === 'action' && one.params.action?.type === 'session/titleChanged')
    .map((one) => one.params.action.title)).toEqual(['Held', 'Given']);

  // A guest who may read files is refused all three, the annotations included,
  // and told which act each one was.
  const guest = await withRole(made, 'g');
  await guest.send('claude:/one', { type: 'session/titleChanged', title: 'Mine' });
  await guest.send('ahp-session:/one', { type: 'session/titleChanged', title: 'Mine' });
  await guest.send('claude:/one/annotations', { type: 'annotations/set', annotations: [] });
  expect(guest.refused()).toEqual([
    'claude:/one: g may not session:rename here',
    'claude:/one: g may not session:rename here',
    'claude:/one/annotations: g may not session:review here',
  ]);
});

it('reads and drives a changeset of a session held under its provider\'s scheme as the session\'s', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write'], r: ['session:read', 'session:write'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  const changeset = 'claude:/one/changeset/session';

  // Whatever the snapshot then says, it is not the gate saying it.
  const member = await withRole(made, 'r');
  expect(await call(member.client, 'subscribe', { channel: changeset })).not.toMatchObject({ code: -32009 });
  await member.send(changeset, { type: 'changeset/filesReviewChanged', files: ['a.txt'], reviewed: true });
  expect(member.refused().filter((one) => one.includes('may not'))).toEqual([]);

  const guest = await withRole(made, 'g');
  expect(await call(guest.client, 'subscribe', { channel: changeset })).toMatchObject({ code: -32009, message: expect.stringContaining('session:state') });
  await guest.send(changeset, { type: 'changeset/filesReviewChanged', files: ['a.txt'], reviewed: true });
  expect(guest.refused()).toEqual([`${changeset}: g may not session:review here`]);
});

it('needs session:changes as well as file:write to run an operation on a session\'s changeset, under either name', async () => {
  const invoked: string[] = [];
  const changes: ChangesetSource = {
    scopes: () => [{ id: 'uncommitted', label: 'Uncommitted Changes', changeKind: 'uncommitted' }],
    state: async () => ({ status: 'ready', files: [] }),
    summary: () => ({ files: 0 }),
    operations: () => [{ id: 'commit', label: 'Commit', scopes: ['changeset'], writes: true }],
    invoke: async (request) => { invoked.push(request.session); return { message: 'did commit' }; },
  };
  const made = host({
    users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write'], f: ['file:write'], b: ['file:write', 'session:write'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
    changes,
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');

  const writer = await withRole(made, 'f');
  for (const channel of ['claude:/one/changeset/uncommitted', 'ahp-session:/one/changeset/uncommitted']) {
    expect(await call(writer.client, 'invokeChangesetOperation', { channel, operationId: 'commit' }))
      .toMatchObject({ code: -32009, message: expect.stringContaining('session:changes') });
  }
  expect(invoked).toEqual([]);

  const both = await withRole(made, 'b');
  for (const channel of ['claude:/one/changeset/uncommitted', 'ahp-session:/one/changeset/uncommitted']) {
    expect(await call(both.client, 'invokeChangesetOperation', { channel, operationId: 'commit' }))
      .toMatchObject({ result: { message: 'did commit' } });
  }
  expect(invoked).toHaveLength(2);
});

it('asks a session\'s grants for a row a backend keeps on disk, under its name or any other', async () => {
  const { agent } = listingOne();
  const made = host({ users: directory({ r: ['session:read', 'session:write'], g: ['file:read'] }), agents: [agent] });
  const member = await withRole(made, 'r');
  expect(await call(member.client, 'subscribe', { channel: 'claude:/disk' })).toMatchObject({ result: { snapshot: { resource: 'claude:/disk' } } });
  expect(await call(member.client, 'subscribe', { channel: 'ahp-session:/disk' })).toMatchObject({ result: { snapshot: { resource: 'ahp-session:/disk' } } });
  // Marking a row read is what a client does from the catalogue, and writes
  // the session's flags: `session:mark`, whatever the row was called. The
  // refusal is said on the session it resolved to.
  const guest = await withRole(made, 'g');
  expect(await call(guest.client, 'subscribe', { channel: 'claude:/disk' })).toMatchObject({ code: -32009, message: expect.stringContaining('session:state') });
  await guest.send('claude:/disk', { type: 'session/isReadChanged', isRead: true });
  await guest.send('elsewhere:/disk', { type: 'session/isReadChanged', isRead: true });
  await guest.send('never-listed:/other', { type: 'session/isReadChanged', isRead: true });
  expect(guest.refused()).toEqual([
    'claude:/disk: g may not session:mark here',
    'claude:/disk: g may not session:mark here',
    'never-listed:/other: g may not session:mark here',
  ]);
});

/** Let whatever the host started get as far as the disk. */
const settle = async (times = 20): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((resolve) => { setTimeout(resolve, 1); });
};

it('finds a session a backend wrote to disk after the last listing', async () => {
  const { agent, rows } = listingOne();
  const made = host({ users: directory({ r: ['session:read'] }), agents: [agent] });
  const member = await withRole(made, 'r');
  await call(member.client, 'listSessions', { channel: ROOT });
  rows.push(onDisk('late'));
  expect(await call(member.client, 'subscribe', { channel: 'claude:/late' })).toMatchObject({ result: { snapshot: { resource: 'claude:/late' } } });
});

it('finds a session written between two subscribes, however close together', async () => {
  const { agent, rows } = listingOne();
  const made = host({ users: directory({ r: ['session:read'] }), agents: [agent] });
  const member = await withRole(made, 'r');

  // The first subscribe is for an id nobody has, and answering it is what
  // tells the host it has to list. A session written after that listing is
  // then opened at once - inside the two seconds the throttle used to answer
  // a second subscribe from, and which is the whole of what it cost.
  expect(await call(member.client, 'subscribe', { channel: 'claude:/nobody' })).toMatchObject({ code: -32001 });
  rows.push(onDisk('late'));
  expect(await call(member.client, 'subscribe', { channel: 'claude:/late' }))
    .toMatchObject({ result: { snapshot: { resource: 'claude:/late' } } });
});

it('finds a session written while a listing was already out', async () => {
  const { agent, counted, rows, holdNextList } = listingOne();
  const made = host({ users: directory({ r: ['session:read'] }), agents: [agent] });
  const member = await withRole(made, 'r');
  await call(member.client, 'listSessions', { channel: ROOT });
  await settle();
  const before = counted.lists;

  /*
   * A pass over the disk that is still out, held where it read.
   *
   * It answers without `late2`, because that is what any listing already in
   * flight does - the session was written after it read. A subscribe that
   * arrives now must not be answered from it: joining a pass that began before
   * the ask is joining one that never saw the session.
   */
  const release = holdNextList();
  const nobody = call(member.client, 'subscribe', { channel: 'claude:/nobody' });
  await settle();
  expect(counted.lists).toBe(before + 1);

  rows.push(onDisk('late2'));
  const late = call(member.client, 'subscribe', { channel: 'claude:/late2' });
  await settle();
  release();

  expect(await late).toMatchObject({ result: { snapshot: { resource: 'claude:/late2' } } });
  expect(await nobody).toMatchObject({ code: -32001 });
});

it('reads a channel it cannot place as a session\'s, and a file as a file', async () => {
  const made = host({ users: directory({ r: ['session:read'], w: ['session:write'], g: ['file:read'] }) });
  const reader = await withRole(made, 'r');
  const writer = await withRole(made, 'w');
  const guest = await withRole(made, 'g');

  // Nothing here is called `x:/1`: the gate asks for a session's read, and
  // what is behind it says there is no such session.
  expect(await call(reader.client, 'subscribe', { channel: 'x:/1' })).not.toMatchObject({ code: -32009 });
  expect(await call(guest.client, 'subscribe', { channel: 'x:/1' })).toMatchObject({ code: -32009, message: expect.stringContaining('session:state') });
  await writer.send('x:/1', { type: 'session/isReadChanged', isRead: true });
  expect(writer.refused().filter((one) => one.includes('may not'))).toEqual([]);
  await guest.send('x:/1', { type: 'session/isReadChanged', isRead: true });
  expect(guest.refused()).toEqual(['x:/1: g may not session:mark here']);

  // A file is a file, to read and to dispatch into; a session's action on it
  // is refused for what the file is, before any grant is asked.
  expect(await call(reader.client, 'subscribe', { channel: uriOf(file) })).toMatchObject({ code: -32009, message: expect.stringContaining('file:watch') });
  await writer.send(uriOf(file), { type: 'vendor/probe' });
  await writer.send(uriOf(file), { type: 'session/isReadChanged', isRead: true });
  expect(writer.refused()).toEqual([`${uriOf(file)}: w may not file:watch here`, `${uriOf(file)}: ${uriOf(file)} is not a session here`]);
});

it('still asks a session\'s grants for a session that was disposed', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/gone', provider: 'claude' })).toHaveProperty('result');
  expect(await call(admin.client, 'disposeSession', { channel: 'claude:/gone' })).toHaveProperty('result');
  const guest = await withRole(made, 'g');
  expect(await call(guest.client, 'subscribe', { channel: 'claude:/gone' })).toMatchObject({ code: -32009, message: expect.stringContaining('session:state') });
  await guest.send('claude:/gone', { type: 'session/isReadChanged', isRead: true });
  expect(guest.refused()).toEqual(['claude:/gone: g may not session:mark here']);
});

it('shares one listing among subscribes to sessions nobody has, asked at once', async () => {
  const { agent, counted } = listingOne();
  const made = host({ users: directory({ r: ['session:read'] }), agents: [agent] });
  const member = await withRole(made, 'r');
  await settle();
  const before = counted.lists;

  // Five ids nobody has, in one breath: whoever is opening sessions nobody has
  // costs one pass over the machine's transcripts and not one each. There is no
  // window to step past any more, so nothing here moves the clock.
  const answers = await Promise.all([0, 1, 2, 3, 4].map((i) =>
    call(member.client, 'subscribe', { channel: `claude:/nobody-${i}` })));
  expect(answers).toHaveLength(5);
  for (const one of answers) expect(one).toMatchObject({ code: -32001 });
  expect(counted.lists - before).toBe(1);
});

it('keeps config for a channel that names no session out of the store', async () => {
  const { agent } = listingOne();
  const store = memorySessions();
  const made = host({ users: directory({ a: ['file:read', 'session:read', 'session:write'] }), agents: [agent], sessions: store });
  const admin = await withRole(made, 'a');
  await admin.send('zzz:/nothing', { type: 'session/configChanged', config: { voice: 'shouty' } });
  await admin.send('zzz:/disk', { type: 'session/configChanged', config: { voice: 'shouty', isolation: 'worktree' } });
  expect(admin.refused()).toEqual(['zzz:/nothing: zzz:/nothing is not a session here']);
  expect(store.config('nothing')).toBeUndefined();
  // The row that is a session keeps the backend's key and not this host's own.
  expect(store.config('disk')).toEqual({ voice: 'shouty' });
});

it('asks a session\'s grants for completions in a session', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  const asked = { channel: 'claude:/one', kind: 'userMessage', text: '/', offset: 1 };
  expect(await call(admin.client, 'completions', asked)).toHaveProperty('result');
  const guest = await withRole(made, 'g');
  expect(await call(guest.client, 'completions', asked)).toMatchObject({ code: -32009, message: expect.stringContaining('session:state') });
  expect(await call(guest.client, 'completions', { ...asked, channel: ROOT })).toHaveProperty('result');
});

it('refuses a channel that is not a string rather than reading it as one', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  const guest = await withRole(made, 'g');
  const asked = { kind: 'userMessage', text: '/', offset: 1 };

  // A session's commands are the session's to give, and the gate asks for a
  // session's read on the name the request spells out.
  expect(await call(guest.client, 'completions', { ...asked, channel: 'claude:/one' }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('session:state') });

  /*
   * And a channel that is not a string is not a channel.
   *
   * `capabilityFor` gates `completions` only when the channel is a string, so
   * a list where a name belongs reached the handler with nothing asked for it
   * - and `String()` there made it the session, so a guest who may not read
   * that session was answered with its commands.
   */
  expect(await call(guest.client, 'completions', { ...asked, channel: ['claude:/one'] }))
    .toMatchObject({ code: -32602, message: 'channel must be a string' });
});

it('needs computer:write to name a source for a session, and no more to name a machine', async () => {
  const made = host({
    users: directory({
      a: ['file:read', 'session:read', 'session:write', 'computer:read', 'computer:write'],
      w: ['file:read', 'session:read', 'session:write'],
    }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');

  // A session on this host, and one in a machine that is already there, are
  // `session:write` and nothing more.
  const worker = await withRole(made, 'w');
  expect(await call(worker.client, 'createSession', { channel: 'ahp-session:/two', provider: 'claude' })).toHaveProperty('result');
  expect(await call(worker.client, 'createSession', {
    channel: 'ahp-session:/three', provider: 'claude', config: { computer: 'computer://box' },
  })).toHaveProperty('result');

  // Naming a source is asking for a machine to be made for the session, which
  // is what the grant is for - decision
  // `a-machine-made-for-a-session-counts-against-max-and-needs-computer-write`.
  expect(await call(worker.client, 'createSession', {
    channel: 'ahp-session:/four', provider: 'claude', config: { computer: 'disposable:s' },
  })).toMatchObject({ code: -32009, message: 'w may not computer:write here' });
  // And the change that makes one before the first turn, which is asked of the
  // same gate rather than of a session nobody is watching yet.
  await worker.send('claude:/two', { type: 'session/configChanged', config: { computer: 'disposable:s' } });
  expect(worker.refused()).toEqual(['claude:/two: w may not computer:write here']);
});

it('needs computer:write to name a folder\'s dev container for a session', async () => {
  const made = host({
    users: directory({ w: ['file:read', 'session:read', 'session:write'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const worker = await withRole(made, 'w');
  expect(await call(worker.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');

  // A dev container made for the session is a machine made for it, held to
  // the grant a disposable one is - decision
  // `a-machine-made-for-a-session-counts-against-max-and-needs-computer-write`.
  expect(await call(worker.client, 'createSession', {
    channel: 'ahp-session:/two', provider: 'claude', config: { computer: 'devcontainer:///w/app' },
  })).toMatchObject({ code: -32009, message: 'w may not computer:write here' });
  await worker.send('claude:/one', { type: 'session/configChanged', config: { computer: 'devcontainer:///w/app' } });
  expect(worker.refused()).toEqual(['claude:/one: w may not computer:write here']);
});

it('asks an automation\'s owner for computer:write, and refuses a run it cannot check', async () => {
  const store = memoryAutomations();
  const made = host({
    users: directory({
      a: ['file:read', 'session:read', 'session:write', 'computer:write', 'automation:read', 'automation:write'],
      w: ['file:read', 'session:read', 'session:write'],
    }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
    automations: store,
    // A machine maker that answers with one box, which is all this test needs:
    // what is asked here is who may ask for it.
    computers: { how: async () => undefined, create: async () => 'box' },
  });
  const admin = await withRole(made, 'a');
  // Nobody this process met signing in, which is the only way an owner can be
  // a name with no principal behind it.
  await withRole(made, 'w');
  const session = { provider: 'claude', config: { computer: 'disposable:s' }, workingDirectories: [`file://${root}`] };
  const runOf = async (resource: string, owner: Owner | undefined) => {
    // Its own copy of the template: a run that makes its machine rewrites the
    // source into `computer://` on the config it was handed, and a shared one
    // would leave the runs after it asking for a machine that is already there.
    store.create(resource, {
      title: 'nightly', enabled: true, message: { text: 'review' },
      session: { ...session, config: { ...session.config } }, triggers: [],
    }, owner);
    await call(admin.client, 'runAutomation', { channel: 'ahp-automations://', automation: resource });
    // `!`: the run was just made, so the entry already shows it.
    return store.get(resource)!.runs[0] as { lifecycle: { status: string; error?: { message: string } } };
  };

  // An owner who may not make machines, refused in the words the boundary
  // refuses a connection with.
  const missing = await runOf('ahp-automation:/missing', 'user:w');
  expect(missing.lifecycle.status).toBe('failed');
  expect(missing.lifecycle.error?.message).toBe('w may not computer:write here');

  // An owner this process has never seen has no grants to ask about, so the
  // run waits for them rather than going unchecked.
  const unseen = await runOf('ahp-automation:/unseen', 'user:ghost');
  expect(unseen.lifecycle.error?.message).toContain('user:ghost has not signed in since this daemon started');

  // And the owner who may, whose run goes on to make its machine.
  const allowed = await runOf('ahp-automation:/allowed', 'user:a');
  expect(allowed.lifecycle.status).not.toBe('failed');

  // An automation nobody signed in for - this host's own, or nobody's - is not
  // somebody's machine, so the gate above has no person to ask and the run goes
  // on to make its machine as a root connection does everywhere else.
  const roots = await runOf('ahp-automation:/root', 'root:workstation');
  expect(roots.lifecycle.status).not.toBe('failed');
  const unowned = await runOf('ahp-automation:/unowned', undefined);
  expect(unowned.lifecycle.status).not.toBe('failed');
});