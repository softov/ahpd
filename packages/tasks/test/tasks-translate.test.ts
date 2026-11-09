import { loggerOf } from '@ahpd/sdk';
import { describe, expect, it } from 'vitest';
import { memoryRecords, pluginHost, raise } from '@ahpd/sdk';
import { apply, name } from '../src/plugin.js';
import { taskStore } from '../src/store.js';
import type { HarnessPlanChange, HarnessPlanEntry, LoaderContext, PlanUpdateEvent } from '@ahpd/sdk';

/*
 * A harness's list, heard by the plugin and written into the session's plan.
 *
 * The plugin is folded into a host as the daemon folds it, and the event is
 * raised the way the host raises it, so a handler that throws is reported
 * against the plugin and the test reads the records the handler wrote.
 */

const context = (): LoaderContext => ({
  path: '/tmp/tasks',
  paths: ['/tmp/tasks'],
  version: '0.12.0',
  hostName: 'tasks-test',
  configDir: '/tmp/tasks',
  log: loggerOf(() => {}),
  say: () => {},
});

/** The event a fake backend raises, before it is made a list or a change. */
const EVENT = {
  type: 'plan_update' as const,
  session: 'claude:/one',
  chat: 'claude-chat:/one',
  turn: 't1',
  harness: 'claude',
  tool: 'TodoWrite',
  sender: 'user:ana' as const,
};

/** A whole list from `tool`, in `turn`, carrying the session's title where it has one. */
const listing = (
  entries: HarnessPlanEntry[],
  over: { title?: string; turn?: string } = {},
): PlanUpdateEvent => ({
  ...EVENT,
  ...(over.title === undefined ? {} : { title: over.title }),
  ...(over.turn === undefined ? {} : { turn: over.turn }),
  entries,
});

/** One change from `tool`, in `turn`, carrying the session's title where it has one. */
const changing = (
  change: HarnessPlanChange,
  over: { title?: string; turn?: string; tool?: string } = {},
): PlanUpdateEvent => ({
  ...EVENT,
  tool: over.tool ?? 'TaskUpdate',
  ...(over.title === undefined ? {} : { title: over.title }),
  ...(over.turn === undefined ? {} : { turn: over.turn }),
  change,
});

/** The plugin applied over fresh records, the events it hears and the store it writes. */
async function served() {
  const records = memoryRecords();
  const problems: string[] = [];
  const { host, contribution, seal } = pluginHost(name, context(), {
    records: () => records,
    alert: (alert) => { problems.push(alert.text); },
  });
  await apply(host, {});
  seal();
  const heard = async (event: PlanUpdateEvent): Promise<void> => {
    await raise(contribution.events, event, (line) => { problems.push(line); });
  };
  const store = taskStore(
    await records.collection('tasks', { body: 'body' }),
    await records.collection('plans', { body: 'goal' }),
    (line) => { problems.push(line); },
  );
  return { problems, heard, store };
}

describe('a harness list in the session plan', () => {
  it('makes the plan on the first list, with the event title and an empty goal', async () => {
    const { heard, store, problems } = await served();
    await heard(listing([
      { text: 'Read the plan', status: 'pending' },
      { text: 'Write it', status: 'in_progress', priority: 'high' },
    ], { title: 'Plan it' }));

    const plans = await store.plans();
    expect(plans).toHaveLength(1);
    expect(plans[0]?.title).toBe('Plan it');
    expect(plans[0]?.goal).toBe('');
    expect(plans[0]?.scope).toEqual({ kind: 'session', session: 'one' });
    expect(plans[0]?.created).toMatchObject({ by: 'user:ana', in: 'claude:/one' });

    const tasks = await store.tasks();
    expect(tasks.map((one) => [one.title, one.status, one.priority])).toEqual([
      ['Read the plan', 'todo', 'medium'],
      ['Write it', 'doing', 'high'],
    ]);
    expect(tasks.every((one) => one.plan === plans[0]?.id)).toBe(true);
    expect(tasks[0]?.source).toEqual({ tool: 'TodoWrite' });
    expect(tasks[1]?.started).toMatchObject({ by: 'user:ana', in: 'claude:/one' });
    expect(problems).toEqual([]);
  });

  it('writes the same plan on a second turn', async () => {
    const { heard, store } = await served();
    await heard(listing([{ text: 'Read the plan', status: 'pending' }], { title: 'Plan it' }));
    const first = (await store.plans())[0]?.id;
    await heard(listing([
      { text: 'Read the plan', status: 'completed' },
      { text: 'Write it', status: 'pending' },
    ], { turn: 't2' }));

    expect((await store.plans()).map((one) => one.id)).toEqual([first]);
    expect((await store.tasks()).map((one) => [one.title, one.status])).toEqual([
      ['Read the plan', 'done'],
      ['Write it', 'todo'],
    ]);
  });

  it('calls the plan Session <id> until the session has a title, then renames it', async () => {
    const { heard, store } = await served();
    await heard(listing([{ text: 'Read the plan', status: 'pending' }]));
    expect((await store.plans())[0]?.title).toBe('Session one');

    await heard(listing([{ text: 'Read the plan', status: 'pending' }], { title: 'Plan it', turn: 't2' }));
    expect((await store.plans())[0]?.title).toBe('Plan it');
  });

  it('drops a step the next list does not hold, and keeps its record', async () => {
    const { heard, store } = await served();
    await heard(listing([
      { text: 'Read the plan', status: 'pending' },
      { text: 'Write it', status: 'pending' },
    ]));
    await heard(listing([{ text: 'Read the plan', status: 'in_progress' }], { turn: 't2' }));

    const tasks = await store.tasks();
    expect(tasks.map((one) => [one.title, one.status])).toEqual([
      ['Read the plan', 'doing'],
      ['Write it', 'dropped'],
    ]);
    expect(tasks[1]?.finished).toMatchObject({ by: 'user:ana', in: 'claude:/one' });
  });

  it('drops nothing when an empty list follows every step done', async () => {
    const { heard, store } = await served();
    await heard(listing([
      { text: 'Read the plan', status: 'completed' },
      { text: 'Write it', status: 'completed' },
    ]));
    await heard(listing([], { turn: 't2' }));

    expect((await store.tasks()).map((one) => one.status)).toEqual(['done', 'done']);
  });

  it('finds a single change by the harness id, and keeps the id in source', async () => {
    const { heard, store } = await served();
    await heard(changing({ id: '3', text: 'Ship it' }, { tool: 'TaskCreate' }));

    let tasks = await store.tasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe('Ship it');
    expect(tasks[0]?.status).toBe('todo');
    expect(tasks[0]?.source).toEqual({ tool: 'TaskCreate', id: '3' });

    await heard(changing({ id: '3', status: 'completed' }, { tool: 'TaskUpdate', turn: 't2' }));
    tasks = await store.tasks();
    expect(tasks[0]?.title).toBe('Ship it');
    expect(tasks[0]?.status).toBe('done');
    expect(tasks[0]?.source).toEqual({ tool: 'TaskCreate', id: '3' });
    expect(tasks[0]?.finished).toMatchObject({ by: 'user:ana', in: 'claude:/one' });
  });
});
