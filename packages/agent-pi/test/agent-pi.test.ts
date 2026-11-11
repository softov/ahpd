import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { bag, uriOf } from '@ahpd/sdk';
import { Status } from '../../sdk/src/sessions/catalog.js';
import { resolveNeeds } from '../../sdk/src/machines/machine.js';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import type { Bag, Start } from '../../sdk/src/types/index.js';
import { piAgent } from '../src/agent.js';
import { watchedSession } from '../src/catalog.js';
import { idOf, listed, modelFor, THINKING_KEY } from '../src/models.js';
import { optionsOf } from '../src/plugin.js';
import { piSession } from '../src/session.js';
import type { OpenPi } from '../src/session.js';
import { callIn, driveCall, fakePi, opened, root, settled, streamed } from './fake-pi.js';

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

it('holds the chat\'s modified time where the reducer moves it, a turn\'s start and then its end', async () => {
  const { session } = opened();
  session.sendMessage('t1', 'Fix the build');
  await settled();
  // The running turn's start, or the ended turn's start plus its duration.
  const running = (session.chatState() as Bag).activeTurn as Bag | undefined;
  const last = session.allTurns().at(-1) as Bag | undefined;
  const at = running !== undefined
    ? String(running.startedAt)
    : new Date(Date.parse(String(last?.startedAt)) + Number(last?.duration)).toISOString();
  expect(session.modifiedAt()).toBe(at);

  // A rename is no turn's start or end, so the time stays.
  await new Promise((r) => { setTimeout(r, 5); });
  session.setTitle?.('Named by a person');
  expect(session.modifiedAt()).toBe(at);
});

/*
 * A session nobody named or spoke in is untitled, an empty title a client
 * draws as one, as VS Code's host holds a session with no summary.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6140-L6146
 */
it('holds an empty title until something names the session', async () => {
  const { session } = opened();
  expect(session.title()).toBe('');
  expect(session.sessionState()).toMatchObject({ title: '', chats: [{ title: '' }] });
  session.sendMessage('t1', 'Fix the build');
  await settled();
  expect(session.title()).toBe('Fix the build');
});

it('holds a title a command suggests until the first message replaces it', async () => {
  const { session, sent } = opened();
  // The host's seed for a `!` command, taken while the session has no title.
  session.seedTitle?.('ls -la');
  expect(session.title()).toBe('ls -la');
  session.sendMessage('t1', 'Fix the build');
  await settled();
  expect(session.title()).toBe('Fix the build');
  expect(sent.filter((one) => one.action.type === 'session/titleChanged').map((one) => one.action.title))
    .toEqual(['ls -la', 'Fix the build']);
});

