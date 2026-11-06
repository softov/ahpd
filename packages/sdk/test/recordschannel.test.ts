import { expect, it } from 'vitest';
import { recordsProvider } from '../src/resources/records.js';
import { recordsChannel, recordsDomain, recordsMethods } from '../src/resources/recordschannel.js';
import { RpcError } from '../src/rpc.js';
import { holds } from '../src/access/users.js';
import type { Records } from '../src/resources/records.js';
import type { ChannelHandle, ChannelSubscriber, PublishOptions } from '../src/types/plugin.js';
import type { Grant, Principal } from '../src/types/users.js';
import type { Owner } from '../src/types/usage.js';

/*
 * A records channel over an in-memory store: each case subscribes readers
 * through `snapshot`, changes the store, calls `refresh`, and reads what each
 * client was sent. The handle stands in for the host: it lists the subscribers
 * and keeps each publish with the client it was sent to.
 */

const SCHEME = 'x-ahpd-teams';
const URI = `${SCHEME}://`;
/** The list as one person reads it, which is the only filter a records channel takes. */
const FILTERED = `${URI}?owner=me`;

/** A store of teams, each `{ title }`, that a case edits in place. */
const store = (rows: Record<string, Record<string, unknown>> = {}): Records & { rows: Record<string, Record<string, unknown>> } => ({
  rows,
  title: 'Teams',
  description: 'Teams people belong to.',
  manifest: { type: 'object' },
  ids: async () => Object.keys(rows),
  find: async (id) => (rows[id] === undefined ? undefined : { ...rows[id] }),
  put: async (id, body) => {
    if (typeof body.title === 'number') throw new RpcError(-32602, 'A team is written with title as text');
    rows[id] = { ...rows[id], ...body };
  },
  drop: async (id) => {
    if (rows[id] === undefined) return false;
    delete rows[id];
    return true;
  },
});

/** A reader holding these grants, which a case may change. */
const person = (id: string, grants: Grant[]): Principal & { grants: Grant[] } => {
  const one = {
    id,
    roles: ['r'],
    grants,
    can: (grant: Grant) => holds(new Set<string>(one.grants), grant),
  };
  return one;
};

/** A handle with these subscribers, and every publish it was handed. */
const fakeHandle = (subscribers: ChannelSubscriber[]) => {
  const heard: { client: string | undefined; action: Record<string, unknown> }[] = [];
  const handle: ChannelHandle = {
    publish: (uri, action, options: PublishOptions = {}) => {
      expect(uri).toBe(URI);
      heard.push({ client: options.to, action });
    },
    subscribers: () => subscribers,
  };
  /** What one client was sent, as `type id` lines. */
  const of = (client: string): string[] => heard
    .filter((one) => one.client === client)
    .map((one) => `${String(one.action.type).slice(SCHEME.length + 1)} ${String(one.action.id)}`);
  return { handle, heard, of };
};

/**
 * A handle that keeps subscribers per channel URI, which a filtered channel
 * needs: the plain list and the narrowed one are two channels on one store.
 */
const filteredHandle = (byUri: Record<string, ChannelSubscriber[]>) => {
  const heard: { uri: string; client: string | undefined; action: Record<string, unknown> }[] = [];
  const handle: ChannelHandle = {
    publish: (uri, action, options: PublishOptions = {}) => {
      heard.push({ uri, client: options.to, action });
    },
    subscribers: (uri) => byUri[uri] ?? [],
  };
  /** What one client was sent on one channel, as `type id` lines. */
  const of = (uri: string, client: string): string[] => heard
    .filter((one) => one.uri === uri && one.client === client)
    .map((one) => `${String(one.action.type).slice(SCHEME.length + 1)} ${String(one.action.id)}`);
  return { handle, heard, of };
};

