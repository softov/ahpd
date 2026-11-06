import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createFakeModel } from '@cofold/agents/testing';
import { bag } from '@ahpd/sdk';
import type { Bag, Session, Start } from '@ahpd/sdk';
import { cofoldAgent } from '../src/index.js';
import { ruleName } from '../src/tools.js';
import { startedNow } from '../../sdk/test/support/started.js';

/*
 * A shell command the owner's rules already allow.
 *
 * `Start.getAutoApproval` is the host's answer to "does this run without
 * asking?", and cofold raises an `approval.requested` when its policy would put
 * a call to a person. An approved `shell_exec` is answered with cofold's own
 * approval before the mapping opens a question, so no entry is raised and the
 * row is readied `not-needed`; a command the check says nothing about asks as
 * it always did, and a call that is not a shell never reaches the check.
 */

/** What the check was asked, in one line each. */
type Asked = { kind: string; line: string; shell: string | undefined; tool: string | undefined }[];

/** The host's answer to "does this run without asking?", in one line each. */
type Check = NonNullable<Start['getAutoApproval']>;

/** The commands a session's check approves, and what it was asked. */
const approving = (allowed: string[]): { asked: Asked; check: Check } => {
  const asked: Asked = [];
  return {
    asked,
    check: (kind, line, shell, tool) => {
      asked.push({ kind, line, shell, tool });
      return kind === 'shell' && allowed.includes(line) ? 'not-needed' as NonNullable<ReturnType<Check>> : undefined;
    },
  };
};

/** The tools the operator's rule names over commands it approves. */
const ruling = (tools: string[], allowed: string[] = []): { asked: Asked; check: Check } => {
  const asked: Asked = [];
  return {
    asked,
    check: (kind, line, shell, tool) => {
      asked.push({ kind, line, shell, tool });
      if (kind === 'tool' && tools.includes(line)) return 'ask' as NonNullable<ReturnType<Check>>;
      return kind === 'shell' && allowed.includes(line) ? 'not-needed' as NonNullable<ReturnType<Check>> : undefined;
    },
  };
};

/** Waits for `check` to hold, turning the event loop, and throws once `ms` of wall-clock time has passed. */
const when = async (check: () => boolean, ms = 5000): Promise<void> => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

type Note = { channel: 'session' | 'chat' | 'terminal'; action: Bag };

const ended = (notes: Note[]): boolean =>
  notes.some((one) => one.action.type === 'chat/turnComplete'
    || one.action.type === 'chat/turnCancelled'
    || one.action.type === 'chat/error');

const of = (notes: Note[], type: string): Bag[] =>
  notes.filter((one) => one.action.type === type).map((one) => one.action);

const readyFor = (notes: Note[], callId: string): Bag | undefined =>
  of(notes, 'chat/toolCallReady').find((action) => action.toolCallId === callId);

/** The shell cofold runs a command through, which is the one its rules are read for. */
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';

/** The tool call a shell command reaches the run as. */
const shell = (command: string) => [
  { toolCalls: [{ name: 'shell_exec', input: { command }, callId: 'c1' }] },
  { text: 'done' },
];

