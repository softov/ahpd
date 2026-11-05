import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, it } from 'vitest';
import type { Bag, Start } from '../../sdk/src/types/index.js';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import { piAgent } from '../src/agent.js';
import { loadPi } from '../src/pi.js';
import { piSession } from '../src/session.js';
import { promptOf, resumeOrCreate, resumePoint } from '../src/backend.js';
import { answer, driveCall, fakePi, opened, root, sessionOnDisk, settled, streamed } from './fake-pi.js';

// A session from disk -------------------------------------------------------

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
        // What the tool returned, as its completion carried it.
        content: [{ type: 'text', text: 'export {};' }],
        // The kind pi's read is drawn as, and how long it ran between pi's
        // own entries for it, off the file.
        _meta: { toolKind: 'read', 'vscode.toolCallDurationMs': expect.any(Number) },
      },
    },
    { id: `${disk.first}:2:0`, kind: 'markdown', content: ' It is empty.' },
  ]);
  // Both answers of the turn, summed and priced as the live turn sums them.
  expect(turns?.[0]?.usage).toEqual({
    inputTokens: 20,
    outputTokens: 10,
    cacheReadTokens: 0,
    model: 'anthropic/claude-opus-5',
    _meta: { 'ahpd.cacheWriteTokens': 0, 'ahpd.cost': { amount: 0, currency: 'USD', input: 0, output: 0 } },
  });
  expect(turns?.[1]?.responseParts).toEqual([
    { kind: 'error', error: { errorType: 'turnFailed', message: '429 rate limited' }, resumable: true },
  ]);

  // The same turn run live, as pi raises it, reads the same.
  const { session, pi } = opened({ settings: { permissionMode: 'bypassPermissions' } } as Partial<Start>);
  pi.hold();
  session.sendMessage('t1', 'read a.ts');
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
  pi.raise({ type: 'agent_settled', aborted: false });
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
    // The host always resolves this, and its own answer when the deployment
    // said nothing is ten minutes.
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
    resume: disk.id,
  } as Start);
  for (let i = 0; i < 200 && session.endPoint?.(disk.first) === undefined; i++) await settled();
  expect(session.endPoint?.(disk.first)).toBe(disk.firstEnd);
  expect(session.endPoint?.(disk.second)).toBe(disk.secondEnd);
  session.close();
});

it('finds the prompt pi wrote after an entry, which is the id a turn from pi file has', async () => {
  const sessionDir = join(root, 'pi');
  const disk = await sessionOnDisk(sessionDir);
  const { SessionManager } = await loadPi();
  const branch = SessionManager.open(disk.file, sessionDir, root).getBranch();
  expect(promptOf(branch, undefined)).toBe(disk.first);
  expect(promptOf(branch, disk.firstEnd)).toBe(disk.second);
  expect(promptOf(branch, disk.secondEnd)).toBeUndefined();
  expect(promptOf(branch, 'not-on-the-branch')).toBeUndefined();
  const turns = await piAgent({ sessionDir }, [root]).transcript?.(disk.id);
  expect(turns?.map((turn) => turn.id)).toEqual([disk.first, disk.second]);
});

it('resumes again from a failed reply whose earlier resume threw before pi wrote anything', async () => {
  /*
   * The reference host marks a resume that failed resumable, so a client may
   * ask again; the second resume continues from the same reply.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1850-L1873
   */
  const sessionDir = join(root, 'pi');
  const disk = await sessionOnDisk(sessionDir);
  const { SessionManager } = await loadPi();
  const store = SessionManager.open(disk.file, sessionDir, root);
  expect(resumePoint(store)).toEqual({ drop: disk.secondEnd });
  // The first resume took the reply out of the model's context, then threw.
  store.appendContextEdit(disk.secondEnd, null);
  expect(resumePoint(store)).toEqual({});
  // A reply after it is a conversation that moved on.
  store.appendMessage(answer([{ type: 'text', text: 'done' }], 'stop'));
  expect(resumePoint(store)).toBeUndefined();
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
    // The host always resolves this, and its own answer when the deployment
    // said nothing is ten minutes.
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
    resume: disk.id,
  } as Start);
  for (let i = 0; i < 200 && session.endPoint?.(disk.first) === undefined; i++) await settled();
  session.sendMessage('t3', 'once more');
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

it('reads back what a turn used as the sum of its answers, as the turn said it live', async () => {
  const { replayEntries } = await import('../src/replay.js');
  const at = new Date().toISOString();
  const { turns } = replayEntries([
    { type: 'message', id: 'u1', parentId: null, timestamp: at, message: { role: 'user', content: 'go', timestamp: 0 } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp: at, message: answer([{ type: 'text', text: 'One' }], 'toolUse') },
    { type: 'message', id: 'a2', parentId: 'a1', timestamp: at, message: answer([{ type: 'text', text: 'Two' }], 'stop') },
  ] as never);
  expect(turns[0]?.usage).toMatchObject({ inputTokens: 20, outputTokens: 10, model: 'anthropic/claude-opus-5' });
});

