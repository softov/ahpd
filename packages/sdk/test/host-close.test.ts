/*
 * A host closed while its process stays up.
 *
 * What a restarting daemon does before its successor starts: the clock stops,
 * the sessions end and are waited on, nothing new starts, and the stores write
 * what was waiting and nothing after, so two processes never write the same
 * files.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOST_CLOSE_WAIT_MS, createHost } from '../src/host.js';
import { scheduledAutomations } from '../src/scheduled.js';
import { fileSessions } from '../src/sessions.js';
import { shellTerminals } from '../src/terminals.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Peer } from '../src/types/rpc.js';
import type { StartTerminals, Terminal } from '../src/types/terminals.js';
import type { StartSession } from '../src/types/automations.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ahpd-close-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A timer that goes off only when a test says so, and says whether it is armed. */
const clockwork = () => {
  let armed: (() => void) | undefined;
  return {
    get armed() { return armed; },
    timer: (fire: () => void) => { armed = fire; return { cancel: () => { armed = undefined; } }; },
  };
};

const nightly = (): Bag => ({
  title: 'Nightly',
  enabled: true,
  message: { text: 'go' },
  session: { provider: 'echo' },
  triggers: [{ id: 't1', kind: 'schedule', schedule: { expression: '0 9 * * *', timeZone: 'UTC' } }],
});

const peer = (): Peer => ({
  name: 'client', send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
}) as unknown as Peer;

describe('the stores, closed', () => {
  it('writes a session change that was waiting, and none after', async () => {
    const file = join(dir, 'sessions.json');
    const store = fileSessions({ file });
    store.setFlags('a', 1);
    store.close?.();
    // Written at the close, not on the tick it was waiting for.
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, sessions: [{ id: 'a', flags: 1 }] });
    const before = readFileSync(file, 'utf8');
    store.setFlags('b', 2);
    await new Promise((done) => { setTimeout(done, 10); });
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('fires nothing and writes nothing once its clock is let go of', () => {
    const file = join(dir, 'automations.json');
    const clock = clockwork();
    const store = scheduledAutomations({ file, now: () => new Date('2026-09-01T08:00:00Z'), timer: clock.timer });
    const due: string[] = [];
    store.onDue?.(({ automation }) => { due.push(automation); });
    store.create('ahp-automation:/one', nightly());
    const fire = clock.armed;
    expect(fire).toBeDefined();
    const before = readFileSync(file, 'utf8');

    store.close?.();
    expect(clock.armed).toBeUndefined();
    fire?.();
    store.create('ahp-automation:/two', nightly());
    expect(due).toEqual([]);
    expect(clock.armed).toBeUndefined();
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});

describe('Host.close', () => {
  it('ends every session, stops the clock and closes the stores, once', async () => {
    const closed: string[] = [];
    const base = echo({ path: dir, pace: 0 });
    const agent: Agent = {
      ...base,
      create: (start) => {
        const session = base.create(start);
        return { ...session, close: () => { closed.push(start.uri); session.close(); } };
      },
    };
    const sessionsFile = join(dir, 'sessions.json');
    const automationsFile = join(dir, 'automations.json');
    const clock = clockwork();
    const automations = scheduledAutomations({ file: automationsFile, now: () => new Date('2026-09-01T08:00:00Z'), timer: clock.timer });
    automations.create('ahp-automation:/one', nightly());
    const host = createHost({ path: dir, agents: [agent], sessions: fileSessions({ file: sessionsFile }), automations });
    const client = host.accept(peer());
    await client.handle({ method: 'initialize', params: { clientId: 'c', protocolVersions: ['0.9.0'] } });
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
    const fire = clock.armed;
    const written = existsSync(automationsFile) ? readFileSync(automationsFile, 'utf8') : '';

    const once = host.close();
    expect(host.close()).toBe(once);
    await once;
    const read = (): string | null => (existsSync(sessionsFile) ? readFileSync(sessionsFile, 'utf8') : null);
    const sessionsAfter = read();
    expect(closed).toEqual(['echo:/one']);
    expect(clock.armed).toBeUndefined();

    // A schedule that comes round after the close starts nothing and writes nothing.
    fire?.();
    await new Promise((done) => { setTimeout(done, 10); });
    expect(host.turning()).toEqual([]);
    expect(closed).toEqual(['echo:/one']);
    expect(existsSync(automationsFile) ? readFileSync(automationsFile, 'utf8') : '').toBe(written);
    // A change the host would store, made after the close, reaches no file.
    await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } }).catch(() => undefined);
    await new Promise((done) => { setTimeout(done, 10); });
    expect(read()).toBe(sessionsAfter);
    client.close();
  });

  it('waits for an agent whose close settles late, and refuses a session asked for meanwhile', async () => {
    const base = echo({ path: dir, pace: 0 });
    let exited = false;
    const agent: Agent = {
      ...base,
      create: (start) => {
        const session = base.create(start);
        return {
          ...session,
          close: () => {
            session.close();
            return new Promise<void>((done) => { setTimeout(() => { exited = true; done(); }, 100); });
          },
        };
      },
    };
    const sessionsFile = join(dir, 'sessions.json');
    const host = createHost({ path: dir, agents: [agent], sessions: fileSessions({ file: sessionsFile }) });
    const client = host.accept(peer());
    await client.handle({ method: 'initialize', params: { clientId: 'c', protocolVersions: ['0.9.0'] } });
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });

    const closing = host.close();
    await expect(client.handle({ method: 'createSession', params: { channel: 'ahp-session:/two', provider: 'echo' } }))
      .rejects.toThrow('This host is closing, so nothing new starts on it');
    expect(exited).toBe(false);
    await closing;
    expect(exited).toBe(true);
    expect(host.turning()).toEqual([]);
    client.close();
  });

  it('waits for a terminal\'s process to exit, and opens none once closing', async () => {
    const shells = shellTerminals();
    const opened: Terminal[] = [];
    const host = createHost({
      path: dir,
      agents: [echo({ path: dir, pace: 0 })],
      terminals: { create: (options) => { const one = shells.create(options); opened.push(one); return one; } },
    });
    const client = host.accept(peer());
    await client.handle({ method: 'initialize', params: { clientId: 'c', protocolVersions: ['0.9.0'] } });
    await client.handle({ method: 'createTerminal', params: { channel: 'ahp-terminal:/one', cwd: `file://${dir}` } });
    expect(opened).toHaveLength(1);

    const closing = host.close();
    await expect(client.handle({ method: 'createTerminal', params: { channel: 'ahp-terminal:/two', cwd: `file://${dir}` } }))
      .rejects.toThrow('This host is closing');
    await closing;
    expect(opened).toHaveLength(1);
    expect(opened[0]?.exitCode()).toBeDefined();
    client.close();
  });

  it('stops waiting for an agent that never exits after HOST_CLOSE_WAIT_MS', async () => {
    vi.useFakeTimers();
    try {
      const base = echo({ path: dir, pace: 0 });
      const agent: Agent = {
        ...base,
        create: (start) => {
          const session = base.create(start);
          return { ...session, close: () => { session.close(); return new Promise<void>(() => {}); } };
        },
      };
      const host = createHost({ path: dir, agents: [agent] });
      const client = host.accept(peer());
      await client.handle({ method: 'initialize', params: { clientId: 'c', protocolVersions: ['0.9.0'] } });
      await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
      let settled = false;
      void host.close().then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(HOST_CLOSE_WAIT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      client.close();
    }
    finally {
      vi.useRealTimers();
    }
  });
});

