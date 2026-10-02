/*
 * What the host keeps about its work, and what a pool has been charged.
 *
 * The store is written down and then read back, so the tests that matter are
 * the ones that build one, record through it, throw it away, and build another
 * over the same folder: a total that only exists while the process runs is not
 * a total a daemon can answer a limit with after a restart.
 *
 * The two kinds are charged in the same place and kept in different files,
 * because a report reads one port and a month's lines are what a person opens
 * with `jq`.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fileUsage } from '../src/usage.js';
import type { ComputerTime, ModelCall, ModelUse, UsageEntry } from '../src/types/usage.js';

let root: string;
let folder: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-usage-'));
  folder = join(root, 'usage');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const modelUse = (at: string, pools: string[], model: Partial<ModelCall> = {}, rest: Partial<ModelUse> = {}): ModelUse => ({
  at,
  kind: 'model',
  source: 'proxy',
  owner: 'user:maria',
  model: { name: 'anthropic/opus-5', ...model },
  pools,
  ...rest,
});

const computerTime = (at: string, seconds: number, pools: string[], rest: Partial<ComputerTime> = {}): ComputerTime => ({
  at,
  kind: 'computer',
  source: 'computer',
  owner: 'project:atlas',
  computer: 'laptop',
  seconds,
  pools,
  ...rest,
});

/** A pool over a whole month, which is the range a report asks about. */
const month = { from: '2026-10-01T00:00:00.000Z', until: '2026-10-31T23:59:59.999Z' };

const files = (): string[] => readdirSync(folder).sort();

it('charges a pool what one model call cost, in every measure it carries', async () => {
  const usage = fileUsage({ folder });
  await usage.record(modelUse('2026-10-04T10:00:00.000Z', ['team:backend'], {
    input: 100,
    output: 20,
    cache: { read: 5, write: 7 },
  }, { cost: { amount: 0.25, currency: 'usd', from: 'harness' } }));

  expect(await usage.total('team:backend', month.from, month.until)).toEqual({
    usd: 0.25,
    // The cache is tokens the provider billed, so it is tokens.
    tokens: 132,
    calls: 1,
  });
  // Nobody else was charged, and a pool nothing names is an empty answer
  // rather than a refusal.
  expect(await usage.total('user:maria', month.from, month.until)).toEqual({});
});

it('charges every pool a record names, and charges a pool in another currency nothing', async () => {
  const usage = fileUsage({ folder });
  await usage.record(modelUse('2026-10-04T10:00:00.000Z', ['team:backend', 'project:atlas'], { input: 10 }, {
    cost: { amount: 3, currency: 'brl', from: 'price' },
  }));

  for (const pool of ['team:backend', 'project:atlas']) {
    const total = await usage.total(pool, month.from, month.until);
    // One number cannot be two currencies, so a cost in reais is kept in the
    // line and is not added to the dollars.
    expect(total.usd).toBeUndefined();
    expect(total.tokens).toBe(10);
    expect(total.calls).toBe(1);
  }
});

it('charges a pool computer time as hours', async () => {
  const usage = fileUsage({ folder });
  await usage.record(computerTime('2026-10-04T10:00:00.000Z', 9_000, ['project:atlas']));

  expect(await usage.total('project:atlas', month.from, month.until)).toEqual({ hours: 2.5 });
  // A computer is not a model call.
  expect((await usage.total('project:atlas', month.from, month.until)).calls).toBeUndefined();
});

it('answers a range by the day it covers, in either store', async () => {
  const usage = fileUsage({ folder });
  await usage.record(modelUse('2026-10-04T10:00:00.000Z', ['p'], { input: 10 }));
  await usage.record(modelUse('2026-10-20T10:00:00.000Z', ['p'], { input: 30 }));
  await usage.record(modelUse('2026-10-21T10:00:00.000Z', ['p'], { input: 60 }));

  const between = await usage.total('p', '2026-10-05T00:00:00.000Z', '2026-10-20T23:59:59.999Z');
  expect(between).toEqual({ tokens: 30, calls: 1 });

  const day = await usage.total('p', '2026-10-21T00:00:00.000Z', '2026-10-21T23:59:59.999Z');
  expect(day).toEqual({ tokens: 60, calls: 1 });

  // Nothing between the two, which is an empty answer and not a zero measure.
  expect(await usage.total('p', '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.999Z')).toEqual({});
});

