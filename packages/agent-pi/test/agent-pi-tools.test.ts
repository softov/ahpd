import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createAgentSession, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { echo } from '../../../examples/echo/agent.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { Status } from '../../sdk/src/sessions/catalog.js';
import { startedNow } from '../../sdk/test/support/started.js';
import type { AgentView, Bag, BoundTool, Start } from '../../sdk/src/types/index.js';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import type { ClientCallAnswer } from '../../sdk/src/tools/clientcalls.js';
import { mapEvent } from '../src/mapping.js';
import { THINKING_KEY } from '../src/models.js';
import { piSession } from '../src/session.js';
import type { OpenPi } from '../src/session.js';
import type { BackendOptions } from '../src/backend.js';
import { toPiTool } from '../src/tools.js';
import { callIn, driveCall, fakePi, opened, root, settled, turn } from './fake-pi.js';

// Host tools --------------------------------------------------------------

/** A client wait that answers nothing, for a host tool nobody hands out. */
const noClient = async (): Promise<ClientCallAnswer> => ({ text: '', ok: false, content: [] });

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

it("drops a client's tool named like one of pi's own", async () => {
  expect(await toPiTool({ definition: { name: 'bash' }, owner: 'editor' }, noClient)).toBeUndefined();
});

it("offers a host tool named like one of pi's own in the place of pi's", async () => {
  /*
   * pi registers a custom tool of a built-in's name in the built-in's place,
   * so the model is offered the host's tool and pi's own is left out, as
   * VS Code's host tools override the runtime's built-in of the same name.
   */
  const host = await toPiTool({ definition: { name: 'bash', title: 'Host shell' }, run: async () => 'ran' }, noClient);
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-pi-override-'));
  try {
    const { session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      sessionManager: SessionManager.inMemory(dir),
      settingsManager: SettingsManager.inMemory(),
      ...(host === undefined ? {} : { customTools: [host] }),
    });
    expect(session.getActiveToolNames().filter((name) => name === 'bash')).toEqual(['bash']);
    expect(session.getToolDefinition('bash')?.label).toBe('Host shell');
    session.dispose();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('keeps a marked host tool that takes the place of one of pi own', async () => {
  let seen: string | undefined;
  const tool = await toPiTool({
    definition: { name: 'bash' },
    overridesBuiltInTool: true,
    run: async (_input, call) => {
      seen = call?.toolCallId;
      return 'the host ran it';
    },
  }, noClient);
  expect(tool?.name).toBe('bash');
  // The call's own id reaches the tool, as it does for every other host tool.
  const result = await callTool(tool, { command: 'echo hi' });
  expect(result.content).toEqual([{ type: 'text', text: 'the host ran it' }]);
  expect(seen).toBe('c1');
});

it('hands the host tools to pi as custom tools', async () => {
  const { session, pi } = opened({
    tools: [
      { definition: { name: 'bash' }, run: async () => 'ran' },
      { definition: { name: 'open_file', title: 'Open file' }, run: async () => 'ok' },
    ],
  } as Partial<Start>);
  session.sendMessage('t1', 'hello');
  await settled();
  expect((pi.opens[0]?.tools ?? []).map((one) => one.name)).toEqual(['bash', 'open_file']);
});

/*
 * The host tools switch, through the plugin: on drops nothing, and off drops
 * the tools with no owner while each client's still reaches pi.
 */
const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-pi/src/index.ts';
const PASSED_OPEN = 'plugin agent-pi: plugins.agent-pi.options.open is not an option agent-pi knows; passed through';

const MINE: BoundTool = { definition: { name: 'mine' }, run: async () => 'ok' };
const REVIEW: BoundTool = { definition: { name: 'review' }, owner: 'a-client' };

/** One record, as an engine is handed it: every field read at each call. */
const viewOf = (id: string, held: () => Bag): AgentView => ({
  id,
  engine: 'pi',
  owner: 'host',
  name: id,
  description: undefined,
  icon: undefined,
  model: undefined,
  get config() { return held(); },
});

/** The tools one record of a plugin configured this way offered pi, by name. */
const offeredBy = async (plugin: Bag, held: () => Bag): Promise<string[]> => {
  const pi = fakePi();
  const { problems, options } = await loadPlugins(
    [{ name: SOURCE, options: { ...plugin, open: pi.open } }],
    {
      base: { path: root, agents: [echo({ path: root })] },
      configDir: REPO,
      cwd: REPO,
      log: () => {},
    },
  );
  expect(problems).toEqual([PASSED_OPEN]);
  const engine = options.engines?.['pi'];
  if (engine === undefined) throw new Error('no pi engine was registered');
  const agent = engine.open(viewOf('pi-host-tools', held));
  const session = startedNow(agent.create({
    uri: 'ahp-session:/host-tools',
    chatUri: 'ahp-chat:/host-tools',
    settings: agent.defaults(),
    emit: () => {},
    tools: [MINE, REVIEW],
  } as unknown as Start));
  session.sendMessage('t1', 'hello');
  await settled();
  await session.close();
  return (pi.opens[0]?.tools ?? []).map((one) => one.name);
};

it('offers the host\'s tools and a client\'s by default', async () => {
  expect(await offeredBy({}, () => ({}))).toEqual(['mine', 'review']);
});

it('drops the host\'s tools when the plugin turns them off', async () => {
  expect(await offeredBy({ hostTools: false }, () => ({}))).toEqual(['review']);
});

it('lets a record turn the host\'s tools off over the plugin\'s on', async () => {
  expect(await offeredBy({ hostTools: true }, () => ({ hostTools: false }))).toEqual(['review']);
});

/** The client's tools one session offered pi, by the name the model calls them. */
const offered = (pi: ReturnType<typeof fakePi>, name: string) =>
  pi.opens[0]?.tools?.find((one) => one.name === name)!;

/** The session's outstanding requests, as they were published. */
const needed = (session: { sessionState(): unknown }): Bag[] =>
  ((session.sessionState() as Bag).inputNeeded ?? []) as Bag[];

it('waits on the client that owns a tool, and lets only that client answer', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'editor__open', title: 'Open' }, owner: 'editor' }],
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  } as Partial<Start>);
  session.sendMessage('t1', 'hello');
  await settled();
  const tool = offered(pi, 'editor__open');
  expect(session.toolCallOwner?.('c1')).toBeUndefined();
  // pi raises the start and calls the hook before it runs the tool, so the
  // client is asked at the ready and the tool runs against the open call.
  await driveCall(pi, 'c1', 'editor__open', {});
  expect(session.toolCallOwner?.('c1')).toBe('editor');

  let answered: Bag | undefined;
  const pending = tool.execute('c1', {} as never, undefined, undefined, undefined as never)
    .then((result) => { answered = result as unknown as Bag; });
  await settled();
  // A result from anybody else is a client out of step and does not settle it.
  expect(session.completeToolCall?.('c1', 'other', { text: 'not mine', ok: true, content: [] })).toBe(false);
  await settled();
  expect(answered).toBeUndefined();
  expect(session.completeToolCall?.('c1', 'editor', { text: 'opened it', ok: true, content: [] })).toBe(true);
  await pending;
  expect(answered?.content).toEqual([{ type: 'text', text: 'opened it' }]);
  expect(session.toolCallOwner?.('c1')).toBeUndefined();
});