/*
 * pi's prompt joins the person's words with what was attached. A turn reads
 * back with the message as the turn had it, which this host keeps as the
 * prompt's parent entry, and a prompt typed into pi itself with its words and
 * the model in force, as VS Code's readers restore a message's text,
 * attachments and model.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L852-L890
 */
const keptMessage = {
  text: 'what is in it',
  origin: { kind: 'user' },
  attachments: [{ type: 'resource', uri: 'file:///work/a.txt', label: 'a.txt', contentType: 'text/plain' }],
  model: { id: 'openai/gpt-5' },
};

it('reads a turn back with the message this host kept for its prompt, and a prompt typed into pi with the model in force', async () => {
  const { replayEntries } = await import('../src/replay.js');
  const at = new Date().toISOString();
  const { turns } = replayEntries([
    { type: 'model_change', id: 'm1', parentId: null, timestamp: at, provider: 'anthropic', modelId: 'claude-opus-5' },
    { type: 'custom', id: 'k1', parentId: 'm1', timestamp: at, customType: 'ahpd.message', data: { message: keptMessage } },
    {
      type: 'message', id: 'u1', parentId: 'k1', timestamp: at,
      message: { role: 'user', content: 'what is in it\n\nThe user provided the following references:\n- /work/a.txt', timestamp: 0 },
    },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp: at, message: answer([{ type: 'text', text: 'Nothing.' }], 'stop') },
    { type: 'message', id: 'u2', parentId: 'a1', timestamp: at, message: { role: 'user', content: 'and now', timestamp: 0 } },
    { type: 'message', id: 'a2', parentId: 'u2', timestamp: at, message: answer([{ type: 'text', text: 'Still.' }], 'stop') },
  ] as never);
  expect(turns.map((one) => one.message)).toEqual([
    keptMessage,
    { text: 'and now', origin: { kind: 'user' }, model: { id: 'anthropic/claude-opus-5' } },
  ]);
});

it('reads a turn this process watched back with the message as the turn had it', async () => {
  const { turnsOf } = await import('../src/transcript.js');
  const at = new Date().toISOString();
  const [turn] = turnsOf({ turns: [{ turnId: 't1', startedAt: at, message: keptMessage, parts: [], state: 'complete' }] });
  expect(turn?.message).toEqual(keptMessage);
});