it('answers each reader a snapshot of the records they may read', async () => {
  const teams = store({ backend: { id: 'backend', title: 'Back' }, web: { id: 'web' } });
  const list = recordsChannel(SCHEME, teams, { grant: 'team:read', mayRead: (id, reader) => id === reader.id });
  const ana = person('ana', ['team:read']);
  const web = person('web', []);
  expect(await list.channel.snapshot(URI, ana, 'ana')).toEqual({
    records: [{ id: 'backend', record: { id: 'backend', title: 'Back' } }, { id: 'web', record: { id: 'web' } }],
  });
  // Without the grant, only what `mayRead` lets in.
  expect(await list.channel.snapshot(URI, web, 'web')).toEqual({ records: [{ id: 'web', record: { id: 'web' } }] });
  // Nobody is a host with no users directory, or the root connection.
  expect(await list.channel.snapshot(URI, undefined, 'root')).toMatchObject({ records: [{ id: 'backend' }, { id: 'web' }] });
  await expect(list.channel.snapshot(`${URI}x`, ana, 'ana')).rejects.toMatchObject({ code: -32001 });
});

it('lets in a reader without the grant only when mayRead holds for a record', async () => {
  const teams = store({ backend: { id: 'backend' } });
  const own = recordsChannel(SCHEME, teams, { grant: 'team:read', mayRead: (id, reader) => id === reader.id });
  expect(await own.channel.authorize?.(URI, person('backend', []))).toBe(true);
  expect(await own.channel.authorize?.(URI, person('ana', []))).toBe(false);
  expect(await own.channel.authorize?.(`${URI}other`, person('backend', []))).toBe(false);
  const plain = recordsChannel(SCHEME, teams, { grant: 'team:read' });
  expect(await plain.channel.authorize?.(URI, person('backend', []))).toBe(false);
});

it('sends added, changed and removed after a refresh, each to the client it concerns', async () => {
  const teams = store({ backend: { id: 'backend' } });
  const list = recordsChannel(SCHEME, teams, { grant: 'team:read', mayRead: (id, reader) => id === reader.id });
  const ana = person('ana', ['team:read']);
  const web = person('web', []);
  const { handle, of } = fakeHandle([{ client: 'ana', reader: ana }, { client: 'web', reader: web }]);
  list.bind(handle);
  await list.channel.snapshot(URI, ana, 'ana');
  await list.channel.snapshot(URI, web, 'web');

  teams.rows.web = { id: 'web' };
  await list.refresh();
  expect(of('ana')).toEqual(['added web']);
  expect(of('web')).toEqual(['added web']);

  teams.rows.backend = { id: 'backend', title: 'Back' };
  await list.refresh();
  // `web` cannot read backend, so is told nothing of its edit.
  expect(of('ana')).toEqual(['added web', 'changed backend']);
  expect(of('web')).toEqual(['added web']);

  delete teams.rows.web;
  await list.refresh();
  expect(of('ana')).toEqual(['added web', 'changed backend', 'removed web']);
  expect(of('web')).toEqual(['added web', 'removed web']);
});

it('notifies each reader who holds a record, and the refresh after it sends no changed', async () => {
  const teams = store({ backend: { id: 'backend', title: 'Back' }, web: { id: 'web' } });
  const list = recordsChannel(SCHEME, teams, { grant: 'team:read', mayRead: (id, reader) => id === reader.id });
  const ana = person('ana', ['team:read']);
  const web = person('web', []);
  const { handle, heard, of } = fakeHandle([{ client: 'ana', reader: ana }, { client: 'web', reader: web }]);
  list.bind(handle);
  await list.channel.snapshot(URI, ana, 'ana');
  await list.channel.snapshot(URI, web, 'web');

  // The store takes the change, and the channel sends it alone.
  teams.rows.backend = { id: 'backend', title: 'Front' };
  await list.notify('backend', { type: `${SCHEME}/retitled`, title: 'Front' }, (record) => ({ ...record, title: 'Front' }));
  // `web` cannot read backend, so it is not told.
  expect(of('ana')).toEqual(['retitled backend']);
  expect(of('web')).toEqual([]);
  expect(heard.at(-1)?.action).toEqual({ type: `${SCHEME}/retitled`, title: 'Front', id: 'backend' });

  await list.refresh();
  expect(of('ana')).toEqual(['retitled backend']);

  // A record nobody was sent is not notified, and its change is not applied.
  let called = false;
  await list.notify('nobody', { type: `${SCHEME}/retitled` }, (record) => { called = true; return record; });
  expect(called).toBe(false);
  expect(of('ana')).toEqual(['retitled backend']);
});

