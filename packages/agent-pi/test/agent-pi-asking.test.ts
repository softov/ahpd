import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Status } from '../../sdk/src/sessions/catalog.js';
import type { Bag, BoundTool, Start } from '../../sdk/src/types/index.js';
import { piAgent } from '../src/agent.js';
import { callIn, driveCall, opened, root, settled } from './fake-pi.js';
import { posix } from '../../../tools/posix.ts';

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

it('asks a person before a call runs, and runs it on their answer', async () => {
  const { session, pi, last } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  const waiting = driveCall(pi, 'c1', 'bash', { command: 'ls' });
  await settled();
  expect(session.status()).toBe(Status.InputNeeded);
  expect(last('chat/toolCallReady')?.confirmed).toBeUndefined();
  expect(last('chat/toolCallReady')?.confirmationTitle).toBe('Run bash?');
  expect((last('session/inputNeededSet')?.request as Bag).kind).toBe('toolConfirmation');
  session.confirm('c1', true);
  expect(await waiting).toBeUndefined();
  // The confirmation is the client's, which the host says as it was sent; the
  // call this session holds moves with it.
  expect(last('chat/toolCallConfirmed')).toBeUndefined();
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect(callIn(parts, 'c1')).toMatchObject({ status: 'running', confirmed: 'user-action' });
  expect(session.status()).toBe(Status.InProgress);
});

it('answers what it is waiting on in its state, so a client that connects late sees the question', async () => {
  const { session, pi, last } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
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
  session.sendMessage('t1', 'hello');
  await settled();
  const waiting = driveCall(pi, 'c1', 'bash', { command: 'rm -rf /' });
  await settled();
  session.confirm('c1', false);
  expect(await waiting).toEqual({ block: true, reason: 'The person declined this action' });
});

it('answers two waiting calls independently, and a cancel answers both it leaves', async () => {
  const { session, pi, sent } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
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
  session.abort();
  await two;
  expect(second).toEqual({ block: true, reason: 'The turn was stopped' });

  // Each question the cancel left is taken off the list and answered in no
  // one's name: the turn's end makes its call cancelled, `skipped`, as the
  // reducer does (channels-chat/reducer.ts L172-L211 at v1.0.0).
  expect(sent.filter((one) => one.action.type === 'chat/toolCallConfirmed'
    && one.action.approved === false)).toHaveLength(0);
  // The entries follow the chat's state: the host took the first down with
  // the confirmation it said and the second with the stop, so this session
  // takes none down itself.
  expect(sent.filter((one) => one.action.type === 'session/inputNeededRemoved')).toHaveLength(0);
  expect(session.status()).not.toBe(Status.InputNeeded);
  const turns = session.chatState().turns as Bag[];
  const parts = turns[turns.length - 1]?.responseParts as Bag[];
  expect(callIn(parts, 'c2')).toMatchObject({ status: 'cancelled', reason: 'skipped' });
});

/*
 * A running shell call holds the output it has printed, as the reducer holds
 * the content each change says, so a subscription opened mid-call reads what a
 * client that watched it was told.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexMapAppServerEvents.ts#L971-L986
 */
