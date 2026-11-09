import { loggerOf } from '@ahpd/sdk';
import { describe, expect, it } from 'vitest';
import { createHost, foldHostOptions, memoryRecords, pluginHost } from '@ahpd/sdk';
import { echo } from '../../../examples/echo/agent.js';
import { apply, name } from '../src/plugin.js';
import type { LoaderContext, RecordCollection } from '@ahpd/sdk';
import type { PlanRecord, Stamp, TaskRecord, TaskStatus } from '../src/record.js';

/*
 * The open tasks a session's `_meta` counts.
 *
 * The plugin holds the count in a map because `_meta` is composed
 * synchronously, so what is checked here is the whole road: a record written
 * to the store is recounted, and the session's clients hear the new count as
 * `session/metaChanged` under the key the window reads.
 */

const STAMP: Stamp = { at: '2026-10-18T10:00:00.000Z', by: 'host', in: 'ahp-session:/one' };

const context = (): LoaderContext => ({
  path: '/tmp/tasks',
  paths: ['/tmp/tasks'],
  version: '0.12.0',
  hostName: 'tasks-test',
  configDir: '/tmp/tasks',
  log: loggerOf(() => {}),
  say: () => {},
});

const task = (id: string, title: string, status: TaskStatus, session?: string): TaskRecord => ({
  id,
  title,
  status,
  priority: 'medium',
  labels: [],
  blockedBy: [],
  refs: [],
  created: STAMP,
  ...(session === undefined ? {} : { session }),
});

const plan = (): PlanRecord => ({
  id: 'p1',
  scope: { kind: 'session', session: 'one' },
  title: 'Session one',
  goal: '',
  status: 'draft',
  refs: [],
  created: STAMP,
});

/** The messages the host sends one client, as it sends them. */
interface Sent {
  method: string;
  params: { channel?: string; action?: Record<string, unknown> };
}

/** A client with no socket, which keeps what it is told. */
const peer = () => {
  const notes: Sent[] = [];
  return {
    notes,
    send: (): void => {},
    notify: (method: string, params: unknown): void => { notes.push({ method, params: params as Sent['params'] }); },
    request: async (): Promise<unknown> => ({}),
    answered: (): void => {},
    close: (): void => {},
  };
};

/** Waits for `check`, turning the event loop, and throws after `ms`. */
const when = async (check: () => boolean, ms = 5000): Promise<void> => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
};

/** Turns the event loop enough times for the promises below to land. */
const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((resolve) => { setTimeout(resolve, 0); });
};

/*
 * A record written to the collection as the plugin reads it. The store knows
 * no plugin's shape, so the record is handed over as what it is: a plain
 * object with an id.
 */
const putTask = (tasks: RecordCollection, one: TaskRecord): Promise<void> => tasks.put({ ...one });
const putPlan = (plans: RecordCollection, one: PlanRecord): Promise<void> => plans.put({ ...one });

/** A host serving echo, with the tasks plugin folded in and its records held here. */
async function served(): Promise<{
  client: ReturnType<ReturnType<typeof createHost>['accept']>;
  notes: Sent[];
  host: ReturnType<typeof createHost>;
  tasks: RecordCollection;
  plans: RecordCollection;
}> {
  const records = memoryRecords();
  const { host: plugin, contribution, seal } = pluginHost(name, context(), {
    records: () => records,
    alert: () => {},
  });
  await apply(plugin, {});
  seal();
  const options = foldHostOptions({
    path: '/tmp/tasks',
    agents: [echo({ path: '/tmp/tasks', pace: 0 })],
    records,
  }, [contribution]).options;
  const host = createHost(options);
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { channel: 'ahp-root://', clientId: 'probe', protocolVersions: ['0.9.0'] },
  });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/one' } });
  // The first count is what the host starts from and is not announced, so
  // wait for it to be taken before anything is written: a count written now
  // would be folded into it and never said.
  await settle();
  return {
    client,
    notes: p.notes,
    host,
    tasks: await records.collection('tasks', { body: 'body' }),
    plans: await records.collection('plans', { body: 'goal' }),
  };
}

/** The counts the host said for `ahp-session:/one`, in order. */
const counts = (notes: Sent[]): unknown[] => notes
  .filter((one) => one.method === 'action' && one.params.channel === 'ahp-session:/one')
  .map((one) => one.params.action)
  .filter((one) => one?.type === 'session/metaChanged')
  .map((one) => (one?._meta as { 'ahpd.tasks'?: unknown } | undefined)?.['ahpd.tasks']);

/** The last count, as the map the key holds. */
const lastCount = (notes: Sent[]): { open?: number } | undefined => counts(notes).at(-1) as { open?: number } | undefined;

describe('the open tasks of a session', () => {
  it('counts the tasks of its plan that are not done or dropped', async () => {
    const { client, notes, host, tasks, plans } = await served();
    await putPlan(plans, plan());
    await putTask(tasks, task('t1', 'Read the file', 'todo', 'ahp-session:/one'));
    await putTask(tasks, task('t2', 'Write the answer', 'doing', 'ahp-session:/one'));
    await putTask(tasks, task('t3', 'Ship it', 'done', 'ahp-session:/one'));
    await putTask(tasks, task('t4', 'Never mind', 'dropped', 'ahp-session:/one'));

    await when(() => lastCount(notes)?.open === 2);
    // And on the session itself, which is what a client that subscribes reads.
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/one' } }) as {
      snapshot: { state: { _meta?: Record<string, unknown> } };
    }).snapshot.state;
    expect(state._meta?.['ahpd.tasks']).toEqual({ open: 2 });
    await host.close();
  });

  it('says a new count when a task is set to done', async () => {
    const { notes, host, tasks, plans } = await served();
    await putPlan(plans, plan());
    await putTask(tasks, task('t1', 'Read the file', 'todo', 'ahp-session:/one'));
    await putTask(tasks, task('t2', 'Write the answer', 'doing', 'ahp-session:/one'));
    await when(() => lastCount(notes)?.open === 2);

    await putTask(tasks, task('t2', 'Write the answer', 'done', 'ahp-session:/one'));
    await when(() => lastCount(notes)?.open === 1);
    expect(counts(notes).at(-1)).toEqual({ open: 1 });
    await host.close();
  });
});
