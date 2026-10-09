/*
 * Usage, as a resource scheme.
 *
 * The store answers what was charged; this is the shape the answer arrives in
 * and the reader it arrives for. The two halves are held together here: what
 * `Usage.total` says over a range and what `usage://<pool>` reads over the same
 * range have to be the same numbers, or a client that draws one and a limit that
 * fires on the other are two truths about one pool.
 *
 * The clock is pinned, because every period here is "now" and the week is the
 * reason the zone exists - a boundary that moved with the wall clock would prove
 * nothing at all.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fileUsage, usageProvider } from '../src/usage.js';
import { mayRead, poolsFor } from '../src/scopes.js';
import type { ComputerTime, ModelCall, ModelUse } from '../src/types/usage.js';
import type { Principal } from '../src/types/users.js';

/** A Wednesday, mid-morning, in the middle of the month the cases are written in. */
const NOW = '2026-10-07T12:00:00.000Z';

let folder: string;
beforeEach(() => {
  folder = join(mkdtempSync(join(tmpdir(), 'ahpd-usage-scheme-')), 'usage');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(folder, { recursive: true, force: true });
});

const modelUse = (at: string, pools: string[], rest: Partial<ModelCall & ModelUse> = {}): ModelUse => ({
  at,
  kind: 'model',
  source: 'proxy',
  owner: 'user:ana',
  model: { name: 'anthropic/opus-5' },
  pools,
  ...rest,
});

const computerTime = (at: string, seconds: number, pools: string[]): ComputerTime => ({
  at,
  kind: 'computer',
  source: 'computer',
  owner: 'user:ana',
  computer: 'laptop',
  seconds,
  pools,
});

/** A person, with what they may do and what they may charge work to. */
const person = (id: string, grants: string[] = [], memberships: string[] = [], projects: string[] = []): Principal => ({
  id,
  roles: ['r'],
  can: (one) => grants.includes(one),
  memberships,
  projects: projects.map((one) => ({ id: one })),
  teams: [{ id: 'backend' }],
});

/** A principal nobody named: a root connection, or a connection the gate did not check. */
const unchecked: Principal = { id: 'the deployment token', roles: [], can: () => true };

/** What a URI read as JSON. */
const json = async (uri: string, reader?: Principal, provider = usageProvider({ usage: fileUsage({ folder }) })): Promise<any> =>
  JSON.parse((await provider.read(uri, undefined, reader)).data);

/** A store with these records in it, and the provider over it. */
const over = async (records: (ModelUse | ComputerTime)[], timezone?: string) => {
  const usage = fileUsage({ folder });
  for (const one of records) await usage.record(one);
  return { usage, provider: usageProvider({ usage, ...(timezone === undefined ? {} : { timezone }) }) };
};

const ANA = person('ana', [], ['backend:search', 'frontend']);
const ANA_POOLS = ['project:backend:search', 'team:frontend', 'user:ana'];

it('lists the pools a reader may see, and not another person\'s', async () => {
  const { provider } = await over([
    modelUse('2026-10-02T10:00:00.000Z', ANA_POOLS, { cost: { amount: 0.25, currency: 'usd', from: 'harness' } }),
    modelUse('2026-10-03T10:00:00.000Z', ['user:beto']),
  ]);

  // Their own, their teams' and their projects' pools, spelled the way a record
  // is charged - and sorted, as every listing here is.
  expect(await provider.list('usage://', ANA)).toEqual([
    { name: 'project:backend:search', type: 'directory' },
    { name: 'team:frontend', type: 'directory' },
    { name: 'user:ana', type: 'directory' },
  ]);
  expect((await provider.list('usage://', ANA)).map((one) => one.name)).not.toContain('user:beto');

  // The pools they name are the same three, and the listing is the ones of
  // those that something was charged to.
  expect(poolsFor(ANA)).toEqual(['user:ana', 'project:backend:search', 'team:frontend']);

  // One holding `usage:read` sees every pool the store holds.
  expect(await provider.list('usage://', person('keeper', ['usage:read']))).toEqual([
    { name: 'project:backend:search', type: 'directory' },
    { name: 'team:frontend', type: 'directory' },
    { name: 'user:ana', type: 'directory' },
    { name: 'user:beto', type: 'directory' },
  ]);

  // And so does a reader the gate never checked: a root connection, and a host
  // with no users directory at all.
  expect(await provider.list('usage://', unchecked)).toHaveLength(4);
  expect(await provider.list('usage://')).toHaveLength(4);
});