it('carries the record with added and changed, and the id alone with removed', async () => {
  const teams = store({});
  const list = recordsChannel(SCHEME, teams, { grant: 'team:read' });
  const { handle, heard } = fakeHandle([{ client: 'root', reader: undefined }]);
  list.bind(handle);
  await list.channel.snapshot(URI, undefined, 'root');
  teams.rows.backend = { id: 'backend' };
  await list.refresh();
  teams.rows.backend = { id: 'backend', title: 'Back' };
  await list.refresh();
  delete teams.rows.backend;
  await list.refresh();
  expect(heard.map((one) => one.action)).toEqual([
    { type: `${SCHEME}/added`, id: 'backend', record: { id: 'backend' } },
    { type: `${SCHEME}/changed`, id: 'backend', record: { id: 'backend', title: 'Back' } },
    { type: `${SCHEME}/removed`, id: 'backend' },
  ]);
  expect(heard.every((one) => one.client === 'root')).toBe(true);
});

it('sends removed for each record to a reader who lost the grant', async () => {
  const teams = store({ backend: { id: 'backend' }, web: { id: 'web' } });
  const list = recordsChannel(SCHEME, teams, { grant: 'team:read' });
  const ana = person('ana', ['team:read']);
  const { handle, of } = fakeHandle([{ client: 'ana', reader: ana }]);
  list.bind(handle);
  await list.channel.snapshot(URI, ana, 'ana');
  ana.grants = [];
  await list.refresh();
  expect(of('ana')).toEqual(['removed backend', 'removed web']);
  // And an edit made after is not sent to them.
  teams.rows.backend = { id: 'backend', title: 'Back' };
  teams.rows.mobile = { id: 'mobile' };
  await list.refresh();
  expect(of('ana')).toEqual(['removed backend', 'removed web']);
});

it('sends nothing when nothing differs', async () => {
  const teams = store({ backend: { id: 'backend' } });
  const list = recordsChannel(SCHEME, teams, { grant: 'team:read' });
  const ana = person('ana', ['team:read']);
  const { handle, heard } = fakeHandle([{ client: 'ana', reader: ana }]);
  list.bind(handle);
  await list.channel.snapshot(URI, ana, 'ana');
  teams.rows.web = { id: 'web' };
  await list.refresh();
  expect(heard).toHaveLength(1);
  await list.refresh();
  expect(heard).toHaveLength(1);
});

it('forgets a client at left, and starts it again from the next refresh', async () => {
  const teams = store({ backend: { id: 'backend' } });
  const list = recordsChannel(SCHEME, teams, { grant: 'team:read' });
  const ana = person('ana', ['team:read']);
  const { handle, heard } = fakeHandle([{ client: 'ana', reader: ana }]);
  list.bind(handle);
  await list.channel.snapshot(URI, ana, 'ana');
  list.channel.left?.('ana');
  teams.rows.web = { id: 'web' };
  await list.refresh();
  expect(heard).toEqual([]);
});

it('says a store it cannot read, and keeps refreshing after', async () => {
  const said: string[] = [];
  const teams = store({});
  let broken = true;
  const list = recordsChannel(SCHEME, {
    ids: async () => { if (broken) throw new Error('the file is not JSON'); return teams.ids(); },
    find: teams.find,
  }, { grant: 'team:read', onProblem: (line) => { said.push(line); } });
  list.bind(fakeHandle([{ client: 'ana', reader: person('ana', ['team:read']) }]).handle);
  await list.refresh();
  expect(said).toEqual([`${SCHEME}: the list could not be read: the file is not JSON`]);
  broken = false;
  await list.refresh();
  expect(said).toHaveLength(1);
});

it('reads nothing while nobody is subscribed', async () => {
  let asked = 0;
  const teams = store({ backend: { id: 'backend' } });
  const list = recordsChannel(SCHEME, { ids: async () => { asked += 1; return teams.ids(); }, find: teams.find }, { grant: 'team:read' });
  await list.refresh();
  list.bind(fakeHandle([]).handle);
  await list.refresh();
  expect(asked).toBe(0);
});