it('holds a running shell call\'s output so far, as the content it said', async () => {
  const { session, pi, last } = opened({ settings: { permissionMode: 'bypassPermissions' } } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', 'bash', { command: 'ls' });
  pi.raise({ type: 'bash_execution_update', id: 'c1', delta: 'one\n' } as never);
  pi.raise({ type: 'bash_execution_update', id: 'c1', delta: 'two\n' } as never);
  const output = [{ type: 'text', text: 'one\ntwo\n' }];
  expect(last('chat/toolCallContentChanged')?.content).toEqual(output);
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect(callIn(parts, 'c1')).toMatchObject({ status: 'running', content: output });
});

/*
 * A call runs titled by what it runs on, and once it is done says what it did
 * as VS Code's agents word a call's past tense: a shell command as the first
 * line it ran, a call that failed as failed, and any other call by its line.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeToolDisplay.ts#L497-L541
 */
it.each([
  ['bash', { command: 'ls -la\npwd' }, 'ls -la\npwd', false, { markdown: 'Ran `ls -la`' }],
  ['powershell', { command: 'Get-ChildItem' }, 'Get-ChildItem', false, { markdown: 'Ran `Get-ChildItem`' }],
  ['bash', { command: 'false' }, 'false', true, '"bash" failed'],
  ['read', { path: 'a.ts' }, 'a.ts', false, 'a.ts'],
  ['read', { path: 'gone.ts' }, 'gone.ts', true, '"read" failed'],
  ['edit', { path: 'a.ts', edits: [] }, 'a.ts', false, 'a.ts'],
  ['write', { path: 'b.ts', content: '' }, 'b.ts', false, 'b.ts'],
  ['grep', { pattern: 'TODO' }, 'TODO', false, 'TODO'],
  ['find', { pattern: '*.ts' }, '*.ts', false, '*.ts'],
  ['ls', { path: 'src' }, 'src', false, 'src'],
  ['ls', {}, '.', false, '.'],
  ['mystery', { anything: 1 }, 'mystery', false, 'mystery'],
])('draws a live %s call by what it runs on while it runs, and by what it did once it is done', async (name, input, said, isError, done) => {
  const { session, pi, last } = opened({ settings: { permissionMode: 'bypassPermissions' } } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  await driveCall(pi, 'c1', name, input);
  expect(last('chat/toolCallReady')?.invocationMessage).toBe(said);
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c1', toolName: name, result: 'ok', isError });
  expect((last('chat/toolCallComplete')?.result as Bag).pastTenseMessage).toEqual(done);
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect(callIn(parts, 'c1')).toMatchObject({ invocationMessage: said, pastTenseMessage: done });
});

it('draws an asked call by what it runs on, and keeps the tool in its question', async () => {
  const { session, pi, last } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  const waiting = driveCall(pi, 'c1', 'bash', { command: 'ls -la' });
  await settled();
  expect(last('chat/toolCallReady')).toMatchObject({ invocationMessage: 'ls -la', confirmationTitle: 'Run bash?' });
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect(callIn(parts, 'c1')).toMatchObject({ invocationMessage: 'ls -la' });
  session.confirm('c1', false);
  await waiting;
});

it('opens one row for an asked call, starts it once and readies it once', async () => {
  const { session, pi, sent } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
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
  expect(parts.filter((one) => (one.toolCall as Bag | undefined)?.toolCallId === 'c1')).toHaveLength(1);
  expect(callIn(parts, 'c1')?.status).toBe('pending-confirmation');
  expect(callStatuses(sent).get('c1')).toBe('pending-confirmation');
  session.confirm('c1', false);
  await waiting;
});

it('completes a call pi failed before its hook, as a client folds it', async () => {
  const { session, pi, sent } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
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
  session.sendMessage('t1', 'hello');
  await settled();
  const waiting = driveCall(pi, 'c1', 'editor__open', {});
  await settled();
  const contributor = { kind: 'client', clientId: 'editor' };
  const start = sent.find((one) => one.action.type === 'chat/toolCallStart')?.action;
  const ready = sent.find((one) => one.action.type === 'chat/toolCallReady')?.action;
  expect(start?.contributor).toEqual(contributor);
  expect(ready?.contributor).toEqual(contributor);
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect(callIn(parts, 'c1')?.contributor).toEqual(contributor);
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
  expect(session.completeToolCall?.('c1', 'editor', { text: 'opened', ok: true, content: [] })).toBe(true);
  await running;
});

/*
 * A chat's activity is a wait before its turn can run, as VS Code's host says
 * one: a turn thinking, asking a person, waiting on a client's tool or being
 * stopped says none, its work shown in its own parts.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L11709-L11724
 */
it('says no activity while a turn thinks, asks, waits on a client or is stopped', async () => {
  const bound: BoundTool = {
    definition: { name: 'editor__open' },
    owner: 'editor',
    effects: { writes: true },
  };
  const { session, pi, sent } = opened({
    tools: [bound],
    settings: { permissionMode: 'default' },
  } as Partial<Start>);
  const said = () => [session.activity(), session.chatState().activity, session.sessionState().activity];
  pi.hold();
  pi.holdStops();
  session.sendMessage('t1', 'hello');
  await settled();
  pi.raise({ type: 'agent_start' });
  const thinking = said();
  const waiting = driveCall(pi, 'c1', 'editor__open', {});
  await settled();
  const asking = said();
  session.confirm('c1', true);
  await waiting;
  const tool = pi.opens[0]?.tools?.find((one) => one.name === 'editor__open');
  const running = tool!.execute('c1', {} as never, undefined, undefined, undefined as never).catch((error: unknown) => error);
  await settled();
  const onClient = said();
  session.abort();
  await running;
  const stopping = said();
  pi.raise({ type: 'agent_settled', aborted: true });
  await settled();

  const none = [undefined, undefined, undefined];
  expect({ thinking, asking, onClient, stopping }).toEqual({ thinking: none, asking: none, onClient: none, stopping: none });
  expect(sent.filter((one) => one.action.type === 'chat/activityChanged' || one.action.type === 'session/activityChanged')).toEqual([]);
});

it('keeps a declined call cancelled in the snapshot and for a client', async () => {
  const { session, pi, sent } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  const waiting = driveCall(pi, 'c1', 'bash', { command: 'rm -rf /' });
  await settled();
  // A client folds the client's refusal, which the host says as it was sent,
  // and then what this session says of the call.
  const answered = sent.length;
  session.confirm('c1', false);
  await waiting;
  // pi reports the blocked call as a failed execution.
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: 'blocked', isError: true });
  await settled();
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect(callIn(parts, 'c1')?.status).toBe('cancelled');
  expect(sent.some((one) => one.action.type === 'chat/toolCallConfirmed')).toBe(false);
  const refusal = { channel: 'chat', action: { type: 'chat/toolCallConfirmed', toolCallId: 'c1', approved: false, reason: 'denied' } };
  expect(callStatuses([...sent.slice(0, answered), refusal, ...sent.slice(answered)]).get('c1')).toBe('cancelled');
});

