import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { computersFor } from '../../sdk/src/computers.js';
import { createHost, ROOT } from '../../sdk/src/host.js';
import { memoryPolicies } from '../../sdk/src/policies.js';
import { memorySessions } from '../../sdk/src/sessions.js';
import { fileUsers } from '../../sdk/src/users.js';
import { acpAgent } from '../../agent-acp/src/index.js';
import { idOf } from '../../sdk/src/catalog.js';
import type { AutomationStore, StartSession } from '../../sdk/src/types/automations.js';
import type { Bag } from '../../sdk/src/types/common.js';
import type { ComputerPort } from '../../sdk/src/types/computers.js';
import type { Policies } from '../../sdk/src/types/policies.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { SessionStore } from '../../sdk/src/types/sessions.js';
import type { Users } from '../../sdk/src/types/users.js';

/*
 * A session that names a machine runs there.
 *
 * The server is the real ACP fixture, reached through a fake `computers` port:
 * the descriptor's command is the fixture and the backend's own command is a
 * program that exits immediately, so a turn that completes is proof the port's
 * answer is what ran. No Docker, and no network.
 */

const FIXTURE = fileURLToPath(new URL('../../agent-acp/test/fixtures/acp-server.mjs', import.meta.url));
const FAILS = ['-e', 'process.exit(3)'];

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

const until = async (check: () => boolean, times = 3000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
};

type Note = { channel: string; action: Record<string, unknown>; rejectionReason?: string };

const actions = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

const types = (p: ReturnType<typeof peer>, channel: string): string[] =>
  actions(p, channel).map((e) => String(e.action.type));

/** What the host refused a dispatched action with, or nothing when it allowed it. */
const rejection = (p: ReturnType<typeof peer>): string | undefined =>
  p.notes
    .filter((note) => note.method === 'action')
    .map((note) => (note.params as Note).rejectionReason)
    .filter((one): one is string => one !== undefined)
    .pop();

/** What the call was refused with, or a case that fails because it was allowed. */
const refusalOf = async (run: Promise<unknown>): Promise<{ code?: number; message: string }> =>
  run.then(() => { throw new Error('the call was allowed'); }, (error: { code?: number; message: string }) => error);

const settle = async (times = 24): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