it('runs at most one refresh and keeps one waiting, which every call made meanwhile shares', async () => {
  let asked = 0;
  let open: () => void = () => {};
  let gate: Promise<void> | undefined;
  const teams = store({ backend: { id: 'backend' } });
  const ids = async () => {
    asked += 1;
    if (gate !== undefined) await gate;
    return teams.ids();
  };
  const list = recordsChannel(SCHEME, { ids, find: teams.find }, { grant: 'team:read' });
  const ana = person('ana', ['team:read']);
  const { handle, of } = fakeHandle([{ client: 'ana', reader: ana }]);
  list.bind(handle);
  await list.channel.snapshot(URI, ana, 'ana');
  asked = 0;

  gate = new Promise((done) => { open = done; });
  const running = list.refresh();
  await Promise.resolve();
  // Three calls while one runs share the one that waits.
  const waiting = [list.refresh(), list.refresh(), list.refresh()];
  teams.rows.web = { id: 'web' };
  gate = undefined;
  open();
  await Promise.all([running, ...waiting]);
  expect(asked).toBe(2);
  expect(of('ana')).toEqual(['added web']);
});

it('answers a refresh called after a change only once a read after that change is sent', async () => {
  const teams = store({});
  const list = recordsChannel(SCHEME, teams, { grant: 'team:read' });
  const ana = person('ana', ['team:read']);
  const { handle, of } = fakeHandle([{ client: 'ana', reader: ana }]);
  list.bind(handle);
  await list.channel.snapshot(URI, ana, 'ana');
  const first = list.refresh();
  teams.rows.web = { id: 'web' };
  await list.refresh();
  expect(of('ana')).toEqual(['added web']);
  await first;
});

it('keeps every reader in step with the store a snapshot read', async () => {
  const teams = store({ backend: { id: 'backend', title: 'Back' } });
  const list = recordsChannel(SCHEME, teams, { grant: 'team:read' });
  const ana = person('ana', ['team:read']);
  const bo = person('bo', ['team:read']);
  const subscribers: ChannelSubscriber[] = [{ client: 'ana', reader: ana }];
  const { handle, of } = fakeHandle(subscribers);
  list.bind(handle);
  await list.channel.snapshot(URI, ana, 'ana');

  // The store changes, and Bo subscribes before any refresh reads it.
  teams.rows.backend = { id: 'backend', title: 'Back end' };
  teams.rows.web = { id: 'web' };
  subscribers.push({ client: 'bo', reader: bo });
  expect(await list.channel.snapshot(URI, bo, 'bo')).toMatchObject({ records: [{ id: 'backend', record: { title: 'Back end' } }, { id: 'web' }] });
  // Ana is sent what that read found, and Bo nothing his snapshot has.
  expect(of('ana')).toEqual(['changed backend', 'added web']);
  expect(of('bo')).toEqual([]);

  await list.refresh();
  expect(of('ana')).toEqual(['changed backend', 'added web']);
  expect(of('bo')).toEqual([]);
});

it('keeps two people on one client id apart, and tests the person at each send', async () => {
  const teams = store({ backend: { id: 'backend' }, web: { id: 'web' } });
  const list = recordsChannel(SCHEME, teams, { grant: 'team:read', mayRead: (id, reader) => id === reader.id });
  const ana = person('ana', ['team:read']);
  const web = person('web', []);
  const sent: { action: Record<string, unknown>; options: PublishOptions }[] = [];
  list.bind({
    publish: (_uri, action, options = {}) => { sent.push({ action, options }); },
    subscribers: () => [{ client: 'shared', reader: web }, { client: 'shared', reader: ana }],
  });
  await list.channel.snapshot(URI, web, 'shared');
  await list.channel.snapshot(URI, ana, 'shared');
  teams.rows.ops = { id: 'ops' };
  delete teams.rows.web;
  await list.refresh();
  // Web lost his own record; Ana gained ops and lost web.
  expect(sent.map((one) => `${String(one.action.type).slice(SCHEME.length + 1)} ${String(one.action.id)}`))
    .toEqual(['removed web', 'added ops', 'removed web']);
  for (const one of sent) expect(one.options.to).toBe('shared');
  const [toWeb, toAna] = [sent[0]!.options, sent[1]!.options];
  expect(toWeb.visible?.(web, 'shared')).toBe(true);
  expect(toWeb.visible?.(ana, 'shared')).toBe(false);
  expect(toAna.visible?.(ana, 'shared')).toBe(true);
  expect(toAna.visible?.(web, 'shared')).toBe(false);
  // A person who has lost the grant since is not sent a record at replay.
  ana.grants = [];
  expect(toAna.visible?.(ana, 'shared')).toBe(false);

  // Left forgets both people on the client id.
  list.channel.left?.('shared');
  teams.rows.dev = { id: 'dev' };
  await list.refresh();
  expect(sent).toHaveLength(3);
});

