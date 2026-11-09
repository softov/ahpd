import { loggerOf } from '@ahpd/sdk';
import { describe, expect, it } from 'vitest';
import { foldHostOptions, memoryRecords, pluginHost } from '@ahpd/sdk';
import { apply, name } from '../src/plugin.js';
import type { HostTool, LoaderContext, RecordStore, ToolCall } from '@ahpd/sdk';

/*
 * The approval tools and the review tool.
 *
 * Approving reads the grant a person holds, and a call nobody is behind holds
 * none. Reviewing reads none, so a session may say what it saw of the work.
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

/** A call from `person`, holding `grants`, in `session`. `person: null` is nobody. */
const at = (over: { person?: string | null; grants?: string[]; session?: string } = {}): ToolCall => {
  const person = over.person === undefined ? 'ana' : over.person ?? undefined;
  return {
    session: over.session ?? 'ahp-session:/one',
    chat: 'ahp-chat:/one',
    person: () => person,
    may: (grant: string) => person !== undefined && (over.grants === undefined || over.grants.includes(grant)),
    refusal: (grant: string) => person === undefined
      ? `nobody may ${grant} here`
      : `user:${person} may not ${grant} here`,
  } as unknown as ToolCall;
};

/** The plugin applied over fresh records, with its tools by name. */
async function served(options: Record<string, unknown> = {}) {
  const records = memoryRecords();
  const problems: string[] = [];
  const { host, contribution, seal } = pluginHost(name, context(), {
    records: () => records,
    alert: (alert) => { problems.push(alert.text); },
  });
  await apply(host, options);
  seal();
  const folded = foldHostOptions({ path: '/tmp/tasks', agents: [] }, [contribution]);
  const tools = new Map<string, HostTool>(folded.options.tools?.map((one) => [one.definition.name, one]));
  const run = async (tool: string, input: Record<string, unknown>, call = at()): Promise<string> => {
    const found = tools.get(tool);
    if (found === undefined) throw new Error(`no ${tool}`);
    return await found.run(input, call);
  };
  return { records, problems, tools, folded, run };
}

/** One kept record, from a collection of the record store. */
async function kept(records: RecordStore, collection: string, id: string): Promise<Record<string, unknown> | undefined> {
  return await (await records.collection(collection)).get(id);
}

describe('the approval tools', () => {
  it('approves a plan and a task for a person with the grant, stamping the caller', async () => {
    const { run, records } = await served();
    await run('plan_create', { title: 'First', goal: 'One.', scope: { kind: 'folder', folder: '/srv/work' } });
    await run('task_add', { title: 'Read it' });

    expect(await run('plan_approve', { plan: 'p1' }, at({ person: 'bob', session: 'ahp-session:/two' })))
      .toBe('p1, draft, First');
    expect(await run('task_approve', { task: 't1' })).toBe('t1, todo, medium, Read it');
    expect((await kept(records, 'plans', 'p1'))?.approved).toMatchObject({ by: 'bob', in: 'ahp-session:/two' });
    expect((await kept(records, 'tasks', 't1'))?.approved).toMatchObject({ by: 'ana', in: 'ahp-session:/one' });
  });

  it('refuses a person without the grant, in the host\'s words, and writes nothing', async () => {
    const { run, records } = await served();
    await run('plan_create', { title: 'First', goal: 'One.', scope: { kind: 'folder', folder: '/srv/work' } });
    await run('task_add', { title: 'Read it' });
    const without = at({ grants: [] });
    await expect(run('plan_approve', { plan: 'p1' }, without)).rejects.toThrow('user:ana may not task:approve here');
    await expect(run('task_approve', { task: 't1' }, without)).rejects.toThrow('user:ana may not task:approve here');
    expect((await kept(records, 'plans', 'p1'))?.approved).toBeUndefined();
    expect((await kept(records, 'tasks', 't1'))?.approved).toBeUndefined();
  });

  it('refuses a call no person is behind', async () => {
    const { run } = await served();
    await run('plan_create', { title: 'First', goal: 'One.', scope: { kind: 'folder', folder: '/srv/work' } });
    await run('task_add', { title: 'Read it' });
    const nobody = at({ person: null });
    await expect(run('plan_approve', { plan: 'p1' }, nobody)).rejects.toThrow('nobody may task:approve here');
    await expect(run('task_approve', { task: 't1' }, nobody)).rejects.toThrow('nobody may task:approve here');
  });

  it('takes a start after the approval when approval is on', async () => {
    const { run } = await served({ requireApproval: true });
    await run('task_add', { title: 'Read it' });
    await expect(run('task_set', { task: 't1', status: 'doing' }))
      .rejects.toThrow('Invalid task_set input: status doing needs task t1 approved first; ask somebody to approve it (see task_approve).');
    await run('task_approve', { task: 't1' });
    expect(await run('task_set', { task: 't1', status: 'doing' })).toBe('t1, doing, medium, Read it');
  });
});

describe('the review tool', () => {
  it('stamps reviewed with each verdict and with none, and asks no grant', async () => {
    const { run, records } = await served();
    await run('task_add', { title: 'Read it' });

    expect(await run('task_review', { task: 't1', verdict: 'approved' }, at({ grants: [] })))
      .toBe('t1, todo, medium, Read it');
    expect((await kept(records, 'tasks', 't1'))?.reviewed).toMatchObject({ by: 'ana', verdict: 'approved' });

    await run('task_review', { task: 't1', verdict: 'changes' });
    expect((await kept(records, 'tasks', 't1'))?.reviewed).toMatchObject({ verdict: 'changes' });

    await run('task_review', { task: 't1' });
    expect((await kept(records, 'tasks', 't1'))?.reviewed).toMatchObject({ by: 'ana' });
    expect((await kept(records, 'tasks', 't1'))?.reviewed).not.toHaveProperty('verdict');
  });

  /*
   * In the words VS Code's server tools refuse their input with:
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L649-L671
   */
  it('refuses an unknown verdict or task', async () => {
    const { run } = await served();
    await run('task_add', { title: 'Read it' });
    await expect(run('task_review', { task: 't1', verdict: 'maybe' }))
      .rejects.toThrow('Invalid task_review input: verdict must be approved or changes.');
    await expect(run('task_review', { task: 't9', verdict: 'approved' }))
      .rejects.toThrow('Invalid task_review input: task must match the id of a known task (see task_list).');
    await expect(run('task_review', {})).rejects.toThrow('Invalid task_review input: task is required.');
    await expect(run('task_approve', { task: 't9' }))
      .rejects.toThrow('Invalid task_approve input: task must match the id of a known task (see task_list).');
    await expect(run('plan_approve', { plan: 'p9' }))
      .rejects.toThrow('Invalid plan_approve input: plan must match the id of a known plan (see plan_list).');
  });
});

describe('the tools the plugin offers', () => {
  it('offers the approval tools beside the plan and task tools, with no problem', async () => {
    const { tools, problems } = await served();
    expect([...tools.keys()]).toEqual([
      'plan_create', 'plan_set', 'plan_show', 'plan_list',
      'task_add', 'task_set', 'task_list',
      'plan_approve', 'task_approve', 'task_review',
    ]);
    expect(problems).toEqual([]);
  });
});