it('reads a pool as its day, week and month, and each is what total says over the same range', async () => {
  const { usage, provider } = await over([
    modelUse('2026-10-02T10:00:00.000Z', ['user:ana'], { cost: { amount: 0.25, currency: 'usd', from: 'harness' } }),
    computerTime('2026-10-03T10:00:00.000Z', 3600, ['user:ana']),
    modelUse('2026-10-07T09:00:00.000Z', ['user:ana'], { cost: { amount: 0.75, currency: 'usd', from: 'harness' } }),
  ], 'UTC');
  const from = (day: string): [string, string] => [`${day}T00:00:00.000Z`, NOW];

  const read = await json('usage://user%3Aana', undefined, provider);
  expect(Object.keys(read).sort()).toEqual(['day', 'kind', 'month', 'name', 'pool', 'week']);

  // The same calls the store makes, over the same ranges.
  expect(read.day).toEqual(await usage.total('user:ana', ...from('2026-10-07')));
  expect(read.week).toEqual(await usage.total('user:ana', ...from('2026-10-05')));
  expect(read.month).toEqual(await usage.total('user:ana', ...from('2026-10-01')));
  // The day's total is the record of today, the week's is Monday's, and the
  // month's is all three - with the computer's hour in hours and the two model
  // calls in calls, as the store reports them.
  expect(read.day).toEqual({ usd: 0.75, providerUsd: 0.75, calls: 1 });
  expect(read.week).toEqual({ usd: 0.75, providerUsd: 0.75, calls: 1 });
  expect(read.month).toEqual({ usd: 1, providerUsd: 1, calls: 2, hours: 1 });
});

/*
 * The three leaves are what the pool is listed as, so reading one has to say
 * the same thing reading the pool does.
 */
it('reads one period at a time, and the listing names what can be read', async () => {
  const { usage, provider } = await over([
    modelUse('2026-10-02T10:00:00.000Z', ['user:ana'], { cost: { amount: 0.25, currency: 'usd', from: 'harness' } }),
  ], 'UTC');

  expect(await provider.list('usage://user%3Aana')).toEqual([
    { name: 'day', type: 'file' },
    { name: 'week', type: 'file' },
    { name: 'month', type: 'file' },
    { name: 'range', type: 'file' },
    { name: 'records', type: 'file' },
  ]);

  const whole = await json('usage://user%3Aana', undefined, provider);
  for (const which of ['day', 'week', 'month'] as const) {
    expect(await json(`usage://user%3Aana/${which}`, undefined, provider)).toEqual(whole[which]);
  }
  // And the boundary really is the range `total` is given.
  const month = await usage.total('user:ana', '2026-10-01T00:00:00.000Z', NOW);
  expect(await json('usage://user%3Aana/month', undefined, provider)).toEqual(month);
});

it('cuts the week on the Monday of the configured zone, not the system\'s', async () => {
  /*
   * Two records either side of the Sunday the two zones disagree about. In UTC
   * the week began on Monday the 5th, so Sunday the 4th is behind it; in Tokyo
   * that Monday was Sunday the 4th at fifteen hundred, so both records are in.
   */
  const records = [
    modelUse('2026-10-04T20:00:00.000Z', ['user:ana'], { cost: { amount: 1, currency: 'usd', from: 'harness' } }),
    modelUse('2026-10-06T10:00:00.000Z', ['user:ana'], { cost: { amount: 2, currency: 'usd', from: 'harness' } }),
  ];
  const { usage } = await over(records, 'UTC');

  const inUtc = usageProvider({ usage, timezone: 'UTC' });
  const inTokyo = usageProvider({ usage, timezone: 'Asia/Tokyo' });
  expect((await json('usage://user%3Aana', undefined, inUtc)).week).toEqual({ usd: 2, providerUsd: 2, calls: 1 });
  expect((await json('usage://user%3Aana', undefined, inTokyo)).week).toEqual({ usd: 3, providerUsd: 3, calls: 2 });

  // The store behind both is the same one, and still says what it always says:
  // the zone is a boundary the provider cuts, not a filter on the records.
  expect(await usage.total('user:ana', '2026-10-01T00:00:00.000Z', NOW)).toEqual({ usd: 3, providerUsd: 3, calls: 2 });

  // And naming no zone at all is the system's own, whatever that is.
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const plain = usageProvider({ usage });
  expect(await json('usage://user%3Aana', undefined, plain)).toEqual(await json('usage://user%3Aana', undefined, usageProvider({ usage, timezone: here })));
});