it('answers a filtered channel with the caller\'s own records, in the snapshot and in each diff', async () => {
  const teams = store({ ana: { id: 'ana', owner: 'user:ana' }, ben: { id: 'ben', owner: 'user:ben' } });
  const list = recordsChannel(SCHEME, teams, {
    grant: 'team:read',
    ownerOf: (_id, record) => record.owner as Owner,
  });
  const ana = person('ana', ['team:read']);
  const ben = person('ben', ['team:read']);
  const { handle, of } = filteredHandle({
    [FILTERED]: [{ client: 'ana', reader: ana }, { client: 'ben', reader: ben }],
  });
  list.bind(handle);
  expect(await list.channel.snapshot(FILTERED, ana, 'ana')).toEqual({
    records: [{ id: 'ana', record: { id: 'ana', owner: 'user:ana' } }],
  });
  expect(await list.channel.snapshot(FILTERED, ben, 'ben')).toEqual({
    records: [{ id: 'ben', record: { id: 'ben', owner: 'user:ben' } }],
  });

  teams.rows.carol = { id: 'carol', owner: 'user:ana' };
  teams.rows.dave = { id: 'dave', owner: 'user:ben' };
  await list.refresh();
  expect(of(FILTERED, 'ana')).toEqual(['added carol']);
  expect(of(FILTERED, 'ben')).toEqual(['added dave']);

  // A record that changes hands leaves one filtered channel and joins the other.
  teams.rows.ana = { id: 'ana', owner: 'user:ben' };
  await list.refresh();
  expect(of(FILTERED, 'ana')).toContain('removed ana');
  expect(of(FILTERED, 'ben')).toContain('added ana');
});

it('keeps the plain list and the filtered one apart on one client', async () => {
  const teams = store({ ana: { id: 'ana', owner: 'user:ana' }, ben: { id: 'ben', owner: 'user:ben' } });
  const list = recordsChannel(SCHEME, teams, {
    grant: 'team:read',
    ownerOf: (_id, record) => record.owner as Owner,
  });
  const ana = person('ana', ['team:read']);
  const { handle, of } = filteredHandle({
    [URI]: [{ client: 'ana', reader: ana }],
    [FILTERED]: [{ client: 'ana', reader: ana }],
  });
  list.bind(handle);
  expect(await list.channel.snapshot(URI, ana, 'ana')).toMatchObject({ records: [{ id: 'ana' }, { id: 'ben' }] });
  expect(await list.channel.snapshot(FILTERED, ana, 'ana')).toMatchObject({ records: [{ id: 'ana' }] });

  teams.rows.carol = { id: 'carol', owner: 'user:ben' };
  await list.refresh();
  // The same person, on the same client id, holds two states: one whole, one hers.
  expect(of(URI, 'ana')).toEqual(['added carol']);
  expect(of(FILTERED, 'ana')).toEqual([]);
});

it('narrows only what the reader may already read', async () => {
  const teams = store({ mine: { id: 'mine', owner: 'user:ana' }, secret: { id: 'secret', owner: 'user:ana' } });
  const list = recordsChannel(SCHEME, teams, {
    grant: 'team:read',
    mayRead: (id) => id === 'mine',
    ownerOf: (_id, record) => record.owner as Owner,
  });
  // No grant, so `mayRead` decides first and the filter only narrows after it.
  expect(await list.channel.snapshot(FILTERED, person('ana', []), 'ana')).toMatchObject({ records: [{ id: 'mine' }] });
});

it('answers no records to a filtered channel with no reader', async () => {
  const teams = store({ ana: { id: 'ana', owner: 'user:ana' } });
  const list = recordsChannel(SCHEME, teams, { grant: 'team:read', ownerOf: (_id, record) => record.owner as Owner });
  expect(await list.channel.snapshot(FILTERED, undefined, 'root')).toEqual({ records: [] });
});

it('refuses a channel URI with a query when it has no ownerOf', async () => {
  const list = recordsChannel(SCHEME, store({ ana: { id: 'ana', owner: 'user:ana' } }), { grant: 'team:read' });
  await expect(list.channel.snapshot(FILTERED, person('ana', ['team:read']), 'ana'))
    .rejects.toMatchObject({ code: -32001 });
  expect(await list.channel.authorize?.(FILTERED, person('ana', ['team:read']))).toBe(false);
});

