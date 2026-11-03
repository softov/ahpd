import { expect, it } from 'vitest';
import { invokeOperation, OPERATION_GRANT } from '../src/kinds/operations.js';
import type { OperationChannel } from '../src/kinds/operations.js';
import type { Operation } from '../src/types/kinds.js';
import type { Principal } from '../src/types/users.js';

/*
 * The one command over a fake channel that offers two operations.
 *
 * The channel lists one operation on the list, whose input is a schema with a
 * required whole number, and one on a tunnel with a grant of its own. Nothing
 * here is a tunnel: the command is the shared core, and the fake channel is
 * what a computers channel will look like too.
 */

const URI = 'x-ahpd-fake://';

type Bag = Record<string, any>;

/** The subset of JSON Schema the fake operation uses: a type and the required fields. */
const check = (value: unknown, schema: Bag, label: string): void => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const given = value as Bag;
  const properties = (schema['properties'] ?? {}) as Bag;
  for (const name of (schema['required'] ?? []) as string[]) {
    if (given[name] === undefined) throw new Error(`${label}.${name} is required`);
  }
  for (const [name, one] of Object.entries(properties) as [string, Bag][]) {
    if (given[name] === undefined) continue;
    if (one['type'] === 'integer' && !Number.isInteger(given[name])) throw new Error(`${label}.${name} must be a whole number`);
  }
};

/** A caller holding exactly these grants. */
const holding = (grants: string[]): Principal => ({
  id: 'ana', roles: [], can: (grant: string) => grants.includes(grant),
});

/** One call the command made on the channel it was given. */
interface Call {
  id: string;
  target?: string;
  input?: Bag;
}

/** A channel that lists two operations, and keeps what the command did. */
function fake(fail?: string) {
  const began: Call[] = [];
  const settled: { id: string; target?: string; error?: string }[] = [];
  const ran: Call[] = [];
  const statuses = new Map<string, { status: Operation['status']; error?: string }>();
  const base: Operation[] = [
    {
      id: 'fake/create',
      kind: 'fake',
      label: 'Fake',
      scopes: ['list'],
      grant: 'tunnel:put',
      status: 'idle',
      input: { type: 'object', properties: { port: { type: 'integer' } }, required: ['port'] },
    },
    { id: 'fake/restart', kind: 'fake', label: 'Restart', scopes: ['tunnel'], grant: 'tunnel:restart', status: 'idle' },
    { id: 'fake/drop', kind: 'fake', label: 'Drop', scopes: ['client'], grant: 'client:drop', status: 'idle' },
  ];
  const channel: OperationChannel = {
    uri: URI,
    operations: () => base.map((one) => ({ ...one, ...(statuses.get(one.id) ?? { status: one.status }) })),
    begin: (id, target) => {
      began.push({ id, ...(target === undefined ? {} : { target }) });
      statuses.set(id, { status: 'running' });
    },
    settle: (id, target, error) => {
      settled.push({ id, ...(target === undefined ? {} : { target }), ...(error === undefined ? {} : { error }) });
      statuses.set(id, error === undefined ? { status: 'idle' } : { status: 'error', error });
    },
    run: async (operation, target, input) => {
      ran.push({ id: operation.id, ...(target === undefined ? {} : { target }), ...(input === undefined ? {} : { input }) });
      if (fail !== undefined) throw new Error(fail);
      return { done: operation.id };
    },
  };
  const problems: string[] = [];
  const method = invokeOperation({ channels: () => ({ [URI]: channel }), check, onProblem: (line) => { problems.push(line); } });
  return { channel, method, began, settled, ran, problems };
}

/** One call as a client sends it, with `target` named as an id. */
const call = (one: ReturnType<typeof fake>, operationId: string, params: Bag = {}) =>
  one.method.handle({ channel: URI, operationId, ...params }, undefined, 'c1');

it('runs an operation the channel lists now, from running to idle', async () => {
  const one = fake();
  expect(await call(one, 'fake/create', { input: { port: 8080 } })).toEqual({ done: 'fake/create' });

  expect(one.began).toEqual([{ id: 'fake/create' }]);
  expect(one.ran).toEqual([{ id: 'fake/create', input: { port: 8080 } }]);
  expect(one.settled).toEqual([{ id: 'fake/create' }]);
  expect(one.channel.operations()[0]).toMatchObject({ status: 'idle' });
});

it('refuses an operation the channel does not list now', async () => {
  const one = fake();
  await expect(call(one, 'fake/gone')).rejects.toThrow('No operation called fake/gone');
  expect(one.began).toEqual([]);
});

it('refuses a target on an operation that runs on the list', async () => {
  const one = fake();
  await expect(call(one, 'fake/create', { input: { port: 8080 }, target: { id: 't1' } }))
    .rejects.toThrow('runs on the list, so it takes no target');
  expect(one.ran).toEqual([]);
});

it('refuses an operation on one tunnel with no target, and runs one with an id', async () => {
  const one = fake();
  await expect(call(one, 'fake/restart')).rejects.toThrow('runs on one tunnel, so it needs target.id');

  expect(await call(one, 'fake/restart', { target: { id: 't1' } })).toEqual({ done: 'fake/restart' });
  expect(one.ran).toEqual([{ id: 'fake/restart', target: 't1' }]);
  expect(one.channel.operations()[1]).toMatchObject({ status: 'idle' });
});

it('names the scope of an operation that runs on one record, client included', async () => {
  const one = fake();
  await expect(call(one, 'fake/drop')).rejects.toThrow('runs on one client, so it needs target.id');
  expect(await call(one, 'fake/drop', { target: { id: '7' } })).toEqual({ done: 'fake/drop' });
  expect(one.ran).toEqual([{ id: 'fake/drop', target: '7' }]);
});

it('refuses an input its schema refuses', async () => {
  const one = fake();
  await expect(call(one, 'fake/create', { input: { port: 'eighty' } }))
    .rejects.toThrow('fake/create\'s input.port must be a whole number');
  expect(one.ran).toEqual([]);
});

it('refuses a caller without the operation\'s grant, and admits one with it', async () => {
  const one = fake();
  const params = { channel: URI, operationId: 'fake/restart'};
  expect(await one.method.authorize?.(params, holding([OPERATION_GRANT]))).toBe(false);
  expect(await one.method.authorize?.(params, holding(['tunnel:restart']))).toBe(true);
  // The command's own grant admits every operation the channel lists.
  expect(one.method.grant).toBe(OPERATION_GRANT);
});

it('refuses a caller with only the command\'s grant, in the handler as well', async () => {
  const one = fake();
  const params = { channel: URI, operationId: 'fake/restart', target: { id: 't1' } };
  await expect(Promise.resolve(one.method.handle(params, holding([OPERATION_GRANT]), 'c1')))
    .rejects.toMatchObject({ code: -32009, message: 'ana may not tunnel:restart here' });
  expect(one.began).toEqual([]);
  expect(one.ran).toEqual([]);

  expect(await one.method.handle(params, holding(['tunnel:restart']), 'c1')).toEqual({ done: 'fake/restart' });
  expect(one.ran).toEqual([{ id: 'fake/restart', target: 't1' }]);
});

it('sets the operation to error with its message when the work throws', async () => {
  const one = fake('the port is taken');
  await expect(call(one, 'fake/create', { input: { port: 8080 } })).rejects.toThrow('the port is taken');

  expect(one.channel.operations()[0]).toMatchObject({ status: 'error', error: 'the port is taken' });
  expect(one.settled).toEqual([{ id: 'fake/create', error: 'the port is taken' }]);
  expect(one.problems).toEqual([`fake/create on ${URI} failed: the port is taken`]);
});
