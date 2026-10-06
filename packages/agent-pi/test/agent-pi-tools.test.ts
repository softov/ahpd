import { expect, it } from 'vitest';
import { Status } from '../../sdk/src/catalog.js';
import type { Bag, BoundTool, Start } from '../../sdk/src/types/index.js';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/clientcalls.js';
import { mapEvent } from '../src/mapping.js';
import { THINKING_KEY } from '../src/models.js';
import { piSession } from '../src/session.js';
import type { OpenPi } from '../src/session.js';
import type { BackendOptions } from '../src/backend.js';
import { toPiTool } from '../src/tools.js';
import { driveCall, fakePi, opened, root, settled, turn } from './fake-pi.js';

// Host tools --------------------------------------------------------------

/** A client wait that answers nothing, for a host tool nobody hands out. */
const noClient = async (): Promise<{ text: string; ok: boolean }> => ({ text: '', ok: false });

/** Call a pi tool definition the way pi does. */
const callTool = async (tool: Awaited<ReturnType<typeof toPiTool>>, params: Record<string, unknown>): Promise<Bag> => {
  if (tool === undefined) throw new Error('no tool to call');
  return await tool.execute('c1', params as never, undefined, undefined, undefined as never) as unknown as Bag;
};

it('converts a bound tool to pi definition, keeping the name, title and schema', async () => {
  const tool = await toPiTool({
    definition: {
      name: 'open_file',
      title: 'Open a file',
      description: 'Opens a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
    run: async () => 'opened',
  }, noClient);
  expect(tool?.name).toBe('open_file');
  expect(tool?.label).toBe('Open a file');
  expect(tool?.description).toBe('Opens a file');
  // The host's schema reaches pi as it is, so a call is validated against it.
  const parameters = tool?.parameters as Bag;
  expect(parameters.type).toBe('object');
  expect((parameters.properties as Bag).path).toEqual({ type: 'string' });
  expect(parameters.required).toEqual(['path']);
});

it('answers a host tool with what run returned', async () => {
  const tool = await toPiTool({
    definition: { name: 'open_file' },
    run: async (input) => `opened ${String(input.path)}`,
  }, noClient);
  const result = await callTool(tool, { path: 'a.txt' });
  expect(result.content).toEqual([{ type: 'text', text: 'opened a.txt' }]);
});

it('rejects the call when the host tool throws', async () => {
  const tool = await toPiTool({
    definition: { name: 'open_file' },
    run: async () => { throw new Error('no such file'); },
  }, noClient);
  await expect(callTool(tool, {})).rejects.toThrow('no such file');
});

it('drops a tool that would shadow one of pi own', async () => {
  expect(await toPiTool({ definition: { name: 'bash' }, run: async () => 'no' }, noClient)).toBeUndefined();
});

it('hands the host tools to pi as custom tools', async () => {
  const { session, pi } = opened({
    tools: [
      { definition: { name: 'bash' }, run: async () => 'no' },
      { definition: { name: 'open_file', title: 'Open file' }, run: async () => 'ok' },
    ],
  } as Partial<Start>);
  session.begin('t1', 'hello');
  await settled();
  expect((pi.opens[0]?.tools ?? []).map((one) => one.name)).toEqual(['open_file']);
});

it('waits on the client that owns a tool, and lets only that client answer', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'editor__open', title: 'Open' }, owner: 'editor' }],
  } as Partial<Start>);
  session.begin('t1', 'hello');
  await settled();
  const tool = pi.opens[0]?.tools?.find((one) => one.name === 'editor__open');
  expect(session.toolCallOwner?.('c1')).toBeUndefined();

  let answered: Bag | undefined;
  const pending = tool!.execute('c1', {} as never, undefined, undefined, undefined as never)
    .then((result) => { answered = result as unknown as Bag; });
  await settled();
  expect(session.toolCallOwner?.('c1')).toBe('editor');
  // A result from anybody else is a client out of step and does not settle it.
  expect(session.completeToolCall?.('c1', 'other', { text: 'not mine', ok: true, content: [] })).toBe(false);
  await settled();
  expect(answered).toBeUndefined();
  expect(session.completeToolCall?.('c1', 'editor', { text: 'opened it', ok: true, content: [] })).toBe(true);
  await pending;
  expect(answered?.content).toEqual([{ type: 'text', text: 'opened it' }]);
  expect(session.toolCallOwner?.('c1')).toBeUndefined();
});