it('refuses an owner filter that is not me', async () => {
  const list = recordsChannel(SCHEME, store({}), { grant: 'team:read', ownerOf: (_id, record) => record.owner as Owner });
  await expect(list.channel.snapshot(`${URI}?owner=team:x`, person('ana', ['team:read']), 'ana'))
    .rejects.toMatchObject({ code: -32602 });
});

it('refuses a query with a key beside owner, so a client cannot open a channel URI of its own', async () => {
  const list = recordsChannel(SCHEME, store({}), { grant: 'team:read', ownerOf: (_id, record) => record.owner as Owner });
  for (const asked of [`${URI}?owner=me&x=1`, `${URI}?owner=me&owner=me`]) {
    await expect(list.channel.snapshot(asked, person('ana', ['team:read']), 'ana'))
      .rejects.toMatchObject({ code: -32001 });
  }
});

/** One method's answer, or the RpcError it threw. */
const answer = async (method: { handle: (params: Record<string, unknown>, reader: Principal | undefined, client: string) => unknown }, params: Record<string, unknown>) => {
  try {
    return { result: await method.handle(params, undefined, 'ana') };
  }
  catch (error) {
    return { code: (error as RpcError).code, message: (error as RpcError).message };
  }
};

it('names put and remove by domain, with the scheme\'s put and delete grants', () => {
  const methods = recordsMethods('teams', 'team', store(), async () => {});
  expect(Object.keys(methods)).toEqual(['x-ahpd/teams/put', 'x-ahpd/teams/remove']);
  expect(methods['x-ahpd/teams/put']?.grant).toBe('team:put');
  expect(methods['x-ahpd/teams/remove']?.grant).toBe('team:delete');
  // Neither lets in a caller without the grant.
  expect(methods['x-ahpd/teams/put']?.authorize).toBeUndefined();
  expect(methods['x-ahpd/teams/remove']?.authorize).toBeUndefined();
});

it('puts and removes a record by command, and refreshes after each', async () => {
  const teams = store();
  let refreshed = 0;
  const methods = recordsMethods('teams', 'team', teams, async () => { refreshed += 1; });
  const put = methods['x-ahpd/teams/put']!;
  const remove = methods['x-ahpd/teams/remove']!;
  expect(await answer(put, { id: 'backend', record: { title: 'Back' } })).toEqual({ result: {} });
  expect(teams.rows.backend).toEqual({ title: 'Back' });
  expect(refreshed).toBe(1);
  expect(await answer(remove, { id: 'backend' })).toEqual({ result: {} });
  expect(teams.rows.backend).toBeUndefined();
  expect(refreshed).toBe(2);
});

it('refuses with the sentence a resource write and delete give', async () => {
  const teams = store({ backend: { title: 'Back' } });
  const provider = recordsProvider('team', teams);
  const methods = recordsMethods('teams', 'team', teams, async () => {});
  const put = methods['x-ahpd/teams/put']!;
  const remove = methods['x-ahpd/teams/remove']!;
  const write = async (uri: string, data: unknown, createOnly?: boolean) => {
    try {
      await provider.write(uri, { data: JSON.stringify(data), encoding: 'utf-8', ...(createOnly === undefined ? {} : { createOnly }) });
      return {};
    }
    catch (error) {
      return { code: (error as RpcError).code, message: (error as RpcError).message };
    }
  };
  // A body the store refuses.
  expect(await answer(put, { id: 'web', record: { title: 7 } })).toEqual(await write('team://web', { title: 7 }));
  // An id already there, with createOnly.
  const taken = await answer(put, { id: 'backend', record: {}, createOnly: true });
  expect(taken).toEqual({ code: -32010, message: 'backend is already a team; edit it or choose another id' });
  expect(taken).toEqual(await write('team://backend', {}, true));
  // A record that is not an object.
  expect(await answer(put, { id: 'web', record: [1] })).toEqual(await write('team://web', [1]));
  // An id nothing holds.
  const gone = await answer(remove, { id: 'nobody' });
  expect(gone).toEqual({ code: -32008, message: 'No team resource at team://nobody' });
  await expect(provider.remove('team://nobody')).rejects.toMatchObject(gone);
});

