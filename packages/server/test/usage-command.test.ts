/*
 * `ahpd usage [pool]`, run in this process.
 *
 * One declaration on two surfaces: the terminal, whose caller holds the files
 * and the process, and `/api`, whose caller is a person with a token. What is
 * pinned here is that the two read one store and one rule - the pools a person
 * may see are the scheme's question, not a second copy of it in this command -
 * and that a period's total is the sum of the records behind it.
 *
 * The clock is pinned, because every period is "now" and the week is the whole
 * reason `usage.timezone` exists.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Output } from '@cofold/commands';
import { fileUsage, fileUsers, usageProvider } from '@ahpd/sdk';
import type { ComputerTime, ModelUse, Usage, Users } from '@ahpd/sdk';
import { optionsFrom } from '../src/commands/options.js';
import { cliRegistry } from '../src/commands/registry.js';
import { apiOrigins } from '../src/commands/run.js';
import { servedRegistry, type ServedFacts } from '../src/commands/served.js';
import { apiHandler } from '../src/http.js';

const AUTHORITY = '127.0.0.1:9351';
/** A Wednesday, mid-morning: the day, the week and the month are all different ranges. */
const NOW = '2026-10-07T12:00:00.000Z';

let home: string;
let config: string;
let folder: string;
let store: Usage;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-usage-command-'));
  config = join(home, 'config.json');
  // The terminal reads the store out of the configuration directory, as the
  // daemon does, so a case here is the same folder the served cases read.
  folder = join(home, 'ahpd', 'usage');
  const had = process.env['XDG_CONFIG_HOME'];
  process.env['XDG_CONFIG_HOME'] = home;
  afterEach(() => { if (had === undefined) delete process.env['XDG_CONFIG_HOME']; else process.env['XDG_CONFIG_HOME'] = had; });
  store = fileUsage({ folder });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(home, { recursive: true, force: true });
});

const put = (held: unknown): void => { writeFileSync(config, `${JSON.stringify(held, null, 2)}\n`); };

const modelUse = (at: string, pools: string[], usd: number): ModelUse => ({
  at,
  kind: 'model',
  source: 'proxy',
  owner: 'user:ana',
  model: { name: 'anthropic/opus-5' },
  pools,
  cost: { amount: usd, currency: 'usd', from: 'harness' },
});

const computerTime = (at: string, pools: string[], seconds: number): ComputerTime => ({
  at,
  kind: 'computer',
  source: 'computer',
  owner: 'user:ana',
  computer: 'laptop',
  seconds,
  pools,
});

/** What the terminal command answered. */
const run = async (input: Record<string, unknown> = {}): Promise<Output> => {
  const registry = cliRegistry();
  const command = registry.find('usage.list');
  if (command === undefined) throw new Error('no usage.list');
  const said = await registry.execute(command, { surface: 'cli', input: { configFile: config, ...input } });
  if (said === null) throw new Error('usage answered nothing');
  return said;
};

/**
 * The people a served case signs in as.
 *
 * A real directory rather than a hand-made one: `poolsFor` is asked what a
 * person may charge work to, which is what the file settles, so a directory
 * that answered only grants would leave the very pools under test unsaid.
 */
const people = async (): Promise<{ directory: Users; ana: string; keeper: string }> => {
  const directory = fileUsers({ path: join(home, 'users.json') });
  await directory.addTeam('backend');
  await directory.addProject('search');
  await directory.addRole('keeper', ['usage:read']);
  await directory.add('ana', ['guest'], { memberships: ['backend:search'] });
  await directory.add('beto', ['guest']);
  await directory.add('keeper', ['keeper']);
  return { directory, ana: await directory.mint('ana'), keeper: await directory.mint('keeper') };
};

/** The daemon's own facts, which every served case reads through. */
const facts = (): ServedFacts => ({
  options: optionsFrom({ configFile: config }),
  configFile: config,
  running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9351, paths: [], startedAt: '' }),
  turning: () => [],
  usage: () => store,
  restart: () => {},
});

/** The daemon's own answer to a path under the API, as one bearer. */
const answer = (registry: ReturnType<typeof servedRegistry>, bearer: string | undefined, path: string, directory?: Users): Promise<Response> =>
  apiHandler({
    registry,
    token: 'root-secret',
    ...(directory === undefined ? {} : { users: directory }),
    program: { name: 'ahpd', version: '0.0.0' },
    origins: () => apiOrigins('127.0.0.1', undefined, 9351),
  })(new Request(`http://${AUTHORITY}/api${path}`, {
    headers: { host: AUTHORITY, ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }) },
  }));

