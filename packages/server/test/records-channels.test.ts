/*
 * People and policies as channels, over the stores the daemon serves.
 *
 * The first half is a host in this process, over a real users file and a real
 * policies file, with the channels and commands the daemon builds: what each
 * person may subscribe to and send, and what reaches them when the store
 * changes. The second half runs the daemon over stdio, where the connection is
 * root, to show the wiring in `run.ts` serves both.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost, filePolicies, fileResources, fileUsers, peopleChannels, policyChannels, servedRecords, type Users } from '@ahpd/sdk';
import { echo } from '../../../examples/echo/agent.js';

const ROOT = 'ahp-root://';
const REPO = join(import.meta.dirname, '../../..');
const MAIN = 'packages/server/src/main.ts';

type Bag = Record<string, any>;

let home: string;
let usersFile: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-records-channels-'));
  usersFile = join(home, 'users.json');
  writeFileSync(usersFile, JSON.stringify({
    roles: {
      clerk: ['user:read', 'team:read', 'team:put', 'policy:read'],
      keeper: ['policy:read', 'policy:put', 'policy:delete'],
    },
    teams: [{ id: 'backend' }],
    users: [{ id: 'ana', roles: ['clerk'] }, { id: 'bo', roles: [] }, { id: 'cy', roles: ['keeper'] }],
  }));
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const wait = async (ms: number): Promise<void> => { await new Promise((done) => { setTimeout(done, ms); }); };

/** A host serving the daemon's records channels and commands, over files in `home`. */
const served = () => {
  const users = fileUsers({ path: usersFile });
  const policies = filePolicies({ file: join(home, 'policies.json') });
  const policyLists = policyChannels(policies);
  const peopleLists = peopleChannels(users, { onChange: () => { void policyLists.refresh(); } });
  const lists = servedRecords('ahpd', [...peopleLists.channels, ...policyLists.channels], { ...peopleLists.methods, ...policyLists.methods });
  const host = createHost({
    path: home,
    agents: [{ ...echo({ path: home, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    resourceProviders: { ...peopleLists.providers, ...policyLists.providers },
    channels: lists.channels,
    methods: lists.methods,
    users,
  });
  return { host, users, close: async () => { peopleLists.close(); await host.close(); } };
};

type Host = ReturnType<typeof createHost>;

/** A client signed in as `id`, on client id `clientId`, whose channel actions are kept. */
const as = async (host: Host, users: Users, id: string, clientId = id) => {
  const token = await users.mint(id);
  const seen: { method: string; params: Bag }[] = [];
  const client = host.accept({
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method, params) => { seen.push({ method, params: params as Bag }); },
  });
  await client.handle({ method: 'initialize', params: { clientId, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: users.resource.resource, token } });
  const call = async (method: string, params: Bag) => client.handle({ method, params }).then(
    (result) => ({ result: result as Bag }),
    (error: { code: number; message: string }) => error as Bag,
  );
  /** Each action on `channel`, as `type id`. */
  const heard = (channel: string) => seen
    .filter((one) => one.method === 'action' && one.params.channel === channel)
    .map((one) => `${String(one.params.action.type).split('/').pop()} ${String(one.params.action.id)}`);
  return { call, heard, close: () => { client.close(); } };
};

/** The ids a subscribe answered. */
const ids = (answer: Bag): string[] => (answer.result.snapshot.state.records as Bag[]).map((one) => String(one.id));

it('shows a person without user:read only their own record on the users channel', async () => {
  const { host, users, close } = served();
  const ana = await as(host, users, 'ana');
  const bo = await as(host, users, 'bo');

  expect(ids(await ana.call('subscribe', { channel: 'x-ahpd-users://' }))).toEqual(['ana', 'bo', 'cy']);
  const own = await bo.call('subscribe', { channel: 'x-ahpd-users://' });
  expect(ids(own)).toEqual(['bo']);

  // A change to another person reaches the reader with the grant and not him.
  await users.add('dee', []);
  await wait(400);
  expect(ana.heard('x-ahpd-users://')).toContain('added dee');
  expect(bo.heard('x-ahpd-users://')).toEqual([]);
  await close();
});

/*
 * Two people on one client id, as a relay that passes no id of its own gives
 * them: each is sent only what they may read, and each keeps their own state,
 * whichever subscribed first.
 */
for (const order of [['ana', 'bo'], ['bo', 'ana']] as const) {
  it(`keeps the users channel apart for two people on one client id, ${order.join(' first, then ')}`, async () => {
    const { host, users, close } = served();
    const people = { ana: await as(host, users, 'ana', 'anonymous'), bo: await as(host, users, 'bo', 'anonymous') };
    const answers: Record<string, string[]> = {};
    for (const one of order) answers[one] = ids(await people[one].call('subscribe', { channel: 'x-ahpd-users://' }));
    expect(answers).toEqual({ ana: ['ana', 'bo', 'cy'], bo: ['bo'] });

    await users.add('dee', []);
    await wait(400);
    expect(people.ana.heard('x-ahpd-users://')).toEqual(['added dee']);
    expect(people.bo.heard('x-ahpd-users://')).toEqual([]);

    // A second change is diffed against each person's own state.
    await users.add('eve', []);
    await wait(400);
    expect(people.ana.heard('x-ahpd-users://')).toEqual(['added dee', 'added eve']);
    expect(people.bo.heard('x-ahpd-users://')).toEqual([]);
    await close();
  });

  it(`keeps the teams channel apart for two people on one client id, ${order.join(' first, then ')}`, async () => {
    writeFileSync(usersFile, JSON.stringify({
      roles: { clerk: ['user:read', 'team:read', 'team:put', 'policy:read'] },
      teams: [{ id: 'backend' }],
      users: [{ id: 'ana', roles: ['clerk'] }, { id: 'bo', roles: ['clerk'] }],
    }));
    const { host, users, close } = served();
    const people = { ana: await as(host, users, 'ana', 'anonymous'), bo: await as(host, users, 'bo', 'anonymous') };
    for (const one of order) expect(ids(await people[one].call('subscribe', { channel: 'x-ahpd-teams://' }))).toEqual(['backend']);
    await wait(50);

    // Bo loses team:read; only he is sent the removal, and Ana's state stays whole.
    writeFileSync(usersFile, JSON.stringify({
      roles: { clerk: ['user:read', 'team:read', 'team:put', 'policy:read'] },
      teams: [{ id: 'backend' }],
      users: [{ id: 'ana', roles: ['clerk'] }, { id: 'bo', roles: [] }],
    }));
    await wait(400);
    expect(people.bo.heard('x-ahpd-teams://')).toEqual(['removed backend']);
    expect(people.ana.heard('x-ahpd-teams://')).toEqual([]);

    expect(await people.ana.call('x-ahpd/teams/put', { id: 'web', record: {} })).toEqual({ result: {} });
    await wait(100);
    expect(people.ana.heard('x-ahpd-teams://')).toEqual(['added web']);
    expect(people.bo.heard('x-ahpd-teams://')).toEqual(['removed backend']);
    await close();
  });
}

it('replays to a person on a shared client id nothing sent to another person on it', async () => {
  const { host, users, close } = served();
  const ana = await as(host, users, 'ana', 'anonymous');
  const bo = await as(host, users, 'bo', 'anonymous');
  await ana.call('subscribe', { channel: 'x-ahpd-users://' });
  const answer = await bo.call('subscribe', { channel: 'x-ahpd-users://' });
  const from = answer.result.snapshot.fromSeq as number;
  bo.close();

  // Sent to Ana, on the client id Bo comes back on.
  await users.add('dee', []);
  await wait(400);
  expect(ana.heard('x-ahpd-users://')).toEqual(['added dee']);

  const person = await users.verify(await users.mint('bo'));
  const back = host.accept({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} }, person);
  const replay = await back.handle({
    method: 'reconnect',
    params: { clientId: 'anonymous', lastSeenServerSeq: from, subscriptions: ['x-ahpd-users://'] },
  }) as Bag;
  expect(replay.type).toBe('replay');
  expect((replay.actions as Bag[]).filter((one) => one.channel === 'x-ahpd-users://')).toEqual([]);
  await close();
});

it('refuses a subscribe to teams or policies without the read grant', async () => {
  const { host, users, close } = served();
  const bo = await as(host, users, 'bo');
  expect(await bo.call('subscribe', { channel: 'x-ahpd-teams://' })).toMatchObject({ code: -32009 });
  expect(await bo.call('subscribe', { channel: 'x-ahpd-policies://' })).toMatchObject({ code: -32009 });
  expect(await bo.call('subscribe', { channel: 'x-ahpd-roles://' })).toMatchObject({ code: -32009 });
  expect(await bo.call('subscribe', { channel: 'x-ahpd-projects://' })).toMatchObject({ code: -32009 });
  await close();
});

it('refuses put without :put and remove without :delete', async () => {
  const { host, users, close } = served();
  const ana = await as(host, users, 'ana');
  const bo = await as(host, users, 'bo');

  // Ana may put a team but not remove one, and may not put a policy.
  expect(await ana.call('x-ahpd/teams/put', { id: 'web', record: {} })).toEqual({ result: {} });
  expect(await ana.call('x-ahpd/teams/remove', { id: 'web' })).toMatchObject({ code: -32009 });
  expect(await ana.call('x-ahpd/policies/put', { id: 'M1', record: {} })).toMatchObject({ code: -32009 });
  expect(await bo.call('x-ahpd/teams/put', { id: 'ops', record: {} })).toMatchObject({ code: -32009 });
  expect(await bo.call('x-ahpd/users/put', { id: 'bo', record: { roles: ['clerk'] } })).toMatchObject({ code: -32009 });
  expect(await bo.call('x-ahpd/users/remove', { id: 'ana' })).toMatchObject({ code: -32009 });
  expect((await users.teams()).map((one) => one.id)).toEqual(['backend', 'web']);
  await close();
});

it('sends changed to a subscriber when the users file is edited by hand', async () => {
  const { host, users, close } = served();
  const ana = await as(host, users, 'ana');
  await ana.call('subscribe', { channel: 'x-ahpd-users://' });
  await ana.call('subscribe', { channel: 'x-ahpd-teams://' });
  await wait(50);
  writeFileSync(usersFile, JSON.stringify({
    roles: { clerk: ['user:read', 'team:read', 'team:put', 'policy:read'] },
    teams: [{ id: 'backend', title: 'Back end' }],
    users: [{ id: 'ana', roles: ['clerk'] }, { id: 'bo', roles: ['clerk'] }],
  }));
  await wait(400);
  expect(ana.heard('x-ahpd-users://')).toEqual(['changed bo', 'removed cy']);
  expect(ana.heard('x-ahpd-teams://')).toEqual(['changed backend']);
  await close();
});

it('sends removed on the policies channel when a person loses policy:read', async () => {
  const { host, users, close } = served();
  const cy = await as(host, users, 'cy');
  expect(await cy.call('x-ahpd/policies/put', {
    id: 'M1', record: { scope: 'all', kind: 'model', effect: 'allow', match: { model: ['deepseek/*'] } },
  })).toEqual({ result: {} });
  expect(ids(await cy.call('subscribe', { channel: 'x-ahpd-policies://' }))).toEqual(['M1']);
  await users.add('cy', []);
  await wait(400);
  expect(cy.heard('x-ahpd-policies://')).toEqual(['removed M1']);
  await close();
});

interface Answered {
  id?: number;
  method?: string;
  params?: Bag;
  result?: Bag;
  error?: { code: number; message: string };
}

/**
 * A stdio daemon over a users file in `home`, sent `frames` one at a time,
 * closed once `waiting` are answered.
 *
 * Each frame goes once the one before it is answered, as a client that reads
 * what it wrote waits for the write's answer: the daemon handles the requests
 * it is sent side by side, as JSON-RPC lets it.
 */
const daemon = (frames: string[], waiting: number[]): Promise<Answered[]> => {
  mkdirSync(join(home, 'ahpd'), { recursive: true });
  const config = join(home, 'config.json');
  writeFileSync(config, JSON.stringify({ plugins: ['./packages/server/test/fixtures/plugin-echo'], users: usersFile }));
  const child = spawn(process.execPath, [MAIN, '--stdio', '--config-file', config, '--no-update-check'], {
    cwd: REPO,
    env: { ...process.env, XDG_CONFIG_HOME: home, CI: '1', NODE_OPTIONS: '--conditions development --import ./scripts/dev.mjs' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const frames_: Answered[] = [];
  const ids = frames.map((one) => (JSON.parse(one) as { id: number }).id);
  let sent = 0;
  const send = (): void => {
    const one = frames[sent];
    if (one === undefined) return;
    sent += 1;
    child.stdin.write(`${one}\n`);
  };
  let held = '';
  const close = (): void => { child.stdin.end(); };
  child.stdout.on('data', (chunk: Buffer) => {
    held += String(chunk);
    let at = held.indexOf('\n');
    while (at !== -1) {
      const line = held.slice(0, at).trim();
      held = held.slice(at + 1);
      if (line.startsWith('{')) {
        const answered = JSON.parse(line) as Answered;
        frames_.push(answered);
        if (answered.method === undefined && answered.id === ids[sent - 1]) send();
      }
      at = held.indexOf('\n');
    }
    if (waiting.every((one) => frames_.some((frame) => frame.id === one))) setTimeout(close, 200);
  });
  send();
  return new Promise((done) => {
    const give = setTimeout(close, 15000);
    child.on('exit', () => { clearTimeout(give); done(frames_); });
  });
};

const frame = (id: number, method: string, params: Bag): string => JSON.stringify({ id, method, params });
const HANDSHAKE = frame(1, 'initialize', { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] });

/** One subscribe and one put for each of the five, as `[channel, command, id, record]`. */
const FIVE: [string, string, string, Bag][] = [
  ['x-ahpd-users://', 'x-ahpd/users/put', 'sam', {}],
  ['x-ahpd-teams://', 'x-ahpd/teams/put', 'ops', { title: 'Ops' }],
  ['x-ahpd-projects://', 'x-ahpd/projects/put', 'ahpd', {}],
  ['x-ahpd-roles://', 'x-ahpd/roles/put', 'reader', { grants: ['team:read'] }],
  ['x-ahpd-policies://', 'x-ahpd/policies/put', 'M2', { scope: 'all', kind: 'agent', effect: 'allow', match: { agent: ['claude'] } }],
];

it('serves each of the five channels, and a put on each reaches its subscriber', async () => {
  const frames = await daemon([
    HANDSHAKE,
    ...FIVE.map(([channel], at) => frame(10 + at, 'subscribe', { channel })),
    ...FIVE.map(([, command, id, record], at) => frame(20 + at, command, { id, record })),
  ], [...FIVE.map((_, at) => 10 + at), ...FIVE.map((_, at) => 20 + at)]);
  for (const [at, [channel, , id]] of FIVE.entries()) {
    expect(frames.find((one) => one.id === 10 + at)?.result?.snapshot).toBeDefined();
    expect(frames.find((one) => one.id === 20 + at)?.result).toEqual({});
    const actions = frames.filter((one) => one.method === 'action' && one.params?.channel === channel).map((one) => one.params?.action as Bag);
    expect(actions.map((one) => `${String(one.type)} ${String(one.id)}`)).toContain(`${channel.slice(0, -3)}/added ${id}`);
  }
}, 60000);

it('serves the teams channel and the policy commands from the daemon', async () => {
  const frames = await daemon([
    HANDSHAKE,
    frame(2, 'subscribe', { channel: 'x-ahpd-teams://' }),
    frame(3, 'resourceWrite', { channel: ROOT, uri: 'team://web', data: JSON.stringify({}), encoding: 'utf-8' }),
    frame(4, 'x-ahpd/policies/put', { id: 'M1', record: { scope: 'all', kind: 'model', effect: 'allow', match: { model: ['deepseek/*'] } } }),
    frame(5, 'resourceRead', { channel: ROOT, uri: 'policy://M1' }),
  ], [2, 3, 4, 5]);
  const answer = (id: number) => frames.find((one) => one.id === id);

  const ready = answer(1)?.result as Bag;
  const methods = ready._meta?.['ahpd.methods'] as Bag[] | undefined;
  expect(methods?.map((one) => one.method)).toEqual(expect.arrayContaining(['x-ahpd/teams/put', 'x-ahpd/policies/remove', 'x-ahpd/usage/totals', 'x-ahpd/usage/pools']));

  expect((answer(2)?.result?.snapshot.state.records as Bag[]).map((one) => one.id)).toEqual(['backend']);
  expect(answer(3)?.error).toBeUndefined();
  const actions = frames.filter((one) => one.method === 'action' && one.params?.channel === 'x-ahpd-teams://');
  expect(actions.map((one) => one.params?.action)).toEqual([{ type: 'x-ahpd-teams/added', id: 'web', record: { id: 'web' } }]);

  expect(answer(4)?.result).toEqual({});
  expect(JSON.parse(String(answer(5)?.result?.data))).toMatchObject({ id: 'M1', effect: 'allow' });
}, 60000);