/*
 * A client tool call fails with the answer it is handed, the host's failure
 * of a call a gone client owes among them, as VS Code's host fails one through
 * the agent's own completion; the session ends none itself.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2085-L2115
 */
it('fails a client tool call with the answer, the host\'s for a gone client among them, and ends none itself', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'editor__open' }, owner: 'editor' }],
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  } as Partial<Start>);
  session.sendMessage('t1', 'hello');
  await settled();
  const tool = offered(pi, 'editor__open');
  await driveCall(pi, 'c1', 'editor__open', {});
  const refused = tool.execute('c1', {} as never, undefined, undefined, undefined as never);
  await settled();
  session.completeToolCall?.('c1', 'editor', { text: 'it refused', ok: false, content: [] });
  await expect(refused).rejects.toThrow('it refused');

  expect('clientGone' in session).toBe(false);
  await driveCall(pi, 'c2', 'editor__open', {});
  const gone = tool.execute('c2', {} as never, undefined, undefined, undefined as never);
  await settled();
  const words = 'Client editor disconnected before completing open';
  session.completeToolCall?.('c2', 'editor', { text: words, ok: false, content: [] });
  await expect(gone).rejects.toThrow(words);
});

it('releases a waiting client call when the turn is cancelled', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'editor__open' }, owner: 'editor' }],
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  const tool = offered(pi, 'editor__open');
  await driveCall(pi, 'c1', 'editor__open', {});
  const waiting = tool.execute('c1', {} as never, undefined, undefined, undefined as never);
  await settled();
  session.abort();
  await expect(waiting).rejects.toThrow('The turn was stopped');
});

