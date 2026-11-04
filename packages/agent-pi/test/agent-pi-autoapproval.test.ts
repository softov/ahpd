import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Status } from '../../sdk/src/sessions/catalog.js';
import type { Bag, Start } from '../../sdk/src/types/index.js';
import { driveCall, opened, root, settled } from './fake-pi.js';

/*
 * A shell command the owner's rules already allow.
 *
 * `Start.getAutoApproval` is the host's answer to "does this run without
 * asking?", and `decide` is the one place this backend chooses between running
 * a call, asking a person and refusing it. An approved shell command runs with
 * no question drawn; a command the check says nothing about asks as it always
 * did, and the modes that never ask - or never let a call run - keep their own
 * answers without consulting the check.
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

/** The tools the operator's rule names, and what the check was asked. */
const ruling = (tools: string[]): { asked: Asked; check: Check } => {
  const asked: Asked = [];
  return {
    asked,
    check: (kind, line, shell, tool) => {
      asked.push({ kind, line, shell, tool });
      return kind === 'tool' && tools.includes(line) ? 'ask' as NonNullable<ReturnType<Check>> : undefined;
    },
  };
};

it('runs a bash command the owner\'s rules allow, without asking', async () => {
  const { asked, check } = approving(['make test']);
  const { session, pi, sent, last } = opened({
    getAutoApproval: check,
    settings: { permissionMode: 'default' },
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();

  const waiting = driveCall(pi, 'c1', 'bash', { command: 'make test' });
  await settled();
  expect(await waiting).toBeUndefined();
  expect(asked).toEqual([
    { kind: 'tool', line: 'bash', shell: undefined, tool: undefined },
    { kind: 'shell', line: 'make test', shell: 'bash' },
  ]);
  // Nothing was drawn: a call nobody was asked about is not a question that
  // was answered, and the row says the approval came from a rule.
  expect(sent.filter((one) => one.action.type === 'session/inputNeededSet')).toEqual([]);
  expect(last('chat/toolCallReady')?.confirmed).toBe('not-needed');
  expect(session.status()).not.toBe(Status.InputNeeded);
});

it('runs a powershell command the rules allow, and says which shell it is', async () => {
  const { asked, check } = approving(['Get-ChildItem']);
  const { session, pi, sent } = opened({
    getAutoApproval: check,
    settings: { permissionMode: 'default' },
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();

  const waiting = driveCall(pi, 'c1', 'powershell', { command: 'Get-ChildItem' });
  await settled();
  expect(await waiting).toBeUndefined();
  // PowerShell's command language is not bash's, and the host's rules for the
  // two are not the same.
  expect(asked).toEqual([
    { kind: 'tool', line: 'powershell', shell: undefined, tool: undefined },
    { kind: 'shell', line: 'Get-ChildItem', shell: 'powershell' },
  ]);
  expect(sent.filter((one) => one.action.type === 'session/inputNeededSet')).toEqual([]);
});

it('asks for a shell command no rule matches', async () => {
  const { asked, check } = approving(['make test']);
  const { session, pi, sent } = opened({
    getAutoApproval: check,
    settings: { permissionMode: 'default' },
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();

  const waiting = driveCall(pi, 'c1', 'bash', { command: 'rm -rf /' });
  await settled();
  expect(asked).toEqual([
    { kind: 'tool', line: 'bash', shell: undefined, tool: undefined },
    { kind: 'shell', line: 'rm -rf /', shell: 'bash' },
  ]);
  expect(sent.filter((one) => one.action.type === 'session/inputNeededSet')).toHaveLength(1);
  session.confirm('c1', false);
  expect(await waiting).toEqual({ block: true, reason: 'The person declined this action' });
});

it('asks when the host offers no check at all', async () => {
  const { session, pi, sent } = opened({ settings: { permissionMode: 'default' } } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();

  const waiting = driveCall(pi, 'c1', 'bash', { command: 'make test' });
  await settled();
  expect(sent.filter((one) => one.action.type === 'session/inputNeededSet')).toHaveLength(1);
  session.confirm('c1', false);
  await waiting;
});

it('asks the terminal check only about the two shells pi runs', async () => {
  const { asked, check } = ruling(['other']);
  const { session, pi, sent } = opened({
    getAutoApproval: check,
    settings: { permissionMode: 'default' },
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();

  const waiting = driveCall(pi, 'c1', 'edit', { path: join(root, 'a.txt') });
  await settled();
  // The rule is read for the call's tool name; a file edit is not a command
  // line, and the terminal rules are about command lines.
  expect(asked).toEqual([{ kind: 'tool', line: 'edit', shell: undefined, tool: undefined }]);
  expect(sent.filter((one) => one.action.type === 'session/inputNeededSet')).toHaveLength(1);
  session.confirm('c1', false);
  await waiting;
});

it('keeps don\'t-ask\'s refusal for a command a rule would allow', async () => {
  const { asked, check } = approving(['make test']);
  const { session, pi } = opened({
    getAutoApproval: check,
    settings: { permissionMode: 'dontAsk' },
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();

  // The rule narrows the questions and adds none, and this mode answers by
  // refusing rather than by asking. The rule is read, and the terminal check
  // is not.
  expect(await driveCall(pi, 'c1', 'bash', { command: 'make test' }))
    .toEqual({ block: true, reason: 'bash would need approval and the mode is dontAsk' });
  expect(asked).toEqual([{ kind: 'tool', line: 'bash', shell: undefined, tool: undefined }]);
});

it('keeps bypass mode\'s answer, without asking the check', async () => {
  const { asked, check } = approving(['make test']);
  const { session, pi } = opened({
    getAutoApproval: check,
    settings: { permissionMode: 'bypassPermissions' },
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();

  expect(await driveCall(pi, 'c1', 'bash', { command: 'make test' })).toBeUndefined();
  // The rule is read; the terminal rules still are not.
  expect(asked).toEqual([{ kind: 'tool', line: 'bash', shell: undefined, tool: undefined }]);
});

/** The action types a session emitted, for a filter a case reads once. */
const types = (sent: { action: Bag }[]): string[] => sent.map((one) => String(one.action.type));

it('still asks about a command whose input names none', async () => {
  const { asked, check } = approving(['make test']);
  const { session, pi, sent } = opened({
    getAutoApproval: check,
    settings: { permissionMode: 'default' },
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();

  const waiting = driveCall(pi, 'c1', 'bash', {} as Bag);
  await settled();
  // Nothing to match, so the terminal check is not asked and the question
  // stands.
  expect(asked).toEqual([{ kind: 'tool', line: 'bash', shell: undefined, tool: undefined }]);
  expect(types(sent)).toContain('session/inputNeededSet');
  session.confirm('c1', false);
  await waiting;
});

/** The one question a session put up, in the shape its entry carries it. */
const question = (sent: { action: Bag }[]): Bag | undefined =>
  sent.find((one) => one.action.type === 'session/inputNeededSet')?.action.request as Bag | undefined;

it('asks for a tool the operator\'s rule names, in default mode', async () => {
  const { asked, check } = ruling(['bash']);
  const { session, pi, sent } = opened({
    getAutoApproval: check,
    settings: { permissionMode: 'default' },
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();

  const waiting = driveCall(pi, 'c1', 'bash', { command: 'make test' });
  await settled();
  expect(asked).toEqual([{ kind: 'tool', line: 'bash', shell: undefined, tool: undefined }]);
  const entry = question(sent);
  expect(entry?.kind).toBe('toolConfirmation');
  // A question with no option list: there is nothing on the card to keep.
  expect(entry?.options).toBeUndefined();
  session.confirm('c1', true);
  expect(await waiting).toBeUndefined();
});

it('asks in bypass mode, where the call would otherwise run', async () => {
  const { asked, check } = ruling(['edit']);
  const { session, pi, sent } = opened({
    getAutoApproval: check,
    settings: { permissionMode: 'bypassPermissions' },
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();

  const waiting = driveCall(pi, 'c1', 'edit', { path: join(root, 'a.txt') });
  await settled();
  expect(asked).toEqual([{ kind: 'tool', line: 'edit', shell: undefined, tool: undefined }]);
  expect(types(sent)).toContain('session/inputNeededSet');
  session.confirm('c1', true);
  expect(await waiting).toBeUndefined();
});

it('asks in plan mode, where the write would otherwise be refused', async () => {
  const { check } = ruling(['edit']);
  const { session, pi, sent } = opened({
    getAutoApproval: check,
    settings: { permissionMode: 'plan' },
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();

  const waiting = driveCall(pi, 'c1', 'edit', { path: join(root, 'a.txt') });
  await settled();
  // The rule wins over the mode: the call is put to a person, not blocked.
  expect(types(sent)).toContain('session/inputNeededSet');
  session.confirm('c1', true);
  expect(await waiting).toBeUndefined();
});

it('refuses a named tool in don\'t-ask mode, without a question', async () => {
  const { check } = ruling(['bash']);
  const { session, pi, sent } = opened({
    getAutoApproval: check,
    settings: { permissionMode: 'dontAsk' },
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();

  expect(await driveCall(pi, 'c1', 'bash', { command: 'make test' }))
    .toEqual({ block: true, reason: 'bash would need approval and the mode is dontAsk' });
  expect(types(sent)).not.toContain('session/inputNeededSet');
});

it('names a host tool to the rule as ahp/<name>, as Claude and ACP do', async () => {
  const { asked, check } = ruling(['ahp/notify']);
  const { session, pi, sent } = opened({
    tools: [{ definition: { name: 'notify', inputSchema: { type: 'object', properties: {} } }, run: () => 'sent' }],
    getAutoApproval: check,
    settings: { permissionMode: 'bypassPermissions' },
  } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'hello');
  await settled();

  const waiting = driveCall(pi, 'c1', 'notify', {});
  await settled();
  expect(asked).toEqual([{ kind: 'tool', line: 'ahp/notify', shell: undefined, tool: undefined }]);
  expect(types(sent)).toContain('session/inputNeededSet');
  session.confirm('c1', true);
  expect(await waiting).toBeUndefined();
});
