import { WAIT_MS } from '../../../tools/wait.ts';
import { loggerOf } from '@ahpd/sdk';
import { describe, expect, it } from 'vitest';
import { createHost, foldHostOptions, memoryRecords, pluginHost } from '@ahpd/sdk';
import { echo } from '../../../examples/echo/agent.js';
import { apply, name } from '../src/plugin.js';
import { taskStore } from '../src/store.js';
import { sessionPlanLines } from '../src/view.js';
import type { LoaderContext, RecordCollection } from '@ahpd/sdk';
import type { PlanRecord, Stamp, TaskRecord, TaskStatus } from '../src/record.js';
import type { TaskStore } from '../src/store.js';

/*
 * A session's plan, as the host draws it in a turn.
 *
 * The records are the one source: the plan names the session by id and a
 * translated task names it by channel, so both spellings have to find the same
 * tasks. What is asserted is the line a client reads, one per task.
 */

const STAMP: Stamp = { at: '2026-10-18T10:00:00.000Z', by: 'host', in: 'ahp-session:/one' };

const task = (id: string, title: string, status: TaskStatus): TaskRecord => ({
  id,
  title,
  status,
  priority: 'medium',
  labels: [],
  blockedBy: [],
  refs: [],
  created: STAMP,
});

const plan = (over: Partial<PlanRecord> = {}): PlanRecord => ({
  id: 'p1',
  scope: { kind: 'session', session: 'one' },
  title: 'Session one',
  goal: '',
  status: 'draft',
  refs: [],
  created: STAMP,
  ...over,
});

/** A store over fresh memory records. */
async function store(): Promise<TaskStore> {
  const records = memoryRecords();
  return taskStore(
    await records.collection('tasks', { body: 'body' }),
    await records.collection('plans', { body: 'goal' }),
    () => {},
  );
}

const context = (): LoaderContext => ({
  path: '/tmp/tasks',
  paths: ['/tmp/tasks'],
  version: '0.12.0',
  hostName: 'tasks-test',
  configDir: '/tmp/tasks',
  log: loggerOf(() => {}),
  say: () => {},
});

/** Waits for `check`, turning the event loop, and throws after `ms`. */
const when = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
};

/** A host with the tasks plugin folded in, and the sessions its reader is asked for. */
async function announced(): Promise<{
  drawn: string[];
  tasks: RecordCollection;
  plans: RecordCollection;
  host: ReturnType<typeof createHost>;
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
  /*
   * The host fills `changed` on the plan it was handed when it is built, and
   * the plugin reads it when it announces, so the wrapper is set after the
   * host exists and passes the call on to the host's own reader.
   */
  const served = options.plan;
  if (served === undefined) throw new Error('the tasks plugin drew no plan');
  const drawn: string[] = [];
  const inside = served.changed;
  served.changed = (uri) => {
    drawn.push(uri);
    return inside?.(uri) ?? Promise.resolve();
  };
  return {
    drawn,
    tasks: await records.collection('tasks', { body: 'body' }),
    plans: await records.collection('plans', { body: 'goal' }),
    host,
  };
}

describe('the lines of a session\'s plan', () => {
  it('gives one line per task, each with its status', async () => {
    const held = await store();
    await held.putPlan(plan());
    await held.putTask({ ...task('t1', 'Read the file', 'todo'), plan: 'p1', session: 'ahp-session:/one' });
    await held.putTask({ ...task('t2', 'Write the answer', 'doing'), plan: 'p1', session: 'ahp-session:/one' });
    await held.putTask({ ...task('t3', 'Ship it', 'done'), plan: 'p1', session: 'ahp-session:/one' });

    expect(await sessionPlanLines(held, 'ahp-session:/one')).toEqual([
      '- [ ] Read the file',
      '- [ ] Write the answer',
      '- [x] Ship it',
    ]);
  });

  it('counts a task of the plan that names the plan and no session', async () => {
    const held = await store();
    await held.putPlan(plan());
    await held.putTask({ ...task('t1', 'Read the file', 'todo'), plan: 'p1' });

    expect(await sessionPlanLines(held, 'ahp-session:/one')).toEqual(['- [ ] Read the file']);
  });

  it('leaves out a task of another session', async () => {
    const held = await store();
    await held.putPlan(plan());
    await held.putTask({ ...task('t1', 'Read the file', 'todo'), session: 'ahp-session:/two' });

    expect(await sessionPlanLines(held, 'ahp-session:/one')).toEqual([]);
  });
});

describe('announcing a redraw', () => {
  it('names a session-scoped plan\'s session for a task that does not', async () => {
    const { drawn, tasks, plans, host } = await announced();
    // A plan of the session is enough to name it, and the task added to it
    // after that carries no session of its own.
    await plans.put({ ...plan() });
    await when(() => drawn.includes('ahp-session:/one'));
    drawn.length = 0;
    await tasks.put({ ...task('t1', 'Read the file', 'todo'), plan: 'p1' });

    await when(() => drawn.includes('ahp-session:/one'));
    expect(drawn).toEqual(['ahp-session:/one']);
    await host.close();
  });
});