it('refuses a missing id, an id no URI could name, a missing record and a createOnly that is not a boolean', async () => {
  const methods = recordsMethods('teams', 'team', store(), async () => {});
  const put = methods['x-ahpd/teams/put']!;
  expect(await answer(put, { record: {} })).toMatchObject({ code: -32602, message: 'x-ahpd/teams/put needs id, the team\'s id, with no / or ?' });
  expect(await answer(put, { id: 'a/b', record: {} })).toMatchObject({ code: -32602 });
  expect(await answer(put, { id: 'a?b', record: {} })).toMatchObject({ code: -32602 });
  expect(await answer(put, { id: 'web' })).toMatchObject({ code: -32602, message: 'A team is made from a JSON object, and that body is not one' });
  expect(await answer(put, { id: 'web', record: {}, createOnly: 'yes' })).toMatchObject({ code: -32602, message: 'x-ahpd/teams/put takes createOnly as true or false' });
  expect(await answer(methods['x-ahpd/teams/remove']!, {})).toMatchObject({ code: -32602 });
});

it('calls changed after a resource write and remove, and not after a refusal', async () => {
  const teams = store();
  let changed = 0;
  const provider = recordsProvider('team', teams, () => { changed += 1; });
  await provider.write('team://backend', { data: '{}', encoding: 'utf-8' });
  expect(changed).toBe(1);
  await provider.remove('team://backend');
  expect(changed).toBe(2);
  await expect(provider.remove('team://backend')).rejects.toMatchObject({ code: -32008 });
  await expect(provider.write('team://web', { data: '{"title":7}', encoding: 'utf-8' })).rejects.toMatchObject({ code: -32602 });
  expect(changed).toBe(2);
});

it('refreshes the channel after a write through the domain\'s provider and its command', async () => {
  const teams = store();
  const domain = recordsDomain('teams', 'team', teams);
  expect(domain.channel.scheme).toBe('x-ahpd-teams');
  expect(domain.channel.channel.grant).toBe('team:read');
  const { handle, of } = fakeHandle([{ client: 'root', reader: undefined }]);
  domain.channel.bind(handle);
  await domain.channel.channel.snapshot(URI, undefined, 'root');
  await domain.provider.write('team://backend', { data: '{}', encoding: 'utf-8' });
  await domain.channel.refresh();
  expect(of('root')).toEqual(['added backend']);
  await domain.methods['x-ahpd/teams/put']!.handle({ id: 'web', record: {} }, undefined, 'root');
  expect(of('root')).toEqual(['added backend', 'added web']);
});

it('sends each reader its record in the locale of its client, and diffs the stored record', async () => {
  const teams = store({ backend: { id: 'backend', title: 'Back' } });
  const words: Record<string, Record<string, string>> = { pt: { Back: 'Fundos', Front: 'Frente' } };
  const list = recordsChannel(SCHEME, teams, {
    grant: 'team:read',
    translate: (record, locale) => ({ ...record, title: words[locale]?.[String(record.title)] ?? record.title }),
  });
  const ana = person('ana', ['team:read']);
  const bia = person('bia', ['team:read']);
  const locales: Record<string, string> = { ana: 'pt' };
  const { handle, heard } = fakeHandle([{ client: 'ana', reader: ana }, { client: 'bia', reader: bia }]);
  list.bind({ ...handle, localeOf: (client) => locales[client] });

  expect(await list.channel.snapshot(URI, ana, 'ana')).toEqual({ records: [{ id: 'backend', record: { id: 'backend', title: 'Fundos' } }] });
  // A client that sent no locale gets the record as the store holds it.
  expect(await list.channel.snapshot(URI, bia, 'bia')).toEqual({ records: [{ id: 'backend', record: { id: 'backend', title: 'Back' } }] });

  teams.rows.backend = { id: 'backend', title: 'Front' };
  await list.refresh();
  // One change each, and each in its own language.
  expect(heard.map((one) => [one.client, one.action.type, (one.action.record as { title: string }).title])).toEqual([
    ['ana', `${SCHEME}/changed`, 'Frente'],
    ['bia', `${SCHEME}/changed`, 'Front'],
  ]);

  // Nothing changed in the store, so nothing is sent, though the two readers hold different text.
  await list.refresh();
  expect(heard).toHaveLength(2);
});