it('works in a scratch folder of its own when the client gave it none', () => {
  // The home the folder is made under is this case's own, so nothing is made
  // in the person's.
  const home = mkdtempSync(join(tmpdir(), 'ahpd-pi-home-'));
  // `os.homedir()` reads `HOME` on POSIX and `USERPROFILE` on Windows.
  const was = process.env.HOME;
  const wasProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const start: Start = {
      uri: 'ahp-session:/scratched',
      chatUri: 'ahp-chat:/scratched',
      settings: {},
      schema: () => ({}),
      emit: () => {},
      clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
    };
    const session = piSession({}, start, fakePi().open, async () => undefined);
    const folder = join(home, '.copilot', 'chats', 'scratched');
    expect(session.workingDirectories()).toEqual([uriOf(folder)]);
    expect(existsSync(folder)).toBe(true);
  }
  finally {
    if (was === undefined) delete process.env.HOME;
    else process.env.HOME = was;
    if (wasProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = wasProfile;
    rmSync(home, { recursive: true, force: true });
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

it('never reads an id that names one of its providers as another provider\'s bare id', () => {
  /*
   * pi 1.3.0 lists no `deepseek-chat` for `deepseek`, and OpenRouter has a
   * model whose own id is `deepseek/deepseek-chat`. A record naming the first
   * names DeepSeek's key and account, not OpenRouter's.
   */
  const models = [
    { provider: 'deepseek', id: 'deepseek-flash' },
    { provider: 'openrouter', id: 'deepseek/deepseek-chat' },
  ];
  expect(modelFor(models, 'deepseek/deepseek-chat')).toBeUndefined();
  expect(modelFor(models, 'openrouter/deepseek/deepseek-chat')?.provider).toBe('openrouter');
  expect(modelFor(models, 'deepseek/deepseek-flash')?.provider).toBe('deepseek');
  // A provider with no key is not among the models pi has available, and its
  // name still makes the id qualified.
  const keyless = [{ provider: 'openrouter', id: 'deepseek/deepseek-chat' }];
  expect(modelFor(keyless, 'deepseek/deepseek-chat', undefined, new Set(['deepseek', 'openrouter']))).toBeUndefined();
  // With no provider of that name, the id is OpenRouter's bare one, as before.
  expect(modelFor(keyless, 'deepseek/deepseek-chat')?.provider).toBe('openrouter');
});

/*
 * A model's levels in the property VS Code's agent host draws, over pi's own
 * levels in pi's words: each level's label and description from VS Code's
 * shared helpers, `off` taking the helpers' label and no description, a
 * one-level picker as VS Code's hosts draw one, and the level pi starts on
 * its default where offered, else VS Code's resolution.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L4536-L4553
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/reasoningEffort.ts#L46-L111
 */
it('offers a model\'s thinking levels in VS Code\'s property, a single level included', () => {
  const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  const thinking = (offered: ReturnType<typeof listed>): unknown => bag(bag(offered.configSchema).properties)[THINKING_KEY];
  expect(thinking(listed({ provider: 'anthropic', id: 'claude-opus-5' }, levels, 'low'))).toEqual({
    type: 'string',
    title: 'Effort Level',
    description: 'Controls how much reasoning effort the model uses.',
    default: 'low',
    enum: levels,
    enumLabels: ['Off', 'Minimal', 'Low', 'Medium', 'High', 'Extra High'],
    enumDescriptions: [
      '', 'Minimal reasoning for fastest responses', 'Faster responses with less reasoning', 'Balanced reasoning and speed',
      'Greater reasoning depth but slower', 'Highest reasoning depth but slowest',
    ],
  });
  // With no level pi starts on, VS Code's resolution: high for a Claude model.
  expect(thinking(listed({ provider: 'anthropic', id: 'claude-opus-5' }, levels))).toMatchObject({ default: 'high' });
  expect(thinking(listed({ provider: 'openai', id: 'gpt-5' }, ['off']))).toMatchObject({ enum: ['off'], default: 'off' });
});

it('says a model context window and output limit when pi knows them', () => {
  const known = listed({ provider: 'anthropic', id: 'claude-opus-5', contextWindow: 200000, maxTokens: 64000 }, ['off']);
  expect(known.maxContextWindow).toBe(200000);
  expect(known.maxOutputTokens).toBe(64000);
  const bare = listed({ provider: 'openai', id: 'gpt-5' }, ['off']);
  expect(bare.maxContextWindow).toBeUndefined();
  expect(bare.maxOutputTokens).toBeUndefined();
});

/*
 * Each model listed in the spec's model info fields from pi's own: the limits,
 * whether it takes an image, and its thinking levels as its form, as VS Code's
 * agents list each model, and nothing the spec's model info does not declare.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L120-L144
 */
it('lists a session\'s models with their limits, their vision and their thinking levels', async () => {
  const { session } = opened();
  session.sendMessage('t1', 'hello');
  await settled();
  const fields = new Set(['id', 'name', 'maxContextWindow', 'maxOutputTokens', 'maxPromptTokens', 'supportsVision', 'configSchema', 'policyState', '_meta']);
  const models = session.models();
  expect(models.length).toBeGreaterThan(0);
  expect(models.flatMap((one) => Object.keys(one)).filter((key) => !fields.has(key))).toEqual([]);
  // The fake's Opus has three levels and its limits, and pi starts it on
  // medium; its GPT has one level.
  const opus = models.find((one) => one.id === 'anthropic/claude-opus-5');
  expect(opus).toMatchObject({ maxContextWindow: 200000, maxOutputTokens: 64000 });
  expect(bag(bag(opus?.configSchema).properties)[THINKING_KEY]).toMatchObject({ enum: ['off', 'medium', 'high'], default: 'medium' });
  expect(bag(bag(models.find((one) => one.id === 'openai/gpt-5')?.configSchema).properties)[THINKING_KEY]).toMatchObject({ enum: ['off'] });
  expect(listed({ provider: 'anthropic', id: 'claude-opus-5', input: ['text', 'image'] }, ['off']).supportsVision).toBe(true);
  expect(listed({ provider: 'openai', id: 'gpt-5', input: ['text'] }, ['off']).supportsVision).toBe(false);
});

it('offers each model the context window pi reports', async () => {
  const { session } = opened();
  session.sendMessage('t1', 'hello');
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
  session.sendMessage('t1', 'hello');
  await settled();
  session.sendMessage('t2', 'again');
  await settled();
  expect(heard).toEqual([['anthropic/claude-opus-5', 'openai/gpt-5']]);
});

// The session -------------------------------------------------------------

/*
 * The host said the turn's start before it handed the turn here, as the
 * reference host says a client's action itself, so pi's session says none.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2737-L2752
 */
it('holds a turn the host handed it with no part, and says no start of it', async () => {
  const { session, types } = opened();
  session.sendMessage('t1', 'hello');
  await settled();
  const chat = types('chat');
  expect(chat).not.toContain('chat/turnStarted');
  // pi wrote nothing, so the turn holds nothing.
  expect(chat).not.toContain('chat/responsePart');
  expect(chat).toContain('chat/turnComplete');
  expect((session.chatState().turns as Bag[])[0]?.responseParts).toEqual([]);
});

it('names a turn by the entry pi wrote its prompt under, read after the entry the turn began on', async () => {
  // The id a turn has when it is read back from pi's file, so what the host
  // keeps against the turn - a `!` turn after it, anchored to it - is found.
  const recorded: [string, string][] = [];
  const { session, pi } = opened({ onTurnRecorded: (turnId, entryId) => { recorded.push([turnId, entryId]); } });
  pi.setLeaf('entry-before');
  pi.setPrompted('entry-prompt');
  session.sendMessage('t1', 'hello');
  await settled();
  expect(pi.asked).toContainEqual({ kind: 'promptAfter', entryId: 'entry-before' });
  expect(recorded).toEqual([['t1', 'entry-prompt']]);
});

it('names a turn by its prompt\'s entry when the session closes while the turn runs', async () => {
  // A host that stops closes its sessions under their turns, and the turn is
  // read back from pi's file after the restart, under its prompt's entry.
  const recorded: [string, string][] = [];
  const { session, pi } = opened({ onTurnRecorded: (turnId, entryId) => { recorded.push([turnId, entryId]); } });
  pi.hold();
  pi.setLeaf('entry-before');
  pi.setPrompted('entry-prompt');
  session.sendMessage('t1', 'hello');
  await settled();
  expect(recorded).toEqual([]);
  session.close();
  expect(recorded).toEqual([['t1', 'entry-prompt']]);
});

it('names no prompt for a turn stopped before pi had it, after a turn that pi had', async () => {
  // The prompt after where the turn before began is the turn before's.
  const recorded: [string, string][] = [];
  const { session, pi } = opened({ onTurnRecorded: (turnId, entryId) => { recorded.push([turnId, entryId]); } });
  pi.setLeaf('entry-before');
  pi.setPrompted('entry-prompt');
  session.sendMessage('t1', 'hello');
  await settled();
  session.sendMessage('t2', 'again');
  session.abort();
  await settled();
  expect(pi.asked.filter((one) => one.kind === 'prompt')).toHaveLength(1);
  expect(recorded).toEqual([['t1', 'entry-prompt']]);
});

it('names no turn whose prompt pi has no entry for', async () => {
  const recorded: [string, string][] = [];
  const { session } = opened({ onTurnRecorded: (turnId, entryId) => { recorded.push([turnId, entryId]); } });
  session.sendMessage('t1', 'hello');
  await settled();
  expect(recorded).toEqual([]);
});

it('skips a call the model was still writing when the turn stopped, in the snapshot too', async () => {
  const { session, pi } = opened();
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  const events = streamed([{ type: 'toolCall', id: 'c1', name: 'write', arguments: {} }]);
  // The call's start and nothing after: the turn stops mid-arguments.
  for (const event of events.slice(0, 2)) pi.raise(event);
  session.abort();
  await settled();
  const turns = session.chatState().turns as Bag[];
  const row = callIn(turns[0]?.responseParts as Bag[], 'c1');
  expect(row).toMatchObject({ status: 'cancelled', reason: 'skipped' });
});

it('ends the turn on pi settling, not on the prompt returning', async () => {
  const { session, pi, types } = opened();
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  expect(types('chat')).not.toContain('chat/turnComplete');
  // A run pi will retry is not a turn that ended.
  pi.raise({ type: 'agent_end', messages: [], willRetry: true });
  await settled();
  expect(types('chat')).not.toContain('chat/turnComplete');
  pi.raise({ type: 'agent_settled', aborted: false });
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
  session.sendMessage('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', 'edit', { path: 'src/a.ts', oldText: 'a', newText: 'b' });
  await driveCall(pi, 'c2', 'read', { path: 'src/b.ts' });
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c2', toolName: 'read', result: 'b', isError: false });
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'edit', result: 'ok', isError: false });
  expect(edits).toEqual([
    ['t1', join(root, 'src/a.ts'), 'before'],
    ['t1', join(root, 'src/a.ts'), 'after'],
  ]);
  pi.raise({ type: 'agent_settled', aborted: false });
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
  session.sendMessage('t1', 'hello');
  await settled();
  const elsewhere = join(root, 'elsewhere', 'c.ts');
  await driveCall(pi, 'c1', 'write', { path: elsewhere, content: 'c' });
  expect(edits).toEqual([['t1', elsewhere, 'before']]);
  pi.raise({ type: 'agent_settled', aborted: false });
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
  session.sendMessage('t1', 'hello');
  await settled();
  const path = join(root, 'a.ts');
  expect(edits).toEqual([['t1', path, 'before'], ['t1', path, 'after']]);
  pi.backend.prompt = prompt;
  session.sendMessage('t2', 'again');
  await settled();
  expect(edits).toHaveLength(2);
});

it('moves the finished turn out of active and into the transcript', async () => {
  const { session } = opened();
  session.sendMessage('t1', 'hello');
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
  session.sendMessage('t1', 'hello');
  await settled();
  expect(at.get('chat/turnComplete')).toBe(Status.Idle);
});

it('is idle by the time it says a turn was cancelled', async () => {
  const { session, pi, at } = ending();
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  session.abort();
  await settled();
  expect(at.get('chat/turnCancelled')).toBe(Status.Idle);
});

it('has failed by the time it says a turn failed', async () => {
  const { session, pi, at } = ending();
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  pi.raise({
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'error', errorMessage: 'boom' },
  } as never);
  pi.raise({ type: 'agent_settled', aborted: false });
  await settled();
  expect(at.get('chat/error')).toBe(Status.Error);
});

