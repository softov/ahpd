import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, it } from 'vitest';
import type { Bag, Start } from '../../sdk/src/types/index.js';
import { piAgent } from '../src/agent.js';
import { loadPi } from '../src/pi.js';
import { piSession } from '../src/session.js';
import { resumeOrCreate } from '../src/backend.js';
import { answer, driveCall, fakePi, opened, root, settled, streamed } from './fake-pi.js';

// A session from disk -------------------------------------------------------

/**
 * A pi session file, written by pi's own `SessionManager`: a model and a level
 * set first, pi's leading system message, a turn that thinks, answers and runs
 * a tool, and a second turn that fails.
 */
async function sessionOnDisk(sessionDir: string) {
  const { SessionManager } = await loadPi();
  const store = SessionManager.create(root, sessionDir);
  store.appendModelChange('anthropic', 'claude-opus-5');
  store.appendThinkingLevelChange('medium');
  store.appendMessage({ role: 'system', content: '', sections: { preamble: 'You are pi.' }, timestamp: Date.now() } as never);
  const first = store.appendMessage({ role: 'user', content: [{ type: 'text', text: 'read a.ts' }], timestamp: Date.now() });
  store.appendMessage(answer([
    { type: 'thinking', thinking: 'I should read it.' },
    { type: 'text', text: 'Reading it.' },
    { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.ts' } },
  ], 'toolUse'));
  store.appendMessage({
    role: 'toolResult',
    toolCallId: 'call-1',
    toolName: 'read',
    content: [{ type: 'text', text: 'export {};' }],
    isError: false,
    timestamp: Date.now(),
  } as never);
  const firstEnd = store.appendMessage(answer([{ type: 'text', text: ' It is empty.' }], 'stop'));
  const second = store.appendMessage({ role: 'user', content: 'again', timestamp: Date.now() });
  const secondEnd = store.appendMessage(answer([], 'error', {
    errorMessage: '429 rate limited',
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  }));
  return { id: store.getSessionId(), first, firstEnd, second, secondEnd };
}

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
      id: 'call-1',
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
        // The times pi's own entries carry for it, off the file.
        _meta: {
          'ahpd.startedAt': expect.any(String),
          'ahpd.endedAt': expect.any(String),
          'ahpd.durationMs': expect.any(Number),
        },
      },
    },
    { id: `${disk.first}:2:0`, kind: 'markdown', content: ' It is empty.' },
  ]);
  expect(turns?.[0]?.usage).toEqual({
    inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, model: 'anthropic/claude-opus-5', _meta: { cacheWriteTokens: 0 },
  });
  expect(turns?.[1]?.responseParts).toEqual([
    { kind: 'error', error: { errorType: 'turnFailed', message: '429 rate limited' } },
  ]);

  // The same turn run live, as pi raises it, reads the same.
  const { session, pi } = opened({ settings: { permissionMode: 'bypassPermissions' } } as Partial<Start>);
  pi.hold();
  session.begin('t1', 'read a.ts');
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
  pi.raise({ type: 'agent_settled' });
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
    resume: disk.id,
  } as Start);
  for (let i = 0; i < 200 && session.endPoint?.(disk.first) === undefined; i++) await settled();
  expect(session.endPoint?.(disk.first)).toBe(disk.firstEnd);
  expect(session.endPoint?.(disk.second)).toBe(disk.secondEnd);
  session.close();
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
    resume: disk.id,
  } as Start);
  for (let i = 0; i < 200 && session.endPoint?.(disk.first) === undefined; i++) await settled();
  session.begin('t3', 'once more');
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

// The id a session is saved under --------------------------------------------

const CLIENT_ID = '0192f5e0-7c1a-7b3e-9a4d-2f6c8e1b3a57';

it('opens a new session under the UUID its URI names', async () => {
  const { session, pi } = opened({ uri: `ahp-session:/${CLIENT_ID}`, chatUri: `ahp-chat:/${CLIENT_ID}` });
  session.begin('t1', 'hello');
  await settled();
  expect(pi.opens[0]?.id).toBe(CLIENT_ID);
  expect(pi.opens[0]?.resume).toBeUndefined();
});

it('leaves the id to pi when the URI does not name a UUID', async () => {
  const { session, pi } = opened();
  session.begin('t1', 'hello');
  await settled();
  expect(pi.opens[0]?.id).toBeUndefined();
});

it('resumes under the id it was resumed with, not the URI', async () => {
  const { session, pi } = opened({ uri: `ahp-session:/${CLIENT_ID}`, resume: 'pi-session-1' });
  session.begin('t1', 'hello');
  await settled();
  expect(pi.opens[0]?.resume).toBe('pi-session-1');
  expect(pi.opens[0]?.id).toBeUndefined();
  expect(pi.opens[0]?.forkAt).toBeUndefined();
});

it('opens a fork at the entry the host named, rather than the source itself', async () => {
  const { session, pi } = opened({ uri: `ahp-session:/${CLIENT_ID}`, resume: 'pi-session-1', forkAt: 'entry-7' });
  session.begin('t2', 'hello');
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