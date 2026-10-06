/*
 * The policy row and the two stores behind the `Policies` port.
 *
 * A row written through the port comes back exactly as it was written, which is
 * the whole promise here: a client reads a row, draws a form from it and writes
 * it back, and the second write must not have changed anything. So the cases
 * that matter are the ones that would quietly change a body - a window written
 * as a bare day, a limit whose pool was dropped - and the ones that would
 * quietly lose one, a file holding a row that is not a policy.
 *
 * The two stores are one function over one map, so the refusals are run
 * against both. What differs is only the file: one keeps a row across a
 * restart and the other keeps nothing at all.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { filePolicies, memoryPolicies } from '../src/policies.js';
import { RpcError } from '../src/rpc.js';
import type { Measure, Policies, Policy, PolicyLimit } from '../src/types/policies.js';

let root: string;
let file: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-policies-'));
  file = join(root, 'policies.json');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** The store a case runs against: the one that keeps a file and the one that keeps nothing. */
const stores = (): [string, () => Policies][] => [
  ['file', () => filePolicies({ file })],
  ['memory', () => memoryPolicies()],
];

/** The three kinds, as the plan's second table writes them, `limits` and all. */
const rows = (): Policy[] => [
  {
    id: 'M1',
    scope: 'all',
    kind: 'model',
    effect: 'allow',
    match: { model: ['deepseek/*', 'qwen/*'], proxy: ['local-vllm'] },
    limits: [{ amount: 500, measure: 'usd', period: 'week', pool: 'shared' }],
    pool: 'shared-llm',
    cap: true,
  },
  {
    id: 'A2',
    scope: 'team:backend',
    kind: 'agent',
    effect: 'allow',
    match: { agent: ['claude', 'pi'], model: ['anthropic/*'] },
    limits: [
      { amount: 400, measure: 'usd', period: 'week', pool: 'shared' },
      { amount: 40, measure: 'hours', period: 'week', pool: 'each' },
    ],
  },
  {
    id: 'C1',
    scope: 'user:alice',
    kind: 'computer',
    effect: 'deny',
    match: { computer: ['sandbox-alice'] },
    limits: [{ amount: 2, measure: 'sessions', period: 'total', pool: 'each' }],
    from: '2026-10-22',
    until: '2026-10-31',
  },
];