/** One session over a scripted model, with the host's check when it gave one. */
async function open(args: {
  script: Parameters<typeof createFakeModel>[0]['script'];
  check?: Check;
  settings?: Record<string, unknown>;
}) {
  const model = createFakeModel({ script: args.script, stream: true });
  const agent = cofoldAgent({ adapter: model, memory: true });
  const notes: Note[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-cofold-autoapproval-'));
  const session: Session = startedNow(agent.create({
    uri: 'ahp-session:/autoapproval',
    chatUri: 'ahp-chat:/autoapproval',
    settings: { ...agent.defaults(), ...(args.settings ?? {}) },
    workingDirectory: dir,
    schema: () => agent.schema(),
    emit: (channel: Note['channel'], action: Bag) => { notes.push({ channel, action }); },
    ...(args.check === undefined ? {} : { getAutoApproval: args.check }),
  } as unknown as Start));
  return { session, model, notes, dir };
}

it('runs a shell command the owner\'s rules allow, without asking', async () => {
  const { asked, check } = approving(['echo hi']);
  const { session, notes, dir } = await open({ script: shell('echo hi'), check });
  session.sendMessage('t1', 'run it');
  await when(() => ended(notes));

  expect(asked).toEqual([
    // The hook reads the rule for every call, before the policy.
    { kind: 'tool', line: 'shell_exec', shell: undefined, tool: undefined },
    { kind: 'tool', line: 'shell_exec', shell: undefined, tool: undefined },
    { kind: 'shell', line: 'echo hi', shell: SHELL },
  ]);
  // Nothing was drawn: a call nobody was asked about is not a question that
  // was answered, and the row says the approval came from a rule.
  expect(of(notes, 'session/inputNeededSet')).toEqual([]);
  expect(readyFor(notes, 'c1')?.confirmed).toBe('not-needed');
  expect(of(notes, 'chat/toolCallComplete').find((action) => action.toolCallId === 'c1')?.result)
    .toMatchObject({ success: true });
  rmSync(dir, { recursive: true, force: true });
});

it('asks for a shell command no rule matches', async () => {
  const { asked, check } = approving(['make test']);
  const { session, notes, dir } = await open({ script: shell('echo hi'), check });
  session.sendMessage('t1', 'run it');
  await when(() => of(notes, 'session/inputNeededSet').length > 0);

  expect(asked).toEqual([
    // The hook reads the rule for every call, before the policy.
    { kind: 'tool', line: 'shell_exec', shell: undefined, tool: undefined },
    // The approval the run paused on, which no rule answers.
    { kind: 'tool', line: 'shell_exec', shell: undefined, tool: undefined },
    { kind: 'shell', line: 'echo hi', shell: SHELL },
    // The mapping reads the rule again as it shapes the question's choices.
    { kind: 'tool', line: 'shell_exec', shell: undefined, tool: undefined },
  ]);
  expect((of(notes, 'session/inputNeededSet')[0]?.request as Bag).kind).toBe('toolConfirmation');
  session.confirm('c1', true);
  await when(() => ended(notes));
  expect(of(notes, 'chat/toolCallComplete').find((action) => action.toolCallId === 'c1')?.result)
    .toMatchObject({ success: true });
  rmSync(dir, { recursive: true, force: true });
});

it('asks when the host offers no check at all', async () => {
  const { session, notes, dir } = await open({ script: shell('echo hi') });
  session.sendMessage('t1', 'run it');
  await when(() => of(notes, 'session/inputNeededSet').length > 0);

  expect((of(notes, 'session/inputNeededSet')[0]?.request as Bag).kind).toBe('toolConfirmation');
  session.confirm('c1', false);
  await when(() => ended(notes));
  rmSync(dir, { recursive: true, force: true });
});

it('asks the check only about cofold\'s shell', async () => {
  const { asked, check } = approving(['new']);
  const { session, notes, dir } = await open({
    script: [
      { toolCalls: [{ name: 'write_file', input: { path: 'b.txt', content: 'new' }, callId: 'c1' }] },
      { text: 'done' },
    ],
    check,
    // The mode that asks before a write, so the call reaches the policy.
    settings: { permissionMode: 'default' },
  });
  session.sendMessage('t1', 'write it');
  await when(() => of(notes, 'session/inputNeededSet').length > 0);

  // The rule is read for the call's tool name, by the hook and again as the
  // question's choices are shaped; a file write is not a command line, and the
  // terminal rules are about command lines.
  expect(asked).toEqual([
    { kind: 'tool', line: 'write_file', shell: undefined, tool: undefined },
    { kind: 'tool', line: 'write_file', shell: undefined, tool: undefined },
  ]);
  session.confirm('c1', false);
  await when(() => ended(notes));
  rmSync(dir, { recursive: true, force: true });
});

/** The ids of the choices a question, or the ready beside it, carried. */
const ids = (list: unknown): unknown[] =>
  (Array.isArray(list) ? list.map((one) => bag(one).id) : []);

/** How many turns have ended, by any of the three endings. */
const endings = (notes: Note[]): number =>
  notes.filter((one) => one.action.type === 'chat/turnComplete'
    || one.action.type === 'chat/turnCancelled'
    || one.action.type === 'chat/error').length;

it('asks for a shell tool the rule names, and offers no session choice', async () => {
  // The command is one the terminal rules allow, so the rule is what puts the
  // question: it wins over a line that would otherwise run unasked.
  const { asked, check } = ruling(['shell_exec'], ['echo hi']);
  const { session, notes, dir } = await open({ script: shell('echo hi'), check });
  session.sendMessage('t1', 'run it');
  await when(() => of(notes, 'session/inputNeededSet').length > 0);

  expect(asked).toEqual([
    // The hook, before the policy.
    { kind: 'tool', line: 'shell_exec', shell: undefined, tool: undefined },
    // The approval the run paused on, which the rule answers with a question.
    { kind: 'tool', line: 'shell_exec', shell: undefined, tool: undefined },
    // Once more as the mapping shapes the question's choices.
    { kind: 'tool', line: 'shell_exec', shell: undefined, tool: undefined },
  ]);
  const entry = of(notes, 'session/inputNeededSet')[0]?.request as Bag;
  // One approval and one refusal: nothing keeps an answer for the session.
  expect(ids(bag(entry.toolCall).options)).toEqual(['allow-once', 'deny']);
  expect(ids(readyFor(notes, 'c1')?.options)).toEqual(['allow-once', 'deny']);
  session.confirm('c1', true, 'allow-once');
  await when(() => endings(notes) === 1);
  rmSync(dir, { recursive: true, force: true });
});

it('never lets a matched call be allowed for the session', async () => {
  const { check } = ruling(['shell_exec'], ['echo hi']);
  const { session, notes, dir } = await open({
    script: [
      { toolCalls: [{ name: 'shell_exec', input: { command: 'echo hi' }, callId: 'c1' }] },
      { text: 'done' },
      { toolCalls: [{ name: 'shell_exec', input: { command: 'echo hi' }, callId: 'c2' }] },
      { text: 'done' },
    ],
    check,
  });
  session.sendMessage('t1', 'run it');
  await when(() => of(notes, 'session/inputNeededSet').length > 0);
  // A client sending the id of the session choice the question did not offer:
  // the answer is still an approval for this one call, and cofold remembers
  // nothing.
  session.confirm('c1', true, 'allow-session');
  await when(() => endings(notes) === 1);

  session.sendMessage('t2', 'run it again');
  await when(() => of(notes, 'session/inputNeededSet').length > 1);
  expect(of(notes, 'session/inputNeededSet')).toHaveLength(2);
  session.confirm('c2', false);
  await when(() => endings(notes) === 2);
  rmSync(dir, { recursive: true, force: true });
});

it('remembers no session choice for a tool the rule named after the question was put', async () => {
  // The card is built before the rule exists, so it offers the session choice;
  // the rule set while it waits still keeps cofold from remembering it.
  const named: string[] = [];
  const check: Check = (kind, line) =>
    (kind === 'tool' && named.includes(line) ? 'ask' as NonNullable<ReturnType<Check>> : undefined);
  const { session, notes, dir } = await open({
    script: [
      { toolCalls: [{ name: 'shell_exec', input: { command: 'echo hi' }, callId: 'c1' }] },
      { text: 'done' },
      { toolCalls: [{ name: 'shell_exec', input: { command: 'echo hi' }, callId: 'c2' }] },
      { text: 'done' },
    ],
    check,
  });
  session.sendMessage('t1', 'run it');
  await when(() => of(notes, 'session/inputNeededSet').length > 0);
  const entry = of(notes, 'session/inputNeededSet')[0]?.request as Bag;
  expect(ids(bag(entry.toolCall).options)).toEqual(['allow-once', 'allow-session', 'deny']);
  named.push('shell_exec');
  session.confirm('c1', true, 'allow-session');
  await when(() => endings(notes) === 1);

  session.sendMessage('t2', 'run it again');
  await when(() => of(notes, 'session/inputNeededSet').length > 1);
  session.confirm('c2', false);
  await when(() => endings(notes) === 2);
  rmSync(dir, { recursive: true, force: true });
});

/** One read of a file in the workspace, which the policy lets run unaided in every mode but `dontAsk`. */
const read = [
  { toolCalls: [{ name: 'read_file', input: { path: 'a.txt' }, callId: 'c1' }] },
  { text: 'done' },
];

it.each(['auto', 'acceptEdits', 'bypassPermissions'] as const)(
  'asks for a tool the rule names in %s mode',
  async (permissionMode) => {
    const { check } = ruling(['read_file']);
    const { session, notes, dir } = await open({ script: read, check, settings: { permissionMode } });
    session.sendMessage('t1', 'read it');
    await when(() => of(notes, 'session/inputNeededSet').length > 0);

    const entry = of(notes, 'session/inputNeededSet')[0]?.request as Bag;
    expect(ids(bag(entry.toolCall).options)).toEqual(['allow-once', 'deny']);
    session.confirm('c1', false);
    await when(() => endings(notes) === 1);
    rmSync(dir, { recursive: true, force: true });
  },
);

it('refuses a tool the rule names in dontAsk mode, without asking', async () => {
  const { check } = ruling(['read_file']);
  const { session, notes, dir } = await open({ script: read, check, settings: { permissionMode: 'dontAsk' } });
  session.sendMessage('t1', 'read it');
  await when(() => endings(notes) === 1);

  expect(of(notes, 'session/inputNeededSet')).toEqual([]);
  expect(of(notes, 'chat/toolCallComplete').find((action) => action.toolCallId === 'c1')?.result)
    .toMatchObject({ success: false, error: { message: 'read_file asks every time and the mode is dontAsk' } });
  rmSync(dir, { recursive: true, force: true });
});

it('asks a tool the rule names even when a session approval was already remembered', async () => {
  const named: string[] = [];
  const check: Check = (kind, line) =>
    (kind === 'tool' && named.includes(line) ? 'ask' as NonNullable<ReturnType<Check>> : undefined);
  const { session, notes, dir } = await open({
    script: [
      { toolCalls: [{ name: 'shell_exec', input: { command: 'echo hi' }, callId: 'c1' }] },
      { text: 'done' },
      { toolCalls: [{ name: 'shell_exec', input: { command: 'echo hi' }, callId: 'c2' }] },
      { text: 'done' },
      { toolCalls: [{ name: 'shell_exec', input: { command: 'echo hi' }, callId: 'c3' }] },
      { text: 'done' },
    ],
    check,
  });
  session.sendMessage('t1', 'run it');
  await when(() => of(notes, 'session/inputNeededSet').length > 0);
  // Allowed for the session before any rule names the tool, so cofold keeps it.
  session.confirm('c1', true, 'allow-session');
  await when(() => endings(notes) === 1);

  // The remembered approval is what answers the question, not the policy.
  session.sendMessage('t2', 'run it again');
  await when(() => endings(notes) === 2);
  expect(of(notes, 'session/inputNeededSet')).toHaveLength(1);

  // The rule names the tool, and the remembered approval no longer answers it.
  named.push('shell_exec');
  session.sendMessage('t3', 'run it once more');
  await when(() => of(notes, 'session/inputNeededSet').length > 1);
  session.confirm('c3', false);
  await when(() => endings(notes) === 3);
  rmSync(dir, { recursive: true, force: true });
});

it('names a host tool to the rule as host/<name>, as Claude and ACP do', () => {
  const offered = [{ definition: { name: 'notify', inputSchema: { type: 'object' as const, properties: {} } } }];
  expect(ruleName(offered, 'notify')).toBe('host/notify');
  expect(ruleName(offered, 'shell_exec')).toBe('shell_exec');
});
