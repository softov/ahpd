import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { Status } from '../../sdk/src/catalog.js';
import type { Bag, BoundTool, Start } from '../../sdk/src/types/index.js';
import { piAgent } from '../src/agent.js';
import { forget } from '../src/catalog.js';
import { activityOf, mapEvent, resultText } from '../src/mapping.js';
import type { PiModel } from '../src/models.js';
import { idOf, modelFor, offered, THINKING_KEY } from '../src/models.js';
import { loadPi } from '../src/pi.js';
import { optionsOf } from '../src/plugin.js';
import { piSession } from '../src/session.js';
import type { OpenPi } from '../src/session.js';
import { resumeOrCreate } from '../src/backend.js';
import type { BackendOptions, PiBackend } from '../src/backend.js';
import { toPiTool } from '../src/tools.js';
import type { PiOptions, PiTurn } from '../src/types.js';

/*
 * pi as a backend, without a model provider.
 *
 * The whole turn lifecycle is driven through the `open` seam: a fake `pi` that
 * records what it was asked and raises the events a real one would. So what is
 * under test is this package's half - the actions, their order, and the state
 * a client re-subscribing would be served - rather than pi.
 */

// pi's SDK, loaded before any case, so a case that builds pi tools does not
// wait seconds for the import inside a few milliseconds of settling.
beforeAll(async () => { await loadPi(); }, 60_000);

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-pi-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); forget(); });

const turn = (turnId = 't1'): PiTurn => ({
  turnId,
  messages: 0,
  blocks: new Map(),
  waiting: new Map(),
  parts: [],
  calls: new Map(),
});

/**
 * The events pi raises for one assistant message, in pi's order: the message
 * and each block streamed by its index, then each call it asked for run.
 */
const streamed = (content: Bag[]): AgentSessionEvent[] => {
  const message = { role: 'assistant', content };
  const events: Bag[] = [{ type: 'message_start', message }];
  const update = (contentIndex: number, inner: Bag): void => {
    events.push({ type: 'message_update', message, assistantMessageEvent: { contentIndex, partial: message, ...inner } });
  };
  content.forEach((block, index) => {
    if (block.type === 'thinking') {
      update(index, { type: 'thinking_start' });
      update(index, { type: 'thinking_delta', delta: block.thinking });
      update(index, { type: 'thinking_end', content: block.thinking });
    }
    else if (block.type === 'text') {
      update(index, { type: 'text_start' });
      update(index, { type: 'text_delta', delta: block.text });
      update(index, { type: 'text_end', content: block.text });
    }
    else if (block.type === 'toolCall') {
      update(index, { type: 'toolcall_start' });
      update(index, { type: 'toolcall_end', toolCall: block });
    }
  });
  events.push({ type: 'message_end', message });
  for (const block of content.filter((one) => one.type === 'toolCall')) {
    events.push({ type: 'tool_execution_start', toolCallId: block.id, toolName: block.name, args: block.arguments });
    events.push({
      type: 'tool_execution_end', toolCallId: block.id, toolName: block.name, result: 'ok', isError: false,
    });
  }
  return events as unknown as AgentSessionEvent[];
};