describe.each(stores())('%s policies', (_name, build) => {
  it('accepts a row of each kind as the plan writes it, limits and all', async () => {
    const store = build();
    for (const row of rows()) await store.put(row);

    expect((await store.list()).map((one) => one.id)).toEqual(['M1', 'A2', 'C1']);
    // The optional fields survive, and a row without them carries none rather
    // than an empty stand-in.
    expect(await store.get('M1')).toEqual(rows()[0]);
    expect((await store.get('C1'))?.limits).toEqual([{ amount: 2, measure: 'sessions', period: 'total', pool: 'each' }]);
    expect(await store.get('nothing')).toBeUndefined();
  });

  it('writes a bare day as the whole day it names, on both ends', async () => {
    const store = build();
    await store.put(rows()[2] as Policy);

    const held = await store.get('C1');
    // `from` opens the day and `until` closes it, so the last day a row names
    // is the last day it applies rather than the one it stops on.
    expect(held?.from).toBe('2026-10-22T00:00:00.000Z');
    expect(held?.until).toBe('2026-10-31T23:59:59.999Z');
  });

  it('takes a row out, and says so about an id it does not hold', async () => {
    const store = build();
    await store.put(rows()[0] as Policy);

    expect(await store.remove('M1')).toBe(true);
    expect(await store.remove('M1')).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  it('edits the row under an id, and never holds two behind one address', async () => {
    const store = build();
    const first = rows()[0] as Policy;
    await store.put(first);
    // Writing a row back unchanged is what a client that read it does.
    await store.put(first);
    // And writing a different row under the same id is the edit, which is what
    // the `policy:` scheme does with every change a form makes.
    await store.put({ ...first, effect: 'deny' });

    expect((await store.get('M1'))?.effect).toBe('deny');
    expect((await store.list()).filter((one) => one.id === 'M1')).toHaveLength(1);
  });
});

describe('what a policy that is not one is refused with', () => {
  /** The refusal one body gets, naming the field, from both stores. */
  const refused = async (body: unknown, field: string): Promise<void> => {
    for (const [, build] of stores()) {
      const error = await build().put(body as Policy).then(() => undefined, (why: unknown) => why);
      expect(error).toBeInstanceOf(RpcError);
      expect((error as RpcError).code).toBe(-32602);
      expect((error as RpcError).message).toContain(field);
    }
  };

  it('refuses a body that is not a JSON object', async () => {
    for (const body of ['a policy', 42, null, ['M1']]) await refused(body, 'JSON object');
  });

  it('refuses an empty id and an id that is only whitespace', async () => {
    await refused({ ...base(), id: '' }, 'id');
    await refused({ ...base(), id: '   ' }, 'id');
    await refused({ ...base(), id: 7 }, 'id');
  });

  it('refuses a scope that is not one of the four forms', async () => {
    await refused({ ...base(), scope: 'company' }, 'scope');
    await refused({ ...base(), scope: 'user:' }, 'scope');
    await refused({ ...base(), scope: 'project:backend' }, 'scope');
    await refused({ ...base(), scope: 'project::billing' }, 'scope');
    await refused({ ...base(), scope: undefined }, 'scope');
    // The four forms themselves, and a project with a colon on either side of
    // the second one.
    for (const scope of ['all', 'user:alice', 'team:backend', 'project:backend:billing']) {
      await expect(memoryPolicies().put({ ...base(), scope: scope as Policy['scope'] })).resolves.toBeDefined();
    }
  });

  it('refuses a kind that is not one of the three, and an effect that is not one of the two', async () => {
    await refused({ ...base(), kind: 'gpu' }, 'kind');
    await refused({ ...base(), effect: 'maybe' }, 'effect');
  });

  it('refuses a value type the kind does not take', async () => {
    await refused({ ...base(), match: { model: ['*'], agent: ['claude'] } }, 'match');
    await refused({ ...base(), kind: 'agent', match: { agent: ['claude'], proxy: ['openrouter'] } }, 'match');
    await refused({ ...base(), kind: 'computer', match: { computer: ['host'], model: ['*'] } }, 'match');
    // A type nobody knows is refused whichever kind it is written on.
    await refused({ ...base(), match: { gpu: ['a100'] } }, 'match');
    // A value that is not a list of strings is refused on the type it is under.
    await refused({ ...base(), match: { model: 'anthropic/*' } }, 'match.model');
  });

  it('refuses a limit whose measure is not of its kind', async () => {
    await refused({ ...base(), limits: [limit(1, 'hours')] }, 'measure');
    await refused({ ...base(), kind: 'computer', match: { computer: ['host'] }, limits: [limit(1, 'usd')] }, 'measure');
    // The measures each kind does take.
    const taken: [Policy['kind'], Policy['match'], Measure[]][] = [
      ['model', { model: ['*'] }, ['usd', 'tokens', 'calls']],
      ['agent', { agent: ['claude'] }, ['usd', 'tokens', 'turns', 'hours']],
      ['computer', { computer: ['host'] }, ['hours', 'sessions']],
    ];
    for (const [kind, match, measures] of taken) {
      for (const measure of measures) {
        await expect(memoryPolicies().put({ ...base(), kind, match, limits: [limit(1, measure)] }))
          .resolves.toBeDefined();
      }
    }
  });

  it('refuses an unknown period, a pool that is not shared or each, and a negative amount', async () => {
    await refused({ ...base(), limits: [{ ...limit(1, 'usd'), period: 'fortnight' }] }, 'period');
    await refused({ ...base(), limits: [{ ...limit(1, 'usd'), pool: 'whole' }] }, 'pool');
    await refused({ ...base(), limits: [limit(-1, 'usd')] }, 'amount');
    await refused({ ...base(), limits: [{ ...limit(1, 'usd'), amount: '500' }] }, 'amount');
    await refused({ ...base(), limits: [limit(Number.NaN, 'usd')] }, 'amount');
    await refused({ ...base(), limits: { amount: 1 } }, 'limits');
    await refused({ ...base(), limits: ['500 usd / week shared'] }, 'limits[0]');
  });

  it('refuses a window that ends before it starts, and one that is not a date', async () => {
    await refused({ ...base(), from: '2026-10-31', until: '2026-10-22' }, 'from');
    await refused({ ...base(), from: 'next tuesday' }, 'from');
    await refused({ ...base(), until: '2026-13-45' }, 'until');
  });

  it('accepts an instant as well as a day, and stores the instant it was given', async () => {
    const store = memoryPolicies();
    await store.put({ ...base(), from: '2026-10-22T09:30:00.000Z', until: '2026-11-01T00:00:00-03:00' });

    const held = await store.get('M1');
    expect(held?.from).toBe('2026-10-22T09:30:00.000Z');
    // Both spellings are the same instant and are stored as one.
    expect(held?.until).toBe('2026-11-01T03:00:00.000Z');
  });
});

/** A `model` row every refusal here starts from. */
const base = (): Policy => ({
  id: 'M1',
  scope: 'all',
  kind: 'model',
  effect: 'allow',
  match: { model: ['anthropic/*'] },
});

const limit = (amount: number, measure: string): PolicyLimit =>
  ({ amount, measure: measure as Measure, period: 'week', pool: 'shared' });

describe('the file policies are kept in', () => {
  it('starts empty over a file that is not there, and keeps nothing on disk until a row is written', async () => {
    const said: string[] = [];
    const store = filePolicies({ file, onProblem: (message) => said.push(message) });

    expect(await store.list()).toEqual([]);
    expect(said).toEqual([]);
    expect(existsSync(file)).toBe(false);

    await store.put(rows()[0] as Policy);
    const written = JSON.parse(readFileSync(file, 'utf8')) as { version: number; policies: Policy[] };
    expect(written.version).toBe(1);
    expect(written.policies).toEqual([rows()[0]]);
  });

  it('reads back every row after a restart, exactly as it was written', async () => {
    const first = filePolicies({ file });
    for (const row of rows()) await first.put(row);

    // A second store over the same file, which is what a restart is.
    const second = filePolicies({ file });
    expect((await second.list()).map((one) => one.id)).toEqual(['M1', 'A2', 'C1']);
    expect(await second.get('A2')).toEqual(rows()[1]);
    expect(await second.get('C1')).toEqual({
      ...(rows()[2] as Policy),
      from: '2026-10-22T00:00:00.000Z',
      until: '2026-10-31T23:59:59.999Z',
    });

    // And a removal survives the same way.
    await second.remove('A2');
    expect((await filePolicies({ file }).list()).map((one) => one.id)).toEqual(['M1', 'C1']);
  });

  it('reports a row that is not a policy and keeps every other row', async () => {
    writeFileSync(file, JSON.stringify({
      version: 1,
      policies: [
        { id: 'A2', scope: 'team:backend', kind: 'agent', effect: 'allow', match: { agent: ['claude'] } },
        { id: 'nonsense', kind: 'agent' },
        'not a row',
        { id: 'C1', scope: 'user:alice', kind: 'computer', effect: 'allow', match: { computer: ['host'] } },
      ],
    }));

    const said: string[] = [];
    const store = filePolicies({ file, onProblem: (message) => said.push(message) });

    // One bad row does not lose the file's other rows.
    expect((await store.list()).map((one) => one.id)).toEqual(['A2', 'C1']);
    expect(said).toHaveLength(2);
    expect(said[0]).toContain('policy 2');
    expect(said[0]).toContain('scope');
    expect(said[1]).toContain('policy 3');
  });

  it('reports two rows under one id and keeps the first', async () => {
    const shared = { scope: 'user:alice', kind: 'computer', effect: 'allow', match: { computer: ['host'] } };
    writeFileSync(file, JSON.stringify({
      version: 1,
      policies: [
        { id: 'C1', ...shared },
        { id: 'C1', ...shared, effect: 'deny' },
      ],
    }));

    const said: string[] = [];
    const store = filePolicies({ file, onProblem: (message) => said.push(message) });

    // One id is one address, so the second body behind it is said and dropped.
    expect((await store.list()).map((one) => [one.id, one.effect])).toEqual([['C1', 'allow']]);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('C1');
  });

  it('says so about a file that is not JSON, and starts with no policies', async () => {
    writeFileSync(file, '{ not json');
    const said: string[] = [];
    const store = filePolicies({ file, onProblem: (message) => said.push(message) });

    expect(await store.list()).toEqual([]);
    expect(said[0]).toContain('not JSON');
  });

  it('leaves no half-written file behind beside the one it wrote', async () => {
    const store = filePolicies({ file });
    await store.put(rows()[0] as Policy);

    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false);
  });

  it('writes the file owner-only, because it names who may use what', async () => {
    const store = filePolicies({ file });
    await store.put(rows()[0] as Policy);

    // Readable by the account the daemon runs as and by nobody else on the
    // machine, which is what every other file the daemon keeps is.
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe('the memory store', () => {
  it('holds nothing on disk and nothing for the next store', async () => {
    const store = memoryPolicies();
    await store.put(rows()[0] as Policy);

    expect(existsSync(file)).toBe(false);
    // A second store is a second host: the rows are gone with the process.
    expect(await memoryPolicies().list()).toEqual([]);
  });
});