it('passes the chosen model and its thinking level through to pi', async () => {
  const { session, pi, types } = opened();
  session.changeModel({ id: 'openai/gpt-5', config: { [THINKING_KEY]: 'off' } });
  session.sendMessage('t1', 'hello');
  await settled();
  expect(pi.asked.find((one) => one.kind === 'setModel'))
    .toEqual({ kind: 'setModel', id: 'openai/gpt-5', config: { [THINKING_KEY]: 'off' } });
  expect(types('chat')).not.toContain('chat/error');
  expect(pi.asked.some((one) => one.kind === 'prompt')).toBe(true);
});

it('runs a turn that names a model pi does not offer on the model pi is on, and logs it', async () => {
  /*
   * VS Code's host keeps a chat's model when its agent does not offer the one
   * a turn names, logs that, and runs the turn.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2228-L2235
   */
  const lines: string[] = [];
  const { session, pi, types } = opened({}, { log: (line) => { lines.push(line); } });
  session.changeModel({ id: 'openrouter/nobody' });
  session.sendMessage('t1', 'hello');
  await settled();
  expect(types('chat')).not.toContain('chat/error');
  expect(pi.asked.some((one) => one.kind === 'prompt')).toBe(true);
  expect(lines.filter((line) => line.includes('ahp-chat:/s1') && line.includes('openrouter/nobody'))).toHaveLength(1);
  // The model is where it was, so the next turn runs on it, which the turn
  // read back names.
  session.sendMessage('t2', 'again');
  await settled();
  const kept = watchedSession('pi', 'pi-session-1')?.turns.find((one) => one.turnId === 't2');
  expect(kept?.message.model).toEqual({ id: 'anthropic/claude-opus-5' });
  // The start every client holds is the message as it was sent, which named none.
  expect((session.chatState().turns as Bag[]).find((one) => one.id === 't2')?.message).not.toHaveProperty('model');
  expect(types('chat')).toContain('chat/turnComplete');
});

it('opens a session on a configured model pi does not have, and logs it', async () => {
  const lines: string[] = [];
  const { session, pi, types } = opened({}, { model: 'openrouter/nobody', log: (line) => { lines.push(line); } });
  session.sendMessage('t1', 'hello');
  await settled();
  expect(pi.asked.find((one) => one.kind === 'setModel')).toEqual({ kind: 'setModel', id: 'openrouter/nobody' });
  expect(pi.asked.some((one) => one.kind === 'prompt')).toBe(true);
  expect(types('chat')).not.toContain('chat/error');
  expect(lines.filter((line) => line.includes("starts on pi's default") && line.includes('openrouter/nobody'))).toHaveLength(1);
});

it('runs a new session on the model the options name', async () => {
  const { session, pi } = opened({}, { model: 'openai/gpt-5' });
  session.sendMessage('t1', 'hello');
  await settled();
  expect(pi.asked.find((one) => one.kind === 'setModel')).toEqual({ kind: 'setModel', id: 'openai/gpt-5' });
});

it('keeps a resumed session on the model its own file recorded', async () => {
  const { session, pi } = opened({ resume: 'pi-session-1' } as Partial<Start>, { model: 'openai/gpt-5' });
  session.sendMessage('t1', 'hello');
  await settled();
  expect(pi.asked.find((one) => one.kind === 'setModel')).toBeUndefined();
});

it('lets a turn choose over the configured model', async () => {
  const { session, pi } = opened({}, { model: 'openai/gpt-5' });
  session.changeModel({ id: 'anthropic/claude-opus-5' });
  session.sendMessage('t1', 'hello');
  await settled();
  expect(pi.asked.filter((one) => one.kind === 'setModel').map((one) => one.id))
    .toEqual(['openai/gpt-5', 'anthropic/claude-opus-5']);
});

it('carries the model a turn runs on its message', async () => {
  const { session } = opened({}, { model: 'openai/gpt-5' });
  session.changeModel({ id: 'anthropic/claude-opus-5', config: { [THINKING_KEY]: 'high' } });
  session.sendMessage('t1', 'hello');
  await settled();
  const turn = (session.chatState().turns as Bag[]).find((one) => one.id === 't1');
  expect((turn?.message as Bag).model).toEqual({ id: 'anthropic/claude-opus-5', config: { [THINKING_KEY]: 'high' } });
});

/*
 * The start every client holds is the message as the client sent it, as VS
 * Code's host says a client's start; the turn read back names the model it
 * ran on.
 */
it('holds a turn that names no model as it was sent, and reads it back with the configured model', async () => {
  const { session } = opened({}, { model: 'openai/gpt-5' });
  session.sendMessage('t1', 'hello');
  await settled();
  const turn = (session.chatState().turns as Bag[]).find((one) => one.id === 't1');
  expect(turn?.message).not.toHaveProperty('model');
  const kept = watchedSession('pi', 'pi-session-1')?.turns.find((one) => one.turnId === 't1');
  expect((kept?.message.model as Bag | undefined)?.id).toBe('openai/gpt-5');
});

it('leaves the model off a turn that has none', async () => {
  const { session } = opened();
  session.sendMessage('t1', 'hello');
  await settled();
  const turn = (session.chatState().turns as Bag[]).find((one) => one.id === 't1');
  expect((turn?.message as Bag).model).toBeUndefined();
});

/*
 * What the host has to say on a turn reaches that turn by pi's own custom
 * message, as the reference agents deliver the instructions their host
 * contributes for a send, and the prompt holds the person's words alone.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2281-L2288
 */
it('hands the send\'s instructions to that turn by pi\'s custom message, and prompts the words alone', async () => {
  const { session, pi } = opened();
  session.sendMessage('t1', 'hello', undefined, undefined, { instructions: () => ['Report back to the chat this came from.', ' '] });
  await settled();
  session.sendMessage('t2', 'again');
  await settled();
  expect(pi.asked.filter((one) => one.kind === 'prompt' || one.kind === 'customMessage').map((one) => [one.kind, one.text ?? one.content]))
    .toEqual([['customMessage', 'Report back to the chat this came from.'], ['prompt', 'hello'], ['prompt', 'again']]);
});

it('steers the running turn with pi\'s own steer', async () => {
  const { session, pi } = opened();
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  // Answered once pi has read it, which the hand-off waits on.
  expect(session.sendSteeringMessage?.({ id: 't1', text: 'actually, stop' })).toBeInstanceOf(Promise);
  // The message is built before it is steered, which reads its attachments
  // off disk, so the steer reaches pi a turn of the event loop later.
  await settled();
  expect(pi.asked.find((one) => one.kind === 'steer')?.text).toBe('actually, stop');
});

