import { WAIT_MS } from '../../../tools/wait.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createFakeModel } from '@cofold/agents/testing';
import { bag } from '@ahpd/sdk';
import type { Bag, Session, Start } from '@ahpd/sdk';
import { cofoldAgent } from '../src/index.js';
import { startedNow } from '../../sdk/test/support/started.js';

/*
 * The question cofold raises about a call, put to the host.
 *
 * cofold raises an `approval.requested` when its policy would put a call to a
 * person, and the question is the host's to decide, its chain reading the
 * owner's rules and the operator's on it, as VS Code's agents raise a pending
 * confirmation for their host's chain.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1499-L1541
 */

/** Waits for `check` to hold, turning the event loop, and throws once `ms` of wall-clock time has passed. */
const when = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

type Note = { channel: 'session' | 'chat' | 'terminal'; action: Bag };

const of = (notes: Note[], type: string): Bag[] =>
  notes.filter((one) => one.action.type === type).map((one) => one.action);

const readyFor = (notes: Note[], callId: string): Bag | undefined =>
  of(notes, 'chat/toolCallReady').find((action) => action.toolCallId === callId);

/** How many turns have ended, by any of the three endings. */
const endings = (notes: Note[]): number =>
  notes.filter((one) => one.action.type === 'chat/turnComplete'
    || one.action.type === 'chat/turnCancelled'
    || one.action.type === 'chat/error').length;

/** The shell cofold runs a command through, which the question names. */
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';

/** One session over a scripted model. */
async function open(args: {
  script: Parameters<typeof createFakeModel>[0]['script'];
  settings?: Record<string, unknown>;
}) {
  const model = createFakeModel({ script: args.script, stream: true });
  const agent = cofoldAgent({ adapter: model, memory: true });
  const notes: Note[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-cofold-questions-'));
  const session: Session = startedNow(agent.create({
    uri: 'ahp-session:/questions',
    chatUri: 'ahp-chat:/questions',
    settings: { ...agent.defaults(), ...(args.settings ?? {}) },
    workingDirectory: dir,
    schema: () => agent.schema(),
    emit: (channel: Note['channel'], action: Bag) => { notes.push({ channel, action }); },
  } as unknown as Start));
  return { session, model, notes, dir };
}

/*
 * A shell call's question says its command, in the shell cofold runs it
 * through, and carries no options of cofold's.
 */
it('says a shell call\'s command in the shell cofold runs it through, with no options of its own', async () => {
  const { session, notes, dir } = await open({
    script: [
      { toolCalls: [{ name: 'shell_exec', input: { command: 'echo hi' }, callId: 'c1' }] },
      { text: 'done' },
    ],
  });
  session.sendMessage('t1', 'run it');
  await when(() => of(notes, 'session/inputNeededSet').length > 0);

  const entry = of(notes, 'session/inputNeededSet')[0]?.request as Bag;
  expect(bag(entry.toolCall)).not.toHaveProperty('options');
  expect(readyFor(notes, 'c1')).not.toHaveProperty('options');
  expect(readyFor(notes, 'c1')).toMatchObject({ permissionKind: 'shell', shellCommand: 'echo hi', shellLanguage: SHELL });
  session.confirm('c1', true, 'allow-once');
  await when(() => endings(notes) === 1);
  rmSync(dir, { recursive: true, force: true });
});

/*
 * The path a file tool's input names, resolved against the workspace with
 * cofold's own resolver, and a fetch's URL, as VS Code's Claude agent reads
 * a call's path and URL by its tool.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeToolDisplay.ts#L187-L194
 */
it('says a file tool\'s path in the workspace and a fetch\'s URL on its question', async () => {
  const { session, notes, dir } = await open({
    script: [
      { toolCalls: [
        { name: 'write_file', input: { path: 'notes/b.txt', content: 'new' }, callId: 'c1' },
        { name: 'web_fetch', input: { url: 'https://example.com/x' }, callId: 'c2' },
      ] },
      { text: 'done' },
    ],
    // The mode that asks before a write and a fetch.
    settings: { permissionMode: 'default' },
  });
  session.sendMessage('t1', 'write and fetch');
  await when(() => readyFor(notes, 'c1')?.confirmationTitle !== undefined);

  expect(readyFor(notes, 'c1')).toMatchObject({ permissionKind: 'write', permissionPath: join(dir, 'notes', 'b.txt') });
  session.confirm('c1', false);
  await when(() => readyFor(notes, 'c2')?.confirmationTitle !== undefined);
  expect(readyFor(notes, 'c2')).toMatchObject({ permissionKind: 'url', permissionUrl: 'https://example.com/x' });
  session.confirm('c2', false);
  await when(() => endings(notes) === 1);
  rmSync(dir, { recursive: true, force: true });
});

/*
 * What the host keeps of an answer is the host's: cofold is answered for the
 * call alone, whatever option the answer names, and asks about the tool's next
 * call again, as VS Code's Copilot agent answers its runtime `approve-once`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L8640
 */
it('answers cofold for the call alone, whatever option the host\'s answer names', async () => {
  const { session, notes, dir } = await open({
    script: [
      { toolCalls: [{ name: 'shell_exec', input: { command: 'echo hi' }, callId: 'c1' }] },
      { text: 'done' },
      { toolCalls: [{ name: 'shell_exec', input: { command: 'echo hi' }, callId: 'c2' }] },
      { text: 'done' },
    ],
  });
  session.sendMessage('t1', 'run it');
  await when(() => of(notes, 'session/inputNeededSet').length > 0);
  session.confirm('c1', true, 'allow-session');
  await when(() => endings(notes) === 1);

  session.sendMessage('t2', 'run it again');
  await when(() => of(notes, 'session/inputNeededSet').length > 1);
  session.confirm('c2', false);
  await when(() => endings(notes) === 2);
  rmSync(dir, { recursive: true, force: true });
});
