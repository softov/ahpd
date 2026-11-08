import { RpcError } from '@ahpd/sdk';
import { isVerdict, planLine, taskLine, VERDICTS } from './record.js';
import { stampOf } from './stamp.js';
import type { Grant } from '@ahpd/sdk';
import type { TaskStore } from './store.js';
import type { HostTool } from '@ahpd/sdk';

/**
 * The three tools that say a plan or a task may go ahead.
 *
 * Approving asks the person behind the call for `task:approve`, in the host's
 * own words when they do not hold it: a grant is a thing a person holds, and a
 * turn nobody sent - a host's own, or one reached after its turn ended - holds
 * none. Both `plan_approve` and `task_approve` read the same grant.
 *
 * Reviewing asks for none. A reviewer session says what it saw of the work,
 * and the verdict is the stamp's own: `approved` or `changes`, or none where
 * the review leaves the task as it was.
 */

/** The protocol's code for a body this host will not take. */
const INVALID_PARAMS = -32602;

/** The grant a person holds to approve. */
const APPROVE_GRANT: Grant = 'task:approve';

/** The values one field may take, said as VS Code's server tools say them: "approved or changes". */
const oneOf = new Intl.ListFormat('en', { type: 'disjunction' });

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

/** Refuse a call whose person does not hold the approve grant, in the host's words. */
const mayApprove = (at: { may(grant: Grant): boolean; refusal(grant: Grant): string }): void => {
  if (!at.may(APPROVE_GRANT)) throw new Error(at.refusal(APPROVE_GRANT));
};

/** The three approval tools, over one store. */
export function approveTools(store: TaskStore): HostTool[] {
  return [
    {
      definition: {
        name: 'plan_approve',
        title: 'Approve Plan',
        description: 'Approve a plan, which stamps it approved. Needs the task:approve grant. Answer: the plan, with its id, status and title.',
        inputSchema: {
          type: 'object',
          properties: {
            plan: { type: 'string', description: 'The plan id, as p1.' },
          },
          required: ['plan'],
        },
        annotations: { title: 'Approve Plan', readOnlyHint: false, destructiveHint: false },
      },
      run: async (input, at) => {
        const tool = 'plan_approve';
        mayApprove(at);
        const id = textOf(tool, input, 'plan');
        if (id === undefined) throw invalidInput(tool, 'plan is required.');
        const plan = await store.plan(id);
        if (plan === undefined) throw invalidInput(tool, 'plan must match the id of a known plan (see plan_list).');
        plan.approved = stampOf(at);
        await store.putPlan(plan);
        return planLine(plan);
      },
    },
    {
      definition: {
        name: 'task_approve',
        title: 'Approve Task',
        description: 'Approve a task, which stamps it approved and lets it start when approval is on. Needs the task:approve grant. Answer: the task, with its id, status, priority and title.',
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'The task id, as t1.' },
          },
          required: ['task'],
        },
        annotations: { title: 'Approve Task', readOnlyHint: false, destructiveHint: false },
      },
      run: async (input, at) => {
        const tool = 'task_approve';
        mayApprove(at);
        const id = textOf(tool, input, 'task');
        if (id === undefined) throw invalidInput(tool, 'task is required.');
        const task = await store.task(id);
        if (task === undefined) throw invalidInput(tool, 'task must match the id of a known task (see task_list).');
        task.approved = stampOf(at);
        await store.putTask(task);
        return taskLine(task);
      },
    },
    {
      definition: {
        name: 'task_review',
        title: 'Review Task',
        description: 'Review a task and stamp reviewed, with a verdict of approved or changes where the review has one. Answer: the task, with its id, status, priority and title.',
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'The task id, as t1.' },
            verdict: { type: 'string', enum: [...VERDICTS], description: 'What the review says: approved or changes. Absent, the review has no verdict.' },
          },
          required: ['task'],
        },
        annotations: { title: 'Review Task', readOnlyHint: false, destructiveHint: false },
      },
      run: async (input, at) => {
        const tool = 'task_review';
        const id = textOf(tool, input, 'task');
        if (id === undefined) throw invalidInput(tool, 'task is required.');
        const verdict = input.verdict;
        if (verdict !== undefined && !isVerdict(verdict)) {
          throw invalidInput(tool, `verdict must be ${oneOf.format(VERDICTS)}.`);
        }
        const task = await store.task(id);
        if (task === undefined) throw invalidInput(tool, 'task must match the id of a known task (see task_list).');
        task.reviewed = {
          ...stampOf(at),
          ...(verdict === undefined ? {} : { verdict }),
        };
        await store.putTask(task);
        return taskLine(task);
      },
    },
  ];
}