it('has nothing to steer when no turn is running, and says so', () => {
  const { session } = opened();
  expect(session.sendSteeringMessage?.({ id: 't1', text: 'hello' })).toBe(false);
});

/*
 * The host said the steering message the client set, so pi's session says no
 * set of its own; the hand-off answers once pi has read it, and its removal is
 * said then, as the reference agents answer a steering message.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1943-L1948
 */
it('answers a steering message once pi has read it, and takes it out then', async () => {
  const { session, pi, sent } = opened();
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  let taken: boolean | undefined;
  void (session.sendSteeringMessage?.({ id: 's1', text: 'actually, stop' }) as Promise<boolean>).then((answer) => { taken = answer; });
  expect(sent.some((one) => one.action.type === 'chat/pendingMessageSet')).toBe(false);

  await settled();
  // pi says its steering queue as it takes the message, and again once the
  // turn has read it.
  pi.raise({ type: 'queue_update', steering: ['actually, stop'], followUp: [] });
  await settled();
  expect(sent.some((one) => one.action.type === 'chat/pendingMessageRemoved')).toBe(false);
  expect(taken).toBeUndefined();
  pi.raise({ type: 'queue_update', steering: [], followUp: [] });
  await settled();
  expect(sent.filter((one) => one.action.type === 'chat/pendingMessageRemoved').map((one) => one.action))
    .toEqual([{ type: 'chat/pendingMessageRemoved', kind: 'steering', id: 's1' }]);
  expect(taken).toBe(true);
});

/*
 * A steering message the turn ended before reading goes back to the host, as
 * the reference agent hands one back unsent, for the host to steer the turn
 * that runs then or run it next; pi is told to let go of it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1943-L1948
 */
it('hands a steering message back when the turn ends before pi reads it', async () => {
  const { session, pi, sent } = opened();
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  let taken: boolean | undefined;
  void (session.sendSteeringMessage?.({ id: 's1', text: 'actually, stop' }) as Promise<boolean>).then((answer) => { taken = answer; });
  await settled();
  pi.raise({ type: 'queue_update', steering: ['actually, stop'], followUp: [] });
  pi.raise({ type: 'agent_settled', aborted: false });
  await settled();
  expect(taken).toBe(false);
  expect(pi.asked.some((one) => one.kind === 'clearSteering')).toBe(true);
  expect(sent.some((one) => one.action.type === 'chat/pendingMessageRemoved')).toBe(false);
});

/*
 * A steer pi will not take is the steering message's failure, and the turn
 * runs on in pi, so every client holds it running: the message comes out of
 * the chat and the reason goes to the log, as the reference drops a steering
 * message it cannot hand its agent.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L449-L474
 */
it('keeps the turn running when pi will not take a steer, and takes the message out', async () => {
  const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const { session, pi, sent } = opened();
    pi.hold();
    session.sendMessage('t1', 'hello');
    await settled();
    pi.failSteer(new Error('pi is compacting'));
    await expect(session.sendSteeringMessage?.({ id: 's1', text: 'actually, stop' })).resolves.toBe(true);
    await settled();
    expect(sent.some((one) => one.action.type === 'chat/error')).toBe(false);
    expect(sent.filter((one) => one.action.type === 'chat/pendingMessageRemoved').map((one) => one.action))
      .toEqual([{ type: 'chat/pendingMessageRemoved', kind: 'steering', id: 's1' }]);
    expect(((session.chatState() as Bag).activeTurn as Bag | undefined)?.id).toBe('t1');
    expect(warned.mock.calls.flat().join(' ')).toContain('pi is compacting');
  }
  finally {
    warned.mockRestore();
  }
});

/*
 * A turn handed while one runs is a send of its own, which pi runs once the
 * turn in front of it is over, as the reference agent runs each send after the
 * one before it. The host said its start, so it took the running turn's place
 * in every client's state, and the turn it replaced runs on into no history.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1814
 */
it('runs a second turn handed while the first runs once the first ends, the first in no history', async () => {
  const { session, pi, types } = opened();
  pi.hold();
  session.sendMessage('t1', 'first');
  await settled();
  session.sendMessage('t2', 'second');
  await settled();
  expect((session.chatState().activeTurn as { id?: string } | undefined)?.id).toBe('t1');
  expect(pi.asked.filter((one) => one.kind === 'prompt').map((one) => one.text)).toEqual(['first']);

  pi.raise({ type: 'agent_settled', aborted: false });
  await settled();
  expect(pi.asked.filter((one) => one.kind === 'prompt').map((one) => one.text)).toEqual(['first', 'second']);
  expect(types('chat')).not.toContain('chat/turnStarted');
  expect((session.chatState().turns as { id: string }[]).map((turn) => turn.id)).not.toContain('t1');
  expect((session.chatState().activeTurn as { id?: string } | undefined)?.id).toBe('t2');
});

/*
 * A stop ends the turn in every client's state when the host takes it, and pi
 * lets the turn go after. A turn sent between the two runs once pi is free, as
 * the reference host hands a client's turn to its agent while an abort may
 * still be under way; the stopped turn ends in the history as stopped.
 */
it('runs a turn sent while pi lets a stopped turn go once pi is free', async () => {
  const { session, pi, types } = opened();
  pi.hold();
  pi.holdStops();
  session.sendMessage('t1', 'first');
  await settled();
  session.abort();
  await settled();
  session.sendMessage('t2', 'second');
  await settled();
  expect(pi.asked.filter((one) => one.kind === 'prompt').map((one) => one.text)).toEqual(['first']);

  pi.raise({ type: 'agent_settled', aborted: true });
  await settled();
  expect(pi.asked.filter((one) => one.kind === 'prompt').map((one) => one.text)).toEqual(['first', 'second']);
  expect(types('chat')).not.toContain('chat/turnStarted');
  expect((session.chatState().turns as { id: string; state?: string }[]).map((turn) => [turn.id, turn.state])).toEqual([['t1', 'cancelled']]);
  expect((session.chatState().activeTurn as { id?: string } | undefined)?.id).toBe('t2');
});

/*
 * A stop drops the turns handed behind the one it stops, as the reference
 * stop aborts the agent's work in flight and drops what waits behind it: the
 * host ended them in every client's state, and pi neither runs nor ends them.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1946-L1954
 */
it('drops a turn handed behind the one a stop ends, saying nothing of it', async () => {
  const { session, pi, sent } = opened();
  pi.hold();
  session.sendMessage('t1', 'first');
  await settled();
  session.sendMessage('t2', 'second');
  await settled();
  session.abort();
  await settled();
  expect(pi.asked.filter((one) => one.kind === 'prompt').map((one) => one.text)).toEqual(['first']);
  expect(sent.filter((one) => one.action.turnId === 't2')).toEqual([]);
  expect(session.chatState().turns).toEqual([]);
  expect(session.chatState().activeTurn).toBeUndefined();
});

it('takes pi its own name for the conversation as the title', async () => {
  const { session, pi, last } = opened();
  session.sendMessage('t1', 'hello');
  await settled();
  pi.raise({ type: 'session_info_changed', name: 'Refactor the parser' });
  expect(last('session/titleChanged')?.title).toBe('Refactor the parser');
  expect(session.title()).toBe('Refactor the parser');
});

