import { RpcError } from '@ahpd/sdk';
import { DEFAULT_PRIORITY, isPriority, isTaskStatus, PRIORITIES, TASK_STATUSES, taskLine } from './record.js';
import { stampOf } from './stamp.js';
import type { Stamp, TaskPriority, TaskRecord } from './record.js';
import type { TaskStore } from './store.js';
import type { HostTool } from '@ahpd/sdk';

/**
 * The three tools a model keeps tasks with.
 *
 * `task_add` makes a task in `todo`, `task_set` changes it by id, and
 * `task_list` answers the list. The host writes the stamps: `created` when the
 * task is made, `started` at the first `doing`, and `finished` once at the
 * first `review`, `done` or `dropped`, so a task reopened and finished again
 * keeps the moment it first was.
 *
 * With approval on, a task nobody approved cannot start. The refusal is the
 * tool's own words rather than the grant's: any session may change any task
 * for now, and what the setting asks is that a person said yes first.
 *
 * None of the three asks a grant. Every user of the host sees and may change
 * every task for now, and the stamps say who did what.
 */

/** The protocol's code for a body this host will not take. */
const INVALID_PARAMS = -32602;

/** The values one field may take, said as VS Code's server tools say them: "high, medium, or low". */
const oneOf = new Intl.ListFormat('en', { type: 'disjunction' });

/** What the task tools read besides the store. */
export interface TaskToolsOptions {
  /** Whether a task needs an `approved` stamp before it may start. */
  requireApproval: boolean;
}

/**
 * A tool's refusal of its input, in the words VS Code's server tools refuse
 * theirs with: the tool, the field, and what it must be.
 *
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L649-L671
 */
const invalidInput = (tool: string, message: string): RpcError => new RpcError(INVALID_PARAMS, `Invalid ${tool} input: ${message}`);

/** A line of input, trimmed, where the input says one. */
const textOf = (tool: string, input: Record<string, unknown>, key: string): string | undefined => {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') throw invalidInput(tool, `${key} must be a non-empty string.`);
  return value.trim();
};

/** A list of text from the input, where the input says one. */
const listOf = (tool: string, input: Record<string, unknown>, key: string): string[] | undefined => {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((one) => typeof one !== 'string')) {
    throw invalidInput(tool, `${key} must be a string array.`);
  }
  return value;
};

/** The five stamps of a task, in the order they are written. */
const stampsOf = (task: TaskRecord): Stamp[] =>
  [task.created, task.approved, task.started, task.finished, task.reviewed]
    .filter((one): one is Stamp => one !== undefined);

/** Whether a stamp names `person`, with or without the owner's prefix. */
const names = (stamp: Stamp, person: string): boolean =>
  stamp.by === person || stamp.by === `user:${person}`;