const settled = (p: ReturnType<typeof peer>, channel: string): boolean =>
  types(p, channel).some((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled' || type === 'chat/error');

const opened: { client: ReturnType<ReturnType<typeof createHost>['accept']>; uri: string }[] = [];
afterEach(async () => {
  for (const one of opened.splice(0)) {
    await one.client.handle({ method: 'disposeSession', params: { channel: one.uri } });
  }
});

/**
 * The ACP backend, with the `computer` key the computer plugin publishes.
 *
 * `sessionMutable: false` is what makes a change of it before the first turn a
 * restart rather than a setting a running backend is handed, and that window
 * is one of the three roads below.
 */
function harness(options: { command: string; args: string[] }) {
  const agent = acpAgent({ command: options.command, args: options.args, provider: 'acp' });
  const { properties, ...rest } = agent.schema() as { properties?: Record<string, unknown> };
  return {
    ...agent,
    schema: () => ({ ...rest, properties: { ...properties, computer: { type: 'string', sessionMutable: false } } }),
  };
}

/** A host and the client that would drive it, before any session is made. */
async function probe(options: {
  command: string;
  args: string[];
  computers?: ComputerPort;
  automations?: AutomationStore;
  users?: Users;
  policies?: Policies;
  policiesCheck?: boolean;
  sessions?: SessionStore;
}) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-in-computer-'));
  const sessions = options.sessions ?? memorySessions();
  const host = createHost({
    path,
    agents: [harness(options)],
    sessions,
    ...(options.computers === undefined ? {} : { computers: options.computers }),
    ...(options.automations === undefined ? {} : { automations: options.automations }),
    ...(options.users === undefined ? {} : { users: options.users }),
    ...(options.policies === undefined ? {} : { policies: options.policies }),
    ...(options.policiesCheck === undefined ? {} : { policiesCheck: options.policiesCheck }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  // The policy check needs somebody to refuse, so a host with a people
  // directory signs this one in before it does anything else.
  if (options.users !== undefined) {
    const secret = await options.users.mint('ana');
    await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: 'ahpd://users', token: secret } });
  }
  return { host, client, peer: p, sessions, uri: 'ahp-session:/in', chatUri: 'ahp-chat:/in' };
}

/** `probe`, with the session made on the machine its settings named. */
async function talking(options: {
  command: string;
  args: string[];
  computers?: ComputerPort;
  computer?: string;
  users?: Users;
  policies?: Policies;
  policiesCheck?: boolean;
  sessions?: SessionStore;
}) {
  const room = await probe(options);
  await room.client.handle({
    method: 'createSession',
    params: {
      channel: room.uri,
      provider: 'acp',
      ...(options.computer === undefined ? {} : { config: { computer: options.computer } }),
    },
  });
  await room.client.handle({ method: 'subscribe', params: { channel: room.chatUri } });
  opened.push({ client: room.client, uri: room.uri });
  return room;
}

/**
 * Another client watching the same session, watching from the start.
 *
 * A refusal is answered to the connection that asked and to nobody else, while
 * an accepted change is broadcast to every subscriber - so a second connection
 * is what tells the two apart.
 */
async function watching(room: Awaited<ReturnType<typeof probe>>, ...channels: string[]) {
  const other = peer();
  const client = room.host.accept(other);
  await client.handle({ method: 'initialize', params: { clientId: 'other', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  for (const channel of channels) await client.handle({ method: 'subscribe', params: { channel } });
  return { client, peer: other };
}

/** A store whose clock is this test's, so a run starts when this test says so. */
function clock(): { store: AutomationStore; due: (wanted: StartSession) => Promise<unknown> } {
  let asked: ((event: { automation: string; origin: Bag }) => void) | undefined;
  let start: ((options: StartSession) => Promise<string>) | undefined;
  const store: AutomationStore = {
    list: () => [],
    get: () => undefined,
    triggers: () => [],
    create: () => { throw new Error('this store holds no automations of its own'); },
    update: () => undefined,
    remove: () => false,
    run: async (_resource, _origin, begin) => { start = begin; return undefined; },
    runOf: () => undefined,
    runs: () => ({ items: [] }),
    onDue: (observer) => { asked = observer; },
  };
  return {
    store,
    due: async (wanted) => {
      // The host hands its own start to whoever runs an automation; this store
      // keeps it, so the test can watch a run be refused rather than leave a
      // run to a clock it does not own.
      asked?.({ automation: 'ahp-automation:/one', origin: { kind: 'manual' } });
      if (start === undefined) throw new Error('the host never asked this store to start a run');
      return start(wanted);
    },
  };
}

/** The people a policy check needs behind a connection, and a store that refuses `box`. */
async function refusedBox(): Promise<{ users: Users; policies: Policies }> {
  const users = fileUsers({ path: join(mkdtempSync(join(tmpdir(), 'ahpd-in-computer-users-')), 'users.json') });
  await users.add('ana', ['member']);
  const policies = memoryPolicies();
  await policies.put({ id: 'A1', scope: 'all', kind: 'agent', effect: 'allow', match: { agent: ['*'] } });
  // The host itself is allowed and `box` is not, so a session on no machine is
  // made and a session moved onto one is refused by policy alone.
  await policies.put({ id: 'C0', scope: 'user:ana', kind: 'computer', effect: 'allow', match: { computer: ['host'] } });
  await policies.put({ id: 'C1', scope: 'user:ana', kind: 'computer', effect: 'deny', match: { computer: ['box'] } });
  return { users, policies };
}

/** One turn, dispatched the way a client dispatches it. */
const begin = (client: Awaited<ReturnType<typeof talking>>['client'], chatUri: string): void => {
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
  });
};

it('spawns the server through the machine the session named', async () => {
  const asked: { id: string; command: string }[] = [];
  const computers: ComputerPort = {
    how: async (id, spawn) => {
      asked.push({ id, command: spawn.command });
      return id === 'box' ? { command: process.execPath, args: [FIXTURE] } : undefined;
    },
  };

  // The backend's own command would exit before the handshake, so completing
  // means the descriptor is what ran.
  const { client, peer: p, chatUri } = await talking({
    command: process.execPath, args: FAILS, computers, computer: 'computer://box',
  });
  begin(client, chatUri);
  await until(() => settled(p, chatUri));

  expect(asked).toEqual([{ id: 'box', command: process.execPath }]);
  expect(types(p, chatUri)).toContain('chat/turnComplete');
});

it('refuses a machine that is not there rather than running on the host', async () => {
  const computers: ComputerPort = { how: async () => undefined };
  const { client, peer: p, chatUri } = await talking({
    command: process.execPath, args: [FIXTURE], computers, computer: 'computer://nope',
  });
  begin(client, chatUri);
  await until(() => settled(p, chatUri));

  const failure = actions(p, chatUri).find((one) => one.action.type === 'chat/error');
  const part = failure?.action.part as { error?: { message?: string } } | undefined;
  expect(part?.error?.message).toContain('There is no computer called nope');
  expect(types(p, chatUri)).not.toContain('chat/turnComplete');
});

it('refuses a named machine on a host with no computer plugin', async () => {
  const { client, peer: p, chatUri } = await talking({
    command: process.execPath, args: [FIXTURE], computer: 'computer://box',
  });
  begin(client, chatUri);
  await until(() => settled(p, chatUri));

  const failure = actions(p, chatUri).find((one) => one.action.type === 'chat/error');
  const part = failure?.action.part as { error?: { message?: string } } | undefined;
  expect(part?.error?.message).toContain('no computer plugin');
  expect(types(p, chatUri)).not.toContain('chat/turnComplete');
});

it('spawns its own command when the session names no machine', async () => {
  let asked = 0;
  const computers: ComputerPort = { how: async () => { asked++; return { command: process.execPath, args: [FIXTURE] }; } };
  const { client, peer: p, chatUri } = await talking({
    command: process.execPath, args: [FIXTURE], computers,
  });
  begin(client, chatUri);
  await until(() => settled(p, chatUri));

  expect(asked).toBe(0);
  expect(types(p, chatUri)).toContain('chat/turnComplete');
});

/*
 * A session is kept to the machines prepared for its own agent.
 *
 * A machine records the agents it was made for, and a session forced onto one
 * prepared for another must not run there - it would fail inside, if it ran at
 * all, which is much further away from the value a person set. The label is
 * read where the session is made rather than where its backend first enters
 * the machine, so a person who typed the wrong value hears it from the call
 * they made.
 */

/** A port whose `box` was made for Claude, and whose `open` carries no label. */
const machines = (): ComputerPort => ({
  how: async () => ({ command: process.execPath, args: [FIXTURE] }),
  agents: async (id) => (id === 'box' ? ['claude'] : []),
});

it('refuses the machine at the session that named it, and makes none', async () => {
  const room = await probe({ command: process.execPath, args: [FIXTURE], computers: machines() });
  const refusal = await refusalOf(room.client.handle({
    method: 'createSession',
    params: { channel: room.uri, provider: 'acp', config: { computer: 'computer://box' } },
  }));

  expect(refusal.code).toBe(-32009);
  expect(refusal.message).toMatch(/computer:\/\/box was prepared for claude/);
  expect(refusal.message).toMatch(/this session runs acp/);
  // No session was made, so there is nothing for a turn to run in.
  const listed = await room.client.handle({ method: 'listSessions', params: { channel: ROOT } }) as {
    items: { resource: string }[];
  };
  expect(listed.items.map((one) => one.resource)).not.toContain(room.uri);
});

it('allows a machine with no label, on every road', async () => {
  // A machine with no label was made before any of this existed, and stays
  // offered to every agent.
  const open: ComputerPort = {
    how: async () => ({ command: process.execPath, args: [FIXTURE] }),
    agents: async () => [],
  };
  const { users } = await refusedBox();
  const made = await talking({ command: process.execPath, args: [FIXTURE], computers: open, computer: 'computer://box' });
  begin(made.client, made.chatUri);
  await until(() => settled(made.peer, made.chatUri));
  expect(types(made.peer, made.chatUri)).toContain('chat/turnComplete');

  // The same through a change before the first turn.
  const changed = await talking({ command: process.execPath, args: [FIXTURE], computers: open });
  await changed.client.handle({
    method: 'dispatchAction',
    params: { channel: changed.uri, action: { type: 'session/configChanged', config: { computer: 'computer://box' } } },
  });
  await settle();
  expect(rejection(changed.peer)).toBeUndefined();

  // And through an automation, whose run is made in whatever the store names.
  const due = clock();
  await probe({ command: process.execPath, args: [FIXTURE], computers: open, automations: due.store, users });
  const uri = await due.due({
    provider: 'acp', text: 'hi', config: { computer: 'computer://box' }, owner: 'user:ana',
  }) as string;
  expect(uri).toMatch(/^acp:\//);
});

it('refuses the machine in a change made before the first turn, and announces nothing', async () => {
  const room = await talking({ command: process.execPath, args: [FIXTURE], computers: machines() });
  const other = await watching(room, room.uri);
  await room.client.handle({
    method: 'dispatchAction',
    params: { channel: room.uri, action: { type: 'session/configChanged', config: { computer: 'computer://box' } } },
  });
  await until(() => rejection(room.peer) !== undefined);
  await settle();

  expect(rejection(room.peer)).toMatch(/computer:\/\/box was prepared for claude/);
  // The action was refused and nothing else happened. Only the connection that
  // asked heard about it, and it heard the refusal rather than the change: a
  // `configChanged` broadcast would leave every subscriber holding a setting
  // the session does not have.
  expect(types(other.peer, room.uri)).toEqual([]);
  expect(actions(room.peer, room.uri).every((one) => one.rejectionReason !== undefined)).toBe(true);
  // And nothing was written to the store, which a resume starts the lead chat
  // with: a computer recorded there is a session that comes back in one.
  expect(room.sessions.config(idOf(room.uri))?.computer).toBeUndefined();
  // The session keeps running where it was, on this host.
  begin(room.client, room.chatUri);
  await until(() => settled(room.peer, room.chatUri));
  expect(types(room.peer, room.chatUri)).toContain('chat/turnComplete');
});

it('puts the scope back when a refused change had moved it', async () => {
  // A people directory and no policy store, so the charge is a real one against
  // a real person and the refusal that follows is the machine's own label -
  // which lands after the charge has already been made.
  const users = fileUsers({ path: join(mkdtempSync(join(tmpdir(), 'ahpd-in-computer-users-')), 'users.json') });
  await users.addTeam('core');
  await users.addTeam('edge');
  await users.add('ana', ['member'], { memberships: ['core', 'edge'], primary: 'core' });
  const sessions = memorySessions();
  const room = await talking({ command: process.execPath, args: [FIXTURE], computers: machines(), users, sessions });
  const id = idOf(room.uri);
  const before = sessions.scope(id);
  // A charge that really moved: the session began charged to `core` and the
  // action asks for `edge`, so putting it back is a change and not a coincidence.
  expect(before).toEqual({ team: 'core' });
  await room.client.handle({
    method: 'dispatchAction',
    params: {
      channel: room.uri,
      action: { type: 'session/configChanged', config: { scope: 'edge', computer: 'computer://box' } },
    },
  });
  await until(() => rejection(room.peer) !== undefined);

  // One action is one decision, so the charge moves with the keys rather than
  // staying behind on a session that went nowhere.
  expect(rejection(room.peer)).toMatch(/computer:\/\/box was prepared for claude/);
  expect(sessions.scope(id)).toEqual(before);
});

it('refuses the machine at an automation\'s start', async () => {
  const { users } = await refusedBox();
  const due = clock();
  await probe({
    command: process.execPath, args: [FIXTURE], computers: machines(), automations: due.store, users,
  });
  const refusal = await refusalOf(due.due({
    provider: 'acp', text: 'hi', config: { computer: 'computer://box' }, owner: 'user:ana',
  }) as Promise<string>);

  expect((refusal as { code?: number }).code).toBe(-32009);
  expect(refusal.message).toMatch(/computer:\/\/box was prepared for claude/);
});

/*
 * The policy check comes first on all three roads.
 *
 * A machine refused by policy and also made for another agent is two sentences,
 * and only one of them is the reason the person will act on: the policy is what
 * their own administrator decided, and the label is a fact about the machine.
 * So the policy is asked first everywhere, and the two sit in one helper
 * (`admitted`) rather than at each road.
 */
it('answers the policy\'s refusal when a machine is both refused and unprepared', async () => {
  const { users, policies } = await refusedBox();

  // The session that named it.
  const room = await probe({
    command: process.execPath, args: [FIXTURE], computers: machines(), users, policies, policiesCheck: true,
  });
  const atCreate = await refusalOf(room.client.handle({
    method: 'createSession',
    params: { channel: room.uri, provider: 'acp', config: { computer: 'computer://box' } },
  }));
  expect(atCreate.code).toBe(-32009);
  expect(atCreate.message).not.toMatch(/was prepared for/);
  expect(atCreate.message).toMatch(/box/);

  // The change before the first turn.
  const changed = await talking({
    command: process.execPath, args: [FIXTURE], computers: machines(), users, policies, policiesCheck: true,
  });
  await changed.client.handle({
    method: 'dispatchAction',
    params: { channel: changed.uri, action: { type: 'session/configChanged', config: { computer: 'computer://box' } } },
  });
  await until(() => rejection(changed.peer) !== undefined);
  expect(rejection(changed.peer)).not.toMatch(/was prepared for/);
  expect(rejection(changed.peer)).toMatch(/box/);

  // And the automation's start, as the person who wrote it.
  const due = clock();
  await probe({
    command: process.execPath, args: [FIXTURE], computers: machines(), automations: due.store,
    users, policies, policiesCheck: true,
  });
  const atRun = await refusalOf(due.due({
    provider: 'acp', text: 'hi', config: { computer: 'computer://box' }, owner: 'user:ana',
  }) as Promise<string>);
  expect(atRun.message).not.toMatch(/was prepared for/);
  expect(atRun.message).toMatch(/box/);
});

it('checks an automation against the policies of the person who wrote it', async () => {
  const { users, policies } = await refusedBox();
  const due = clock();
  const room = await probe({
    command: process.execPath, args: [FIXTURE], computers: machines(), automations: due.store,
    users, policies, policiesCheck: true,
  });
  // The machine is refused by policy, so nothing here is left for the label to
  // say - which is the point: the run is being checked at all, as its owner,
  // where before only `createSession` checked anything.
  const refusal = await refusalOf(due.due({
    provider: 'acp', text: 'hi', config: { computer: 'computer://box' }, owner: 'user:ana',
  }) as Promise<string>);

  expect(refusal.message).not.toMatch(/was prepared for/);
  expect(refusal.message).toMatch(/box/);
  const listed = await room.client.handle({ method: 'listSessions', params: { channel: ROOT } }) as {
    items: { resource: string }[];
  };
  expect(listed.items.map((one) => one.resource)).not.toContain(room.uri);
});

it('refuses an automation whose owner this host has never met', async () => {
  const { users, policies } = await refusedBox();
  const due = clock();
  await probe({
    command: process.execPath, args: [FIXTURE], computers: machines(), automations: due.store,
    users, policies, policiesCheck: true,
  });
  // A principal cannot be read from an owner nobody here signed in, and a run
  // that went unchecked would be work nobody's policies apply to.
  const refusal = await refusalOf(due.due({
    provider: 'acp', text: 'hi', owner: 'user:bo',
  }) as Promise<string>);

  expect(refusal.message).toMatch(/bo has to sign in once before an automation of theirs may run/);
});

it('the port a backend is handed refuses the same machine', async () => {
  // The check the host and the port share, and the one every road that does not
  // create a session reaches: the label read before the backend enters.
  const guarded = computersFor(machines(), 'acp');
  await expect(guarded.how('box', { command: 'node' })).rejects.toThrow(/computer:\/\/box was prepared for claude/);
  expect(await guarded.how('open', { command: 'node' })).toEqual({ command: process.execPath, args: [FIXTURE] });
});