it('names an unnamed session after the first thing said in it', async () => {
  const { session } = opened();
  session.sendMessage('t1', 'Fix the tunnel forwarder\nand its test');
  await settled();
  expect(session.title()).toBe('Fix the tunnel forwarder');
});

it('renames pi too, so the title survives outside this host', async () => {
  const { session, pi } = opened();
  session.sendMessage('t1', 'hello');
  await settled();
  session.setTitle?.('Something else');
  expect(pi.asked.find((one) => one.kind === 'rename')?.title).toBe('Something else');
});

it('keeps a person\'s name when pi offers one afterwards', async () => {
  const { session, pi } = opened();
  session.sendMessage('t1', 'hello');
  await settled();
  // A person's rename, which the host announces and this only keeps: a name
  // somebody chose is not pi's to replace, the way ACP's `renamed` guard says.
  session.setTitle?.('Something else');
  pi.raise({ type: 'session_info_changed', name: 'Refactor the parser' });
  await settled();
  expect(session.title()).toBe('Something else');
});

it('opens pi under the chat\'s own name, so a second chat is a conversation of its own', async () => {
  /*
   * The session's id names its first chat alone, so a peer chat hands pi a
   * name of its own. One file per conversation is what keeps two chats of one
   * session from becoming one transcript with two writers.
   */
  const CHAT = '99999999-8888-7777-6666-555555555555';
  const { session, pi } = opened({ chatId: CHAT });
  session.sendMessage('t1', 'hello');
  await settled();
  expect(pi.opens[0]?.id).toBe(CHAT);
});

/*
 * A level pi moved itself is a model's, which the session's schema does not
 * declare: it is read on the model selection, whose config the agent's schema
 * puts it in, and said in no session config.
 */
it('says no session config for a level pi moved itself', async () => {
  const { session, pi, last } = opened();
  session.sendMessage('t1', 'hello');
  await settled();
  pi.raise({ type: 'thinking_level_changed', level: 'high' as never });
  await settled();
  expect(last('session/configChanged')).toBeUndefined();
  expect(session.settings()).not.toHaveProperty('thinkingLevel');
});

it('truncates by moving pi own leaf back', async () => {
  const { session, pi } = opened({ rewindAt: 'entry-7' } as Partial<Start>);
  session.sendMessage('t1', 'hello');
  await settled();
  expect(pi.asked.find((one) => one.kind === 'truncate')?.entryId).toBe('entry-7');
});

it('answers where a watched turn ended, and nothing for one it never saw end', async () => {
  const { session, pi } = opened();
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  // Still running, so there is no point to name yet.
  expect(session.endPoint?.('t1')).toBeUndefined();
  pi.setLeaf('entry-7');
  pi.raise({ type: 'agent_settled', aborted: false });
  await settled();
  expect(session.endPoint?.('t1')).toBe('entry-7');
  expect(session.endPoint?.('never-watched')).toBeUndefined();
});

it('names where a watched turn ended as the point a fork copies through', async () => {
  const { session, pi } = opened();
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  // Still running, so there is no point to name yet.
  expect(session.forkPoint?.('t1')).toBeUndefined();
  pi.setLeaf('entry-7');
  pi.raise({ type: 'agent_settled', aborted: false });
  await settled();
  // The turn's last entry, not the prompt it began with: a fork copies the
  // conversation through the turn it names, answer included.
  expect(session.forkPoint?.('t1')).toBe('entry-7');
  expect(session.forkPoint?.('t1')).toBe(session.endPoint?.('t1'));
  // A turn this session never watched end has no leaf to name, and no second
  // map: `forkPoint` is `endPoint`.
  expect(session.forkPoint?.('never-watched')).toBeUndefined();
});

/*
 * A cut pi refuses is logged, and the turn runs on pi's leaf: the reference
 * host logs an agent's cut that failed (agentSideEffects.ts L1982-L1986 at
 * a4e689ae).
 */
it('runs the turn when pi refuses to move the leaf back, and logs the refusal', async () => {
  const { session, pi, last } = opened({ rewindAt: 'entry-7' } as Partial<Start>);
  pi.refuseTruncate();
  const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
  session.sendMessage('t1', 'hello');
  await settled();
  expect(pi.asked.find((one) => one.kind === 'truncate')?.entryId).toBe('entry-7');
  expect(last('chat/error')).toBeUndefined();
  expect(pi.asked.find((one) => one.kind === 'prompt')?.text).toBe('hello');
  expect(warned.mock.calls.some(([line]) => String(line).includes('refused to move the leaf back to entry-7'))).toBe(true);
  warned.mockRestore();
});

it('fails the turn on the last assistant message ending in error', async () => {
  const { session, pi, last } = opened();
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  pi.raise({
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'error', errorMessage: '429 rate limited' },
  } as never);
  pi.raise({ type: 'agent_settled', aborted: false });
  await settled();
  expect(((last('chat/error')?.part as Bag).error as Bag).message).toBe('429 rate limited');
  expect(session.status()).toBe(2);
  expect((session.chatState().turns as Bag[])[0]?.state).toBe('error');
});

it('does not fail a turn pi retried and then answered', async () => {
  const { session, pi, types } = opened();
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  pi.raise({
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'error', errorMessage: 'boom' },
  } as never);
  // A run pi will retry is not a turn that ended, and the retry replaces the
  // error with an answer.
  pi.raise({ type: 'agent_end', messages: [], willRetry: true });
  pi.raise({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } } as never);
  pi.raise({ type: 'agent_settled', aborted: false });
  await settled();
  expect(types('chat')).toContain('chat/turnComplete');
  expect(types('chat')).not.toContain('chat/error');
});

it('keeps a cancelled turn cancelled when its last message was aborted', async () => {
  const { session, pi, types } = opened();
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  pi.raise({ type: 'message_end', message: { role: 'assistant', stopReason: 'aborted' } } as never);
  session.abort();
  await settled();
  expect(types('chat')).toContain('chat/turnCancelled');
  expect(types('chat')).not.toContain('chat/error');
});

it('sends what the turn used, before it ends, and keeps it on the transcript', async () => {
  const { session, pi, types, last } = opened();
  pi.hold();
  session.sendMessage('t1', 'hello');
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
  pi.raise({ type: 'agent_settled', aborted: false });
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
  session.sendMessage('t1', 'hello');
  await settled();
  expect(types('chat')).not.toContain('chat/usage');
});

it('sends no usage for an error that used no tokens', async () => {
  const { session, pi, types } = opened();
  pi.hold();
  session.sendMessage('t1', 'hello');
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
  pi.raise({ type: 'agent_settled', aborted: false });
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

  session.sendMessage('t1', 'hello');
  await settled();
  const failure = sent.find((one) => one.action.type === 'chat/error')?.action;
  expect(((failure?.part as Bag).error as Bag).message).toBe('no model provider is configured');
  expect(session.status()).toBe(2);
});

/*
 * A key the schema does not declare and a value it does not offer, refused in
 * VS Code's two sentences.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L136-L147
 */