/** A pi that raises whatever a test tells it to, and records what it was asked. */
function fakePi() {
  let listener: ((event: AgentSessionEvent) => void) | undefined;
  const asked: Bag[] = [];
  const opens: BackendOptions[] = [];
  const runtime: PiModel[] = [
    { provider: 'anthropic', id: 'claude-opus-5', name: 'Opus 5', contextWindow: 200000, maxTokens: 64000 },
    { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
  ];
  let settle = true;
  let leaf = 'entry-1';
  let moves = true;
  const backend: PiBackend = {
    id: 'pi-session-1',
    file: '/tmp/pi/pi-session-1.jsonl',
    subscribe: (one) => { listener = one; return () => { listener = undefined; }; },
    prompt: async (text) => {
      asked.push({ kind: 'prompt', text });
      if (settle) listener?.({ type: 'agent_settled' });
    },
    steer: async (text) => { asked.push({ kind: 'steer', text }); },
    abort: async () => { asked.push({ kind: 'abort' }); listener?.({ type: 'agent_settled' }); },
    models: async () => runtime,
    levels: (model) => (model.provider === 'anthropic' ? ['off', 'medium', 'high'] : ['off']),
    chosen: () => ({ id: 'anthropic/claude-opus-5', config: { [THINKING_KEY]: 'off' } }),
    /*
     * pi's own runtime is what resolves a pick, so a model it does not list is
     * refused rather than taken. That is the whole of what a turn cannot do.
     */
    choose: async (id, config) => {
      asked.push({ kind: 'choose', id, ...(config ? { config } : {}) });
      return modelFor(runtime, id) !== undefined;
    },
    rename: (title) => { asked.push({ kind: 'rename', title }); },
    rewind: async (entryId) => { asked.push({ kind: 'rewind', entryId }); return moves; },
    leaf: () => leaf,
    close: () => { asked.push({ kind: 'close' }); },
  };
  return {
    backend,
    asked,
    opens,
    raise: (event: AgentSessionEvent) => { listener?.(event); },
    hold: () => { settle = false; },
    setLeaf: (next: string) => { leaf = next; },
    refuseRewind: () => { moves = false; },
    open: (async (options: BackendOptions) => { opens.push(options); return backend; }) as OpenPi,
  };
}

/** One session, with everything it emitted. */
function opened(
  over: Partial<Start> = {},
  options: PiOptions = {},
  open?: OpenPi,
) {
  const pi = fakePi();
  const sent: { channel: string; action: Bag }[] = [];
  const start: Start = {
    uri: 'ahp-session:/s1',
    chatUri: 'ahp-chat:/s1',
    settings: {},
    workingDirectory: root,
    schema: () => ({}),
    emit: (channel, action) => { sent.push({ channel, action }); },
    ...over,
  } as Start;
  // No file of pi's is read for a resumed session here: the fake has none.
  const session = piSession(options, start, open ?? pi.open, async () => undefined);
  const types = (channel?: string) => sent
    .filter((one) => channel === undefined || one.channel === channel)
    .map((one) => String(one.action.type));
  const last = (type: string) => [...sent].reverse().find((one) => one.action.type === type)?.action;
  return { session, pi, sent, types, last };
}

const settled = async (): Promise<void> => { await new Promise((done) => { setTimeout(done, 5); }); };

/**
 * Send pi's own start and then call the hook, in the order pi raises them.
 *
 * pi-agent-core 0.87.1 emits `tool_execution_start` before `beforeToolCall`
 * calls the extension's `tool_call` handler, so a test that calls the hook
 * first is testing an order pi never uses.
 */
const driveCall = (
  pi: ReturnType<typeof fakePi>,
  toolCallId: string,
  toolName: string,
  input: Bag,
): Promise<Bag | undefined> => {
  pi.raise({ type: 'tool_execution_start', toolCallId, toolName, args: input });
  return pi.opens[0]!.onToolCall!(
    { type: 'tool_call', toolCallId, toolName, input } as never,
  ) as Promise<Bag | undefined>;
};

/**
 * The tool call statuses a client would show, folded from the actions.
 *
 * The transitions are the protocol reducer's: a call completes only from
 * `running` or `pending-confirmation`, so a result for one already
 * `cancelled` leaves it cancelled.
 */
const callStatuses = (sent: { channel: string; action: Bag }[]): Map<string, string> => {
  const states = new Map<string, string>();
  for (const { channel, action } of sent) {
    if (channel !== 'chat') continue;
    const id = String(action.toolCallId ?? '');
    if (id === '') continue;
    const current = states.get(id);
    if (action.type === 'chat/toolCallStart') states.set(id, 'streaming');
    else if (action.type === 'chat/toolCallReady') {
      states.set(id, action.confirmed === 'not-needed' ? 'running' : 'pending-confirmation');
    }
    else if (action.type === 'chat/toolCallConfirmed') {
      states.set(id, action.approved === true ? 'running' : 'cancelled');
    }
    else if (action.type === 'chat/toolCallComplete') {
      if (current === 'running' || current === 'pending-confirmation') states.set(id, 'completed');
    }
  }
  return states;
};

it('publishes the schema the host handed it, so a contributed key reaches the session', () => {
  // The host's `sessionSchema` already carries pi's own `projectTrust` and
  // whatever a plugin contributed - the computer a session runs in - and a
  // session that published `schemaOf()` alone would draw no control for it.
  const computer = {
    type: 'string',
    title: 'Computer',
    description: 'The computer://<id> this session runs in.',
    sessionMutable: false,
  };
  const { session } = opened({
    schema: () => ({ type: 'object', properties: { projectTrust: { type: 'string' }, computer } }),
  });
  const state = session.sessionState() as Bag;
  const properties = ((state.config as Bag).schema as Bag).properties as Bag;
  expect(properties.computer).toEqual(computer);
  expect(properties.projectTrust).toBeDefined();
});

// Models ------------------------------------------------------------------

it('spells a model id the way pi spells one, so two providers stay apart', () => {
  expect(idOf({ provider: 'openai', id: 'gpt-5' })).toBe('openai/gpt-5');
});

it('resolves a qualified id, and a bare one only when it is unambiguous', () => {
  const models = [
    { provider: 'openai', id: 'gpt-5' },
    { provider: 'azure', id: 'gpt-5' },
    { provider: 'anthropic', id: 'claude-opus-5' },
  ];
  expect(modelFor(models, 'azure/gpt-5')?.provider).toBe('azure');
  expect(modelFor(models, 'claude-opus-5')?.provider).toBe('anthropic');
  // Two providers answer to it, so guessing would run the turn on somebody's
  // other account.
  expect(modelFor(models, 'gpt-5')).toBeUndefined();
  // Unless it is already the one this session is on.
  expect(modelFor(models, 'gpt-5', { provider: 'azure', id: 'gpt-5' })?.provider).toBe('azure');
});

it('offers the thinking form only for a model with more than one level', () => {
  const many = offered({ provider: 'anthropic', id: 'claude-opus-5' }, ['off', 'high']);
  expect((many.configSchema as Bag)).toBeDefined();
  // A form with one answer is a control nobody can use.
  expect(offered({ provider: 'openai', id: 'gpt-5' }, ['off']).configSchema).toBeUndefined();
});

it('says a model context window and output limit when pi knows them', () => {
  const known = offered({ provider: 'anthropic', id: 'claude-opus-5', contextWindow: 200000, maxTokens: 64000 }, ['off']);
  expect(known.maxContextWindow).toBe(200000);
  expect(known.maxOutputTokens).toBe(64000);
  const bare = offered({ provider: 'openai', id: 'gpt-5' }, ['off']);
  expect(bare.maxContextWindow).toBeUndefined();
  expect(bare.maxOutputTokens).toBeUndefined();
});

it('offers each model the context window pi reports', async () => {
  const { session } = opened();
  session.begin('t1', 'hello');
  await settled();
  expect(session.models().map((one) => one.id))
    .toEqual(['anthropic/claude-opus-5', 'openai/gpt-5']);
});

it('tells the host once pi has listed its models, and only once', async () => {
  const heard: string[][] = [];
  let session: ReturnType<typeof opened>['session'] | undefined;
  ({ session } = opened({
    onHandshake: () => { heard.push((session?.models() ?? []).map((one) => one.id)); },
  } as Partial<Start>));
  session.begin('t1', 'hello');
  await settled();
  session.begin('t2', 'again');
  await settled();
  expect(heard).toEqual([['anthropic/claude-opus-5', 'openai/gpt-5']]);
});

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
  expect(session.completeToolCall?.('c1', 'other', { text: 'not mine', ok: true })).toBe(false);
  await settled();
  expect(answered).toBeUndefined();
  expect(session.completeToolCall?.('c1', 'editor', { text: 'opened it', ok: true })).toBe(true);
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
  session.completeToolCall?.('c1', 'editor', { text: 'it refused', ok: false });
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

it('asks a person before a call runs, and runs it on their answer', async () => {
  const { session, pi, last } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  const waiting = driveCall(pi, 'c1', 'bash', { command: 'ls' });
  await settled();
  expect(session.status()).toBe(Status.InputNeeded);
  expect(last('chat/toolCallReady')?.confirmed).toBeUndefined();
  expect(last('chat/toolCallReady')?.confirmationTitle).toBe('Run bash?');
  expect((last('session/inputNeededSet')?.request as Bag).kind).toBe('toolConfirmation');
  session.confirm('c1', true);
  expect(await waiting).toBeUndefined();
  expect(last('chat/toolCallConfirmed')?.approved).toBe(true);
  expect(last('chat/toolCallConfirmed')?.confirmed).toBe('user-action');
  expect(session.status()).toBe(Status.InProgress);
});

it('answers what it is waiting on in its state, so a client that connects late sees the question', async () => {
  const { session, pi, last } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  expect(session.sessionState().inputNeeded).toBeUndefined();
  const waiting = driveCall(pi, 'c1', 'bash', { command: 'ls' });
  await settled();
  const sentEntry = last('session/inputNeededSet')?.request;
  expect(session.sessionState().inputNeeded).toEqual([sentEntry]);
  session.confirm('c1', true);
  await waiting;
  expect(session.sessionState().inputNeeded).toBeUndefined();
});

it('blocks a declined call with the reason the model reads', async () => {
  const { session, pi } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  const waiting = driveCall(pi, 'c1', 'bash', { command: 'rm -rf /' });
  await settled();
  session.confirm('c1', false);
  expect(await waiting).toEqual({ block: true, reason: 'The person declined this action' });
});

it('answers two waiting calls independently, and a cancel answers both it leaves', async () => {
  const { session, pi, sent } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  let first: Bag | undefined;
  let second: Bag | undefined;
  const one = driveCall(pi, 'c1', 'bash', { command: 'ls' })
    .then((result) => { first = result; });
  const two = driveCall(pi, 'c2', 'edit', { path: join(root, 'a.txt') })
    .then((result) => { second = result; });
  await settled();
  expect(session.status()).toBe(Status.InputNeeded);
  session.confirm('c1', true);
  await one;
  expect(first).toBeUndefined();
  // The second is still a question, so the session is still waiting.
  expect(session.status()).toBe(Status.InputNeeded);
  session.cancel('t1');
  await two;
  expect(second).toEqual({ block: true, reason: 'The turn was stopped' });

  // Each question the cancel left is answered as cancelled and taken off the list.
  expect(sent.filter((one) => one.action.type === 'chat/toolCallConfirmed'
    && one.action.approved === false)).toHaveLength(1);
  expect(sent.filter((one) => one.action.type === 'session/inputNeededRemoved')).toHaveLength(2);
  expect(session.status()).not.toBe(Status.InputNeeded);
  const turns = session.chatState().turns as Bag[];
  const parts = turns[turns.length - 1]?.responseParts as Bag[];
  expect((parts.find((part) => part.id === 'c2')?.toolCall as Bag).status).toBe('cancelled');
});

it.each([
  ['bash', { command: 'ls -la' }, 'ls -la'],
  ['powershell', { command: 'Get-ChildItem' }, 'Get-ChildItem'],
  ['read', { path: 'a.ts' }, 'a.ts'],
  ['edit', { path: 'a.ts', edits: [] }, 'a.ts'],
  ['write', { path: 'b.ts', content: '' }, 'b.ts'],
  ['grep', { pattern: 'TODO' }, 'TODO'],
  ['find', { pattern: '*.ts' }, '*.ts'],
  ['ls', { path: 'src' }, 'src'],
  ['ls', {}, '.'],
  ['mystery', { anything: 1 }, 'mystery'],
])('draws a live %s call by what it runs on, while it runs and once it is done', async (name, input, said) => {
  const { session, pi, last } = opened({ settings: { permissionMode: 'bypassPermissions' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', name, input);
  expect(last('chat/toolCallReady')?.invocationMessage).toBe(said);
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c1', toolName: name, result: 'ok', isError: false });
  expect((last('chat/toolCallComplete')?.result as Bag).pastTenseMessage).toBe(said);
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect(parts.find((one) => one.id === 'c1')?.toolCall).toMatchObject({ invocationMessage: said, pastTenseMessage: said });
});

it('draws an asked call by what it runs on, and keeps the tool in its question', async () => {
  const { session, pi, last } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  const waiting = driveCall(pi, 'c1', 'bash', { command: 'ls -la' });
  await settled();
  expect(last('chat/toolCallReady')).toMatchObject({ invocationMessage: 'ls -la', confirmationTitle: 'Run bash?' });
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect(parts.find((one) => one.id === 'c1')?.toolCall).toMatchObject({ invocationMessage: 'ls -la' });
  session.confirm('c1', false);
  await waiting;
});

it('opens one row for an asked call, starts it once and readies it once', async () => {
  const { session, pi, sent } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  const waiting = driveCall(pi, 'c1', 'bash', { command: 'ls' });
  await settled();
  const starts = sent.filter((one) => one.action.type === 'chat/toolCallStart');
  const readies = sent.filter((one) => one.action.type === 'chat/toolCallReady');
  expect(starts).toHaveLength(1);
  expect(readies).toHaveLength(1);
  expect(readies[0]?.action.confirmed).toBeUndefined();
  expect(readies[0]?.action.confirmationTitle).toBe('Run bash?');
  expect(readies[0]?.action.toolInput).toBe('{"command":"ls"}');
  // The start pi sent is the row the question moved, not a second one.
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect(parts.filter((one) => one.id === 'c1')).toHaveLength(1);
  expect((parts.find((one) => one.id === 'c1')?.toolCall as Bag).status).toBe('pending-confirmation');
  expect(callStatuses(sent).get('c1')).toBe('pending-confirmation');
  session.confirm('c1', false);
  await waiting;
});

it('completes a call pi failed before its hook, as a client folds it', async () => {
  const { session, pi, sent } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  // An unknown tool or arguments that fail validation: pi opens the row and
  // closes it with an error, and the `tool_call` hook never runs.
  pi.raise({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'nope', args: {} });
  pi.raise({
    type: 'tool_execution_end',
    toolCallId: 'c1',
    toolName: 'nope',
    result: { content: [{ type: 'text', text: 'Tool nope not found' }] },
    isError: true,
  });
  await settled();
  expect(callStatuses(sent).get('c1')).toBe('completed');
  const readies = sent.filter((one) => one.action.type === 'chat/toolCallReady');
  expect(readies).toHaveLength(1);
  expect(readies[0]?.action.confirmed).toBe('not-needed');
});

it('does not send a client tool to its client until the person approves it', async () => {
  const bound: BoundTool = {
    definition: { name: 'editor__open' },
    owner: 'editor',
    effects: { writes: true },
  };
  const { session, pi, sent } = opened({
    tools: [bound],
    settings: { permissionMode: 'default' },
  } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  const waiting = driveCall(pi, 'c1', 'editor__open', {});
  await settled();
  const contributor = { kind: 'client', clientId: 'editor' };
  const start = sent.find((one) => one.action.type === 'chat/toolCallStart')?.action;
  const ready = sent.find((one) => one.action.type === 'chat/toolCallReady')?.action;
  expect(start?.contributor).toEqual(contributor);
  expect(ready?.contributor).toEqual(contributor);
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect((parts.find((one) => one.id === 'c1')?.toolCall as Bag).contributor).toEqual(contributor);
  // It is a question before it is anyone's to run: nothing marks it ready for
  // the client until a person answers.
  expect(callStatuses(sent).get('c1')).toBe('pending-confirmation');
  expect(session.status()).toBe(Status.InputNeeded);
  expect(session.toolCallOwner?.('c1')).toBeUndefined();
  session.confirm('c1', true);
  await waiting;

  // pi runs the approved tool, which is when the client is asked.
  const tool = pi.opens[0]?.tools?.find((one) => one.name === 'editor__open');
  const running = tool!.execute('c1', {} as never, undefined, undefined, undefined as never);
  await settled();
  expect(session.toolCallOwner?.('c1')).toBe('editor');
  expect(session.completeToolCall?.('c1', 'editor', { text: 'opened', ok: true })).toBe(true);
  await running;
});

it('keeps a declined call cancelled in the snapshot and for a client', async () => {
  const { session, pi, sent } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  const waiting = driveCall(pi, 'c1', 'bash', { command: 'rm -rf /' });
  await settled();
  session.confirm('c1', false);
  await waiting;
  // pi reports the blocked call as a failed execution.
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: 'blocked', isError: true });
  await settled();
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect((parts.find((one) => one.id === 'c1')?.toolCall as Bag).status).toBe('cancelled');
  expect(callStatuses(sent).get('c1')).toBe('cancelled');
});

it('still asks under projectTrust deny, because the inline extension is not the project\'s own', async () => {
  const { session, pi } = opened({}, { projectTrust: 'deny' });
  session.begin('t1', 'hello');
  await settled();
  expect(pi.opens[0]?.onToolCall).toBeDefined();
});

// Permission modes --------------------------------------------------------

/** What one call gets under a mode: it runs, it asks, or it is refused. */
async function verdict(
  mode: string,
  toolName: string,
  input: Bag,
  tools: BoundTool[] = [],
): Promise<'run' | 'ask' | 'refused'> {
  const { session, pi } = opened({ tools, settings: { permissionMode: mode } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  let resolved = false;
  let answer: Bag | undefined;
  void driveCall(pi, 'c1', toolName, input).then((result) => { resolved = true; answer = result; });
  await settled();
  if (resolved) {
    session.close();
    return answer === undefined ? 'run' : 'refused';
  }
  session.confirm('c1', false);
  await settled();
  session.close();
  return 'ask';
}

it('decides each mode the way the siblings do', async () => {
  const tools: BoundTool[] = [
    { definition: { name: 'destructive_tool' }, run: async () => 'x', effects: { destructive: true } },
    { definition: { name: 'writing_tool' }, run: async () => 'x', effects: { writes: true } },
    { definition: { name: 'plain_tool' }, run: async () => 'x' },
  ];
  const inside = join(root, 'a.txt');
  const outside = join(tmpdir(), 'elsewhere', 'a.txt');
  const cases: [string, string, Bag, 'run' | 'ask' | 'refused'][] = [
    ['default', 'edit', { path: inside }, 'ask'],
    ['default', 'edit', { path: outside }, 'ask'],
    ['default', 'bash', { command: 'ls' }, 'ask'],
    ['default', 'read', { path: inside }, 'run'],
    ['default', 'destructive_tool', {}, 'ask'],
    ['default', 'writing_tool', {}, 'ask'],
    ['default', 'plain_tool', {}, 'run'],
    ['acceptEdits', 'edit', { path: inside }, 'run'],
    ['acceptEdits', 'edit', { path: outside }, 'ask'],
    ['acceptEdits', 'bash', { command: 'ls' }, 'ask'],
    ['acceptEdits', 'read', { path: inside }, 'run'],
    ['acceptEdits', 'destructive_tool', {}, 'ask'],
    ['acceptEdits', 'writing_tool', {}, 'ask'],
    ['acceptEdits', 'plain_tool', {}, 'run'],
    ['plan', 'edit', { path: inside }, 'refused'],
    ['plan', 'bash', { command: 'ls' }, 'refused'],
    ['plan', 'read', { path: inside }, 'run'],
    ['plan', 'destructive_tool', {}, 'refused'],
    ['plan', 'writing_tool', {}, 'refused'],
    ['auto', 'edit', { path: inside }, 'run'],
    ['auto', 'bash', { command: 'ls' }, 'ask'],
    ['auto', 'read', { path: inside }, 'run'],
    ['auto', 'destructive_tool', {}, 'ask'],
    ['auto', 'writing_tool', {}, 'run'],
    ['auto', 'plain_tool', {}, 'run'],
    ['bypassPermissions', 'edit', { path: outside }, 'run'],
    ['bypassPermissions', 'bash', { command: 'ls' }, 'run'],
    ['bypassPermissions', 'destructive_tool', {}, 'run'],
    ['dontAsk', 'edit', { path: inside }, 'refused'],
    ['dontAsk', 'bash', { command: 'ls' }, 'refused'],
    ['dontAsk', 'read', { path: inside }, 'run'],
    ['dontAsk', 'destructive_tool', {}, 'refused'],
    ['dontAsk', 'writing_tool', {}, 'refused'],
    ['dontAsk', 'plain_tool', {}, 'run'],
  ];
  for (const [mode, toolName, input, expected] of cases) {
    expect([mode, toolName, await verdict(mode, toolName, input, tools)], `${mode} ${toolName}`)
      .toEqual([mode, toolName, expected]);
  }
});

it('judges a path where pi will use it, not where the string points', async () => {
  const elsewhere = mkdtempSync(join(tmpdir(), 'ahpd-pi-out-'));
  symlinkSync(elsewhere, join(root, 'link'));
  try {
    expect(await verdict('acceptEdits', 'write', { path: '~/.bashrc' })).toBe('ask');
    expect(await verdict('acceptEdits', 'write', { path: '@/etc/x' })).toBe('ask');
    expect(await verdict('acceptEdits', 'write', { path: join(root, 'link', 'x') })).toBe('ask');
    // The same resolution lets a relative path inside the directory through.
    expect(await verdict('acceptEdits', 'write', { path: 'inside.txt' })).toBe('run');
  }
  finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

it('asks about a read outside the workspace, as cofold does', async () => {
  expect(await verdict('default', 'read', { path: '/etc/hosts' })).toBe('ask');
  expect(await verdict('acceptEdits', 'read', { path: '/etc/hosts' })).toBe('ask');
  expect(await verdict('plan', 'read', { path: '/etc/hosts' })).toBe('ask');
  expect(await verdict('dontAsk', 'read', { path: '/etc/hosts' })).toBe('refused');
  // A read inside the workspace does not ask.
  expect(await verdict('default', 'read', { path: join(root, 'a.txt') })).toBe('run');
  // A read that names no path works where the session does.
  expect(await verdict('default', 'ls', {})).toBe('run');
});

it('runs a client tool that declares no effects, as cofold does', async () => {
  const bound: BoundTool = { definition: { name: 'editor__peek' }, owner: 'editor' };
  expect(await verdict('default', 'editor__peek', {}, [bound])).toBe('run');
});

it('keeps pi own effects for a name it owns, even when a host tool declares others', async () => {
  const shadow: BoundTool = { definition: { name: 'bash' }, run: async () => 'x', effects: { reads: true } };
  expect(await verdict('default', 'bash', { command: 'ls' }, [shadow])).toBe('ask');
});

it('names the mode in a refusal rather than asking anybody', async () => {
  const { session, pi } = opened({ settings: { permissionMode: 'plan' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  const answer = await pi.opens[0]?.onToolCall!(
    { type: 'tool_call', toolCallId: 'c1', toolName: 'edit', input: { path: join(root, 'a.txt') } } as never,
  ) as Bag;
  expect(answer.block).toBe(true);
  expect(String(answer.reason)).toContain('plan');
  expect(session.status()).toBe(Status.InProgress);
});

it('advertises the six permission modes, defaulting to default', () => {
  const agent = piAgent({}, [root]);
  const properties = ((agent.schema?.() as Bag).properties as Bag);
  const mode = properties.permissionMode as Bag;
  expect(mode.enum).toEqual(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk']);
  expect(mode.default).toBe('default');
  expect(mode.sessionMutable).toBe(true);
  expect((agent.defaults?.() as Bag).permissionMode).toBe('default');
});

it('takes a permission mode while the session runs, and refuses an unknown one', async () => {
  const { session } = opened();
  expect(await session.setConfig?.('permissionMode', 'plan')).toBe(true);
  expect(session.settings().permissionMode).toBe('plan');
  expect(await session.setConfig?.('permissionMode', 'nonsense')).toContain('permissionMode');
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

// Mapping -----------------------------------------------------------------

it('streams text into the part its block opened, and into the snapshot', () => {
  const one = turn();
  const [started] = streamed([]);
  mapEvent(one, started!);
  // A text block opens its part at its first words, not at its start.
  expect(mapEvent(one, {
    type: 'message_update',
    message: {} as never,
    assistantMessageEvent: { type: 'text_start', contentIndex: 0, partial: {} as never },
  })).toEqual([]);
  const actions = mapEvent(one, {
    type: 'message_update',
    message: {} as never,
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello', partial: {} as never },
  });
  expect(actions).toEqual([
    { type: 'chat/responsePart', turnId: 't1', part: { id: 't1:1:0', kind: 'markdown', content: '' } },
    { type: 'chat/delta', turnId: 't1', partId: 't1:1:0', content: 'hello' },
  ]);
  // The snapshot is the parts, not a replay of the actions.
  expect(one.parts[0]?.content).toBe('hello');
});

it('keeps the whitespace a text block starts with in its one part', () => {
  const one = turn();
  const [started] = streamed([]);
  mapEvent(one, started!);
  const text = (delta: string): AgentSessionEvent => ({
    type: 'message_update',
    message: {} as never,
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta, partial: {} as never },
  });
  expect(mapEvent(one, text(' '))).toEqual([]);
  expect(mapEvent(one, text('\n'))).toEqual([]);
  expect(mapEvent(one, text('hello'))).toEqual([
    { type: 'chat/responsePart', turnId: 't1', part: { id: 't1:1:0', kind: 'markdown', content: '' } },
    { type: 'chat/delta', turnId: 't1', partId: 't1:1:0', content: ' \nhello' },
  ]);
  expect(mapEvent(one, text(' '))).toEqual([{ type: 'chat/delta', turnId: 't1', partId: 't1:1:0', content: ' ' }]);
  expect(one.parts.map((p) => [p.kind, p.content])).toEqual([['markdown', ' \nhello ']]);
});

it('opens a thought\'s part once, however much pi thinks, and the next thought its own', () => {
  const one = turn();
  const thinking = (contentIndex: number, delta: string): AgentSessionEvent => ({
    type: 'message_update',
    message: {} as never,
    assistantMessageEvent: { type: 'thinking_delta', contentIndex, delta, partial: {} as never },
  });
  // A delta whose block never announced a start still opens it first.
  const first = mapEvent(one, thinking(0, 'hm'));
  expect(first.map((a) => a.type)).toEqual(['chat/responsePart', 'chat/reasoning']);
  const second = mapEvent(one, thinking(0, 'm'));
  expect(second.map((a) => a.type)).toEqual(['chat/reasoning']);
  const third = mapEvent(one, thinking(1, 'so'));
  expect(third.map((a) => a.type)).toEqual(['chat/responsePart', 'chat/reasoning']);
  expect(one.parts.map((p) => [p.kind, p.content])).toEqual([['reasoning', 'hmm'], ['reasoning', 'so']]);
});

it('keeps thinking, a call and thinking again in the order pi wrote them, live and replayed', async () => {
  const { replayEntries } = await import('../src/replay.js');
  const call = { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'a.ts' } };
  const shapes: Bag[][][] = [
    // One message holding all four blocks.
    [[{ type: 'thinking', thinking: 'THINK-1' }, call, { type: 'thinking', thinking: 'THINK-2' }, { type: 'text', text: 'REPLY' }]],
    // The call ending the first message, and the answer in a second.
    [[{ type: 'thinking', thinking: 'THINK-1' }, call], [{ type: 'thinking', thinking: 'THINK-2' }, { type: 'text', text: 'REPLY' }]],
  ];
  for (const messages of shapes) {
    const live = turn('u1');
    for (const content of messages) for (const event of streamed(content)) mapEvent(live, event);
    const seen = live.parts.map((p) => [p.id, p.kind, p.kind === 'toolCall' ? (p.toolCall as Bag).toolCallId : p.content]);
    expect(seen.map(([, kind, content]) => [kind, content])).toEqual([
      ['reasoning', 'THINK-1'], ['toolCall', 'c1'], ['reasoning', 'THINK-2'], ['markdown', 'REPLY'],
    ]);

    const at = new Date().toISOString();
    const entries: Bag[] = [
      { type: 'message', id: 'u1', parentId: null, timestamp: at, message: { role: 'user', content: 'go', timestamp: 0 } },
    ];
    messages.forEach((content, index) => {
      entries.push({ type: 'message', id: `a${index}`, parentId: 'u1', timestamp: at, message: answer(content, 'stop') });
      if (content.includes(call)) {
        entries.push({
          type: 'message',
          id: `r${index}`,
          parentId: `a${index}`,
          timestamp: at,
          message: { role: 'toolResult', toolCallId: 'c1', toolName: 'read', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 0 },
        });
      }
    });
    const { turns } = replayEntries(entries as never);
    const replayed = turns[0]!.parts.map((p) => [p.id, p.kind, p.kind === 'toolCall' ? (p.toolCall as Bag).toolCallId : p.content]);
    expect(replayed).toEqual(seen);
  }
});

it('opens no part for a text block that is only whitespace, live and replayed', async () => {
  const { replayEntries } = await import('../src/replay.js');
  const call = { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'a.ts' } };
  // Kimi K2.6's shape: a blank text block between each thought and its call.
  const messages: Bag[][] = [
    [{ type: 'thinking', thinking: 'THINK-1' }, { type: 'text', text: ' ' }, call],
    [{ type: 'thinking', thinking: 'THINK-2' }, { type: 'text', text: 'REPLY' }],
  ];
  const live = turn('u1');
  const sent: Bag[] = [];
  for (const content of messages) for (const event of streamed(content)) sent.push(...mapEvent(live, event));
  const seen = live.parts.map((p) => [p.id, p.kind, p.kind === 'toolCall' ? (p.toolCall as Bag).toolCallId : p.content]);
  expect(seen).toEqual([
    ['u1:1:0', 'reasoning', 'THINK-1'], ['c1', 'toolCall', 'c1'], ['u1:2:0', 'reasoning', 'THINK-2'], ['u1:2:1', 'markdown', 'REPLY'],
  ]);
  expect(sent.filter((a) => a.type === 'chat/delta').map((a) => a.content)).toEqual(['REPLY']);

  const at = new Date().toISOString();
  const entries: Bag[] = [
    { type: 'message', id: 'u1', parentId: null, timestamp: at, message: { role: 'user', content: 'go', timestamp: 0 } },
    { type: 'message', id: 'a0', parentId: 'u1', timestamp: at, message: answer(messages[0]!, 'toolUse') },
    {
      type: 'message',
      id: 'r0',
      parentId: 'a0',
      timestamp: at,
      message: { role: 'toolResult', toolCallId: 'c1', toolName: 'read', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 0 },
    },
    { type: 'message', id: 'a1', parentId: 'r0', timestamp: at, message: answer(messages[1]!, 'stop') },
  ];
  const { turns } = replayEntries(entries as never);
  const replayed = turns[0]!.parts.map((p) => [p.id, p.kind, p.kind === 'toolCall' ? (p.toolCall as Bag).toolCallId : p.content]);
  expect(replayed).toEqual(seen);
});

it('opens a call\'s row when the model starts writing it, and starts it once', () => {
  const one = turn();
  const events = streamed([{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }]);
  const starts = events
    .map((event) => [event, mapEvent(one, event).filter((a) => a.type === 'chat/toolCallStart')] as const)
    .filter(([, found]) => found.length > 0);
  expect(starts).toHaveLength(1);
  expect(starts[0]![1]).toHaveLength(1);
  expect((starts[0]![0] as Bag).assistantMessageEvent).toMatchObject({ type: 'toolcall_start' });
});

it('opens a tool call and leaves its ready to the hook', () => {
  const one = turn();
  const actions = mapEvent(one, {
    type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: { command: 'ls' },
  });
  expect(actions.map((a) => a.type)).toEqual(['chat/toolCallStart']);
  expect(actions[0]?.toolName).toBe('bash');
});

it('closes a failed call with the error a client shows', () => {
  const one = turn();
  mapEvent(one, { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: {} });
  const done = mapEvent(one, {
    type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: 'no such file', isError: true,
  }).find((action) => action.type === 'chat/toolCallComplete');
  expect(done).toBeDefined();
  expect((done?.result as Bag).success).toBe(false);
  expect(((done?.result as Bag).error as Bag).message).toBe('no such file');
});

it('lands a shell delta on the call that opened the row, and drops an orphan', () => {
  const one = turn();
  mapEvent(one, { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: {} });
  expect(mapEvent(one, { type: 'bash_execution_update', id: 'c1', delta: 'line\n' })
    .map((a) => a.type)).toEqual(['chat/toolCallContentChanged']);
  expect(mapEvent(one, { type: 'bash_execution_update', id: 'nobody', delta: 'x' })).toEqual([]);
});

it('says nothing for an event it has no action for, rather than throwing', () => {
  expect(mapEvent(turn(), { type: 'summarization_retry_finished' })).toEqual([]);
  expect(mapEvent(turn(), { type: 'queue_update', steering: [], followUp: [] })).toEqual([]);
});

it('reads a tool result whatever shape it came in', () => {
  expect(resultText('plain')).toBe('plain');
  expect(resultText({ output: 'from output' })).toBe('from output');
  expect(resultText({ content: [{ text: 'a' }, { text: 'b' }] })).toBe('a\nb');
  expect(resultText(undefined)).toBe('');
});

it('tells "this event says nothing about activity" from "it is idle now"', () => {
  expect(activityOf({ type: 'agent_settled' })).toBeUndefined();
  expect(activityOf({ type: 'summarization_retry_finished' })).toBe(false);
  expect(activityOf({ type: 'tool_execution_start', toolCallId: 'c', toolName: 'bash', args: {} }))
    .toBe('Running bash');
});

// The session -------------------------------------------------------------

it('opens a turn with no part, before anything streams into it', async () => {
  const { session, types } = opened();
  session.begin('t1', 'hello');
  await settled();
  const chat = types('chat');
  expect(chat[0]).toBe('chat/turnStarted');
  // pi wrote nothing, so the turn holds nothing.
  expect(chat).not.toContain('chat/responsePart');
  expect(chat).toContain('chat/turnComplete');
  expect((session.chatState().turns as Bag[])[0]?.responseParts).toEqual([]);
});

it('skips a call the model was still writing when the turn stopped, in the snapshot too', async () => {
  const { session, pi } = opened();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  const events = streamed([{ type: 'toolCall', id: 'c1', name: 'write', arguments: {} }]);
  // The call's start and nothing after: the turn stops mid-arguments.
  for (const event of events.slice(0, 2)) pi.raise(event);
  session.cancel('t1');
  await settled();
  const turns = session.chatState().turns as Bag[];
  const row = (turns[0]?.responseParts as Bag[]).find((one) => one.id === 'c1')?.toolCall as Bag;
  expect(row).toMatchObject({ status: 'cancelled', reason: 'skipped' });
});

it('ends the turn on pi settling, not on the prompt returning', async () => {
  const { session, pi, types } = opened();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  expect(types('chat')).not.toContain('chat/turnComplete');
  // A run pi will retry is not a turn that ended.
  pi.raise({ type: 'agent_end', messages: [], willRetry: true });
  await settled();
  expect(types('chat')).not.toContain('chat/turnComplete');
  pi.raise({ type: 'agent_settled' });
  await settled();
  expect(types('chat')).toContain('chat/turnComplete');
});

it('announces an edit before and after, for the absolute path, on the running turn', async () => {
  const edits: [string, string, string][] = [];
  const { session, pi } = opened({
    settings: { permissionMode: 'bypassPermissions' },
    onFileEdit: (turnId, path, phase) => { edits.push([turnId, path, phase]); },
  } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', 'edit', { path: 'src/a.ts', oldText: 'a', newText: 'b' });
  await driveCall(pi, 'c2', 'read', { path: 'src/b.ts' });
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c2', toolName: 'read', result: 'b', isError: false });
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'edit', result: 'ok', isError: false });
  expect(edits).toEqual([
    ['t1', join(root, 'src/a.ts'), 'before'],
    ['t1', join(root, 'src/a.ts'), 'after'],
  ]);
  pi.raise({ type: 'agent_settled' });
  await settled();
  expect(edits).toHaveLength(2);
});

it('settles a write that never ended when the turn does', async () => {
  const edits: [string, string, string][] = [];
  const { session, pi } = opened({
    settings: { permissionMode: 'bypassPermissions' },
    onFileEdit: (turnId, path, phase) => { edits.push([turnId, path, phase]); },
  } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  const elsewhere = join(root, 'elsewhere', 'c.ts');
  await driveCall(pi, 'c1', 'write', { path: elsewhere, content: 'c' });
  expect(edits).toEqual([['t1', elsewhere, 'before']]);
  pi.raise({ type: 'agent_settled' });
  await settled();
  expect(edits).toEqual([['t1', elsewhere, 'before'], ['t1', elsewhere, 'after']]);
});

it('settles an open edit on its own turn when the prompt throws, and leaks nothing into the next', async () => {
  const edits: [string, string, string][] = [];
  const { session, pi } = opened({
    settings: { permissionMode: 'bypassPermissions' },
    onFileEdit: (turnId, path, phase) => { edits.push([turnId, path, phase]); },
  } as Partial<Start>);
  const prompt = pi.backend.prompt;
  pi.backend.prompt = async () => {
    pi.raise({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'edit', args: { path: 'a.ts' } });
    throw new Error('provider went away');
  };
  session.begin('t1', 'hello');
  await settled();
  const path = join(root, 'a.ts');
  expect(edits).toEqual([['t1', path, 'before'], ['t1', path, 'after']]);
  pi.backend.prompt = prompt;
  session.begin('t2', 'again');
  await settled();
  expect(edits).toHaveLength(2);
});

it('moves the finished turn out of active and into the transcript', async () => {
  const { session } = opened();
  session.begin('t1', 'hello');
  await settled();
  const state = session.chatState();
  expect(state.activeTurn).toBeUndefined();
  expect((state.turns as Bag[]).map((one) => one.id)).toEqual(['t1']);
  expect(session.status()).toBe(1);
});

/**
 * One session that notes its own status as each ending action goes out.
 *
 * The host reads `status()` as it passes an ending action on, and announces
 * the session's row with whatever it read; a session still running at that
 * moment stays running in every client's list.
 */
function ending() {
  const at = new Map<string, number>();
  let status = (): number => -1;
  const one = opened({
    emit: (_channel: string, action: Bag) => {
      const type = String(action.type);
      if (type === 'chat/turnComplete' || type === 'chat/turnCancelled' || type === 'chat/error') at.set(type, status());
    },
  } as Partial<Start>);
  status = () => one.session.status();
  return { ...one, at };
}

it('is idle by the time it says a turn completed', async () => {
  const { session, at } = ending();
  session.begin('t1', 'hello');
  await settled();
  expect(at.get('chat/turnComplete')).toBe(Status.Idle);
});

it('is idle by the time it says a turn was cancelled', async () => {
  const { session, pi, at } = ending();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  session.cancel('t1');
  await settled();
  expect(at.get('chat/turnCancelled')).toBe(Status.Idle);
});

it('has failed by the time it says a turn failed', async () => {
  const { session, pi, at } = ending();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  pi.raise({
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'error', errorMessage: 'boom' },
  } as never);
  pi.raise({ type: 'agent_settled' });
  await settled();
  expect(at.get('chat/error')).toBe(Status.Error);
});

it('passes the chosen model and its thinking level through to pi', async () => {
  const { session, pi, types } = opened();
  session.begin('t1', 'hello', { id: 'openai/gpt-5', config: { [THINKING_KEY]: 'off' } });
  await settled();
  expect(pi.asked.find((one) => one.kind === 'choose'))
    .toEqual({ kind: 'choose', id: 'openai/gpt-5', config: { [THINKING_KEY]: 'off' } });
  expect(types('chat')).not.toContain('chat/error');
  expect(pi.asked.some((one) => one.kind === 'prompt')).toBe(true);
});

it('fails a turn that names a model pi does not have', async () => {
  const { session, pi, last, types } = opened();
  session.begin('t1', 'hello', { id: 'openrouter/nobody' });
  await settled();
  expect(((last('chat/error')?.part as Bag).error as Bag).message)
    .toBe('pi has no model openrouter/nobody');
  expect(pi.asked.some((one) => one.kind === 'prompt')).toBe(false);
  // The model is where it was, so the next turn runs on it rather than on the
  // one this turn asked for.
  session.begin('t2', 'again');
  await settled();
  expect((last('chat/turnStarted')?.message as Bag).model)
    .toEqual({ id: 'anthropic/claude-opus-5' });
  expect(types('chat')).toContain('chat/turnComplete');
});

it('opens a session on a configured model pi does not have', async () => {
  const { session, pi, types } = opened({}, { model: 'openrouter/nobody' });
  session.begin('t1', 'hello');
  await settled();
  expect(pi.asked.find((one) => one.kind === 'choose')).toEqual({ kind: 'choose', id: 'openrouter/nobody' });
  expect(pi.asked.some((one) => one.kind === 'prompt')).toBe(true);
  expect(types('chat')).not.toContain('chat/error');
});

it('runs a new session on the model the options name', async () => {
  const { session, pi } = opened({}, { model: 'openai/gpt-5' });
  session.begin('t1', 'hello');
  await settled();
  expect(pi.asked.find((one) => one.kind === 'choose')).toEqual({ kind: 'choose', id: 'openai/gpt-5' });
});

it('keeps a resumed session on the model its own file recorded', async () => {
  const { session, pi } = opened({ resume: 'pi-session-1' } as Partial<Start>, { model: 'openai/gpt-5' });
  session.begin('t1', 'hello');
  await settled();
  expect(pi.asked.find((one) => one.kind === 'choose')).toBeUndefined();
});

it('lets a turn choose over the configured model', async () => {
  const { session, pi } = opened({}, { model: 'openai/gpt-5' });
  session.begin('t1', 'hello', { id: 'anthropic/claude-opus-5' });
  await settled();
  expect(pi.asked.filter((one) => one.kind === 'choose').map((one) => one.id))
    .toEqual(['openai/gpt-5', 'anthropic/claude-opus-5']);
});

it('carries the model a turn runs on its message', async () => {
  const { session, last } = opened({}, { model: 'openai/gpt-5' });
  session.begin('t1', 'hello', { id: 'anthropic/claude-opus-5', config: { [THINKING_KEY]: 'high' } });
  await settled();
  const wanted = { id: 'anthropic/claude-opus-5', config: { [THINKING_KEY]: 'high' } };
  expect((last('chat/turnStarted')?.message as Bag).model).toEqual(wanted);
  const turn = (session.chatState().turns as Bag[]).find((one) => one.id === 't1');
  expect((turn?.message as Bag).model).toEqual(wanted);
});

it('carries the configured model when the turn names none', async () => {
  const { session, last } = opened({}, { model: 'openai/gpt-5' });
  session.begin('t1', 'hello');
  await settled();
  expect(((last('chat/turnStarted')?.message as Bag).model as Bag).id).toBe('openai/gpt-5');
});

it('leaves the model off a turn that has none', async () => {
  const { session, last } = opened();
  session.begin('t1', 'hello');
  await settled();
  expect((last('chat/turnStarted')?.message as Bag).model).toBeUndefined();
});

it('steers the running turn rather than queueing behind it', async () => {
  const { session, pi } = opened();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  expect(session.steer?.('t1', 'actually, stop')).toBe(true);
  expect(pi.asked.find((one) => one.kind === 'steer')?.text).toBe('actually, stop');
});

it('has nothing to steer when no turn is running, and says so', () => {
  const { session } = opened();
  expect(session.steer?.('t1', 'hello')).toBe(false);
});

it('queues a second message and runs it when the first turn ends', async () => {
  const { session, pi, types } = opened();
  pi.hold();
  session.begin('t1', 'first');
  await settled();
  session.begin('t2', 'second');
  await settled();
  expect(types('chat')).toContain('chat/pendingMessageSet');
  expect(pi.asked.filter((one) => one.kind === 'prompt').map((one) => one.text)).toEqual(['first']);

  pi.raise({ type: 'agent_settled' });
  await settled();
  expect(types('chat')).toContain('chat/pendingMessageRemoved');
  expect(pi.asked.filter((one) => one.kind === 'prompt').map((one) => one.text)).toEqual(['first', 'second']);
});

it('takes pi its own name for the conversation as the title', async () => {
  const { session, pi, last } = opened();
  session.begin('t1', 'hello');
  await settled();
  pi.raise({ type: 'session_info_changed', name: 'Refactor the parser' });
  expect(last('session/titleChanged')?.title).toBe('Refactor the parser');
  expect(session.title()).toBe('Refactor the parser');
});

it('names an unnamed session after the first thing said in it', async () => {
  const { session } = opened();
  session.begin('t1', 'Fix the tunnel forwarder\nand its test');
  await settled();
  expect(session.title()).toBe('Fix the tunnel forwarder');
});

it('renames pi too, so the title survives outside this host', async () => {
  const { session, pi } = opened();
  session.begin('t1', 'hello');
  await settled();
  session.setTitle?.('Something else');
  expect(pi.asked.find((one) => one.kind === 'rename')?.title).toBe('Something else');
});

it('reports the level pi moved to as a value in force', async () => {
  const { session, pi, last } = opened();
  session.begin('t1', 'hello');
  await settled();
  pi.raise({ type: 'thinking_level_changed', level: 'high' as never });
  expect((last('session/configChanged')?.values as Bag).thinkingLevel).toBe('high');
  expect(session.settings().thinkingLevel).toBe('high');
});

it('truncates by moving pi own leaf, which is what a rewind is', async () => {
  const { session, pi } = opened({ rewindAt: 'entry-7' } as Partial<Start>);
  session.begin('t1', 'hello');
  await settled();
  expect(pi.asked.find((one) => one.kind === 'rewind')?.entryId).toBe('entry-7');
});

it('answers where a watched turn ended, and nothing for one it never saw end', async () => {
  const { session, pi } = opened();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  // Still running, so there is no point to name yet.
  expect(session.endPoint?.('t1')).toBeUndefined();
  pi.setLeaf('entry-7');
  pi.raise({ type: 'agent_settled' });
  await settled();
  expect(session.endPoint?.('t1')).toBe('entry-7');
  expect(session.endPoint?.('never-watched')).toBeUndefined();
});

it('names where a watched turn ended as the point a fork copies through', async () => {
  const { session, pi } = opened();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  // Still running, so there is no point to name yet.
  expect(session.forkPoint?.('t1')).toBeUndefined();
  pi.setLeaf('entry-7');
  pi.raise({ type: 'agent_settled' });
  await settled();
  // The turn's last entry, not the prompt it began with: a fork copies the
  // conversation through the turn it names, answer included.
  expect(session.forkPoint?.('t1')).toBe('entry-7');
  expect(session.forkPoint?.('t1')).toBe(session.endPoint?.('t1'));
  // A turn this session never watched end has no leaf to name, and no second
  // map: `forkPoint` is `endPoint`.
  expect(session.forkPoint?.('never-watched')).toBeUndefined();
});

it('names no point for a !command turn, which is not pi running', async () => {
  const { session } = opened();
  session.ran?.('t1', 'echo hi', async () => ({ success: true, said: 'Ran echo hi', output: 'hi', code: 0 }));
  await settled();
  expect(session.forkPoint?.('t1')).toBeUndefined();
  expect(session.endPoint?.('t1')).toBeUndefined();
});

it('fails the turn when pi refuses to move the leaf back', async () => {
  const { session, pi, last } = opened({ rewindAt: 'entry-7' } as Partial<Start>);
  pi.refuseRewind();
  session.begin('t1', 'hello');
  await settled();
  expect(pi.asked.find((one) => one.kind === 'rewind')?.entryId).toBe('entry-7');
  const failure = last('chat/error');
  expect(((failure?.part as Bag).error as Bag).message).toContain('refused');
  expect(session.status()).toBe(2);
});

it('fails the turn on the last assistant message ending in error', async () => {
  const { session, pi, last } = opened();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  pi.raise({
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'error', errorMessage: '429 rate limited' },
  } as never);
  pi.raise({ type: 'agent_settled' });
  await settled();
  expect(((last('chat/error')?.part as Bag).error as Bag).message).toBe('429 rate limited');
  expect(session.status()).toBe(2);
  expect((session.chatState().turns as Bag[])[0]?.state).toBe('error');
});

it('does not fail a turn pi retried and then answered', async () => {
  const { session, pi, types } = opened();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  pi.raise({
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'error', errorMessage: 'boom' },
  } as never);
  // A run pi will retry is not a turn that ended, and the retry replaces the
  // error with an answer.
  pi.raise({ type: 'agent_end', messages: [], willRetry: true });
  pi.raise({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } } as never);
  pi.raise({ type: 'agent_settled' });
  await settled();
  expect(types('chat')).toContain('chat/turnComplete');
  expect(types('chat')).not.toContain('chat/error');
});

it('keeps a cancelled turn cancelled when its last message was aborted', async () => {
  const { session, pi, types } = opened();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  pi.raise({ type: 'message_end', message: { role: 'assistant', stopReason: 'aborted' } } as never);
  session.cancel('t1');
  await settled();
  expect(types('chat')).toContain('chat/turnCancelled');
  expect(types('chat')).not.toContain('chat/error');
});

it('sends what the turn used, before it ends, and keeps it on the transcript', async () => {
  const { session, pi, types, last } = opened();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  pi.raise({
    type: 'message_end',
    message: {
      role: 'assistant',
      stopReason: 'stop',
      provider: 'anthropic',
      model: 'claude-opus-5',
      usage: { input: 120, output: 30, cacheRead: 10, cacheWrite: 5, totalTokens: 165 },
    },
  } as never);
  pi.raise({ type: 'agent_settled' });
  await settled();
  const expected = {
    inputTokens: 120,
    outputTokens: 30,
    cacheReadTokens: 10,
    model: 'anthropic/claude-opus-5',
    _meta: { cacheWriteTokens: 5 },
  };
  expect(last('chat/usage')?.usage).toEqual(expected);
  const chat = types('chat');
  expect(chat.indexOf('chat/usage')).toBeLessThan(chat.indexOf('chat/turnComplete'));
  const turns = await piAgent({}, [root]).transcript?.('pi-session-1');
  expect(turns?.[0]?.usage).toEqual(expected);
});

it('sends no usage for a turn that had no assistant message', async () => {
  const { session, types } = opened();
  session.begin('t1', 'hello');
  await settled();
  expect(types('chat')).not.toContain('chat/usage');
});

it('sends no usage for a !command turn, which is not pi running', async () => {
  const { session, types } = opened();
  session.ran?.('t1', 'echo hi', async () => ({ success: true, said: 'Ran echo hi', output: 'hi', code: 0 }));
  await settled();
  expect(types('chat')).not.toContain('chat/usage');
});

it('sends no usage for an error that used no tokens', async () => {
  const { session, pi, types } = opened();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  pi.raise({
    type: 'message_end',
    message: {
      role: 'assistant',
      stopReason: 'error',
      errorMessage: '401 Unauthorized',
      provider: 'openrouter',
      model: 'x',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    },
  } as never);
  pi.raise({ type: 'agent_settled' });
  await settled();
  expect(types('chat')).toContain('chat/error');
  expect(types('chat')).not.toContain('chat/usage');
});

it('fails the turn with what went wrong when pi cannot run it', async () => {
  const pi = fakePi();
  const sent: { channel: string; action: Bag }[] = [];
  const session = piSession({}, {
    uri: 'ahp-session:/s1',
    chatUri: 'ahp-chat:/s1',
    settings: {},
    workingDirectory: root,
    schema: () => ({}),
    emit: (channel, action) => { sent.push({ channel, action }); },
  } as Start, (async () => { throw new Error('no model provider is configured'); }) as OpenPi);
  void pi;

  session.begin('t1', 'hello');
  await settled();
  const failure = sent.find((one) => one.action.type === 'chat/error')?.action;
  expect(((failure?.part as Bag).error as Bag).message).toBe('no model provider is configured');
  expect(session.status()).toBe(2);
});

it('refuses a setting it does not serve in words that say which of the two went wrong', async () => {
  const { session } = opened();
  expect(await session.setConfig?.('projectTrust', 'deny')).toBe(true);
  expect(await session.setConfig?.('projectTrust', 'maybe')).toBe('projectTrust is "trust" or "deny"');
  expect(await session.setConfig?.('somethingElse', 'plan')).toBe('pi sessions have no "somethingElse" setting');
});

it('reports no runtime switch for a customization rather than pretending', async () => {
  const { session } = opened();
  expect(await session.setCustomizationEnabled('skill', true)).toBe(false);
  expect(await session.startMcpServer('one')).toBe(false);
});

// The agent ---------------------------------------------------------------

it('claims only the directories the host serves', () => {
  const agent = piAgent({}, [root, '/work/other']);
  expect(agent.directories?.()).toEqual([root, '/work/other']);
  expect(agent.provider).toBe('pi');
  expect(agent.multipleDirectories).toBe(false);
});

it('offers pi models before a session exists, as a session offers them', async () => {
  const { session, pi } = opened();
  session.begin('t1', 'hello');
  await settled();
  const agent = piAgent({}, [root], pi.backend.models);
  const probed = await agent.probe?.();
  expect(probed).toEqual({ models: session.models(), customizations: [], commands: [] });
  expect(probed?.models.map((one) => one.id)).toEqual(['anthropic/claude-opus-5', 'openai/gpt-5']);
});

it('offers no models when pi runtime cannot be built, rather than failing the probe', async () => {
  const agent = piAgent({}, [root], async () => { throw new Error('auth.json is unreadable'); });
  expect(await agent.probe?.()).toEqual({ models: [], customizations: [], commands: [] });
});

it('has no transcript for a session with no file and no record', async () => {
  const agent = piAgent({ sessionDir: join(root, 'pi') }, [root]);
  expect(await agent.transcript?.('never-opened')).toBeUndefined();
});

it('reads back the turns of a session it did watch', async () => {
  const { session } = opened();
  session.begin('t1', 'hello');
  await settled();
  const agent = piAgent({ sessionDir: join(root, 'pi') }, [root]);
  const turns = await agent.transcript?.('pi-session-1');
  expect(turns?.map((one) => one.id)).toEqual(['t1']);
  expect(turns?.[0]?.message.text).toBe('hello');
  expect(turns?.[0]?.state).toBe('complete');
});

// A session from disk -------------------------------------------------------

/** What pi stores for one assistant message, with the fields a test varies. */
const answer = (content: Bag[], stopReason: string, extra: Bag = {}): never => ({
  role: 'assistant',
  content,
  api: 'anthropic-messages',
  provider: 'anthropic',
  model: 'claude-opus-5',
  usage: {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason,
  timestamp: Date.now(),
  ...extra,
}) as never;

/**
 * A pi session file, written by pi's own `SessionManager`: a model and a level
 * set first, pi's leading system message, a turn that thinks, answers and runs
 * a tool, and a second turn that fails.
 */
async function sessionOnDisk(sessionDir: string) {
  const { SessionManager } = await loadPi();
  const store = SessionManager.create(root, sessionDir);
  store.appendModelChange('anthropic', 'claude-opus-5');
  store.appendThinkingLevelChange('medium');
  store.appendMessage({ role: 'system', content: '', sections: { preamble: 'You are pi.' }, timestamp: Date.now() } as never);
  const first = store.appendMessage({ role: 'user', content: [{ type: 'text', text: 'read a.ts' }], timestamp: Date.now() });
  store.appendMessage(answer([
    { type: 'thinking', thinking: 'I should read it.' },
    { type: 'text', text: 'Reading it.' },
    { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.ts' } },
  ], 'toolUse'));
  store.appendMessage({
    role: 'toolResult',
    toolCallId: 'call-1',
    toolName: 'read',
    content: [{ type: 'text', text: 'export {};' }],
    isError: false,
    timestamp: Date.now(),
  } as never);
  const firstEnd = store.appendMessage(answer([{ type: 'text', text: ' It is empty.' }], 'stop'));
  const second = store.appendMessage({ role: 'user', content: 'again', timestamp: Date.now() });
  const secondEnd = store.appendMessage(answer([], 'error', {
    errorMessage: '429 rate limited',
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  }));
  return { id: store.getSessionId(), first, firstEnd, second, secondEnd };
}

it('rebuilds a session it never watched from pi file, with the parts a live turn has', async () => {
  const sessionDir = join(root, 'pi');
  const disk = await sessionOnDisk(sessionDir);
  const turns = await piAgent({ sessionDir }, [root]).transcript?.(disk.id);
  expect(turns?.map((one) => [one.id, one.message.text, one.state]))
    .toEqual([[disk.first, 'read a.ts', 'complete'], [disk.second, 'again', 'error']]);
  expect(turns?.[0]?.responseParts).toEqual([
    { id: `${disk.first}:1:0`, kind: 'reasoning', content: 'I should read it.' },
    { id: `${disk.first}:1:1`, kind: 'markdown', content: 'Reading it.' },
    {
      id: 'call-1',
      kind: 'toolCall',
      toolCall: {
        toolCallId: 'call-1',
        toolName: 'read',
        displayName: 'read',
        status: 'completed',
        invocationMessage: 'a.ts',
        toolInput: JSON.stringify({ path: 'a.ts' }),
        confirmed: 'not-needed',
        success: true,
        pastTenseMessage: 'a.ts',
        // The times pi's own entries carry for it, off the file.
        _meta: {
          'ahpd.startedAt': expect.any(String),
          'ahpd.endedAt': expect.any(String),
          'ahpd.durationMs': expect.any(Number),
        },
      },
    },
    { id: `${disk.first}:2:0`, kind: 'markdown', content: ' It is empty.' },
  ]);
  expect(turns?.[0]?.usage).toEqual({
    inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, model: 'anthropic/claude-opus-5', _meta: { cacheWriteTokens: 0 },
  });
  expect(turns?.[1]?.responseParts).toEqual([
    { kind: 'error', error: { errorType: 'turnFailed', message: '429 rate limited' } },
  ]);

  // The same turn run live, as pi raises it, reads the same.
  const { session, pi } = opened({ settings: { permissionMode: 'bypassPermissions' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'read a.ts');
  await settled();
  const asked = streamed([
    { type: 'thinking', thinking: 'I should read it.' },
    { type: 'text', text: 'Reading it.' },
    { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.ts' } },
  ]);
  // Up to the message's end: the call is then run as pi runs it, hook and all.
  for (const event of asked.slice(0, asked.findIndex((one) => one.type === 'message_end') + 1)) pi.raise(event);
  await driveCall(pi, 'call-1', 'read', { path: 'a.ts' });
  pi.raise({
    type: 'tool_execution_end',
    toolCallId: 'call-1',
    toolName: 'read',
    result: { content: [{ type: 'text', text: 'export {};' }] },
    isError: false,
  });
  for (const event of streamed([{ type: 'text', text: ' It is empty.' }])) pi.raise(event);
  pi.raise({ type: 'agent_settled' });
  await settled();
  const live = (session.allTurns()[0] as Bag).responseParts;
  // The times are the one thing the two do not share: live they are this
  // clock's and replayed they are pi's own entries', so they are taken off
  // both sides before the rest of the parts are compared.
  const back = (turns?.[0]?.responseParts ?? []) as Bag[];
  for (const parts of [live as Bag[], back]) {
    for (const part of parts) {
      if (part.kind === 'toolCall') delete (part.toolCall as Bag)._meta;
    }
  }
  expect(JSON.parse(JSON.stringify(live).replaceAll('t1:', `${disk.first}:`))).toEqual(back);
});

it('answers where a turn from pi file ended, once the session is resumed', async () => {
  const sessionDir = join(root, 'pi');
  const disk = await sessionOnDisk(sessionDir);
  const session = await piAgent({ sessionDir }, [root], async () => []).create({
    uri: 'ahp-session:/s1',
    chatUri: 'ahp-chat:/s1',
    settings: {},
    workingDirectory: root,
    schema: () => ({}),
    emit: () => {},
    resume: disk.id,
  } as Start);
  for (let i = 0; i < 200 && session.endPoint?.(disk.first) === undefined; i++) await settled();
  expect(session.endPoint?.(disk.first)).toBe(disk.firstEnd);
  expect(session.endPoint?.(disk.second)).toBe(disk.secondEnd);
  session.close();
});

it('keeps the turns from pi file in the record of a session resumed and run again', async () => {
  const sessionDir = join(root, 'pi');
  const disk = await sessionOnDisk(sessionDir);
  const pi = fakePi();
  (pi.backend as { id: string }).id = disk.id;
  const agent = piAgent({ sessionDir }, [root], async () => []);
  const resumed = { ...agent, create: (start: Start) => piSession({ sessionDir }, start, pi.open) };
  const session = await resumed.create({
    uri: 'ahp-session:/s1',
    chatUri: 'ahp-chat:/s1',
    settings: {},
    workingDirectory: root,
    schema: () => ({}),
    emit: () => {},
    resume: disk.id,
  } as Start);
  for (let i = 0; i < 200 && session.endPoint?.(disk.first) === undefined; i++) await settled();
  session.begin('t3', 'once more');
  await settled();
  const turns = await agent.transcript?.(disk.id);
  expect(turns?.map((one) => one.id)).toEqual([disk.first, disk.second, 't3']);
  expect(turns?.[2]?.state).toBe('complete');
  session.close();
});

it('reads a turn whose last answer was aborted as cancelled, as a stopped live turn is', async () => {
  const { replayEntries } = await import('../src/replay.js');
  const at = new Date().toISOString();
  const { turns } = replayEntries([
    { type: 'message', id: 'u1', parentId: null, timestamp: at, message: { role: 'user', content: 'go', timestamp: 0 } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp: at, message: answer([{ type: 'text', text: 'Start' }], 'aborted') },
  ] as never);
  expect(turns.map((one) => one.state)).toEqual(['cancelled']);
  expect(turns[0]?.parts).toEqual([{ id: 'u1:1:0', kind: 'markdown', content: 'Start' }]);
});

// The id a session is saved under --------------------------------------------

const CLIENT_ID = '0192f5e0-7c1a-7b3e-9a4d-2f6c8e1b3a57';

it('opens a new session under the UUID its URI names', async () => {
  const { session, pi } = opened({ uri: `ahp-session:/${CLIENT_ID}`, chatUri: `ahp-chat:/${CLIENT_ID}` });
  session.begin('t1', 'hello');
  await settled();
  expect(pi.opens[0]?.id).toBe(CLIENT_ID);
  expect(pi.opens[0]?.resume).toBeUndefined();
});

it('leaves the id to pi when the URI does not name a UUID', async () => {
  const { session, pi } = opened();
  session.begin('t1', 'hello');
  await settled();
  expect(pi.opens[0]?.id).toBeUndefined();
});

it('resumes under the id it was resumed with, not the URI', async () => {
  const { session, pi } = opened({ uri: `ahp-session:/${CLIENT_ID}`, resume: 'pi-session-1' });
  session.begin('t1', 'hello');
  await settled();
  expect(pi.opens[0]?.resume).toBe('pi-session-1');
  expect(pi.opens[0]?.id).toBeUndefined();
  expect(pi.opens[0]?.forkAt).toBeUndefined();
});

it('opens a fork at the entry the host named, rather than the source itself', async () => {
  const { session, pi } = opened({ uri: `ahp-session:/${CLIENT_ID}`, resume: 'pi-session-1', forkAt: 'entry-7' });
  session.begin('t2', 'hello');
  await settled();
  expect(pi.opens[0]?.resume).toBe('pi-session-1');
  expect(pi.opens[0]?.forkAt).toBe('entry-7');
  expect(pi.opens[0]?.id).toBeUndefined();
});

it('saves a new session under the id it was given, and lists it by that id', async () => {
  const sdk = await loadPi();
  const sessionDir = join(root, 'pi');
  const store = resumeOrCreate(sdk, { cwd: root, sessionDir, id: CLIENT_ID });
  expect(store.getSessionId()).toBe(CLIENT_ID);
  store.appendMessage({ role: 'user', content: 'hello', timestamp: Date.now() });
  store.appendMessage(answer([{ type: 'text', text: 'Hi.' }], 'stop'));
  expect(basename(store.getSessionFile() ?? '')).toMatch(new RegExp(`_${CLIENT_ID}\\.jsonl$`));
  const rows = await piAgent({ sessionDir }, [root]).list?.();
  expect(rows?.map((one) => one.id)).toEqual([CLIENT_ID]);
});

it('creates a resumed id that has no file under that id', async () => {
  const sdk = await loadPi();
  const store = resumeOrCreate(sdk, { cwd: root, sessionDir: join(root, 'pi'), resume: CLIENT_ID });
  expect(store.getSessionId()).toBe(CLIENT_ID);
});

it('forks a session from disk at the entry it was given, and leaves the source as it was', async () => {
  const sdk = await loadPi();
  const sessionDir = join(root, 'pi');
  const disk = await sessionOnDisk(sessionDir);
  const source = sdk.SessionManager.findById(root, disk.id, sessionDir) as string;
  const before = readFileSync(source, 'utf8');
  // Through the first turn, answer included: what came after it is not in the
  // copy, which is the whole difference from a resume.
  const store = resumeOrCreate(sdk, { cwd: root, sessionDir, resume: disk.id, forkAt: disk.firstEnd });
  expect(store.getSessionId()).not.toBe(disk.id);
  const branch = store.getBranch().map((one) => one.id);
  expect(branch).toContain(disk.first);
  expect(branch).toContain(disk.firstEnd);
  expect(branch).not.toContain(disk.second);
  expect(branch).not.toContain(disk.secondEnd);
  expect(readFileSync(store.getSessionFile() as string, 'utf8')).not.toContain('again');
  store.appendMessage({ role: 'user', content: 'after the fork', timestamp: Date.now() });
  expect(readFileSync(source, 'utf8')).toBe(before);
});

it('refuses a fork it cannot make rather than starting a conversation that is not one', async () => {
  const sdk = await loadPi();
  const sessionDir = join(root, 'pi');
  const disk = await sessionOnDisk(sessionDir);
  // Nothing to copy from.
  expect(() => resumeOrCreate(sdk, { cwd: root, sessionDir, forkAt: disk.firstEnd }))
    .toThrow(/needs the conversation it copies/);
  // A conversation pi has no file for. A resume would have started a new one
  // under the id it was given; a fork has nothing to copy and says so.
  expect(() => resumeOrCreate(sdk, { cwd: root, sessionDir, resume: 'no-such-session', forkAt: disk.firstEnd }))
    .toThrow(/no pi session to fork from/);
  // An entry the source does not have is pi's own refusal.
  expect(() => resumeOrCreate(sdk, { cwd: root, sessionDir, resume: disk.id, forkAt: 'no-such-entry' }))
    .toThrow(/not found/);
});

it('lists an empty directory as no sessions rather than failing', async () => {
  const agent = piAgent({ sessionDir: join(root, 'pi') }, [root]);
  expect(await agent.list?.()).toEqual([]);
});

// When a call ran ----------------------------------------------------------

/*
 * When a pi tool call started and ended, live and replayed.
 *
 * The protocol gives a call no time of its own, so the times ride in its
 * `_meta`, stamped from this plugin's clock live and from pi's own entries on a
 * replay. An action carrying a `_meta` replaces the call's whole bag, so the
 * ready, the approval and the completion each carry them again.
 */

/** The `_meta` an action carries, or an empty bag for one that carries none. */
const metaOf = (action: Bag | undefined): Bag => (action?._meta ?? {}) as Bag;

/** Whether an action carries a call's start, its end and how long it took. */
const timed = (action: Bag | undefined): boolean => {
  const meta = metaOf(action);
  return typeof meta['ahpd.startedAt'] === 'string'
    && typeof meta['ahpd.endedAt'] === 'string'
    && typeof meta['ahpd.durationMs'] === 'number';
};

it('says when a live call started and ended, on its ready and its complete', async () => {
  const { session, pi, sent } = opened({ settings: { permissionMode: 'bypassPermissions' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', 'bash', { command: 'ls' });
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: 'ok', isError: false });
  const for1 = (type: string) => sent.find((one) => one.action.type === type && one.action.toolCallId === 'c1')?.action;
  const ready = for1('chat/toolCallReady');
  const complete = for1('chat/toolCallComplete');
  expect(metaOf(ready)['ahpd.startedAt']).toEqual(expect.any(String));
  expect(metaOf(ready)['ahpd.endedAt']).toBeUndefined();
  expect(timed(complete)).toBe(true);
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect(timed(parts.find((one) => one.id === 'c1')?.toolCall as Bag)).toBe(true);
});

it('says when a call started, on the start pi opened the row for', async () => {
  const one = turn();
  const message = { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }] };
  mapEvent(one, { type: 'message_update', message, assistantMessageEvent: { contentIndex: 0, partial: message, type: 'toolcall_start' } } as unknown as AgentSessionEvent);
  // The model's stream names the call; pi runs it afterwards, which is when the
  // start is stamped - the start action has been sent by then and cannot say.
  const opened_ = mapEvent(one, { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: {} }, 1_700_000_000_000);
  expect(opened_).toEqual([]);
  expect(metaOf(one.parts[0]?.toolCall as Bag)['ahpd.startedAt']).toBe('2023-11-14T22:13:20.000Z');
});

it('starts an approved call when it was approved, and says none for a denied one', async () => {
  let now = 1_700_000_000_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const { session, pi, sent } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  const asked = now;
  const waiting = driveCall(pi, 'c1', 'bash', { command: 'ls' });
  await settled();
  now += 30_000;
  const approved = now;
  session.confirm('c1', true);
  await waiting;
  const confirmed = sent.find((one) => one.action.type === 'chat/toolCallConfirmed' && one.action.toolCallId === 'c1')?.action;
  // The question waited for a person, which is not work: the start is the
  // approval's, not the one the asked ready already carried.
  expect(metaOf(sent.find((one) => one.action.type === 'chat/toolCallReady' && one.action.toolCallId === 'c1')?.action)['ahpd.startedAt'])
    .toBe(new Date(asked).toISOString());
  expect(metaOf(confirmed)['ahpd.startedAt']).toBe(new Date(approved).toISOString());

  session.begin('t2', 'again');
  await settled();
  const refused = driveCall(pi, 'c2', 'bash', { command: 'rm -rf /' });
  await settled();
  session.confirm('c2', false);
  await refused;
  const denied = sent.find((one) => one.action.type === 'chat/toolCallConfirmed' && one.action.toolCallId === 'c2')?.action;
  expect(metaOf(denied)['ahpd.startedAt']).toBeUndefined();
  expect(metaOf(denied)['ahpd.durationMs']).toBeUndefined();
  // And the snapshot the person would read says the same.
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect((parts.find((one) => one.id === 'c2')?.toolCall as Bag)._meta ?? {}).not.toHaveProperty('ahpd.startedAt');
  clock.mockRestore();
});

it('says when a command of the person\'s own ran', async () => {
  const { session, sent } = opened({ settings: { permissionMode: 'bypassPermissions' } } as Partial<Start>);
  session.ran?.('t1', 'ls -la', async () => ({ success: true, said: 'Listed files', output: 'a b c' }));
  await settled();
  const for1 = (type: string) => sent.find((one) => one.action.type === type && one.action.toolCallId === 't1:shell')?.action;
  expect(metaOf(for1('chat/toolCallReady'))['ahpd.startedAt']).toEqual(expect.any(String));
  expect(timed(for1('chat/toolCallComplete'))).toBe(true);
});

it('gives a replayed call the times of the entries that ran it', async () => {
  const { replayEntries } = await import('../src/replay.js');
  const call = { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } };
  const entries: Bag[] = [
    { type: 'message', id: 'u1', parentId: null, timestamp: '2020-01-01T00:00:00.000Z', message: { role: 'user', content: 'go', timestamp: 0 } },
    { type: 'message', id: 'a0', parentId: 'u1', timestamp: '2020-01-01T00:00:05.000Z', message: answer([call], 'toolUse') },
    {
      type: 'message',
      id: 'r0',
      parentId: 'a0',
      timestamp: '2020-01-01T00:00:09.500Z',
      message: { role: 'toolResult', toolCallId: 'c1', toolName: 'bash', content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: 0 },
    },
  ];
  const { turns } = replayEntries(entries as never);
  const row = turns[0]!.parts.find((one) => one.id === 'c1')?.toolCall as Bag;
  // pi's own times, not the moment this process read the file.
  expect(row._meta).toMatchObject({
    'ahpd.startedAt': '2020-01-01T00:00:05.000Z',
    'ahpd.endedAt': '2020-01-01T00:00:09.500Z',
    'ahpd.durationMs': 4500,
  });
});

it('never writes a bare timing key on a pi tool call', async () => {
  const { session, pi, sent } = opened({ settings: { permissionMode: 'bypassPermissions' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', 'bash', { command: 'ls' });
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: 'ok', isError: false });
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  for (const { action } of sent) {
    const keys = Object.keys(metaOf(action));
    expect(keys, String(action.type)).not.toContain('startedAt');
    expect(keys, String(action.type)).not.toContain('endedAt');
    expect(keys, String(action.type)).not.toContain('durationMs');
  }
  const keys = Object.keys((parts.find((one) => one.id === 'c1')?.toolCall as Bag)._meta as Bag);
  expect(keys).not.toContain('startedAt');
});

// The plugin --------------------------------------------------------------

it('needs no option, because pi resolves its own directory and credentials', () => {
  expect(optionsOf({})).toEqual({});
});

it('takes the options the schema checked as they are', () => {
  expect(optionsOf({ provider: 'pi-two', projectTrust: 'deny' })).toEqual({ provider: 'pi-two', projectTrust: 'deny' });
});