it('reads a call with no result back as one its turn ended around, and an earlier turn that held it as stopped', async () => {
  /*
   * A call pi's file holds no result for never finished. The protocol's
   * reducer holds a call still open when its turn ends as cancelled and
   * skipped, and the reference reads a transcript's call with no result back
   * that way, with the turn that held it cancelled when a turn came after it.
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L492-L514
   */
  const { replayEntries } = await import('../src/replay.js');
  const at = new Date().toISOString();
  const { turns } = replayEntries([
    { type: 'message', id: 'u1', parentId: null, timestamp: at, message: { role: 'user', content: 'go', timestamp: 0 } },
    {
      type: 'message', id: 'a1', parentId: 'u1', timestamp: at,
      message: answer([{ type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.ts' } }], 'toolUse'),
    },
    { type: 'message', id: 'u2', parentId: 'a1', timestamp: at, message: { role: 'user', content: 'again', timestamp: 0 } },
    { type: 'message', id: 'a2', parentId: 'u2', timestamp: at, message: answer([{ type: 'text', text: 'Fine' }], 'stop') },
  ] as never);
  expect(turns.map((one) => one.state)).toEqual(['cancelled', 'complete']);
  const call = (turns[0]?.parts.find((part) => part.kind === 'toolCall') as Bag | undefined)?.toolCall as Bag | undefined;
  expect(call).toMatchObject({ toolCallId: 'call-1', status: 'cancelled', reason: 'skipped' });
});

/*
 * A file that ends while its last turn's request still ran reads that turn
 * back interrupted, as VS Code's reader ends one whose request is still active:
 * in error, its last part `executionInterrupted` and resumable, whether the
 * last answer asked for a tool with no result, every tool returned and the
 * model said nothing after, or the prompt has no answer at all.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L7987-L7990
 * https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L1128-L1130
 */
it.each<[string, string[], string | undefined]>([
  ['an answer that asked for a tool with no result', ['toolUse'], 'cancelled'],
  ['every tool returned and nothing after', ['toolUse', 'result'], 'completed'],
  ['a prompt with no answer', [], undefined],
])('reads a file that ends at %s back as interrupted and resumable', async (_what, tail, status) => {
  const { replayEntries } = await import('../src/replay.js');
  const at = new Date().toISOString();
  const entries: Bag[] = [{ type: 'message', id: 'u1', parentId: null, timestamp: at, message: { role: 'user', content: 'go', timestamp: 0 } }];
  if (tail.includes('toolUse')) {
    entries.push({
      type: 'message', id: 'a1', parentId: 'u1', timestamp: at,
      message: answer([{ type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.ts' } }], 'toolUse'),
    });
  }
  if (tail.includes('result')) {
    entries.push({
      type: 'message', id: 'r1', parentId: 'a1', timestamp: at,
      message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'read', content: [{ type: 'text', text: 'export {};' }], isError: false, timestamp: 0 },
    });
  }
  const { turns } = replayEntries(entries as never);
  expect(turns.map((one) => one.state)).toEqual(['error']);
  const call = (turns[0]?.parts.find((part) => part.kind === 'toolCall') as Bag | undefined)?.toolCall as Bag | undefined;
  expect(call?.status).toBe(status);
  expect(turns[0]?.parts.at(-1)).toEqual({
    kind: 'error',
    error: { errorType: 'executionInterrupted', message: 'The agent was interrupted before this request finished.' },
    resumable: true,
  });
});

it('resumes a cut-off request from where the file ends, and a failed or cut-off answer once it is dropped', async () => {
  const sessionDir = join(root, 'pi');
  const disk = await sessionOnDisk(sessionDir);
  const { SessionManager } = await loadPi();
  const store = SessionManager.open(disk.file, sessionDir, root);
  // A failed reply is dropped from the model's context, and the model asked again.
  expect(resumePoint(store)).toEqual({ drop: disk.secondEnd });
  // A prompt with no answer, and a tool's result with nothing after, go on as they are.
  store.appendMessage({ role: 'user', content: 'go on', timestamp: Date.now() });
  expect(resumePoint(store)).toEqual({});
  const asked = store.appendMessage(answer([{ type: 'toolCall', id: 'call-9', name: 'read', arguments: { path: 'b.ts' } }], 'toolUse'));
  expect(resumePoint(store)).toEqual({ drop: asked });
  store.appendMessage({
    role: 'toolResult', toolCallId: 'call-9', toolName: 'read', content: [{ type: 'text', text: 'export {};' }], isError: false, timestamp: Date.now(),
  } as never);
  expect(resumePoint(store)).toEqual({});
  // An answer that ended the request leaves nothing to resume.
  store.appendMessage(answer([{ type: 'text', text: 'done' }], 'stop'));
  expect(resumePoint(store)).toBeUndefined();
});

it('marks only the last turn read back resumable, when it failed on a model call', async () => {
  const { replayEntries } = await import('../src/replay.js');
  const at = new Date().toISOString();
  const failed = (id: string) => answer([], 'error', { errorMessage: `${id} failed` });
  const { turns } = replayEntries([
    { type: 'message', id: 'u1', parentId: null, timestamp: at, message: { role: 'user', content: 'go', timestamp: 0 } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp: at, message: failed('a1') },
    { type: 'message', id: 'u2', parentId: 'a1', timestamp: at, message: { role: 'user', content: 'again', timestamp: 0 } },
    { type: 'message', id: 'a2', parentId: 'u2', timestamp: at, message: failed('a2') },
  ] as never);
  expect(turns.map((one) => one.state)).toEqual(['error', 'error']);
  expect(turns.map((one) => one.parts.at(-1)?.resumable)).toEqual([undefined, true]);
  const { turns: ended } = replayEntries([
    { type: 'message', id: 'u1', parentId: null, timestamp: at, message: { role: 'user', content: 'go', timestamp: 0 } },
    { type: 'message', id: 'a1', parentId: 'u1', timestamp: at, message: failed('a1') },
    { type: 'message', id: 'u2', parentId: 'a1', timestamp: at, message: { role: 'user', content: 'again', timestamp: 0 } },
    { type: 'message', id: 'a2', parentId: 'u2', timestamp: at, message: answer([{ type: 'text', text: 'Fine' }], 'stop') },
  ] as never);
  expect(ended.flatMap((one) => one.parts).some((part) => part.resumable !== undefined)).toBe(false);
});

// The id a session is saved under --------------------------------------------

const CLIENT_ID = '0192f5e0-7c1a-7b3e-9a4d-2f6c8e1b3a57';

it('opens a new session under the UUID its URI names', async () => {
  const { session, pi } = opened({ uri: `ahp-session:/${CLIENT_ID}`, chatUri: `ahp-chat:/${CLIENT_ID}` });
  session.sendMessage('t1', 'hello');
  await settled();
  expect(pi.opens[0]?.id).toBe(CLIENT_ID);
  expect(pi.opens[0]?.resume).toBeUndefined();
});

it('leaves the id to pi when the URI does not name a UUID', async () => {
  const { session, pi } = opened();
  session.sendMessage('t1', 'hello');
  await settled();
  expect(pi.opens[0]?.id).toBeUndefined();
});

it('resumes under the id it was resumed with, not the URI', async () => {
  const { session, pi } = opened({ uri: `ahp-session:/${CLIENT_ID}`, resume: 'pi-session-1' });
  session.sendMessage('t1', 'hello');
  await settled();
  expect(pi.opens[0]?.resume).toBe('pi-session-1');
  expect(pi.opens[0]?.id).toBeUndefined();
  expect(pi.opens[0]?.forkAt).toBeUndefined();
});

it('opens a fork at the entry the host named, rather than the source itself', async () => {
  const { session, pi } = opened({ uri: `ahp-session:/${CLIENT_ID}`, resume: 'pi-session-1', forkAt: 'entry-7' });
  session.sendMessage('t2', 'hello');
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