/** The three task tools, over one store and one approval setting. */
export function taskTools(store: TaskStore, options: TaskToolsOptions): HostTool[] {
  /** The tasks an input names in `blockedBy`, each one that is there. */
  const checkBlockers = async (tool: string, ids: string[]): Promise<void> => {
    for (const id of ids) {
      if (await store.task(id) === undefined) throw invalidInput(tool, 'blockedBy must match the ids of known tasks (see task_list).');
    }
  };

  /** The plan an input names, where it names one that is there. */
  const checkPlan = async (tool: string, id: string | undefined): Promise<void> => {
    if (id !== undefined && await store.plan(id) === undefined) {
      throw invalidInput(tool, 'plan must match the id of a known plan (see plan_list).');
    }
  };

  /** Whether a task is ready: `todo`, every blocker `done`, and approved where approval is on. */
  const ready = (task: TaskRecord, all: Map<string, TaskRecord>): boolean =>
    task.status === 'todo'
    && task.blockedBy.every((id) => all.get(id)?.status === 'done')
    && (!options.requireApproval || task.approved !== undefined);

  return [
    {
      definition: {
        name: 'task_add',
        title: 'Add Task',
        description: 'Add a task, in todo. It may name a plan, a bot and the tasks that block it. Answer: its id, status, priority and title.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'What the task is, in one line.' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How urgent it is. Default medium.' },
            labels: { type: 'array', items: { type: 'string' }, description: 'Words a client groups tasks by.' },
            topic: { type: 'string', description: 'What the task is about.' },
            plan: { type: 'string', description: 'The plan it belongs to, by plan id as p1.' },
            bot: { type: 'string', description: 'The bot it belongs to, by slug.' },
            folder: { type: 'string', description: 'The folder it was made in.' },
            session: { type: 'string', description: 'The session it was made in. Default: this call\'s session.' },
            blockedBy: { type: 'array', items: { type: 'string' }, description: 'Task ids that must be done first.' },
            active: { type: 'string', description: 'What is being done right now, in one line.' },
            note: { type: 'string', description: 'One line about where the task stands.' },
            refs: { type: 'array', items: { type: 'string' }, description: 'Links and references the task needs.' },
            body: { type: 'string', description: 'The long text of the task, in Markdown.' },
          },
          required: ['title'],
        },
        annotations: { title: 'Add Task', readOnlyHint: false, destructiveHint: false },
      },
      run: async (input, at) => {
        const tool = 'task_add';
        const title = textOf(tool, input, 'title');
        if (title === undefined) throw invalidInput(tool, 'title is required.');
        const askedPriority = input.priority;
        if (askedPriority !== undefined && !isPriority(askedPriority)) {
          throw invalidInput(tool, `priority must be ${oneOf.format(PRIORITIES)}.`);
        }
        const plan = textOf(tool, input, 'plan');
        const blockedBy = listOf(tool, input, 'blockedBy') ?? [];
        await checkPlan(tool, plan);
        await checkBlockers(tool, blockedBy);
        const topic = textOf(tool, input, 'topic');
        const bot = textOf(tool, input, 'bot');
        const folder = textOf(tool, input, 'folder');
        const session = textOf(tool, input, 'session') ?? at.session;
        const active = textOf(tool, input, 'active');
        const note = textOf(tool, input, 'note');
        if (input.body !== undefined && typeof input.body !== 'string') {
          throw invalidInput(tool, 'body must be a string.');
        }
        const priority: TaskPriority = askedPriority ?? DEFAULT_PRIORITY;
        const task: TaskRecord = {
          id: await store.nextTaskId(),
          title,
          status: 'todo',
          priority,
          labels: listOf(tool, input, 'labels') ?? [],
          session,
          blockedBy,
          refs: listOf(tool, input, 'refs') ?? [],
          created: stampOf(at),
          ...(topic === undefined ? {} : { topic }),
          ...(plan === undefined ? {} : { plan }),
          ...(bot === undefined ? {} : { bot }),
          ...(folder === undefined ? {} : { folder }),
          ...(active === undefined ? {} : { active }),
          ...(note === undefined ? {} : { note }),
          ...(typeof input.body === 'string' ? { body: input.body } : {}),
        };
        await store.putTask(task);
        return taskLine(task);
      },
    },
    {
      definition: {
        name: 'task_set',
        title: 'Set Task',
        description: 'Change the fields a task names, by task id. Moving to doing stamps started, and moving to review, done or dropped stamps finished once. Answer: its id, status, priority and title.',
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'The task id, as t1.' },
            title: { type: 'string', description: 'A new title, in one line.' },
            status: { type: 'string', enum: [...TASK_STATUSES], description: 'A new status.' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'A new priority.' },
            labels: { type: 'array', items: { type: 'string' }, description: 'New labels.' },
            topic: { type: 'string', description: 'What the task is about.' },
            plan: { type: 'string', description: 'The plan it belongs to, by plan id.' },
            bot: { type: 'string', description: 'The bot it belongs to, by slug.' },
            folder: { type: 'string', description: 'The folder it was made in.' },
            session: { type: 'string', description: 'The session it was made in.' },
            blockedBy: { type: 'array', items: { type: 'string' }, description: 'Task ids that must be done first.' },
            active: { type: 'string', description: 'What is being done right now, in one line.' },
            note: { type: 'string', description: 'One line about where the task stands.' },
            refs: { type: 'array', items: { type: 'string' }, description: 'Links and references the task needs.' },
            body: { type: 'string', description: 'The long text of the task, in Markdown.' },
          },
          required: ['task'],
        },
        annotations: { title: 'Set Task', readOnlyHint: false, destructiveHint: false },
      },
      run: async (input, at) => {
        const tool = 'task_set';
        const id = textOf(tool, input, 'task');
        if (id === undefined) throw invalidInput(tool, 'task is required.');
        const task = await store.task(id);
        if (task === undefined) throw invalidInput(tool, 'task must match the id of a known task (see task_list).');
        const title = textOf(tool, input, 'title');
        if (title !== undefined) task.title = title;
        const status = input.status;
        if (status !== undefined && !isTaskStatus(status)) {
          throw invalidInput(tool, `status must be ${oneOf.format(TASK_STATUSES)}.`);
        }
        const priority = input.priority;
        if (priority !== undefined && !isPriority(priority)) {
          throw invalidInput(tool, `priority must be ${oneOf.format(PRIORITIES)}.`);
        }
        if (priority !== undefined) task.priority = priority;
        const plan = textOf(tool, input, 'plan');
        if (plan !== undefined) {
          await checkPlan(tool, plan);
          task.plan = plan;
        }
        const blockedBy = listOf(tool, input, 'blockedBy');
        if (blockedBy !== undefined) {
          await checkBlockers(tool, blockedBy);
          task.blockedBy = blockedBy;
        }
        const labels = listOf(tool, input, 'labels');
        if (labels !== undefined) task.labels = labels;
        const refs = listOf(tool, input, 'refs');
        if (refs !== undefined) task.refs = refs;
        for (const field of ['topic', 'bot', 'folder', 'session', 'active', 'note'] as const) {
          const value = textOf(tool, input, field);
          if (value !== undefined) task[field] = value;
        }
        if (input.body !== undefined) {
          if (typeof input.body !== 'string') throw invalidInput(tool, 'body must be a string.');
          task.body = input.body;
        }
        if (status !== undefined) {
          /*
           * A task starts once and finishes once. Reopening one keeps the
           * moment it first started, and moving a finished one again keeps the
           * moment it first finished: the stamps are the history of the task
           * and not the state of its status.
           */
          if (status === 'doing') {
            if (options.requireApproval && task.approved === undefined) {
              throw invalidInput(tool, `status doing needs task ${task.id} approved first; ask somebody to approve it (see task_approve).`);
            }
            if (task.started === undefined) task.started = stampOf(at);
          }
          else {
            // Nothing is being done once the task leaves doing.
            delete task.active;
          }
          if (status === 'review' || status === 'done' || status === 'dropped') {
            if (task.finished === undefined) task.finished = stampOf(at);
          }
          task.status = status;
        }
        await store.putTask(task);
        return taskLine(task);
      },
    },
    {
      definition: {
        name: 'task_list',
        title: 'List Tasks',
        description: 'List tasks, filtered by status, approval, readiness, who stamped it and since when. Answer: one line per task, with its id, status, priority and title.',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: [...TASK_STATUSES], description: 'Only tasks with this status.' },
            approved: { type: 'boolean', description: 'Only approved tasks (true) or only unapproved ones (false).' },
            ready: { type: 'boolean', description: 'Only ready tasks (true) or only those that are not (false).' },
            by: { type: 'string', description: 'Only tasks with a stamp by this person.' },
            since: { type: 'string', description: 'Only tasks with a stamp at or after this date.' },
          },
        },
        annotations: { title: 'List Tasks', readOnlyHint: true, destructiveHint: false },
      },
      run: async (input) => {
        const tool = 'task_list';
        const status = input.status;
        if (status !== undefined && !isTaskStatus(status)) {
          throw invalidInput(tool, `status must be ${oneOf.format(TASK_STATUSES)}.`);
        }
        const approved = input.approved;
        if (approved !== undefined && typeof approved !== 'boolean') {
          throw invalidInput(tool, 'approved must be a boolean.');
        }
        const wanted = input.ready;
        if (wanted !== undefined && typeof wanted !== 'boolean') {
          throw invalidInput(tool, 'ready must be a boolean.');
        }
        const by = textOf(tool, input, 'by');
        // A date read as VS Code's list_sessions reads createdAfter, and refused in its words.
        const since = input.since;
        if (since !== undefined && typeof since !== 'string') {
          throw invalidInput(tool, 'since must be an ISO-8601 timestamp string.');
        }
        const sinceAt = since === undefined ? undefined : Date.parse(since);
        if (since !== undefined && Number.isNaN(sinceAt)) {
          throw invalidInput(tool, 'since must be a valid ISO-8601 timestamp (e.g. 2025-01-31T00:00:00Z).');
        }
        const all = await store.tasks();
        const byId = new Map(all.map((one) => [one.id, one]));
        const listed = all.filter((task) =>
          (status === undefined || task.status === status)
          && (approved === undefined || (task.approved !== undefined) === approved)
          && (wanted === undefined || ready(task, byId) === wanted)
          && (by === undefined || stampsOf(task).some((stamp) => names(stamp, by)))
          && (sinceAt === undefined || stampsOf(task).some((stamp) => Date.parse(stamp.at) >= sinceAt)));
        return listed.length === 0 ? 'No tasks.' : listed.map(taskLine).join('\n');
      },
    },
  ];
}