/** The daemon's own answer to a path under the API, as one bearer. */
const get = (path: string, bearer: string | undefined, directory?: Users): Promise<Response> =>
  answer(servedRegistry(facts()), bearer, path, directory);

/** The pools, as the listing names them. */
const pools = (value: Output): string[] => (value.data as { pool: string }[]).map((one) => one.pool);

/** What a sum of the records adds up to, in the four measures a total reports. */
const sumOf = (records: { kind: string; cost?: { amount?: number }; model?: { input?: number; output?: number }; seconds?: number }[]): Record<string, number> => {
  let usd = 0;
  let tokens = 0;
  let calls = 0;
  let hours = 0;
  for (const one of records) {
    if (one.kind === 'computer') { hours += (one.seconds ?? 0) / 3600; continue; }
    usd += one.cost?.amount ?? 0;
    tokens += (one.model?.input ?? 0) + (one.model?.output ?? 0);
    calls += 1;
  }
  // A measure nothing was charged in is left out, the way a total leaves it out.
  return {
    ...(usd === 0 ? {} : { usd }),
    ...(tokens === 0 ? {} : { tokens }),
    ...(calls === 0 ? {} : { calls }),
    ...(hours === 0 ? {} : { hours }),
  };
};

describe('usage at the terminal', () => {
  it('lists the pools this host was charged', async () => {
    put({});
    for (const one of [
      modelUse('2026-10-02T10:00:00.000Z', ['user:ana', 'project:backend:search'], 1),
      modelUse('2026-10-03T10:00:00.000Z', ['user:beto'], 2),
      computerTime('2026-10-06T10:00:00.000Z', ['team:backend'], 1800),
    ]) await store.record(one);

    // The terminal's caller is the process owner, who holds the files, so
    // every pool is theirs - the listing is the scheme's, not this command's.
    const said = await run();
    expect(pools(said)).toEqual(['project:backend:search', 'team:backend', 'user:ana', 'user:beto']);
    expect(said.plain).toBe('project:backend:search\nteam:backend\nuser:ana\nuser:beto\n');
  });

  it('says there are no pools rather than printing an empty list', async () => {
    put({});
    const said = await run();
    expect(said.data).toEqual([]);
    expect(said.plain).toBe('no pools\n');
  });

  it('prints a pool\'s three totals, and carries the same numbers to --json', async () => {
    put({ usage: { timezone: 'UTC' } });
    for (const one of [
      modelUse('2026-10-02T10:00:00.000Z', ['user:ana'], 0.25),
      computerTime('2026-10-03T10:00:00.000Z', ['user:ana'], 3600),
      modelUse('2026-10-07T09:00:00.000Z', ['user:ana'], 0.75),
    ]) await store.record(one);

    const said = await run({ pool: 'user:ana' });
    const body = said.data as { pool: string; day: Record<string, number>; week: Record<string, number>; month: Record<string, number> };
    // Today is the record of this morning, the week is that one too, and the
    // month is all three: a call's tokens and its cost, and an hour of a
    // machine in hours, as the store reports them.
    expect(body).toEqual({
      pool: 'user:ana',
      day: { usd: 0.75, calls: 1 },
      week: { usd: 0.75, calls: 1 },
      month: { usd: 1, calls: 2, hours: 1 },
    });
    expect(said.plain).toBe('user:ana\n  today       usd 0.75 calls 1\n  this week   usd 0.75 calls 1\n  this month  usd 1 calls 2 hours 1\n');

    // A pool a measure was never charged in leaves it out rather than saying zero.
    await store.record(modelUse('2026-10-07T10:00:00.000Z', ['team:backend'], 3));
    expect((await run({ pool: 'team:backend' })).data).toMatchObject({ day: { usd: 3, calls: 1 } });
    expect((await run({ pool: 'team:frontend' })).plain).toContain('  today       nothing\n');
  });

  it('answers with the same numbers the scheme reads, over the same ranges', async () => {
    put({ usage: { timezone: 'UTC' } });
    for (const one of [
      modelUse('2026-10-02T10:00:00.000Z', ['user:ana'], 0.25),
      computerTime('2026-10-03T10:00:00.000Z', ['user:ana'], 3600),
      modelUse('2026-10-07T09:00:00.000Z', ['user:ana'], 0.75),
    ]) await store.record(one);

    const said = await run({ pool: 'user:ana' });
    const body = said.data as { day: Record<string, number>; week: Record<string, number>; month: Record<string, number> };
    const provider = usageProvider({ usage: store, timezone: 'UTC' });
    const at = async (uri: string): Promise<any> => JSON.parse((await provider.read(uri)).data);

    // Each period is the sum of the records the scheme answers behind it, over
    // the range that period covers: Monday the 5th, and the 1st of the month.
    for (const [period, from] of [['day', '2026-10-07'], ['week', '2026-10-05'], ['month', '2026-10-01']] as const) {
      const behind = await at(`usage://user%3Aana/records?from=${from}&until=${NOW}`);
      expect(sumOf(behind)).toEqual(body[period]);
    }
    // And the totals the store itself answers over those ranges.
    expect(body.week).toEqual(await store.total('user:ana', '2026-10-05T00:00:00.000Z', NOW));
    expect(body.month).toEqual(await store.total('user:ana', '2026-10-01T00:00:00.000Z', NOW));
  });

  it('cuts the week in usage.timezone, not in the system\'s own zone', async () => {
    /*
     * Two records either side of the Sunday the two zones disagree about. In
     * UTC the week began on Monday the 5th; in Tokyo that Monday was Sunday the
     * 4th at fifteen hundred, so both records are behind it.
     */
    for (const one of [
      modelUse('2026-10-04T20:00:00.000Z', ['user:ana'], 1),
      modelUse('2026-10-06T10:00:00.000Z', ['user:ana'], 2),
    ]) await store.record(one);

    put({ usage: { timezone: 'UTC' } });
    expect((await run({ pool: 'user:ana' })).data).toMatchObject({ week: { usd: 2, calls: 1 } });
    put({ usage: { timezone: 'Asia/Tokyo' } });
    expect((await run({ pool: 'user:ana' })).data).toMatchObject({ week: { usd: 3, calls: 2 } });
    // The month is the whole of it either way: the key moves a boundary, it
    // does not filter the records.
    expect((await run({ pool: 'user:ana' })).data).toMatchObject({ month: { usd: 3, calls: 2 } });
  });
});