it('fails a client tool call with the answer, and when its client is gone', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'editor__open' }, owner: 'editor' }],
  } as Partial<Start>);
  session.begin('t1', 'hello');
  await settled();
  const tool = pi.opens[0]?.tools?.find((one) => one.name === 'editor__open');
  const refused = tool!.execute('c1', {} as never, undefined, undefined, undefined as never);
  await settled();
  session.completeToolCall?.('c1', 'editor', { text: 'it refused', ok: false, content: [] });
  await expect(refused).rejects.toThrow('it refused');

  const gone = tool!.execute('c2', {} as never, undefined, undefined, undefined as never);
  await settled();
  session.clientGone?.('editor');
  await expect(gone).rejects.toThrow('The client that provides this tool is no longer here');
});

it('releases a waiting client call when the turn is cancelled', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'editor__open' }, owner: 'editor' }],
  } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  const tool = pi.opens[0]?.tools?.find((one) => one.name === 'editor__open');
  const waiting = tool!.execute('c1', {} as never, undefined, undefined, undefined as never);
  await settled();
  session.cancel('t1');
  await expect(waiting).rejects.toThrow('The turn was stopped');
});

it('replaces the tools on the next turn, rebuilding pi on the same session file', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'one' }, run: async () => 'ok' }],
  } as Partial<Start>);
  session.begin('t1', 'hello');
  await settled();
  expect(pi.opens).toHaveLength(1);
  expect(await session.setTools?.([{ definition: { name: 'two' }, run: async () => 'ok' }])).toBe(true);
  session.begin('t2', 'again');
  await settled();
  expect(pi.opens).toHaveLength(2);
  expect(pi.opens[1]?.resume).toBe('pi-session-1');
  expect((pi.opens[1]?.tools ?? []).map((one) => one.name)).toEqual(['two']);
});

it('does not rebuild pi when the tools did not change', async () => {
  const tool = { definition: { name: 'one' }, run: async () => 'ok' };
  const { session, pi } = opened({ tools: [tool] } as Partial<Start>);
  session.begin('t1', 'hello');
  await settled();
  expect(await session.setTools?.([tool])).toBe(true);
  session.begin('t2', 'again');
  await settled();
  expect(pi.opens).toHaveLength(1);
});

it('changes the tools before pi opens', async () => {
  const { session, pi } = opened();
  expect(await session.setTools?.([{ definition: { name: 'one' }, run: async () => 'ok' }])).toBe(true);
  session.begin('t1', 'hello');
  await settled();
  expect((pi.opens[0]?.tools ?? []).map((one) => one.name)).toEqual(['one']);
});

it('takes a tool change made during a turn on the turn after it', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'one' }, run: async () => 'ok' }],
  } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  await session.setTools?.([{ definition: { name: 'two' }, run: async () => 'ok' }]);
  // The running turn already handed pi its tools and is not touched.
  expect(pi.opens).toHaveLength(1);
  pi.raise({ type: 'agent_settled' });
  await settled();
  session.begin('t2', 'again');
  await settled();
  expect(pi.opens).toHaveLength(2);
  expect((pi.opens[1]?.tools ?? []).map((one) => one.name)).toEqual(['two']);
});

it('hands the host instructions to pi, and drops the empty ones', async () => {
  const { session, pi } = opened({ instructions: ['one', ' ', 'two'] } as Partial<Start>);
  session.begin('t1', 'hello');
  await settled();
  expect(pi.opens[0]?.instructions).toEqual(['one', 'two']);
});

it('passes no instructions for a session that named none', async () => {
  const { session, pi } = opened();
  session.begin('t1', 'hello');
  await settled();
  expect(pi.opens[0]?.instructions).toBeUndefined();
});

// Tools and the backend ---------------------------------------------------

it('takes a setTools made while the first open is still pending', async () => {
  const pi = fakePi();
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const start: Start = {
    uri: 'ahp-session:/s1',
    chatUri: 'ahp-chat:/s1',
    settings: {},
    workingDirectory: root,
    schema: () => ({}),
    emit: () => {},
    // The host always resolves this, and its own answer when the deployment
    // said nothing is ten minutes.
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  } as Start;
  const session = piSession({}, start, (async (options: BackendOptions) => {
    await gate;
    return pi.open(options);
  }) as OpenPi);

  session.begin('t1', 'hello');
  await settled();
  // The open the turn waits on was handed the list before this.
  expect(await session.setTools?.([{ definition: { name: 'late' }, run: async () => 'ok' }])).toBe(true);
  release();
  await settled();
  expect(pi.opens.some((options) => (options.tools ?? []).some((tool) => tool.name === 'late'))).toBe(true);
});