it('says once that a zone it cannot read is not one, and cuts in the system\'s own', async () => {
  const said: string[] = [];
  const usage = fileUsage({ folder });
  await usage.record(modelUse('2026-10-02T10:00:00.000Z', ['user:ana'], { cost: { amount: 1, currency: 'usd', from: 'harness' } }));

  const provider = usageProvider({ usage, timezone: 'Middle/Earth', onProblem: (message) => { said.push(message); } });
  expect(said).toHaveLength(1);
  expect(said[0]).toContain('Middle/Earth');

  // Two reads and no second word: it was said once, where the provider is built.
  await provider.read('usage://user%3Aana');
  await provider.read('usage://user%3Aana');
  expect(said).toHaveLength(1);
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  expect(await json('usage://user%3Aana', undefined, provider))
    .toEqual(await json('usage://user%3Aana', undefined, usageProvider({ usage, timezone: here })));
});

it('reads a pool name holding colons as one encoded segment', async () => {
  const { provider } = await over([
    modelUse('2026-10-02T10:00:00.000Z', ['project:backend:search'], { cost: { amount: 0.25, currency: 'usd', from: 'harness' } }),
  ], 'UTC');

  const read = await json('usage://project%3Abackend%3Asearch', undefined, provider);
  expect(read.pool).toBe('project:backend:search');
  expect(read.month).toEqual({ usd: 0.25, providerUsd: 0.25, calls: 1 });
  // The same pool as the listing spells it, and the listing is what a client
  // browses before it builds the URI. Their own pool has nothing charged to it,
  // so it is not listed.
  expect((await provider.list('usage://', person('ana', [], ['backend:search']))).map((one) => one.name))
    .toEqual(['project:backend:search']);
});

it('answers the records charged to a pool, newest first, and takes the range off the query', async () => {
  const { provider } = await over([
    modelUse('2026-09-28T10:00:00.000Z', ['user:ana'], { cost: { amount: 9, currency: 'usd', from: 'harness' } }),
    modelUse('2026-10-02T10:00:00.000Z', ['user:ana'], { cost: { amount: 1, currency: 'usd', from: 'harness' } }),
    computerTime('2026-10-03T11:00:00.000Z', 3600, ['user:ana']),
    modelUse('2026-10-06T09:00:00.000Z', ['user:ana'], { cost: { amount: 3, currency: 'usd', from: 'harness' } }),
  ], 'UTC');

  const all = await json('usage://user%3Aana/records', undefined, provider);
  expect(all.map((one: { at: string }) => one.at)).toEqual([
    '2026-10-06T09:00:00.000Z',
    '2026-10-03T11:00:00.000Z',
    '2026-10-02T10:00:00.000Z',
  ]);

  // September is behind the default range, and naming it says so.
  const september = await json('usage://user%3Aana/records?from=2026-09-01&until=2026-09-30', undefined, provider);
  expect(september.map((one: { at: string }) => one.at)).toEqual(['2026-09-28T10:00:00.000Z']);

  // A pool nothing was charged to answers nothing, not zeroes.
  expect(await json('usage://user%3Anobody/records', undefined, provider)).toEqual([]);
});

it('refuses a pool the reader may not see, and answers an empty one with an empty total', async () => {
  const { provider } = await over([
    modelUse('2026-10-02T10:00:00.000Z', ['user:ana'], { cost: { amount: 1, currency: 'usd', from: 'harness' } }),
    modelUse('2026-10-02T10:00:00.000Z', ['user:beto'], { cost: { amount: 2, currency: 'usd', from: 'harness' } }),
  ], 'UTC');
  const ana = person('ana', [], ['backend']);

  // Their own pool and their team's pool, one of which has nothing in it: a
  // measure nothing was charged in is absent rather than zero.
  expect(await provider.list('usage://user%3Aana', ana)).toHaveLength(5);
  expect(await provider.list('usage://team%3Abackend', ana)).toHaveLength(5);
  expect(await json('usage://team%3Abackend', ana, provider))
    .toEqual({ pool: 'team:backend', kind: 'team', name: 'backend', day: {}, week: {}, month: {} });

  // Somebody else's is refused with the sentence the host would have said.
  await expect(provider.read('usage://user%3Abeto', undefined, ana)).rejects.toMatchObject({
    code: -32009,
    message: 'ana may not usage:read here',
  });
  await expect(provider.list('usage://user%3Abeto', ana)).rejects.toMatchObject({ message: 'ana may not usage:read here' });

  // And the gate is told the same thing, so the read never reaches the refusal.
  expect(await provider.authorize('usage://user%3Aana', ana)).toBe(true);
  expect(await provider.authorize('usage://user%3Abeto', ana)).toBe(false);
  expect(await provider.authorize('usage://user%3Abeto', person('keeper', ['usage:read']))).toBe(true);
  expect(await provider.authorize('usage://user%3Abeto', unchecked)).toBe(true);
  // The scheme's own root is a listing, and it lists only the reader's.
  expect(await provider.authorize('usage://', ana)).toBe(true);
});

