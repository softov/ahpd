import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFakeModel } from '@cofold/agents/testing';
import { foldHostOptions, memoryRecords, pluginHost } from '@ahpd/sdk';
import { cofoldAgent } from '../../agent-cofold/src/index.js';
import { toPiTool } from '../../agent-pi/src/tools.js';
import { apply, name } from '../src/plugin.js';
import type { Bag, BoundTool, ClientCallAnswer, HostTool, LoaderContext, Start, ToolCall } from '@ahpd/sdk';
import { startedNow } from '../../sdk/test/support/started.js';

/*
 * The ten tools as a harness is offered them.
 *
 * A backend is handed `BoundTool`s: the host's definition and a `run` with the
 * call already bound in. Here the plugins are folded as the daemon folds them,
 * and each tool is wrapped the way the host wraps one for a session - with that
 * session's call - before pi or cofold is given it. Nothing under either
 * backend changes: a host tool is offered to every session.
 */

const context = (): LoaderContext => ({
  path: '/tmp/tasks',
  paths: ['/tmp/tasks'],
  version: '0.12.0',
  hostName: 'tasks-test',
  configDir: '/tmp/tasks',
  log: () => {},
  say: () => {},
});

/** Every tool's name, in the order the plugin registers them. */
const NAMES = [
  'plan_create', 'plan_set', 'plan_show', 'plan_list',
  'task_add', 'task_set', 'task_list',
  'plan_approve', 'task_approve', 'task_review',
];

/** A call from `person`, in `session`. */
const callOf = (person: string, session: string): ToolCall => ({
  session,
  chat: session.replace('ahp-session:', 'ahp-chat:'),
  person: () => person,
  may: () => true,
} as unknown as ToolCall);

/** The plugin folded into a host's options, as the daemon folds it. */
async function folded() {
  const records = memoryRecords();
  const { host, contribution, seal } = pluginHost(name, context(), {
    records: () => records,
    alert: () => {},
  });
  await apply(host, {});
  seal();
  const options = foldHostOptions({ path: '/tmp/tasks', agents: [] }, [contribution]).options;
  return { records, tools: (options.tools ?? []) as HostTool[] };
}

/** The host tools as one session runs them, with its call bound in. */
const boundFor = (tools: HostTool[], person: string, session: string): BoundTool[] =>
  tools.map((tool) => ({
    definition: tool.definition,
    run: (input: Record<string, unknown>) => tool.run(input, callOf(person, session)),
  }));

/** A client wait that answers nothing, for a host tool nobody hands out. */
const noClient = async (): Promise<ClientCallAnswer> => ({ text: '', ok: false, content: [] });

/** Call a pi tool definition the way pi does. */
const callPi = async (
  tool: Awaited<ReturnType<typeof toPiTool>>,
  params: Record<string, unknown>,
): Promise<Bag> => {
  if (tool === undefined) throw new Error('no tool to call');
  return await tool.execute('c1', params as never, undefined, undefined, undefined as never) as unknown as Bag;
};

/** Waits for `check` to hold, turning the event loop, and throws after `ms`. */
const when = async (check: () => boolean, ms = 5000): Promise<void> => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

describe('pi and cofold are offered the task tools', () => {
  it('converts each of the ten tools to pi and calls task_add the way pi does', async () => {
    const { tools } = await folded();
    const bound = boundFor(tools, 'ana', 'ahp-session:/pi');
    const converted = await Promise.all(bound.map(async (one) => await toPiTool(one, noClient)));
    expect(converted.map((one) => one?.name)).toEqual(NAMES);

    const added = await callPi(converted.find((one) => one?.name === 'task_add'), { title: 'From pi' });
    expect(added.content).toEqual([{ type: 'text', text: 't1, todo, medium, From pi' }]);
    const listed = await callPi(converted.find((one) => one?.name === 'task_list'), {});
    expect(listed.content).toEqual([{ type: 'text', text: 't1, todo, medium, From pi' }]);
  });

  it('opens a cofold session with the ten tools as host tools', async () => {
    const { tools } = await folded();
    const model = createFakeModel({ script: [{ text: 'ok' }], stream: true });
    const agent = cofoldAgent({ adapter: model, memory: true });
    let finished = false;
    const emit = (_channel: string, action: Bag): void => {
      if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled' || action.type === 'chat/error') {
        finished = true;
      }
    };
    const session = startedNow(agent.create({
      uri: 'ahp-session:/cofold',
      chatUri: 'ahp-chat:/cofold',
      settings: { ...agent.defaults() },
      workingDirectory: mkdtempSync(join(tmpdir(), 'ahpd-tasks-cofold-')),
      schema: () => agent.schema(),
      emit,
      tools: boundFor(tools, 'ana', 'ahp-session:/cofold'),
    } as unknown as Start));
    session.sendMessage('t1', 'hello');
    await when(() => finished);
    const offered = (model.requests[0]?.tools ?? []).map((one) => one.name);
    expect(offered).toEqual(expect.arrayContaining(NAMES));
  });

  it('lists from a second session the task a first session added', async () => {
    const { records, tools } = await folded();
    const first = boundFor(tools, 'ana', 'ahp-session:/one');
    const second = boundFor(tools, 'bob', 'ahp-session:/two');
    const add = first.find((one) => one.definition.name === 'task_add');
    const list = second.find((one) => one.definition.name === 'task_list');
    expect(await add?.run?.({ title: 'From the first session' })).toBe('t1, todo, medium, From the first session');
    expect(await list?.run?.({})).toBe('t1, todo, medium, From the first session');
    const kept = await (await records.collection('tasks', { body: 'body' })).get('t1');
    expect(kept?.created).toMatchObject({ by: 'ana', in: 'ahp-session:/one' });
  });
});

describe('calls made at once', () => {
  it('give each new task an id of its own', async () => {
    const { tools } = await folded();
    const add = tools.find((tool) => tool.definition.name === 'task_add');
    if (add === undefined) throw new Error('no task_add');
    await Promise.all(Array.from({ length: 5 }, (_, n) =>
      add.run({ title: `Task ${n}` }, callOf('ana', 'ahp-session:/one'))));
    const list = tools.find((tool) => tool.definition.name === 'task_list');
    if (list === undefined) throw new Error('no task_list');
    const text = await list.run({}, callOf('ana', 'ahp-session:/one'));
    for (const id of ['t1', 't2', 't3', 't4', 't5']) expect(text).toContain(id);
  });
});