it('still asks under projectTrust deny, because the inline extension is not the project\'s own', async () => {
  const { session, pi } = opened({}, { projectTrust: 'deny' });
  session.sendMessage('t1', 'hello');
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
  session.sendMessage('t1', 'hello');
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
  // A junction on Windows, which links a folder with no privilege and resolves as a link does.
  symlinkSync(elsewhere, join(root, 'link'), posix ? 'dir' : 'junction');
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
  session.sendMessage('t1', 'hello');
  await settled();
  const answer = await pi.opens[0]?.onToolCall!(
    { type: 'tool_call', toolCallId: 'c1', toolName: 'edit', input: { path: join(root, 'a.txt') } } as never,
  ) as Bag;
  expect(answer.block).toBe(true);
  expect(String(answer.reason)).toContain('plan');
  expect(session.status()).toBe(Status.InProgress);
});

/*
 * A call the mode refuses is not readied to run, and a client is never asked
 * to run it: pi blocks it and it closes failed, as VS Code's host answers a
 * call its permissions deny without readying it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1726-L1734
 */
it('closes a refused call failed, never readied to run and never handed to its client', async () => {
  const bound: BoundTool = { definition: { name: 'editor__write', title: 'write' }, owner: 'editor', effects: { writes: true } };
  const { session, pi, sent } = opened({ settings: { permissionMode: 'plan' }, tools: [bound] } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();
  const answer = await driveCall(pi, 'c1', 'editor__write', { path: 'a.txt' });
  expect(answer?.block).toBe(true);
  // Nothing says the call runs, and no client was asked to run it.
  expect(sent.filter((one) => one.action.type === 'chat/toolCallReady')).toEqual([]);
  expect(sent.filter((one) => one.action.type === 'session/inputNeededSet')).toEqual([]);
  pi.raise({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'editor__write', result: String(answer?.reason), isError: true });
  const parts = (session.chatState().activeTurn as Bag).responseParts as Bag[];
  expect(callIn(parts, 'c1')).toMatchObject({ status: 'completed', success: false });
});

/*
 * Each chat keeps its own mode, as VS Code's Claude agent marks its mode
 * `chatMutable`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2283-L2305
 */
it('advertises the six permission modes, defaulting to default', () => {
  const agent = piAgent({}, [root]);
  const properties = ((agent.schema?.() as Bag).properties as Bag);
  const mode = properties.permissionMode as Bag;
  expect(mode.enum).toEqual(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk']);
  expect(mode.default).toBe('default');
  expect(mode.sessionMutable).toBe(true);
  expect(mode.chatMutable).toBe(true);
  expect((agent.defaults?.() as Bag).permissionMode).toBe('default');
});

it('takes a permission mode while the session runs, and refuses an unknown one', async () => {
  const { session } = opened();
  expect(await session.setConfig?.('permissionMode', 'plan')).toBe(true);
  expect(session.settings().permissionMode).toBe('plan');
  expect(await session.setConfig?.('permissionMode', 'nonsense')).toContain('permissionMode');
});