it('says what it is for on the handshake, and makes nothing', () => {
  const provider = usageProvider({ usage: fileUsage({ folder }) });
  expect(provider.describe()).toEqual({
    title: 'Usage',
    description: 'What this host has been charged, per pool.',
  });
});

it('refuses a URI of another scheme, a leaf that is not one of the five, and the root itself', async () => {
  const { provider } = await over([modelUse('2026-10-02T10:00:00.000Z', ['user:ana'])], 'UTC');

  // Not this scheme's URI: a bad argument, not a denial - the code a client
  // reads here is the one it fixes by sending a different URI.
  await expect(provider.read('file:///etc/hosts', undefined, unchecked)).rejects.toMatchObject({ code: -32602 });
  await expect(provider.read('usage://')).rejects.toMatchObject({ code: -32008 });
  await expect(provider.read('usage://user%3Aana/total', undefined, unchecked)).rejects.toMatchObject({ code: -32008 });
  await expect(provider.list('usage://user%3Aana/records')).rejects.toMatchObject({ code: -32008 });

  expect(await provider.resolve('usage://')).toMatchObject({ uri: 'usage://', type: 'directory' });
  expect(await provider.resolve('usage://user%3Aana/week')).toMatchObject({ uri: 'usage://user%3Aana/week', type: 'file' });
  await expect(provider.resolve('usage://user%3Aana/total')).rejects.toMatchObject({ code: -32008 });
});
/*
 * A member reads the team pool their own work is charged to, whichever
 * membership in the team they hold, and `team:*` reads every project of the
 * team rather than the install's projects crossed with it.
 */
it('lets a member read their team\'s pool, and `team:*` every project of that team', async () => {
  const { provider } = await over([], 'UTC');
  const any = person('soft', [], ['backend:*']);
  expect(mayRead(any, 'team:backend')).toBe(true);
  expect(mayRead(any, 'project:backend:ahpc')).toBe(true);
  expect(mayRead(any, 'project:testing:ahpc')).toBe(false);
  expect(await provider.authorize('usage://team%3Abackend', any)).toBe(true);
  expect(await provider.authorize('usage://project%3Abackend%3Aahpc', any)).toBe(true);
  expect(await provider.authorize('usage://project%3Atesting%3Aahpc', any)).toBe(false);

  const one = person('soft', [], ['backend:ahpapp']);
  expect(mayRead(one, 'team:backend')).toBe(true);
  expect(mayRead(one, 'project:backend:ahpapp')).toBe(true);
  expect(mayRead(one, 'project:backend:ahpc')).toBe(false);
  expect(await provider.authorize('usage://team%3Abackend', one)).toBe(true);
  expect(await provider.authorize('usage://project%3Abackend%3Aahpc', one)).toBe(false);

  // A bare team reads the team's pool and none of its projects.
  const bare = person('soft', [], ['backend']);
  expect(mayRead(bare, 'team:backend')).toBe(true);
  expect(mayRead(bare, 'project:backend:ahpapp')).toBe(false);

  // Holding `usage:read` reads every pool, the host's own among them.
  const keeper = person('keeper', ['usage:read']);
  for (const pool of ['user:soft', 'team:testing', 'project:testing:ahpc', 'root:x']) {
    expect(await provider.authorize(`usage://${encodeURIComponent(pool)}`, keeper)).toBe(true);
  }
  expect(mayRead(one, 'root:x')).toBe(false);
});

