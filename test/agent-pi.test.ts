import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Bag, Start } from '../packages/sdk/src/types/index.js';
import { piAgent } from '../packages/agent-pi/src/agent.js';
import { forget } from '../packages/agent-pi/src/catalog.js';
import { activityOf, mapEvent, resultText } from '../packages/agent-pi/src/mapping.js';
import { idOf, modelFor, offered, THINKING_KEY } from '../packages/agent-pi/src/models.js';
import { optionsOf } from '../packages/agent-pi/src/plugin.js';
import { piSession } from '../packages/agent-pi/src/session.js';
import type { OpenPi } from '../packages/agent-pi/src/session.js';
import type { PiBackend } from '../packages/agent-pi/src/backend.js';
import type { PiTurn } from '../packages/agent-pi/src/types.js';

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
  let settle = true;
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
      { provider: 'anthropic', id: 'claude-opus-5', name: 'Opus 5' },
      { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
    ],
    levels: (model) => (model.provider === 'anthropic' ? ['off', 'medium', 'high'] : ['off']),
    chosen: () => ({ id: 'anthropic/claude-opus-5', config: { [THINKING_KEY]: 'off' } }),
    choose: async (id, config) => { asked.push({ kind: 'choose', id, ...(config ? { config } : {}) }); },
    rename: (title) => { asked.push({ kind: 'rename', title }); },
    rewind: async (entryId) => { asked.push({ kind: 'rewind', entryId }); return true; },
    close: () => { asked.push({ kind: 'close' }); },
  };
  return {
    backend,
    asked,
    raise: (event: AgentSessionEvent) => { listener?.(event); },
    hold: () => { settle = false; },
    open: (async () => backend) as OpenPi,
  };
}

/** One session, with everything it emitted. */
function opened(over: Partial<Start> = {}) {
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
  const session = piSession({}, start, pi.open);
  const types = (channel?: string) => sent
    .filter((one) => channel === undefined || one.channel === channel)
    .map((one) => String(one.action.type));
  const last = (type: string) => [...sent].reverse().find((one) => one.action.type === type)?.action;
  return { session, pi, sent, types, last };
}

const settled = async (): Promise<void> => { await new Promise((done) => { setTimeout(done, 5); }); };

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

it('readies a tool call with its arguments, so nothing waits on an approval', () => {
  const one = turn();
  const actions = mapEvent(one, {
    type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: { command: 'ls' },
  });
  expect(actions.map((a) => a.type)).toEqual(['chat/toolCallStart', 'chat/toolCallReady']);
  // pi has no permission policy, so a call parked in `pending-confirmation`
  // would be asking a question nobody can answer.
  expect(actions[1]?.confirmed).toBe('not-needed');
  expect(actions[1]?.toolInput).toBe('{"command":"ls"}');
});

it('closes a failed call with the error a client shows', () => {
  const one = turn();
  mapEvent(one, { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: {} });
  const [done] = mapEvent(one, {
    type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: 'no such file', isError: true,
  });
  expect(done?.type).toBe('chat/toolCallComplete');
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

it('announces the models as soon as pi has a runtime to report them', async () => {
  const { session, last } = opened();
  session.begin('t1', 'hello');
  await settled();
  const announced = last('session/modelsChanged');
  expect((announced?.models as Bag[]).map((one) => one.id))
    .toEqual(['anthropic/claude-opus-5', 'openai/gpt-5']);
  expect(session.models().map((one) => one.id)).toEqual(['anthropic/claude-opus-5', 'openai/gpt-5']);
});

it('passes the chosen model and its thinking level through to pi', async () => {
  const { session, pi } = opened();
  session.begin('t1', 'hello', { id: 'openai/gpt-5', config: { [THINKING_KEY]: 'off' } });
  await settled();
  expect(pi.asked.find((one) => one.kind === 'choose'))
    .toEqual({ kind: 'choose', id: 'openai/gpt-5', config: { [THINKING_KEY]: 'off' } });
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
  expect(await session.setConfig?.('permissionMode', 'plan')).toBe('pi sessions have no "permissionMode" setting');
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