// A client's calls, held by the sdk --------------------------------------

it('raises the call on the session, and takes the entry down with the answer', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'editor__open', title: 'Open' }, owner: 'editor' }],
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  } as Partial<Start>);
  // Held, because a client's call belongs to a turn and the fake settles one
  // as soon as it is asked to run.
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', 'editor__open', { path: '/a.txt' });

  const raised = needed(session);
  expect(raised).toHaveLength(1);
  expect(raised[0]).toMatchObject({
    kind: 'toolClientExecution',
    chat: 'ahp-chat:/s1',
    turnId: 't1',
    clientId: 'editor',
    toolCall: {
      toolCallId: 'c1',
      // The tool's own name, not the `editor__` name the model was offered.
      toolName: 'open',
      status: 'running',
      contributor: { kind: 'client', clientId: 'editor' },
    },
  });

  session.completeToolCall?.('c1', 'editor', { text: 'opened', ok: true, content: [{ type: 'text', text: 'opened' }] });
  await settled();
  expect(needed(session).some((one) => one.id === raised[0]?.id)).toBe(false);
});

it('names a client\'s call in its row by the name the client announced', async () => {
  const { session, pi, sent } = opened({
    tools: [{ definition: { name: 'editor__open' }, owner: 'editor' }],
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', 'editor__open', { path: '/a.txt' });

  // The tool the client has, as VS Code's agents strip their client tool
  // server's prefix: the chat's row and the session's entry name one tool.
  const start = sent.find((one) => one.action.type === 'chat/toolCallStart' && one.action.toolCallId === 'c1')?.action;
  expect(start).toMatchObject({ toolName: 'open', displayName: 'open', contributor: { kind: 'client', clientId: 'editor' } });
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect(callIn(parts, 'c1')).toMatchObject({ toolName: 'open', displayName: 'open' });
  expect(needed(session)[0]?.toolCall).toMatchObject({ toolName: 'open', displayName: 'open' });
});

it('keeps the answer a client gives between the ready and the run', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'editor__open' }, owner: 'editor' }],
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  } as Partial<Start>);
  session.sendMessage('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', 'editor__open', {});
  // The client answers before pi gets as far as running the tool.
  session.completeToolCall?.('c1', 'editor', { text: 'early', ok: true, content: [{ type: 'text', text: 'early' }] });
  await settled();

  const result = await offered(pi, 'editor__open')
    .execute('c1', {} as never, undefined, undefined, undefined as never) as unknown as Bag;
  expect(result.content).toEqual([{ type: 'text', text: 'early' }]);
});