it('lists the pools something was charged to that the reader may read, the same rows root sees', async () => {
  const { provider } = await over([
    modelUse('2026-10-02T10:00:00.000Z', ['user:soft', 'team:backend', 'project:backend:ahpapp'], { owner: 'user:soft' }),
    modelUse('2026-10-03T10:00:00.000Z', ['root:x'], { owner: 'root:x' }),
  ], 'UTC');
  const soft = person('soft', [], ['backend:*', 'testing:*', 'backend:ahpapp'], ['ahpapp', 'ahpc', 'ahpd']);

  expect((await provider.list('usage://', soft)).map((one) => one.name))
    .toEqual(['project:backend:ahpapp', 'team:backend', 'user:soft']);
  expect((await provider.list('usage://')).map((one) => one.name))
    .toEqual(['project:backend:ahpapp', 'root:x', 'team:backend', 'user:soft']);

  // A pool they may read that nothing was charged to is not a row.
  expect(mayRead(soft, 'project:testing:ahpc')).toBe(true);
  expect((await provider.list('usage://', soft)).map((one) => one.name)).not.toContain('project:testing:ahpc');
});

it('names a pool by its kind and the titles of its team and project', async () => {
  const usage = fileUsage({ folder });
  const titles = {
    teams: async () => [{ id: 'backend', title: 'Backend' }, { id: 'testing' }],
    projects: async () => [{ id: 'ahpapp' }, { id: 'ahpc', title: 'The client' }],
  };
  const provider = usageProvider({ usage, timezone: 'UTC', titles });
  // A reader with no `team` or `project` grant, who reads the pool by membership.
  const soft = person('soft', [], ['backend:ahpapp', 'testing:*']);

  expect(await json('usage://project%3Abackend%3Aahpapp', soft, provider))
    .toMatchObject({ pool: 'project:backend:ahpapp', kind: 'project', name: 'Backend / ahpapp' });
  expect(await json('usage://project%3Atesting%3Aahpc', soft, provider))
    .toMatchObject({ kind: 'project', name: 'testing / The client' });
  // A team with no title is named by its id.
  expect(await json('usage://team%3Atesting', soft, provider)).toMatchObject({ kind: 'team', name: 'testing' });
  expect(await json('usage://team%3Abackend', soft, provider)).toMatchObject({ kind: 'team', name: 'Backend' });
  expect(await json('usage://user%3Asoft', soft, provider)).toMatchObject({ kind: 'user', name: 'soft' });
  expect(await json('usage://root%3Ax', undefined, provider)).toMatchObject({ kind: 'root', name: 'x' });

  // With no titles to read, every name is its ids.
  expect(await json('usage://project%3Abackend%3Aahpapp', soft, usageProvider({ usage })))
    .toMatchObject({ kind: 'project', name: 'backend / ahpapp' });
});

it('reads a total over any range, and the records over the same range agree with it', async () => {
  const { usage, provider } = await over([
    modelUse('2026-09-28T10:00:00.000Z', ['user:ana'], { cost: { amount: 9, currency: 'usd', from: 'harness' } }),
    modelUse('2026-09-29T10:00:00.000Z', ['user:ana'], { cost: { amount: 1, currency: 'usd', from: 'harness' } }),
    computerTime('2026-09-30T11:00:00.000Z', 3600, ['user:ana']),
    modelUse('2026-10-01T09:00:00.000Z', ['user:ana'], { cost: { amount: 3, currency: 'usd', from: 'harness' } }),
  ], 'UTC');

  // The two days in the middle, and neither side of them.
  const range = await json('usage://user%3Aana/range?from=2026-09-29&until=2026-09-30', undefined, provider);
  expect(range).toEqual({ usd: 1, providerUsd: 1, calls: 1, hours: 1 });
  expect(range).toEqual(await usage.total('user:ana', '2026-09-29', '2026-09-30'));

  const records = await json('usage://user%3Aana/records?from=2026-09-29&until=2026-09-30', undefined, provider);
  expect(records.map((one: { at: string }) => one.at)).toEqual(['2026-09-30T11:00:00.000Z', '2026-09-29T10:00:00.000Z']);
  const usd = records.reduce((sum: number, one: { cost?: { amount: number } }) => sum + (one.cost?.amount ?? 0), 0);
  expect(usd).toBe(range.usd);

  // With no range, both are this month to now.
  expect(await json('usage://user%3Aana/range', undefined, provider)).toEqual({ usd: 3, providerUsd: 3, calls: 1 });

  // A bound that is not a date is refused, the same way on both leaves.
  for (const leaf of ['range', 'records']) {
    await expect(provider.read(`usage://user%3Aana/${leaf}?from=yesterday`)).rejects.toMatchObject({ code: -32602 });
    await expect(provider.read(`usage://user%3Aana/${leaf}?until=2026-13-45`)).rejects.toMatchObject({ code: -32602 });
  }
});