describe('usage, served', () => {
  it('shows a person their own pools with no usage:read, and refuses another person\'s', async () => {
    put({ usage: { timezone: 'UTC' } });
    for (const one of [
      modelUse('2026-10-07T09:00:00.000Z', ['user:ana', 'project:backend:search'], 1.5),
      modelUse('2026-10-07T10:00:00.000Z', ['user:beto'], 2),
    ]) await store.record(one);
    const { directory, ana, keeper } = await people();

    // Their own pool and the project they belong to, read with nothing held.
    const own = await get('/usage/user%3Aana', ana, directory);
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ pool: 'user:ana', day: { usd: 1.5, calls: 1 } });

    const project = await get('/usage/project%3Abackend%3Asearch', ana, directory);
    expect(project.status).toBe(200);
    expect(await project.json()).toMatchObject({ pool: 'project:backend:search', day: { usd: 1.5, calls: 1 } });

    // Somebody else's is refused with the sentence the host says on the socket.
    const refused = await get('/usage/user%3Abeto', ana, directory);
    expect(refused.status).toBe(403);
    expect((await refused.json() as { message: string }).message).toBe('ana may not usage:read here');

    // A role naming `usage:read` reads every pool the store holds.
    const every = await get('/usage/user%3Abeto', keeper, directory);
    expect(every.status).toBe(200);
    expect(await every.json()).toMatchObject({ pool: 'user:beto', day: { usd: 2, calls: 1 } });

    // And the deployment token is the host: it reads what nobody else may.
    const root = await get('/usage/user%3Abeto', 'root-secret', directory);
    expect(root.status).toBe(200);
    expect(await root.json()).toMatchObject({ pool: 'user:beto' });
  });

  it('refuses a caller with no credential at all, before any pool is asked for', async () => {
    put({});
    await store.record(modelUse('2026-10-07T09:00:00.000Z', ['user:ana'], 1));
    const { directory } = await people();

    const answered = await answer(servedRegistry(facts()), undefined, '/usage/user%3Aana', directory);
    expect(answered.status).toBe(401);
  });

  it('says a daemon that was started with no store has nothing to say it spent', async () => {
    put({});
    // A host with no `usage` port: `facts.usage` is absent, the way it is for a
    // daemon whose plugins took the store away.
    const { usage: _absent, ...without } = facts();
    const answered = await answer(servedRegistry(without), 'root-secret', '/usage/user%3Aana');
    expect(answered.status).toBe(400);
    expect((await answered.json() as { message: string }).message).toContain('no usage store');
  });
});