it('refuses a setting it does not serve, and a value it does not offer, in VS Code\'s two sentences', async () => {
  const { session } = opened();
  expect(await session.setConfig?.('projectTrust', 'deny')).toBe(true);
  expect(await session.setConfig?.('projectTrust', 'maybe')).toBe('Session configuration \'projectTrust\' does not offer \'maybe\'.');
  expect(await session.setConfig?.('permissionMode', 'yolo')).toBe('Session configuration \'permissionMode\' does not offer \'yolo\'.');
  expect(await session.setConfig?.('somethingElse', 'plan')).toBe('Session configuration \'somethingElse\' is not writable.');
});

/** Where pi's loader says it found a resource. */
const source = (path: string, baseDir: string, scope: 'user' | 'project', origin: 'top-level' | 'package' = 'top-level') =>
  ({ path, source: origin === 'package' ? 'npm:pi-tools' : 'local', scope, origin, baseDir });

/** What pi's loader finds under `home`: a user skill, a package's skill, a project prompt template and a user extension. */
const RESOURCES = (home: string) => ({
  skills: [
    {
      name: 'review', description: 'Reviews a change', filePath: join(home, 'agent', 'skills', 'review', 'SKILL.md'), baseDir: join(home, 'agent', 'skills', 'review'),
      sourceInfo: source(join(home, 'agent', 'skills', 'review', 'SKILL.md'), join(home, 'agent', 'skills'), 'user'), disableModelInvocation: false,
    },
    {
      name: 'lint', description: '', filePath: join(home, 'pkg', 'skills', 'lint', 'SKILL.md'), baseDir: join(home, 'pkg', 'skills', 'lint'),
      sourceInfo: source(join(home, 'pkg', 'skills', 'lint', 'SKILL.md'), join(home, 'pkg'), 'user', 'package'), disableModelInvocation: true,
    },
  ],
  prompts: [{
    name: 'fix', description: 'Fixes it', content: 'Fix it.', filePath: join(home, 'work', '.pi', 'prompts', 'fix.md'),
    sourceInfo: source(join(home, 'work', '.pi', 'prompts', 'fix.md'), join(home, 'work', '.pi', 'prompts'), 'project'),
  }],
  extensions: [
    {
      path: join(home, 'agent', 'extensions', 'guard.ts'), resolvedPath: join(home, 'agent', 'extensions', 'guard.ts'),
      sourceInfo: source(join(home, 'agent', 'extensions', 'guard.ts'), join(home, 'agent', 'extensions'), 'user'),
    },
    // This host's own, which pi was handed inline, and is no customization of the person's.
    { path: '<inline:ahpd>', resolvedPath: '<inline:ahpd>', hidden: true, sourceInfo: { path: '<inline:ahpd>', source: 'inline', scope: 'temporary', origin: 'top-level' } },
  ],
}) as unknown as Parameters<ReturnType<typeof fakePi>['find']>[0];

/*
 * pi's skills, prompt templates and extensions in the customization model: a
 * directory per folder pi loads from, holding the kind found there, as VS
 * Code's discovery groups customizations, and a package a plugin holding its
 * kinds, each by its URI.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/sessionCustomizationDiscovery.ts#L1041-L1078
 */
it('lists pi\'s skills, prompt templates and extensions, a directory per folder and a package as a plugin', async () => {
  const pi = fakePi();
  pi.find(RESOURCES(root));
  const { session, last } = opened({}, {}, pi.open);
  session.sendMessage('t1', 'hello');
  await settled();
  const folder = (...parts: string[]) => uriOf(join(root, ...parts));
  const listed = [
    {
      type: 'directory', id: folder('agent', 'skills'), uri: folder('agent', 'skills'), name: 'skills', enabled: true, contents: 'skill', writable: true,
      load: { kind: 'loaded' },
      children: [{ type: 'skill', id: folder('agent', 'skills', 'review', 'SKILL.md'), uri: folder('agent', 'skills', 'review', 'SKILL.md'), name: 'review', description: 'Reviews a change' }],
    },
    {
      type: 'plugin', id: folder('pkg'), uri: folder('pkg'), name: 'pkg', enablement: [{ kind: 'session', enabled: true }], load: { kind: 'loaded' },
      children: [{ type: 'skill', id: folder('pkg', 'skills', 'lint', 'SKILL.md'), uri: folder('pkg', 'skills', 'lint', 'SKILL.md'), name: 'lint', disableModelInvocation: true }],
    },
    {
      type: 'directory', id: folder('work', '.pi', 'prompts'), uri: folder('work', '.pi', 'prompts'), name: 'prompts', enabled: true, contents: 'prompt', writable: true,
      load: { kind: 'loaded' },
      children: [{ type: 'prompt', id: folder('work', '.pi', 'prompts', 'fix.md'), uri: folder('work', '.pi', 'prompts', 'fix.md'), name: 'fix', description: 'Fixes it' }],
    },
    {
      type: 'directory', id: folder('agent', 'extensions'), uri: folder('agent', 'extensions'), name: 'extensions', enabled: true, contents: 'hook', writable: true,
      load: { kind: 'loaded' },
      children: [{ type: 'hook', id: folder('agent', 'extensions', 'guard.ts'), uri: folder('agent', 'extensions', 'guard.ts'), name: 'guard' }],
    },
  ];
  expect(session.customizations()).toEqual(listed);
  expect(last('session/customizationsChanged')).toEqual({ type: 'session/customizationsChanged', customizations: listed });
});

/*
 * A switch reaches pi as a tool change does: the pi built before the next turn
 * leaves what is off out through its loader's own overrides.
 */
