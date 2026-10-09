import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { uriOf } from '@ahpd/sdk';
import { Status } from '../../sdk/src/catalog.js';
import { resolveNeeds } from '../../sdk/src/machine.js';
import type { Bag, Start } from '../../sdk/src/types/index.js';
import { piAgent } from '../src/agent.js';
import { idOf, modelFor, offered, THINKING_KEY } from '../src/models.js';
import { optionsOf } from '../src/plugin.js';
import { piSession } from '../src/session.js';
import type { OpenPi } from '../src/session.js';
import { driveCall, fakePi, opened, root, settled, streamed } from './fake-pi.js';

/*
 * pi as a backend, without a model provider.
 *
 * The whole turn lifecycle is driven through the `open` seam: a fake `pi` that
 * records what it was asked and raises the events a real one would. So what is
 * under test is this package's half - the actions, their order, and the state
 * a client re-subscribing would be served - rather than pi.
 */

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

it('reports the folder it works in as a URI a host reads back as that folder', () => {
  /*
   * `` `file://${where}` `` is the path as it is, and a folder whose name holds
   * a `#` or a space is a different folder to a reader that takes `#` for a
   * fragment and to one that takes the text literally: the host reads the URI
   * back with `localPath`, and a command it runs for the session runs where the
   * host read rather than where pi works.
   */
  const root = mkdtempSync(join(tmpdir(), 'ahpd-pi-uris-'));
  const where = join(root, 'C# a b');
  mkdirSync(where);
  try {
    const { session } = opened({ workingDirectory: where });
    expect(session.workingDirectories()).toEqual([uriOf(where)]);
    expect((session.sessionState() as Bag).workingDirectories).toEqual([uriOf(where)]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
  // The message is built before it is steered, which reads its attachments
  // off disk, so the steer reaches pi a turn of the event loop later.
  await settled();
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
    _meta: { 'ahpd.cacheWriteTokens': 5 },
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

// The plugin --------------------------------------------------------------

it('needs no option, because pi resolves its own directory and credentials', () => {
  expect(optionsOf({})).toEqual({});
});

it('takes the options the schema checked as they are', () => {
  expect(optionsOf({ provider: 'pi-two', projectTrust: 'deny' })).toEqual({ provider: 'pi-two', projectTrust: 'deny' });
});

// A machine ---------------------------------------------------------------

/** The daemon's `HOME` and `PI_CODING_AGENT_DIR` for one case, put back after it. */
const withHome = <T>(home: string, agentDir: string | undefined, run: () => T): T => {
  const before = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
  process.env.HOME = home;
  if (agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = agentDir;
  try { return run(); }
  finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

/** The key variables pi's own provider list reads, from the pi-ai it runs on. */
const piKeyVariables = (): string[] => {
  const file = join(import.meta.dirname, '../node_modules/@earendil-works/pi-ai/dist/env-api-keys.js');
  const source = readFileSync(file, 'utf8');
  const listed = source.slice(source.indexOf('function getApiKeyEnvVars'), source.indexOf('export function findEnvKeys'));
  const named = [...listed.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((one) => one[1] as string);
  const constants = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'];
  return [...new Set([...named, ...constants])].sort();
};

it('runs nested, from the ahpd part', () => {
  const agent = piAgent({}, ['/tmp/pi-machine']);
  expect(agent.runsNested).toBe(true);
  expect(agent.machine?.().ahpdPart).toMatchObject({ part: 'ahpd', required: true });
});

it('keeps its agent directory in a state volume, seeded without auth.json, and declares its keys by name', () => {
  const home = mkdtempSync(join(tmpdir(), 'ahpd-pi-home-'));
  const needs = withHome(home, undefined, () => piAgent({}, ['/tmp/pi-machine']).machine?.() ?? {});
  expect(needs.piState).toEqual({
    state: '/ahpd/pi',
    seed: [{ source: join(home, '.pi', 'agent', 'settings.json') }, { source: join(home, '.pi', 'agent', 'models.json') }],
    description: expect.stringMatching(/pi/),
  });
  expect(needs.piAgentDir).toMatchObject({ name: 'PI_CODING_AGENT_DIR', default: '/ahpd/pi' });
  expect(JSON.stringify(needs)).not.toContain('auth.json');
  // A key need is the profile's to fill: it has no default of the daemon's.
  const keys = Object.values(needs).filter((one) => 'name' in one && one.name !== 'PI_CODING_AGENT_DIR');
  expect(keys.map((one) => (one as { name: string }).name).sort()).toEqual(piKeyVariables());
  expect(keys.every((one) => one.default === undefined && one.required !== true)).toBe(true);

  const volume = resolveNeeds(needs, {}, home, 'volume');
  expect(volume.map((one) => one.kind).sort()).toEqual(['env', 'part', 'state']);
  expect(volume.find((one) => one.kind === 'env')).toMatchObject({ target: 'PI_CODING_AGENT_DIR', source: '/ahpd/pi' });
});

it('declares only the provider list\'s keys, whatever variable the host settings name', () => {
  const home = mkdtempSync(join(tmpdir(), 'ahpd-pi-home-'));
  mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
  writeFileSync(join(home, '.pi', 'agent', 'models.json'), JSON.stringify({ providers: { mine: { apiKey: 'MY_CUSTOM_KEY' } } }));
  const needs = withHome(home, undefined, () => piAgent({}, ['/tmp/pi-machine']).machine?.() ?? {});
  expect(JSON.stringify(needs)).not.toContain('MY_CUSTOM_KEY');
});

it('mounts the host agent directory read-write for state host', () => {
  const home = mkdtempSync(join(tmpdir(), 'ahpd-pi-home-'));
  const dir = join(home, '.pi', 'agent');
  mkdirSync(dir, { recursive: true });
  const needs = withHome(home, undefined, () => piAgent({}, ['/tmp/pi-machine']).machine?.() ?? {});
  expect(needs.piAgentDirectory).toEqual({
    directory: dir,
    target: '/ahpd/pi',
    required: true,
    when: 'host',
    description: expect.stringMatching(/pi/),
  });
  const host = resolveNeeds(needs, {}, home, 'host');
  // A key with no value from the profile is left out, so these are all of it.
  expect(host.map((one) => [one.kind, one.target])).toEqual([
    ['part', '/opt/ahpd/ahpd'],
    ['directory', '/ahpd/pi'],
    ['env', 'PI_CODING_AGENT_DIR'],
  ]);
  expect(host.find((one) => one.kind === 'directory')?.readOnly).toBeUndefined();
});

it('seeds from PI_CODING_AGENT_DIR when the daemon has it', () => {
  const home = mkdtempSync(join(tmpdir(), 'ahpd-pi-home-'));
  const needs = withHome(home, '/srv/pi', () => piAgent({}, ['/tmp/pi-machine']).machine?.() ?? {});
  expect((needs.piState as { seed: { source: string }[] }).seed.map((one) => one.source))
    .toEqual(['/srv/pi/settings.json', '/srv/pi/models.json']);
  expect(needs.piAgentDirectory).toMatchObject({ directory: '/srv/pi' });
});

