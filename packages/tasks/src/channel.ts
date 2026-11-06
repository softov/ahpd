import { idOf, RpcError } from '@ahpd/sdk';
import type { ChannelHandle, PluginChannel, RecordChange } from '@ahpd/sdk';
import type { PlanRecord, TaskRecord } from './record.js';
import type { TaskStore } from './store.js';

/**
 * The plan a client subscribes to.
 *
 * One plan is one channel URI, `x-ahpd-plans://<plan id>`, and its state is
 * the plan record and the tasks that name it. A client subscribes and is
 * answered with that state; what happens after is one action per change, so a
 * window draws the plan once and moves with it rather than reading the list
 * again.
 *
 * The records are the one source: an action carries the record as the store
 * reads it, and nothing here writes one back. A removed task has no record left
 * to send, so its removal is said with the task's id alone - and the plan it
 * was on is one read before the removal, because the record is already gone by
 * the time the change is heard.
 */

/** The scheme the plan channel is served under. */
export const PLAN_SCHEME = 'x-ahpd-plans';

/** The channel URI of one plan. */
export const planUri = (id: string): string => `${PLAN_SCHEME}://${id}`;

/** What a subscriber is answered with: the plan and the tasks that name it. */
export interface PlanState {
  /** The plan record, as the store reads it. */
  plan: PlanRecord;
  /** Every task whose `plan` is this plan, by id. */
  tasks: TaskRecord[];
}

/** The plan channel and the two calls a record change goes through. */
export interface PlanChannel {
  /** What `registerChannel` takes. */
  channel: PluginChannel;
  /** The handle `registerChannel` answered, which every publish goes through. */
  bind(handle: ChannelHandle): void;
  /** A task was added, changed or removed: publish it to the plan it names. */
  taskMoved(change: RecordChange): Promise<void>;
  /** A plan changed: publish it to its own channel. */
  planMoved(change: RecordChange): Promise<void>;
}

export function planChannel(store: TaskStore): PlanChannel {
  let handle: ChannelHandle | undefined;
  /*
   * The plan each task was last seen on.
   *
   * A removal carries the task's id and nothing else, and the record is gone
   * from the store by the time a watcher hears of it - so the channel a
   * removal is published on is read here, from the task as it stood. A task
   * whose plan changed is read against it the same way, since its record
   * names the plan it joined. The tasks already in the store fill the
   * map when this is made, and each change after that moves it on. A task
   * removed before it was ever read has no entry: no subscriber can hold it
   * either, since a subscribe reads the store as it then stands.
   */
  const homes = new Map<string, string>();
  void store.tasks().then((tasks) => {
    for (const task of tasks) {
      if (task.plan !== undefined) homes.set(task.id, task.plan);
    }
  }, () => undefined);

  const channel: PluginChannel = {
    /*
     * Every built-in role holds `session:read`: a plan is what the sessions of
     * a host are doing, and a person who may read a session may read the plan
     * it works on.
     */
    grant: 'session:read',
    describe: () => ({ title: 'Plan', description: 'One plan and the tasks that name it, kept current.' }),
    snapshot: async (uri) => {
      const plan = await store.plan(idOf(uri));
      // A URI under the scheme and no plan behind it is not a channel: the id
      // is the plan's own, and a subscriber that asked for one that is gone is
      // told, in the code and words VS Code's host refuses a subscribe it has
      // no state for with:
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2199
      if (plan === undefined) throw new RpcError(-32001, `Resource not found: ${uri}`);
      return { plan, tasks: await store.tasksOf(plan.id) } satisfies PlanState;
    },
  };

  return {
    channel,

    bind: (given) => { handle = given; },

    /*
     * The record is read back rather than taken from the change, which
     * carries an id and what happened and not the record: a subscriber is
     * sent the task as the store holds it, which is what a client draws.
     *
     * A removal is the one change with nothing to read back, so it is said as
     * the id it was and drawn on the channel of the plan it was last on. A
     * task that leaves a plan, for another or for none, is said removed on the
     * plan it left and added on the one it joined, as the protocol says a chat
     * that moves between sessions on both catalogs:
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L225-L226
     */
    taskMoved: async (change) => {
      const was = homes.get(change.id);
      if (change.type === 'deleted') {
        homes.delete(change.id);
        if (was === undefined) return;
        handle?.publish(planUri(was), { type: `${PLAN_SCHEME}/taskRemoved`, taskId: change.id });
        return;
      }
      const task = await store.task(change.id);
      if (task === undefined) return;
      if (was !== undefined && was !== task.plan) {
        handle?.publish(planUri(was), { type: `${PLAN_SCHEME}/taskRemoved`, taskId: change.id });
      }
      if (task.plan === undefined) {
        homes.delete(change.id);
        return;
      }
      homes.set(change.id, task.plan);
      const joined = change.type === 'added' || was !== task.plan;
      handle?.publish(planUri(task.plan), { type: joined ? `${PLAN_SCHEME}/taskAdded` : `${PLAN_SCHEME}/taskSet`, task });
    },

    planMoved: async (change) => {
      const plan = await store.plan(change.id);
      if (plan === undefined) return;
      handle?.publish(planUri(plan.id), { type: `${PLAN_SCHEME}/set`, plan });
    },
  };
}