describe('Host.close refuses what would start', () => {
  const hello = async (host: ReturnType<typeof createHost>) => {
    const client = host.accept(peer());
    await client.handle({ method: 'initialize', params: { clientId: 'c', protocolVersions: ['0.9.0'] } });
    return client;
  };

  it('refuses the spawn of a session whose create was under way when the close began', async () => {
    let letGo = (): void => {};
    let entered = 0;
    const gate = new Promise<void>((done) => { letGo = done; });
    const created: string[] = [];
    const base = echo({ path: dir, pace: 0 });
    const agent: Agent = { ...base, create: (start) => { created.push(start.uri); return base.create(start); } };
    const worktrees = {
      repository: async () => { entered += 1; await gate; return dir; },
      branches: async () => [],
      create: async () => {},
    };
    const host = createHost({ path: dir, agents: [agent], worktrees: worktrees as never });
    const client = await hello(host);
    const creating = client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/late', provider: 'echo', config: { isolation: 'worktree' }, workingDirectories: [`file://${dir}`] },
    });
    // Past the request's own guard and waiting on the worktree, so the close lands before `spawn`.
    while (entered === 0) await new Promise((turn) => { setImmediate(turn); });
    const closing = host.close();
    letGo();
    await expect(creating).rejects.toThrow('This host is closing, so nothing new starts on it');
    await closing;
    expect(created).toEqual([]);
    client.close();
  });

  it('answers a command asked for after the close with the refusal, and opens no terminal', async () => {
    let run: ((toolCallId: string) => Promise<{ success: boolean; said?: string }>) | undefined;
    const base = echo({ path: dir, pace: 0 });
    const agent: Agent = {
      ...base,
      create: (start) => ({ ...base.create(start), ran: (_turnId, _command, given) => { run = given; } }),
    };
    const opened: string[] = [];
    const host = createHost({
      path: dir,
      agents: [agent],
      terminals: { create: (options) => { opened.push(options.uri); return shellTerminals().create(options); } },
    });
    const client = await hello(host);
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/one' } });
    await client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/one', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: '!ls' } } },
    });
    expect(run).toBeDefined();
    await host.close();
    expect(await run?.('call-1')).toMatchObject({ success: false, said: 'This host is closing, so nothing new starts on it' });
    expect(opened).toEqual([]);
    client.close();
  });

  it('refuses a terminal a backend opens after the close', async () => {
    let open: StartTerminals['open'] | undefined;
    const base = echo({ path: dir, pace: 0 });
    const agent: Agent = { ...base, create: (start) => { open = start.terminals?.open; return base.create(start); } };
    const host = createHost({ path: dir, agents: [agent], terminals: shellTerminals() });
    const client = await hello(host);
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
    expect(open).toBeDefined();
    await host.close();
    expect(() => open?.({ cwd: dir, command: 'true' })).toThrow('This host is closing, so nothing new starts on it');
    client.close();
  });

  it('fires no automation that comes due once closing, and refuses a run that asks to start a session', async () => {
    let due: ((event: { automation: string; origin: { kind: 'schedule' } }) => void) | undefined;
    let start: ((options: StartSession) => Promise<string>) | undefined;
    const runs: string[] = [];
    const store = {
      onDue: (observer: typeof due) => { due = observer; },
      run: async (automation: string, _origin: unknown, given: (options: StartSession) => Promise<string>) => {
        runs.push(automation);
        start = given;
        return undefined;
      },
      close: () => {},
    };
    const host = createHost({ path: dir, agents: [echo({ path: dir, pace: 0 })], automations: store as never });
    due?.({ automation: 'ahp-automation:/before', origin: { kind: 'schedule' } });
    await new Promise((wait) => { setTimeout(wait, 0); });
    expect(runs).toEqual(['ahp-automation:/before']);

    const closing = host.close();
    // The store is still open until the sessions are waited on, so this reaches the host's own guard.
    due?.({ automation: 'ahp-automation:/after', origin: { kind: 'schedule' } });
    await new Promise((wait) => { setTimeout(wait, 0); });
    expect(runs).toEqual(['ahp-automation:/before']);
    await expect(start?.({ provider: 'echo', text: 'go' })).rejects.toThrow('This host is closing, so nothing new starts on it');
    await closing;
  });

  it('waits for an automation run already starting a session, which then fails with the refusal logged', async () => {
    let due: ((event: { automation: string; origin: { kind: 'schedule' } }) => void) | undefined;
    let letGo = (): void => {};
    let entered = 0;
    const gate = new Promise<void>((done) => { letGo = done; });
    const said: string[] = [];
    const store = {
      onDue: (observer: typeof due) => { due = observer; },
      run: async (_automation: string, _origin: unknown, start: (options: StartSession) => Promise<string>) => {
        await start({ provider: 'echo', text: 'go', workingDirectory: dir, config: { isolation: 'worktree' } });
        return undefined;
      },
      close: () => {},
    };
    const worktrees = { repository: async () => { entered += 1; await gate; return dir; }, branches: async () => [], create: async () => {} };
    const host = createHost({
      path: dir, agents: [echo({ path: dir, pace: 0 })], automations: store as never, worktrees: worktrees as never,
      onEvent: (line: string) => { said.push(line); },
    } as never);
    due?.({ automation: 'ahp-automation:/nightly', origin: { kind: 'schedule' } });
    while (entered === 0) await new Promise((turn) => { setImmediate(turn); });

    let settled = false;
    const closing = host.close().then(() => { settled = true; });
    await new Promise((turn) => { setImmediate(turn); });
    expect(settled).toBe(false);
    letGo();
    await closing;
    await new Promise((turn) => { setImmediate(turn); });
    expect(host.turning()).toEqual([]);
    expect(said).toContain('ahp-automation:/nightly was due and failed: This host is closing, so nothing new starts on it');
  });

  it('closes every store even when a session\'s close throws, and logs the failure', async () => {
    const said: string[] = [];
    const base = echo({ path: dir, pace: 0 });
    const agent: Agent = { ...base, create: (start) => ({ ...base.create(start), close: () => { throw new Error('the agent would not go'); } }) };
    const closedStores: string[] = [];
    const sessions = { ...fileSessions({ file: join(dir, 'sessions.json') }), close: () => { closedStores.push('sessions'); } };
    const automations = { onDue: () => {}, run: async () => undefined, close: () => { closedStores.push('automations'); throw new Error('the clock stuck'); } };
    const host = createHost({
      path: dir, agents: [agent], sessions, automations: automations as never, onEvent: (line: string) => { said.push(line); },
    } as never);
    const client = await hello(host);
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
    await host.close();
    expect(closedStores).toEqual(['automations', 'sessions']);
    expect(said.some((line) => line.startsWith('closing ahp-chat:') && line.endsWith('failed: the agent would not go'))).toBe(true);
    expect(said.some((line) => line.includes('closing the automation store failed: the clock stuck'))).toBe(true);
    client.close();
  });
});