it('judges a running turn with the tools it was built with', async () => {
  const bound: BoundTool = { definition: { name: 'editor__open' }, owner: 'editor' };
  const { session, pi, sent } = opened({ tools: [bound] } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  // The client's tool goes away while the turn is running.
  await session.setTools?.([]);
  pi.raise({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'editor__open', args: {} });
  await settled();
  const start = sent.find((one) => one.action.type === 'chat/toolCallStart'
    && one.action.toolCallId === 'c1');
  expect(start?.action.contributor).toEqual({ kind: 'client', clientId: 'editor' });
});

it('judges a running turn with the effects it was built with', async () => {
  const bound: BoundTool = {
    definition: { name: 'editor__save' },
    run: async () => 'x',
    effects: { writes: true },
  };
  const { session, pi } = opened({
    tools: [bound],
    settings: { permissionMode: 'default' },
  } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  await session.setTools?.([]);
  // It was a writing tool when the turn was built, so it still asks.
  const waiting = driveCall(pi, 'c1', 'editor__save', {});
  await settled();
  expect(session.status()).toBe(Status.InputNeeded);
  session.confirm('c1', false);
  await waiting;
});

it('ends a host tool when pi aborts the call', async () => {
  const tool = await toPiTool({ definition: { name: 'slow' }, run: () => new Promise(() => {}) }, noClient);
  const stopping = new AbortController();
  const running = tool!.execute('c1', {} as never, stopping.signal, undefined, undefined as never);
  stopping.abort();
  const outcome = await Promise.race([
    running.then(() => 'resolved', () => 'rejected'),
    new Promise((done) => { setTimeout(() => done('still-running'), 50); }),
  ]);
  expect(outcome).toBe('rejected');
  void running.catch(() => {});
});

it('rebuilds pi on the same session and the model it was on', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'one' }, run: async () => 'ok' }],
    instructions: ['be nice'],
  } as Partial<Start>);
  session.begin('t1', 'hello');
  await settled();
  const before = pi.asked.filter((one) => one.kind === 'choose').length;
  await session.setTools?.([{ definition: { name: 'two' }, run: async () => 'ok' }]);
  session.begin('t2', 'again');
  await settled();
  expect(pi.opens).toHaveLength(2);
  const second = pi.opens[1]!;
  expect(second.resume).toBe('pi-session-1');
  expect((second.tools ?? []).map((one) => one.name)).toEqual(['two']);
  expect(second.instructions).toEqual(['be nice']);
  expect(second.onToolCall).toBeDefined();
  // The model and thinking level the session was on are applied again.
  const chooses = pi.asked.filter((one) => one.kind === 'choose');
  expect(chooses.length).toBeGreaterThan(before);
  expect(chooses[chooses.length - 1]).toEqual({
    kind: 'choose',
    id: 'anthropic/claude-opus-5',
    config: { [THINKING_KEY]: 'off' },
  });
});

it('lets the next turn open again after a rebuild fails', async () => {
  const pi = fakePi();
  let opens = 0;
  const open: OpenPi = async (options) => {
    opens += 1;
    if (opens === 2) throw new Error('the rebuild could not start');
    return pi.open(options);
  };
  const { session, sent } = opened(
    { tools: [{ definition: { name: 'one' }, run: async () => 'ok' }] } as Partial<Start>,
    {},
    open,
  );
  session.begin('t1', 'hello');
  await settled();
  await session.setTools?.([{ definition: { name: 'two' }, run: async () => 'ok' }]);
  session.begin('t2', 'again');
  await settled();
  const failure = [...sent].reverse().find((one) => one.action.type === 'chat/error')?.action;
  expect(((failure?.part as Bag).error as Bag).message).toBe('the rebuild could not start');

  // Nothing is live, so the next turn opens again rather than reusing the failure.
  session.begin('t3', 'third');
  await settled();
  expect(opens).toBe(3);
});

it('marks a client-owned call with the client that runs it', () => {
  const one = turn();
  one.ownerOf = (toolName) => (toolName === 'editor__open' ? 'editor' : undefined);
  const actions = mapEvent(one, {
    type: 'tool_execution_start', toolCallId: 'c1', toolName: 'editor__open', args: {},
  });
  const contributor = { kind: 'client', clientId: 'editor' };
  expect(actions).toHaveLength(1);
  expect(actions[0]?.type).toBe('chat/toolCallStart');
  expect(actions[0]?.contributor).toEqual(contributor);
  // The snapshot row says the same thing, so a client that subscribes reads it.
  expect((one.parts.find((part) => part.id === 'c1')?.toolCall as Bag)?.contributor).toEqual(contributor);
  // A host tool is nobody's client, and a call to one carries nothing.
  expect(mapEvent(turn(), {
    type: 'tool_execution_start', toolCallId: 'c2', toolName: 'bash', args: {},
  })[0]?.contributor).toBeUndefined();
});