it('settles a call only from the client the tool belongs to', async () => {
  const bound = (owner: string): BoundTool => ({
    definition: { name: `${owner}__openFile`, title: 'Open a file' },
    owner,
  });
  const { session, pi } = opened({
    tools: [bound('a'), bound('b')],
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  } as Partial<Start>);
  session.sendMessage('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', 'a__openFile', {});
  expect(needed(session)).toHaveLength(1);
  expect(needed(session)[0]?.clientId).toBe('a');

  const running = offered(pi, 'a__openFile')
    .execute('c1', {} as never, undefined, undefined, undefined as never);
  await settled();
  expect(session.toolCallOwner?.('c1')).toBe('a');
  // Both clients provide a tool of this name; the call is one of theirs.
  expect(session.completeToolCall?.('c1', 'b', { text: 'not mine', ok: true, content: [] })).toBe(false);
  expect(session.completeToolCall?.('c1', 'a', { text: 'mine', ok: true, content: [{ type: 'text', text: 'mine' }] })).toBe(true);
  expect((await running as unknown as Bag).content).toEqual([{ type: 'text', text: 'mine' }]);
});

it('fails a call nobody answers, in the time the host allows', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'editor__open' }, owner: 'editor' }],
    clientToolTimeoutMs: 30,
  } as Partial<Start>);
  session.sendMessage('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', 'editor__open', {});

  const running = offered(pi, 'editor__open')
    .execute('c1', {} as never, undefined, undefined, undefined as never);
  await expect(running).rejects.toThrow('no answer from editor');
  await settled();
  expect(needed(session)).toHaveLength(0);
});

it('asks a client for a call only once the person has allowed it', async () => {
  const bound: BoundTool = {
    definition: { name: 'editor__save', title: 'Save' },
    owner: 'editor',
    effects: { writes: true },
  };
  const { session, pi } = opened({
    tools: [bound],
    settings: { permissionMode: 'default' },
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  const waiting = driveCall(pi, 'c1', 'editor__save', {});
  await settled();
  // Nobody has allowed it yet, so nothing has been asked of the client.
  expect(needed(session).map((one) => one.kind)).toEqual(['toolConfirmation']);

  session.confirm('c1', true);
  await waiting;
  await settled();
  expect(needed(session).map((one) => one.kind)).toEqual(['toolClientExecution']);

  const running = offered(pi, 'editor__save')
    .execute('c1', {} as never, undefined, undefined, undefined as never);
  await settled();
  session.completeToolCall?.('c1', 'editor', { text: 'saved', ok: true, content: [{ type: 'text', text: 'saved' }] });
  expect((await running as unknown as Bag).content).toEqual([{ type: 'text', text: 'saved' }]);
});

it('hands the model the client image as an image, and its other files as a line', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'editor__open' }, owner: 'editor' }],
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  } as Partial<Start>);
  session.sendMessage('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', 'editor__open', {});

  const running = offered(pi, 'editor__open')
    .execute('c1', {} as never, undefined, undefined, undefined as never);
  await settled();
  session.completeToolCall?.('c1', 'editor', {
    text: 'here it is',
    ok: true,
    content: [
      { type: 'text', text: 'here it is' },
      { type: 'embeddedResource', data: 'iVBORw0KGgo=', contentType: 'image/png' },
      { type: 'embeddedResource', data: 'AAAA', contentType: 'application/pdf' },
    ],
  });
  expect((await running as unknown as Bag).content).toEqual([
    { type: 'text', text: 'here it is' },
    { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
    { type: 'text', text: '[application/pdf, 3 bytes]' },
  ]);
});

it('replaces the tools on the next turn, rebuilding pi on the same session file', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'one' }, run: async () => 'ok' }],
  } as Partial<Start>);
  session.sendMessage('t1', 'hello');
  await settled();
  expect(pi.opens).toHaveLength(1);
  expect(await session.setTools?.([{ definition: { name: 'two' }, run: async () => 'ok' }])).toBe(true);
  session.sendMessage('t2', 'again');
  await settled();
  expect(pi.opens).toHaveLength(2);
  expect(pi.opens[1]?.resume).toBe('pi-session-1');
  expect((pi.opens[1]?.tools ?? []).map((one) => one.name)).toEqual(['two']);
});