it('switches a skill or a package off for the pi built before the next turn, and refuses an id that is no customization of pi\'s', async () => {
  const pi = fakePi();
  pi.find(RESOURCES(root));
  const { session } = opened({}, {}, pi.open);
  session.sendMessage('t1', 'hello');
  await settled();
  pi.raise({ type: 'agent_settled' } as never);
  await settled();
  const review = uriOf(join(root, 'agent', 'skills', 'review', 'SKILL.md'));
  expect(await session.setCustomizationEnabled(review, false)).toBe(true);
  expect(await session.setCustomizationEnabled(uriOf(join(root, 'pkg')), false)).toBe(true);
  expect(await session.setCustomizationEnabled('skill', true)).toBe(false);
  expect(await session.startMcpServer('one')).toBe(false);
  const skills = (session.customizations() as Bag[]).flatMap((one) => (one.children as Bag[]).filter((child) => child.type === 'skill'));
  expect(skills.map((one) => [one.name, one.enabled])).toEqual([['review', false], ['lint', undefined]]);
  expect((session.customizations() as Bag[]).find((one) => one.type === 'plugin')?.enablement).toEqual([{ kind: 'session', enabled: false }]);
  session.sendMessage('t2', 'again');
  await settled();
  expect([...(pi.opens.at(-1)?.switchedOff ?? [])].sort()).toEqual([
    join(root, 'agent', 'skills', 'review', 'SKILL.md'),
    join(root, 'pkg', 'skills', 'lint', 'SKILL.md'),
  ]);
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
  session.sendMessage('t1', 'hello');
  await settled();
  const agent = piAgent({}, [root], async () => (await pi.backend.models()).map((model) => {
    const startsOn = pi.backend.startsOn(model);
    return { model, levels: pi.backend.levels(model), ...(startsOn === undefined ? {} : { startsOn }) };
  }));
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

it('reads back a turn that had not ended as interrupted, as pi file reads one back', async () => {
  /*
   * VS Code's reader ends a turn whose request is still active at the end of
   * its events in error, with a resumable `executionInterrupted` part.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L1152-L1155
   */
  const interrupted = {
    kind: 'error',
    error: { errorType: 'executionInterrupted', message: 'The agent was interrupted before this request finished.' },
    resumable: true,
  };
  const { session, pi } = opened();
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  const agent = piAgent({ sessionDir: join(root, 'pi') }, [root]);
  const running = await agent.transcript?.('pi-session-1');
  expect(running?.map((one) => one.state)).toEqual(['error']);
  expect(running?.[0]?.responseParts.at(-1)).toEqual(interrupted);
  // The live turn holds what it holds; the interruption is the record's reading.
  expect(((session.chatState().activeTurn as Bag).responseParts as Bag[]).some((part) => part.kind === 'error')).toBe(false);
  session.close();
  const closed = await agent.transcript?.('pi-session-1');
  expect(closed?.map((one) => one.state)).toEqual(['error']);
  expect(closed?.[0]?.responseParts.at(-1)).toEqual(interrupted);
});

/*
 * A turn whose session closes under it ends for every client as VS Code's
 * agent ends a turn whose runtime goes: an error part that is not resumable,
 * in VS Code's words for a turn its agent left unfinished, and then the turn's
 * completion. The read back above finds the same turn interrupted and
 * resumable, since nothing records an ending for it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L4606-L4646
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L7991-L7994
 */
it('ends a turn still running at close for every client, an error not marked resumable and then its completion', async () => {
  const { session, pi, sent } = opened();
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  session.close();
  const ending = sent.map((one) => one.action).filter((action) => action.type === 'chat/error' || action.type === 'chat/turnComplete');
  expect(ending).toEqual([
    {
      type: 'chat/error',
      turnId: 't1',
      duration: expect.any(Number) as number,
      part: { kind: 'error', error: { errorType: 'executionInterrupted', message: 'The agent was interrupted before this request finished.' } },
    },
    { type: 'chat/turnComplete', turnId: 't1', duration: expect.any(Number) as number },
  ]);
});

it('lists a session it watched as modified at its last change, as the chat is', async () => {
  /*
   * A listing dates a session by its last activity, as Codex's catalogue dates
   * its threads, and the record wins over pi's file in the listing.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L8204
   */
  const { session } = opened();
  session.sendMessage('t1', 'hello');
  await settled();
  await new Promise((done) => { setTimeout(done, 5); });
  session.sendMessage('t2', 'again');
  await settled();
  const agent = piAgent({ sessionDir: join(root, 'pi') }, [root]);
  const row = (await agent.list?.())?.find((one) => one.id === 'pi-session-1');
  expect(row?.modifiedAt).toBe(session.modifiedAt());
  expect(Date.parse(String(row?.modifiedAt))).toBeGreaterThan(Date.parse(String(row?.createdAt)));
  expect((await agent.find?.('pi-session-1'))?.modifiedAt).toBe(session.modifiedAt());
});

it('reads back the turns of a session it did watch', async () => {
  const { session } = opened();
  session.sendMessage('t1', 'hello');
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

/**
 * The daemon's home and `PI_CODING_AGENT_DIR` for one case, put back after it.
 *
 * `USERPROFILE` beside `HOME`, since that is the one `os.homedir()` reads on
 * Windows: without it, the case reads the home of the person running it.
 */
const withHome = <T>(home: string, agentDir: string | undefined, run: () => T): T => {
  const before = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
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
    .toEqual([join('/srv/pi', 'settings.json'), join('/srv/pi', 'models.json')]);
  expect(needs.piAgentDirectory).toMatchObject({ directory: '/srv/pi' });
});


// A failed turn resumed ------------------------------------------------------

/** A session whose turn `t1` wrote some text and then failed on a model call. */
const failedTurn = async () => {
  const one = opened();
  one.pi.hold();
  one.session.sendMessage('t1', 'hello');
  await settled();
  for (const event of streamed([{ type: 'text', text: 'Reading.' }])) one.pi.raise(event);
  one.pi.raise({
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'error', errorMessage: '429 rate limited' },
  } as never);
  one.pi.raise({ type: 'agent_settled', aborted: false });
  await settled();
  return one;
};

/*
 * Typed by pi's own stop reason, as VS Code's agents type a runtime's failure
 * by the runtime's own code.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSdkChatError.ts#L54-L64
 */
it('marks a failed model call resumable, on chat/error and on the turn', async () => {
  const { session, last } = await failedTurn();
  const part = last('chat/error')?.part as Bag;
  expect(part).toEqual({ kind: 'error', error: { errorType: 'error', message: '429 rate limited' }, resumable: true });
  const turn = (session.chatState().turns as Bag[])[0]!;
  expect((turn.responseParts as Bag[]).at(-1)).toEqual(part);
});

/*
 * A send that fails before pi has the prompt is typed by its stage, VS Code's
 * `sendFailed`, and a record that cannot be used is one: the turn is opened and
 * ended with the sentence cofold's turn ends with, as VS Code's host ends a
 * turn it cannot send with `chat/error`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2328-L2349
 */
it('types a send that fails before pi has the prompt by its stage', async () => {
  const failing: OpenPi = async () => { throw new Error('pi would not open'); };
  const { session, last } = opened({}, {}, failing);
  session.sendMessage('t1', 'hello');
  await settled();
  expect(last('chat/error')?.part).toEqual({ kind: 'error', error: { errorType: 'sendFailed', message: 'pi would not open' } });
});

it('ends a turn whose record cannot be used with the record\'s sentence, typed by its stage', async () => {
  const { session, last } = opened({}, {
    provider: 'pi-record',
    recordOf: () => { throw new Error('a key the vault would not read back'); },
  });
  expect(() => { session.sendMessage('t1', 'hello'); }).not.toThrow();
  await settled();
  expect(last('chat/error')).toMatchObject({
    turnId: 't1',
    part: { kind: 'error', error: { errorType: 'sendFailed', message: 'pi-record: the record cannot be used: a key the vault would not read back' } },
  });
});

it('does not mark a turn resumable when pi failed before it had the prompt', async () => {
  const sent: { channel: string; action: Bag }[] = [];
  const session = piSession({}, {
    uri: 'ahp-session:/s1',
    chatUri: 'ahp-chat:/s1',
    settings: {},
    workingDirectory: root,
    schema: () => ({}),
    emit: (channel, action) => { sent.push({ channel, action }); },
  } as Start, (async () => { throw new Error('no model provider is configured'); }) as OpenPi);
  session.sendMessage('t1', 'hello');
  await settled();
  const part = sent.find((one) => one.action.type === 'chat/error')?.action.part as Bag;
  expect(part.resumable).toBeUndefined();
  expect(((session.chatState().turns as Bag[])[0]!.responseParts as Bag[]).at(-1)).toEqual(part);
  expect(() => session.resumeTurn?.('t1')).toThrow();
});

/*
 * The host said the client's resume before it asked here, as the reference
 * host says a client's action itself, so pi's session says none.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2737-L2752
 */
it('reopens a failed turn on resume, with its parts, and says no resume of it', async () => {
  const { session, pi, sent } = await failedTurn();
  const before = sent.length;
  const parts = ((session.chatState().turns as Bag[])[0]!.responseParts as Bag[]).slice();
  pi.resumeWith(new Promise(() => {}));
  expect(() => session.resumeTurn?.('t1')).not.toThrow();
  expect(sent.slice(before).map((one) => one.action.type)).not.toContain('chat/turnResume');
  const state = session.chatState();
  expect(state.turns).toEqual([]);
  const active = state.activeTurn as Bag;
  expect(active.id).toBe('t1');
  expect(active.state).toBeUndefined();
  expect(active.responseParts).toEqual(parts);
  await settled();
  expect(pi.asked.at(-1)).toEqual({ kind: 'resume' });
  expect(session.status()).not.toBe(2);
});

it('ends a resumed run that answers as complete, with the turn once in turns', async () => {
  const { session, pi, types } = await failedTurn();
  expect(() => session.resumeTurn?.('t1')).not.toThrow();
  // What the resumed run writes, raised before the fake's `resume` returns.
  for (const event of streamed([{ type: 'text', text: 'Done.' }])) pi.raise(event);
  await settled();
  expect(types('chat').slice(-1)).toEqual(['chat/turnComplete']);
  const turns = session.chatState().turns as Bag[];
  expect(turns.map((one) => [one.id, one.state])).toEqual([['t1', 'complete']]);
  const kinds = (turns[0]!.responseParts as Bag[]).map((part) => part.kind);
  expect(kinds).toEqual(['markdown', 'error', 'markdown']);
  // The prompt was named when the turn first ended, and is not named again.
  expect(pi.asked.filter((one) => one.kind === 'promptAfter')).toHaveLength(1);
});

/*
 * A resumed run says its own time and usage, which the host merges over the
 * run before's as VS Code's host says a resumed turn, and the turn holds both
 * runs' so a chat opened after it reads what a client that watched it was told.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L966-L975
 */
it('says a resumed run\'s own time and usage, and holds the turn\'s across both runs', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const began = Date.parse('2026-11-04T12:00:00.000Z');
    vi.setSystemTime(began);
    const { session, pi, sent } = opened();
    pi.hold();
    session.sendMessage('t1', 'hello');
    await settled();
    vi.setSystemTime(began + 5000);
    pi.raise({
      type: 'message_end',
      message: {
        role: 'assistant', stopReason: 'error', errorMessage: '429 rate limited',
        usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120, cost: { total: 0.5 } },
      },
    } as never);
    pi.raise({ type: 'agent_settled', aborted: false });
    await settled();
    // A while later, a client resumes it, and the run takes two seconds.
    vi.setSystemTime(began + 60_000);
    expect(() => session.resumeTurn?.('t1')).not.toThrow();
    vi.setSystemTime(began + 62_000);
    pi.raise({
      type: 'message_end',
      message: {
        role: 'assistant', stopReason: 'stop', content: [],
        usage: { input: 40, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 50, cost: { total: 0.25 } },
      },
    } as never);
    await settled();

    const said = sent.filter((one) => one.channel === 'chat').map((one) => one.action);
    expect(said.filter((one) => one.type === 'chat/turnComplete').map((one) => one.duration)).toEqual([2000]);
    expect(said.filter((one) => one.type === 'chat/usage').at(-1)?.usage)
      .toMatchObject({ inputTokens: 40, outputTokens: 10, _meta: { 'ahpd.cost': { amount: 0.25 } } });
    const turn = (session.chatState().turns as Bag[])[0]!;
    expect([turn.state, turn.duration]).toEqual(['complete', 7000]);
    expect(turn.usage).toMatchObject({ inputTokens: 40, outputTokens: 10, _meta: { 'ahpd.cost': { amount: 0.75, currency: 'USD' } } });
  }
  finally {
    vi.useRealTimers();
  }
});