it('keeps one file per month and kind, and rebuilds the totals from them', async () => {
  const first = fileUsage({ folder });
  await first.record(modelUse('2026-10-31T23:00:00.000Z', ['p'], { input: 10 }, { cost: { amount: 1, currency: 'usd', from: 'harness' } }));
  await first.record(computerTime('2026-10-31T23:00:00.000Z', 1_800, ['p']));
  await first.record(modelUse('2026-11-01T00:10:00.000Z', ['p'], { input: 40 }));

  expect(files()).toEqual(['2026-10-computer.jsonl', '2026-10-model.jsonl', '2026-11-model.jsonl']);

  // A new store over the same folder, which is what a restart is.
  const second = fileUsage({ folder });
  expect(await second.total('p', month.from, month.until)).toEqual({ usd: 1, tokens: 10, calls: 1, hours: 0.5 });

  // A range across the two months sums both files.
  const both = await second.total('p', '2026-10-01T00:00:00.000Z', '2026-11-30T23:59:59.999Z');
  expect(both).toEqual({ usd: 1, tokens: 50, calls: 2, hours: 0.5 });

  // And what it wrote is one whole record per line.
  const written = readFileSync(join(folder, '2026-10-model.jsonl'), 'utf8').trim().split('\n');
  expect(written).toHaveLength(1);
  expect(JSON.parse(written[0] as string)).toEqual(modelUse('2026-10-31T23:00:00.000Z', ['p'], { input: 10 }, {
    cost: { amount: 1, currency: 'usd', from: 'harness' },
  }));
});

it('loses nothing when several records arrive at once', async () => {
  const usage = fileUsage({ folder });
  const many = Array.from({ length: 200 }, (_one, index) => modelUse(
    `2026-10-04T10:00:${String(index % 60).padStart(2, '0')}.000Z`,
    ['p'],
    { input: 1 },
  ));

  await Promise.all(many.map((entry) => usage.record(entry)));

  expect(await usage.total('p', month.from, month.until)).toEqual({ tokens: 200, calls: 200 });
  // Two lines appended at once can interleave into one line that reads back as
  // neither record, so every one of them is a line of its own.
  const lines = readFileSync(join(folder, '2026-10-model.jsonl'), 'utf8').trim().split('\n');
  expect(lines).toHaveLength(200);
  for (const line of lines) expect((JSON.parse(line) as UsageEntry).pools).toEqual(['p']);
  // And a second store over the folder reads exactly the same number back.
  expect(await fileUsage({ folder }).total('p', month.from, month.until)).toEqual({ tokens: 200, calls: 200 });
});

it('skips a line it cannot read, says so once, and keeps the month', async () => {
  const usage = fileUsage({ folder });
  await usage.record(modelUse('2026-10-04T10:00:00.000Z', ['p'], { input: 7 }));
  // A file a later version wrote, and a torn one a kill left.
  writeFileSync(join(folder, '2026-10-model.jsonl'), '{"at": "2026-10-04T11:00:00.000Z", "pools"\n', { flag: 'a' });
  writeFileSync(join(folder, '2026-10-model.jsonl'), '"not a record"\n', { flag: 'a' });
  writeFileSync(join(folder, 'notes.txt'), 'not a usage file\n');
  writeFileSync(join(folder, '2026-10-model.jsonl.part'), '{"pools": ["p"]}\n');

  const said: string[] = [];
  const rebuilt = fileUsage({ folder, onProblem: (message) => said.push(message) });

  expect(said).toHaveLength(2);
  expect(said[0]).toContain('2026-10-model.jsonl');
  expect(said[1]).toContain('not a usage record');
  // The whole line that was readable is still charged, and a file that is not
  // this store's is left alone.
  expect(await rebuilt.total('p', month.from, month.until)).toEqual({ tokens: 7, calls: 1 });
  expect(readFileSync(join(folder, 'notes.txt'), 'utf8')).toBe('not a usage file\n');
});

it('says so and keeps nothing of a record that names no day, rather than charging a wrong one', async () => {
  const said: string[] = [];
  const usage = fileUsage({ folder, onProblem: (message) => said.push(message) });
  await usage.record(modelUse('whenever', ['p'], { input: 5 }));

  expect(said).toHaveLength(1);
  expect(said[0]).toContain('no readable date');
  expect(await usage.total('p', month.from, month.until)).toEqual({});
  expect(existsSync(join(folder, 'whatev-model.jsonl'))).toBe(false);
});

it('makes its folder, and writes usage nobody but its owner may read', async () => {
  expect(existsSync(folder)).toBe(false);
  const usage = fileUsage({ folder });
  expect(existsSync(folder)).toBe(true);

  await usage.record(modelUse('2026-10-04T10:00:00.000Z', ['p'], { input: 1 }));
  // The mode is set when the file is made, so it is the creating store that
  // has to get it right.
  expect(statSync(join(folder, '2026-10-model.jsonl')).mode & 0o777).toBe(0o600);
});

it('starts empty over a folder that is not there yet', async () => {
  const said: string[] = [];
  const usage = fileUsage({ folder: join(root, 'never', 'made'), onProblem: (message) => said.push(message) });
  expect(said).toEqual([]);
  expect(await usage.total('p', month.from, month.until)).toEqual({});
});