it('does not rebuild pi when the tools did not change', async () => {
  const tool = { definition: { name: 'one' }, run: async () => 'ok' };
  const { session, pi } = opened({ tools: [tool] } as Partial<Start>);
  session.sendMessage('t1', 'hello');
  await settled();
  expect(await session.setTools?.([tool])).toBe(true);
  session.sendMessage('t2', 'again');
  await settled();
  expect(pi.opens).toHaveLength(1);
});

it('changes the tools before pi opens', async () => {
  const { session, pi } = opened();
  expect(await session.setTools?.([{ definition: { name: 'one' }, run: async () => 'ok' }])).toBe(true);
  session.sendMessage('t1', 'hello');
  await settled();
  expect((pi.opens[0]?.tools ?? []).map((one) => one.name)).toEqual(['one']);
});

it('takes a tool change made during a turn on the turn after it', async () => {
  const { session, pi } = opened({
    tools: [{ definition: { name: 'one' }, run: async () => 'ok' }],
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  await session.setTools?.([{ definition: { name: 'two' }, run: async () => 'ok' }]);
  // The running turn already handed pi its tools and is not touched.
  expect(pi.opens).toHaveLength(1);
  pi.raise({ type: 'agent_settled', aborted: false });
  await settled();
  session.sendMessage('t2', 'again');
  await settled();
  expect(pi.opens).toHaveLength(2);
  expect((pi.opens[1]?.tools ?? []).map((one) => one.name)).toEqual(['two']);
});

it('hands the host instructions to pi, and drops the empty ones', async () => {
  const { session, pi } = opened({ instructions: ['one', ' ', 'two'] } as Partial<Start>);
  session.sendMessage('t1', 'hello');
  await settled();
  expect(pi.opens[0]?.instructions).toEqual(['one', 'two']);
});

it('passes no instructions for a session that named none', async () => {
  const { session, pi } = opened();
  session.sendMessage('t1', 'hello');
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

  session.sendMessage('t1', 'hello');
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
  session.sendMessage('t1', 'hello');
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
  session.sendMessage('t1', 'hello');
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
  session.sendMessage('t1', 'hello');
  await settled();
  const before = pi.asked.filter((one) => one.kind === 'setModel').length;
  await session.setTools?.([{ definition: { name: 'two' }, run: async () => 'ok' }]);
  session.sendMessage('t2', 'again');
  await settled();
  expect(pi.opens).toHaveLength(2);
  const second = pi.opens[1]!;
  expect(second.resume).toBe('pi-session-1');
  expect((second.tools ?? []).map((one) => one.name)).toEqual(['two']);
  expect(second.instructions).toEqual(['be nice']);
  expect(second.onToolCall).toBeDefined();
  // The model and thinking level the session was on are applied again.
  const moves = pi.asked.filter((one) => one.kind === 'setModel');
  expect(moves.length).toBeGreaterThan(before);
  expect(moves[moves.length - 1]).toEqual({
    kind: 'setModel',
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
  session.sendMessage('t1', 'hello');
  await settled();
  await session.setTools?.([{ definition: { name: 'two' }, run: async () => 'ok' }]);
  session.sendMessage('t2', 'again');
  await settled();
  const failure = [...sent].reverse().find((one) => one.action.type === 'chat/error')?.action;
  expect(((failure?.part as Bag).error as Bag).message).toBe('the rebuild could not start');

  // Nothing is live, so the next turn opens again rather than reusing the failure.
  session.sendMessage('t3', 'third');
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
  expect(callIn(one.parts, 'c1')?.contributor).toEqual(contributor);
  // A host tool is nobody's client, and a call to one carries nothing.
  expect(mapEvent(turn(), {
    type: 'tool_execution_start', toolCallId: 'c2', toolName: 'bash', args: {},
  })[0]?.contributor).toBeUndefined();
});