/*
 * A record is charged to its user, team and project pools, so it is in three
 * pool totals. A group counts it once.
 */
it('sums the records by user, team and project, each record once', async () => {
  const usage = fileUsage({ folder });
  const scoped = (at: string, owner: `user:${string}`, team: string, project: string | undefined, amount: number): ModelUse =>
    modelUse(at, [owner, `team:${team}`, ...(project === undefined ? [] : [`project:${team}:${project}`])], {
      owner,
      team,
      ...(project === undefined ? {} : { project }),
      cost: { amount, currency: 'usd', from: 'harness' },
    });
  for (const one of [
    scoped('2026-10-02T10:00:00.000Z', 'user:soft', 'backend', 'ahpapp', 1),
    scoped('2026-10-03T10:00:00.000Z', 'user:soft', 'backend', 'ahpc', 2),
    scoped('2026-10-04T10:00:00.000Z', 'user:ana', 'backend', 'ahpapp', 4),
    scoped('2026-10-05T10:00:00.000Z', 'user:ana', 'backend', undefined, 8),
    scoped('2026-10-06T10:00:00.000Z', 'user:beto', 'testing', 'ahpc', 16),
    // Outside the range asked for below.
    scoped('2026-09-20T10:00:00.000Z', 'user:soft', 'backend', 'ahpapp', 32),
  ]) await usage.record(one);
  const provider = usageProvider({
    usage,
    timezone: 'UTC',
    titles: { teams: async () => [{ id: 'backend', title: 'Backend' }], projects: async () => [] },
  });
  const october = 'from=2026-10-01&until=2026-10-07';

  const byUser = await json(`usage://groups?by=user&${october}`, undefined, provider);
  expect(byUser).toEqual([
    { keys: { user: 'user:ana' }, names: { user: 'ana' }, total: { usd: 12, providerUsd: 12, calls: 2 } },
    { keys: { user: 'user:beto' }, names: { user: 'beto' }, total: { usd: 16, providerUsd: 16, calls: 1 } },
    { keys: { user: 'user:soft' }, names: { user: 'soft' }, total: { usd: 3, providerUsd: 3, calls: 2 } },
  ]);

  // A team's spending split by project, and its team work apart from them.
  const byProject = await json(`usage://groups?by=team,project&${october}`, undefined, provider);
  expect(byProject.map((row: { keys: unknown; total: { usd: number } }) => [row.keys, row.total.usd])).toEqual([
    [{ team: 'team:backend' }, 8],
    [{ team: 'team:backend', project: 'project:backend:ahpapp' }, 5],
    [{ team: 'team:backend', project: 'project:backend:ahpc' }, 2],
    [{ team: 'team:testing', project: 'project:testing:ahpc' }, 16],
  ]);
  expect(byProject[1].names).toEqual({ team: 'Backend', project: 'Backend / ahpapp' });

  // No keys is one row, the whole range.
  expect(await json(`usage://groups?${october}`, undefined, provider))
    .toEqual([{ keys: {}, names: {}, total: { usd: 31, providerUsd: 31, calls: 5 } }]);

  // A reader sees no row built from records whose pools they may not read.
  const soft = person('soft', [], ['backend:ahpapp']);
  const theirs = await json(`usage://groups?by=user&${october}`, soft, provider);
  expect(theirs.map((row: { keys: { user: string } }) => row.keys.user)).toEqual(['user:ana', 'user:soft']);
  expect(await provider.authorize('usage://groups?by=user', soft)).toBe(true);

  // A key that is not one is refused, and so is a bound that is not a date.
  await expect(provider.read('usage://groups?by=user,agent')).rejects.toMatchObject({ code: -32602 });
  await expect(provider.read('usage://groups?by=user&from=soon')).rejects.toMatchObject({ code: -32602 });
  await expect(provider.list('usage://groups')).rejects.toMatchObject({ code: -32008 });
  expect(await provider.resolve('usage://groups?by=user')).toMatchObject({ type: 'file' });
});
