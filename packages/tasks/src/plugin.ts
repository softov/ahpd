import { idOf, reason, uriFor } from '@ahpd/sdk';
import { approveTools } from './approve.js';
import { planChannel, PLAN_SCHEME } from './channel.js';
import { planTools } from './plans.js';
import { taskStore } from './store.js';
import { taskTools } from './tasks.js';
import { writePlanList } from './translate.js';
import { sessionPlanLines } from './view.js';
import type { Plugin } from '@ahpd/sdk';

/**
 * The package as a plugin: one list of tasks and plans for every agent.
 *
 * A task and a plan are records of the host's record store, so every session
 * that is offered a host tool reads and writes the same list. A task names its
 * plan, and a plan belongs to a folder or a bot and outlives the session that
 * made it.
 *
 * Two settings change how the list lives. `requireApproval` keeps an agent
 * from starting a task nobody approved, and `sweepAfterDays` lets a finished
 * plan and the tasks that name it go after a while. Both are off by default: a
 * host that says nothing keeps every task, and an agent starts one when it is
 * ready.
 */

/** The plugin's id, unique among the plugins a daemon loads. */
export const name = 'tasks';

/** What a listing prints. */
export const title = 'Tasks';

/** What an option falls back to. */
export const defaults = {
  requireApproval: false,
} as const;

/** The two settings `apply` reads. */
export interface TaskSettings {
  /** Whether a task needs an `approved` stamp before it may start. */
  requireApproval: boolean;
  /** How many days a finished plan is kept. Absent keeps it forever. */
  sweepAfterDays?: number;
}

/**
 * The settings as `apply` reads them, with a value of the wrong kind reported.
 *
 * The schema checks the kinds of the options the daemon applies, and this
 * checks them again because a host built by hand in a test or in an embedding
 * does not run the schema. A value that is not the kind the setting wants is
 * reported and the setting's default stands, so a typo costs the setting and
 * not the list.
 */
export function settingsOf(options: Record<string, unknown>, problem: (line: string) => void): TaskSettings {
  const askedApproval = options.requireApproval;
  if (askedApproval !== undefined && typeof askedApproval !== 'boolean') {
    problem(`${name}: requireApproval is ${JSON.stringify(askedApproval)}, which is not true or false; using false`);
  }
  const askedSweep = options.sweepAfterDays;
  const integer = typeof askedSweep === 'number' && Number.isInteger(askedSweep) && askedSweep >= 1;
  if (askedSweep !== undefined && !integer) {
    problem(`${name}: sweepAfterDays is ${JSON.stringify(askedSweep)}, which is not a whole number of days; keeping finished plans forever`);
  }
  return {
    requireApproval: typeof askedApproval === 'boolean' ? askedApproval : defaults.requireApproval,
    ...(integer ? { sweepAfterDays: askedSweep } : {}),
  };
}

/** How often a finished plan is looked at, when the sweep is on. */
const SWEEP_MS = 60 * 60 * 1000;

