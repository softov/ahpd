import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { Status } from '../../sdk/src/catalog.js';
import type { Bag, BoundTool, Start } from '../../sdk/src/types/index.js';
import { piAgent } from '../src/agent.js';
import { forget } from '../src/catalog.js';
import { activityOf, mapEvent, resultText } from '../src/mapping.js';
import { idOf, modelFor, offered, THINKING_KEY } from '../src/models.js';
import { optionsOf } from '../src/plugin.js';
import { piSession } from '../src/session.js';
import type { OpenPi } from '../src/session.js';
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

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-pi-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); forget(); });

const turn = (turnId = 't1'): PiTurn => ({
  turnId,
  textPartId: `${turnId}:text`,
  parts: [{ id: `${turnId}:text`, kind: 'markdown', content: '' }],
  calls: new Map(),
});

/** A pi that raises whatever a test tells it to, and records what it was asked. */
function fakePi() {
  let listener: ((event: AgentSessionEvent) => void) | undefined;
  const asked: Bag[] = [];
  const opens: BackendOptions[] = [];
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
    models: async () => [
      { provider: 'anthropic', id: 'claude-opus-5', name: 'Opus 5', contextWindow: 200000, maxTokens: 64000 },
      { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
    ],
    levels: (model) => (model.provider === 'anthropic' ? ['off', 'medium', 'high'] : ['off']),
    chosen: () => ({ id: 'anthropic/claude-opus-5', config: { [THINKING_KEY]: 'off' } }),
    choose: async (id, config) => { asked.push({ kind: 'choose', id, ...(config ? { config } : {}) }); },
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
  const session = piSession(options, start, open ?? pi.open);
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
const callTool = async (tool: ReturnType<typeof toPiTool>, params: Record<string, unknown>): Promise<Bag> => {
  if (tool === undefined) throw new Error('no tool to call');
  return await tool.execute('c1', params as never, undefined, undefined, undefined as never) as unknown as Bag;
};

it('converts a bound tool to pi definition, keeping the name, title and schema', () => {
  const tool = toPiTool({
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
  const tool = toPiTool({
    definition: { name: 'open_file' },
    run: async (input) => `opened ${String(input.path)}`,
  }, noClient);
  const result = await callTool(tool, { path: 'a.txt' });
  expect(result.content).toEqual([{ type: 'text', text: 'opened a.txt' }]);
});

it('rejects the call when the host tool throws', async () => {
  const tool = toPiTool({
    definition: { name: 'open_file' },
    run: async () => { throw new Error('no such file'); },
  }, noClient);
  await expect(callTool(tool, {})).rejects.toThrow('no such file');
});

it('drops a tool that would shadow one of pi own', () => {
  expect(toPiTool({ definition: { name: 'bash' }, run: async () => 'no' }, noClient)).toBeUndefined();
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
  const tool = toPiTool({ definition: { name: 'slow' }, run: () => new Promise(() => {}) }, noClient);
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

it('streams text into the part the turn opened, and into the snapshot', () => {
  const one = turn();
  const actions = mapEvent(one, {
    type: 'message_update',
    message: {} as never,
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello', partial: {} as never },
  });
  expect(actions).toEqual([{ type: 'chat/delta', turnId: 't1', partId: 't1:text', content: 'hello' }]);
  // The snapshot is the parts, not a replay of the actions.
  expect(one.parts[0]?.content).toBe('hello');
});

it('opens the reasoning part once, however much pi thinks', () => {
  const one = turn();
  const first = mapEvent(one, {
    type: 'message_update',
    message: {} as never,
    assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'hm', partial: {} as never },
  });
  expect(first.map((a) => a.type)).toEqual(['chat/responsePart', 'chat/reasoning']);
  const second = mapEvent(one, {
    type: 'message_update',
    message: {} as never,
    assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'm', partial: {} as never },
  });
  expect(second.map((a) => a.type)).toEqual(['chat/reasoning']);
  expect(one.parts.find((p) => p.kind === 'reasoning')?.content).toBe('hmm');
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

it('opens a turn before anything streams into it', async () => {
  const { session, types } = opened();
  session.begin('t1', 'hello');
  await settled();
  const chat = types('chat');
  expect(chat[0]).toBe('chat/turnStarted');
  expect(chat[1]).toBe('chat/responsePart');
  expect(chat).toContain('chat/turnComplete');
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

it('moves the finished turn out of active and into the transcript', async () => {
  const { session } = opened();
  session.begin('t1', 'hello');
  await settled();
  const state = session.chatState();
  expect(state.activeTurn).toBeUndefined();
  expect((state.turns as Bag[]).map((one) => one.id)).toEqual(['t1']);
  expect(session.status()).toBe(1);
});

it('passes the chosen model and its thinking level through to pi', async () => {
  const { session, pi } = opened();
  session.begin('t1', 'hello', { id: 'openai/gpt-5', config: { [THINKING_KEY]: 'off' } });
  await settled();
  expect(pi.asked.find((one) => one.kind === 'choose'))
    .toEqual({ kind: 'choose', id: 'openai/gpt-5', config: { [THINKING_KEY]: 'off' } });
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
  const { session, last } = opened({}, { model: 'openrouter/y' });
  session.begin('t1', 'hello', { id: 'openrouter/x', config: { [THINKING_KEY]: 'high' } });
  await settled();
  const wanted = { id: 'openrouter/x', config: { [THINKING_KEY]: 'high' } };
  expect((last('chat/turnStarted')?.message as Bag).model).toEqual(wanted);
  const turn = (session.chatState().turns as Bag[]).find((one) => one.id === 't1');
  expect((turn?.message as Bag).model).toEqual(wanted);
});

it('carries the configured model when the turn names none', async () => {
  const { session, last } = opened({}, { model: 'openrouter/y' });
  session.begin('t1', 'hello');
  await settled();
  expect(((last('chat/turnStarted')?.message as Bag).model as Bag).id).toBe('openrouter/y');
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

it('offers nothing before a session exists, and says so rather than omitting it', async () => {
  const agent = piAgent({}, [root]);
  expect(await agent.probe?.()).toEqual({ models: [], customizations: [], commands: [] });
});

it('has no transcript for a session this process never watched', async () => {
  const agent = piAgent({}, [root]);
  expect(await agent.transcript?.('never-opened')).toBeUndefined();
});

it('reads back the turns of a session it did watch', async () => {
  const { session } = opened();
  session.begin('t1', 'hello');
  await settled();
  const agent = piAgent({}, [root]);
  const turns = await agent.transcript?.('pi-session-1');
  expect(turns?.map((one) => one.id)).toEqual(['t1']);
  expect(turns?.[0]?.message.text).toBe('hello');
  expect(turns?.[0]?.state).toBe('complete');
});

it('lists an empty directory as no sessions rather than failing', async () => {
  const agent = piAgent({ sessionDir: join(root, 'pi') }, [root]);
  expect(await agent.list?.()).toEqual([]);
});

// The plugin --------------------------------------------------------------

it('needs no option, because pi resolves its own directory and credentials', () => {
  expect(optionsOf({})).toEqual({});
});

it('drops a misspelled option rather than the whole plugin', () => {
  expect(optionsOf({ provider: 'pi-two', displayName: 42, model: '  ' }))
    .toEqual({ provider: 'pi-two' });
});

it('has no third answer for project trust, because a daemon has nobody to ask', () => {
  expect(optionsOf({ projectTrust: 'deny' }).projectTrust).toBe('deny');
  expect(optionsOf({ projectTrust: 'ask' }).projectTrust).toBe('trust');
});