it('ends a resumed run that fails again with a second error, which is resumable', async () => {
  const { session, pi, last } = await failedTurn();
  expect(() => session.resumeTurn?.('t1')).not.toThrow();
  pi.raise({
    type: 'message_end',
    message: { role: 'assistant', stopReason: 'error', errorMessage: '500 overloaded' },
  } as never);
  await settled();
  expect((last('chat/error')?.part as Bag).resumable).toBe(true);
  const turn = (session.chatState().turns as Bag[])[0]!;
  expect(turn.state).toBe('error');
  const errors = (turn.responseParts as Bag[]).filter((part) => part.kind === 'error');
  expect(errors.map((part) => (part.error as Bag).message)).toEqual(['429 rate limited', '500 overloaded']);
  expect(() => session.resumeTurn?.('t1')).not.toThrow();
});

it('fails a resumed turn, not resumable, when pi has no failed reply to continue from', async () => {
  const { session, pi, last } = await failedTurn();
  pi.resumeWith(false);
  expect(() => session.resumeTurn?.('t1')).not.toThrow();
  await settled();
  const part = last('chat/error')?.part as Bag;
  expect(part.resumable).toBeUndefined();
  expect(() => session.resumeTurn?.('t1')).toThrow();
});

it('keeps a resumed turn resumable when pi throws as it continues', async () => {
  const { session, pi, last } = await failedTurn();
  pi.resumeWith(new Error('connection reset'));
  expect(() => session.resumeTurn?.('t1')).not.toThrow();
  await settled();
  expect(last('chat/error')?.part).toMatchObject({ error: { message: 'connection reset' }, resumable: true });
});

it('refuses a resume that names no failed, resumable latest turn', async () => {
  const { session, pi } = await failedTurn();
  // Not the latest turn's id.
  expect(() => session.resumeTurn?.('t0')).toThrow();
  // A turn is running.
  pi.hold();
  session.sendMessage('t2', 'again');
  await settled();
  expect(() => session.resumeTurn?.('t1')).toThrow();
  pi.raise({ type: 'agent_settled', aborted: false });
  await settled();
  // The latest turn completed.
  expect(() => session.resumeTurn?.('t2')).toThrow();
  expect(() => session.resumeTurn?.('t1')).toThrow();
  // A closed session.
  const closed = await failedTurn();
  closed.session.close();
  expect(() => closed.session.resumeTurn?.('t1')).toThrow();
  expect(pi.asked.some((one) => one.kind === 'resume')).toBe(false);
});

it('ends a resumed run cancelled when it is stopped', async () => {
  const { session, pi, types } = await failedTurn();
  pi.resumeWith(new Promise(() => {}));
  expect(() => session.resumeTurn?.('t1')).not.toThrow();
  await settled();
  session.abort();
  await settled();
  expect(types('chat').slice(-1)).toEqual(['chat/turnCancelled']);
  expect((session.chatState().turns as Bag[])[0]?.state).toBe('cancelled');
});

/*
 * A chat's activity is a wait before its turn can run, as VS Code's host says
 * one, and a resumed turn runs once the host hands it over.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L11709-L11724
 */
it('says no activity while a resumed turn runs again or is stopped', async () => {
  const { session, pi, sent } = await failedTurn();
  const before = sent.length;
  pi.resumeWith(new Promise(() => {}));
  expect(() => session.resumeTurn?.('t1')).not.toThrow();
  await settled();
  expect([session.activity(), session.chatState().activity, session.sessionState().activity]).toEqual([undefined, undefined, undefined]);
  session.abort();
  await settled();
  expect(sent.slice(before).filter((one) => one.action.type === 'chat/activityChanged' || one.action.type === 'session/activityChanged')).toEqual([]);
});