export const apply: Plugin['apply'] = (host, options) => {
  const settings = settingsOf(options, (line) => { host.problem(line); });
  /*
   * The two collections the list lives in, each with its long text as the
   * record's body: `body` for a task and `goal` for a plan. The store checks
   * every record on the way in and out, so a record a person edited by hand
   * cannot reach a tool as one it is not.
   */
  const taskRecords = host.records('tasks', { body: 'body' });
  const planRecords = host.records('plans', { body: 'goal' });
  const store = taskStore(
    taskRecords,
    planRecords,
    (line) => { host.problem(`${name}: ${line}`); },
    settings.sweepAfterDays === undefined ? undefined : { sweepAfterDays: settings.sweepAfterDays },
  );
  /*
   * One call at a time, the sweep among them. A new id is one past the highest
   * there is and an edit reads the record before it writes it, so two calls at
   * once would give two tasks one id or lose one of two edits.
   */
  let last: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
    const next = last.then(work, work);
    last = next.catch(() => undefined);
    return next;
  };
  /*
   * The tools every session is offered. A host tool is the one road into the
   * list an agent inside a session cannot take for itself: the plugin holds the
   * store, and the model holds the tool.
   */
  const tools = [
    ...planTools(store),
    ...taskTools(store, { requireApproval: settings.requireApproval }),
    ...approveTools(store),
  ];
  for (const tool of tools) {
    host.registerTool({ ...tool, run: (input, at) => oneAtATime(async () => tool.run(input, at)) });
  }
  /*
   * A harness's own list, brought by its backend. It writes the session's plan
   * one update at a time with the tool calls, because it reads a record before
   * it writes it like they do.
   *
   * The handler settles only once the host has drawn the row, which is what
   * lets the host hold the turn end back for it: the update is in flight from
   * the backend's `planUpdate` until this promise settles. The watch below is
   * left out while a translation writes, because this handler names the
   * session from the update itself and waits for the draw, where the watch can
   * only read the sessions back off the records.
   */
  let translating = false;
  host.on('plan_update', (event) => oneAtATime(async () => {
    translating = true;
    try {
      await writePlanList(store, event);
    }
    finally {
      translating = false;
    }
    /*
     * Awaited so the event settles only once the row is drawn. An update that
     * arrives before a host is built has nothing to redraw, and that refusal is
     * written down rather than raised at the backend that sent the list.
     */
    try {
      await host.planChanged(event.session);
    }
    catch (error: unknown) {
      host.log(`${name}: the Plan call of ${event.session} was not redrawn: ${reason(error)}`);
    }
  }));
  /*
   * The lines of a session's plan, which the host draws as the turn's one Plan
   * call. A turn that changes the plan gets the call, and every later turn
   * reads the list as it then stands.
   */
  host.registerPlan((uri) => sessionPlanLines(store, uri));
  /*
   * The count of open tasks a session's `_meta` carries, by session id.
   *
   * Held here rather than read from the store because `_meta` is composed
   * synchronously and the records are read through a promise: the map is what
   * the last recount found, refreshed after every change to either collection.
   * A session no record mentions has no entry, which leaves the key out of its
   * `_meta` rather than saying a list that does not hold it has nothing open.
   */
  const openCounts = new Map<string, number>();
  /** The URI each counted session was named by, so a change can name it. */
  const sessionUris = new Map<string, string>();
  host.registerSessionMeta('ahpd.tasks', (uri) => {
    const open = openCounts.get(idOf(uri));
    return open === undefined ? undefined : { open };
  });
  /**
   * Recount the open tasks of every session the list mentions, and say what
   * moved.
   *
   * A task is open unless it is `done` or `dropped`. The sessions a task
   * belongs to are the one its `session` names and the one whose plan it names:
   * a translated task carries both, and either one is enough for a task
   * written another way. The first count is what a host starts from and is
   * not a change; every count after it that differs is announced for the URI
   * that named the session, live spelling first.
   */
  let counted = false;
  const recount = (): Promise<void> => oneAtATime(async () => {
    const tasks = await store.tasks();
    const plans = await store.plans();
    const sessionOfPlan = new Map<string, string>();
    for (const plan of plans) {
      if (plan.scope.kind === 'session') sessionOfPlan.set(plan.id, idOf(plan.scope.session));
    }
    const uris = new Map<string, string>();
    for (const task of tasks) {
      if (task.session !== undefined && task.session !== '') uris.set(idOf(task.session), task.session);
    }
    for (const id of sessionOfPlan.values()) {
      if (!uris.has(id)) uris.set(id, uriFor(id));
    }
    const counts = new Map<string, number>();
    for (const id of uris.keys()) counts.set(id, 0);
    for (const task of tasks) {
      if (task.status === 'done' || task.status === 'dropped') continue;
      const named = new Set<string>();
      if (task.session !== undefined && task.session !== '') named.add(idOf(task.session));
      const byPlan = task.plan === undefined ? undefined : sessionOfPlan.get(task.plan);
      if (byPlan !== undefined) named.add(byPlan);
      for (const id of named) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const moved: string[] = [];
    for (const [id, count] of counts) {
      if (openCounts.get(id) !== count) moved.push(id);
    }
    for (const id of openCounts.keys()) {
      if (!counts.has(id)) moved.push(id);
    }
    const before = new Map(sessionUris);
    openCounts.clear();
    for (const [id, count] of counts) openCounts.set(id, count);
    sessionUris.clear();
    for (const [id, uri] of uris) sessionUris.set(id, uri);
    if (!counted) {
      counted = true;
      return;
    }
    for (const id of moved) {
      const uri = uris.get(id) ?? before.get(id);
      if (uri !== undefined) host.sessionMetaChanged(uri);
    }
  });
  const countMoved = (): void => {
    void recount().catch((error: unknown) => {
      host.log(`${name}: the open tasks of a session were not counted: ${reason(error)}`);
    });
  };
  countMoved();
  taskRecords.watch(countMoved);
  planRecords.watch(countMoved);
  /*
   * One plan as a channel a client subscribes to: the plan record and the
   * tasks that name it as the state, then one action for each change to
   * either. A change is read back through the store, so it goes through the
   * same one-at-a-time queue as the write that made it and the action carries
   * the record as the store holds it.
   */
  const planOnChannel = planChannel(store);
  planOnChannel.bind(host.registerChannel(PLAN_SCHEME, planOnChannel.channel));
  const channelMoved = (publish: () => Promise<void>, what: string): void => {
    void oneAtATime(publish).catch((error: unknown) => {
      host.log(`${name}: ${what} was not published: ${reason(error)}`);
    });
  };
  taskRecords.watch((change) => {
    channelMoved(() => planOnChannel.taskMoved(change), `the change to task ${change.id}`);
  });
  planRecords.watch((change) => {
    channelMoved(() => planOnChannel.planMoved(change), `the change to plan ${change.id}`);
  });
  /*
   * Either collection moving may move a session's lines, so both watches
   * announce it. The sessions are the ones a task names, and the one a
   * session-scoped plan belongs to whether or not a task names it: a task
   * added to such a plan without a `session` field is still on that session's
   * list. A translation writes its own announcement and is skipped here. An
   * announcement before a host is built has nothing to redraw and is only
   * written down.
   */
  const planMoved = (): void => {
    if (translating) return;
    void (async () => {
      const tasks = await store.tasks();
      const plans = await store.plans();
      const sessions = new Set<string>();
      for (const task of tasks) {
        if (task.session !== undefined && task.session !== '') sessions.add(task.session);
      }
      for (const plan of plans) {
        if (plan.scope.kind === 'session' && plan.scope.session !== '') sessions.add(uriFor(idOf(plan.scope.session)));
      }
      for (const uri of sessions) await host.planChanged(uri);
    })().catch((error: unknown) => {
      host.log(`${name}: the Plan call was not redrawn: ${reason(error)}`);
    });
  };
  taskRecords.watch(planMoved);
  planRecords.watch(planMoved);
  /*
   * A finished plan is held for the days the setting names, and looked at once
   * when the plugin is applied and then every hour. The timer is unref'd, so a
   * daemon with nothing else to do is not kept up by it, and it is cleared when
   * the daemon stops. A pass that fails is something that went wrong in the
   * daemon, so it goes to the log, as VS Code's lifecycle pass logs its own:
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionLifecycle.ts#L102
   */
  if (settings.sweepAfterDays !== undefined) {
    const look = (): void => {
      void oneAtATime(() => store.sweep()).catch((error: unknown) => {
        host.log(`${name}: the sweep did not finish: ${reason(error)}`);
      });
    };
    let sweeping: ReturnType<typeof setInterval> | undefined = setInterval(look, SWEEP_MS);
    (sweeping as { unref?: () => void }).unref?.();
    look();
    host.on('stopping', () => {
      if (sweeping !== undefined) clearInterval(sweeping);
      sweeping = undefined;
    });
  }
};
