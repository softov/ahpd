import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, type FSWatcher } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { gitChanges } from '../src/changes.js';
import { createHost } from '../src/host.js';
import { fileResources } from '../src/resources.js';
import { shellTerminals } from '../src/terminals.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { ChangesetSource } from '../src/types/changes.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * The source opens a real `fs.watch` handle, and one case below asks what it
 * does when that handle fails. The handle is held here so a test can hand back
 * one it controls; every other `watch` call is the real one.
 */
const handles = vi.hoisted(() => ({
  installed: undefined as { at: string; watcher: FSWatcher } | undefined,
  listeners: {} as Record<string, ((event: string, name: string | null) => void) | undefined>,
  opened: 0,
  paths: [] as string[],
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    watch: (...args: unknown[]) => {
      handles.opened += 1;
      const at = String(args[0]);
      handles.paths.push(at);
      handles.listeners[at] = args[1] as ((event: string, name: string | null) => void) | undefined;
      if (handles.installed !== undefined && handles.installed.at === at) return handles.installed.watcher;
      return (actual.watch as (...rest: unknown[]) => FSWatcher)(...args);
    },
  };
});

/*
 * What makes an uncommitted changeset follow the tree.
 *
 * The triggers are the point: staging in another program, a tool call mid-turn,
 * a client's write through the host and a terminal's exit, and none of them
 * costs git anything while nobody watches. Real repositories, because the
 * question is what git wrote.
 */

const CHANGESET = 'ahp-session:/s/changeset/uncommitted';
const URI = 'ahp-session:/s';

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString().trim();

const repository = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-refresh-'));
  made.push(dir);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  writeFileSync(join(dir, 'tracked.txt'), 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
};

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

const settle = async (times = 10): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

const waitFor = async (ready: () => Promise<boolean> | boolean, ms = 3000): Promise<void> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await ready()) return;
    await new Promise((r) => { setTimeout(r, 25); });
  }
  throw new Error('the change never arrived');
};

const channelActions = (p: ReturnType<typeof peer>, channel: string): Record<string, unknown>[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown> })
  .filter((n) => n.channel === channel)
  .map((n) => n.action);

/** One client on one session in `dir`, watching the session and nothing else. */
const open = async (dir: string, changes: ChangesetSource, agent: Agent = echo({ path: dir })) => {
  const host = createHost({ path: dir, agents: [agent], resources: fileResources(), terminals: shellTerminals(), changes });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: URI } });
  await settle(8);
  return { client, peer: p, dir };
};

/** A source that wraps the real one and counts what the host asks of it. */
const counting = (): {
  calls: { refresh: number; watched: (() => void) | undefined; stopped: number; watches: number };
  source: ChangesetSource;
} => {
  const base = gitChanges();
  const calls: { refresh: number; watched: (() => void) | undefined; stopped: number; watches: number } =
    { refresh: 0, watched: undefined, stopped: 0, watches: 0 };
  return {
    calls,
    source: {
      ...base,
      refresh: async (dir) => {
        calls.refresh += 1;
        return await base.refresh?.(dir) ?? false;
      },
      watch: (_dir, onChange) => {
        calls.watches += 1;
        calls.watched = onChange;
        return () => {
          calls.stopped += 1;
          calls.watched = undefined;
        };
      },
    },
  };
};

it('re-reads a changeset when git is changed outside the host', async () => {
  const dir = repository();
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  const { client, peer: p } = await open(dir, gitChanges());
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await settle(8);

  git(dir, 'add', 'a.txt');
  // A one-file changeset comes back as the whole list, and a bigger one as
  // `operationsChanged`; either carries the verbs, which is what moved.
  const carried = (): { id: string; confirmation?: string }[] | undefined => channelActions(p, CHANGESET)
    .filter((one) => one.type === 'changeset/contentChanged' || one.type === 'changeset/operationsChanged')
    .at(-1)?.operations as { id: string; confirmation?: string }[] | undefined;
  await waitFor(() => carried()?.find((one) => one.id === 'commit')?.confirmation
    === "Commit 1 staged file as 'Echo session'?");
});

it('moves the changeset when a client writes a file through the host', async () => {
  const dir = repository();
  // A source whose watch never fires, so only the write's own trigger can move
  // it: the git watcher would otherwise catch the same file a moment later.
  const { source } = counting();
  const { client, peer: p } = await open(dir, source);
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await settle(8);

  await client.handle({
    method: 'resourceWrite',
    params: { uri: `file://${dir}/fresh.txt`, data: 'new\n', encoding: 'utf-8' },
  });
  await waitFor(() => channelActions(p, CHANGESET).some((one) => JSON.stringify(one.files ?? '').includes('fresh.txt')));
});

it('moves the changeset when a tool call completes mid-turn', async () => {
  const dir = repository();
  const held: { emit?: Start['emit'] } = {};
  const base = echo({ path: dir });
  const agent: Agent = {
    ...base,
    create: (start: Start) => {
      held.emit = start.emit;
      return base.create(start);
    },
  };
  const { client, peer: p } = await open(dir, gitChanges(), agent);
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await settle(8);

  writeFileSync(join(dir, 'from-tool.txt'), 'made\n');
  held.emit?.('chat', { type: 'chat/toolCallComplete', turnId: 't1', toolCallId: 'c1', result: {} });
  await waitFor(() => channelActions(p, CHANGESET).some((one) => JSON.stringify(one.files ?? '').includes('from-tool.txt')));
  // And nothing has ended the turn, which is what used to be the only trigger.
  expect(channelActions(p, URI).some((one) => one.type === 'chat/turnComplete')).toBe(false);
});

it('runs no git for tool calls or writes when no client watches the directory', async () => {
  const dir = repository();
  const held: { emit?: Start['emit'] } = {};
  const base = echo({ path: dir });
  const agent: Agent = {
    ...base,
    create: (start: Start) => {
      held.emit = start.emit;
      return base.create(start);
    },
  };
  const { calls, source } = counting();
  const { client } = await open(dir, source, agent);
  calls.refresh = 0;

  // Ten tool calls that each wrote a file, with nobody subscribed.
  for (let i = 0; i < 10; i++) {
    writeFileSync(join(dir, `t${String(i)}.txt`), 'x\n');
    held.emit?.('chat', { type: 'chat/toolCallComplete', turnId: 't1', toolCallId: `c${String(i)}`, result: {} });
  }
  await settle(10);
  expect(calls.refresh).toBe(0);

  // And ten writes through the host, which reach the same check.
  for (let i = 0; i < 10; i++) {
    await client.handle({
      method: 'resourceWrite',
      params: { uri: `file://${dir}/f${String(i)}.txt`, data: 'x\n', encoding: 'utf-8' },
    });
  }
  await settle(10);
  expect(calls.refresh).toBe(0);
});

it('moves the changeset when a terminal that committed in the directory exits', async () => {
  const dir = repository();
  writeFileSync(join(dir, 'tracked.txt'), 'two\n');
  // No git watch, so only the terminal's exit can move this changeset.
  const { source } = counting();
  const { client, peer: p } = await open(dir, source);
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await settle(8);

  const terminal = 'ahp-terminal:/t';
  await client.handle({
    method: 'createTerminal',
    params: { channel: terminal, claim: { kind: 'client', clientId: 'probe' }, cwd: `file://${dir}` },
  });
  await client.handle({ method: 'subscribe', params: { channel: terminal } });
  await settle(10);
  client.handle({
    method: 'dispatchAction',
    params: { channel: terminal, action: { type: 'terminal/input', data: 'git commit -am x\nexit\n' } },
  });
  await waitFor(() => channelActions(p, terminal).some((one) => one.type === 'terminal/exited'), 8000);
  await waitFor(() => channelActions(p, CHANGESET).some((one) => one.type === 'changeset/cleared'), 4000);
}, 20000);

it('coalesces a burst of triggers into at most two re-reads', async () => {
  const dir = repository();
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  const { calls, source } = counting();
  const { client } = await open(dir, source);
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await settle(8);
  calls.refresh = 0;

  for (let i = 0; i < 20; i++) calls.watched?.();
  await settle(20);
  expect(calls.refresh).toBeGreaterThan(1);
  expect(calls.refresh).toBeLessThanOrEqual(2);
});

it('closes the git watch when a connection closes without unsubscribing', async () => {
  const dir = repository();
  const { calls, source } = counting();
  const { client } = await open(dir, source);
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await settle(8);
  expect(calls.watched).toBeDefined();

  client.close();
  await settle(8);
  expect(calls.stopped).toBe(1);
});

it('closes the git watch when the only session in the directory is disposed', async () => {
  const dir = repository();
  const { calls, source } = counting();
  const { client } = await open(dir, source);
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await settle(8);
  expect(calls.watches).toBe(1);

  await client.handle({ method: 'disposeSession', params: { channel: URI } });
  await settle(8);
  expect(calls.stopped).toBe(1);

  // The directory holds no entry any more, so a session made there again
  // opens a watch of its own.
  await client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await settle(10);
  expect(calls.watches).toBe(2);
});

it('keeps the directory watch until the last watched session is disposed', async () => {
  const dir = repository();
  const second = 'ahp-session:/t';
  const secondChangeset = `${second}/changeset/uncommitted`;
  const { calls, source } = counting();
  const host = createHost({
    path: dir, agents: [echo({ path: dir })], resources: fileResources(), terminals: shellTerminals(), changes: source,
  });
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await client.handle({ method: 'createSession', params: { channel: second, provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: URI } });
  await client.handle({ method: 'subscribe', params: { channel: second } });
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await client.handle({ method: 'subscribe', params: { channel: secondChangeset } });
  await settle(10);
  expect(calls.watched).toBeDefined();

  await client.handle({ method: 'disposeSession', params: { channel: second } });
  await settle(8);
  expect(calls.stopped).toBe(0);
  expect(calls.watched).toBeDefined();

  await client.handle({ method: 'disposeSession', params: { channel: URI } });
  await settle(8);
  expect(calls.stopped).toBe(1);
});

it('closes a failing watcher, drops its pending re-read and leaves the process alone', async () => {
  const dir = repository();
  const gitDir = git(dir, 'rev-parse', '--absolute-git-dir');
  const watcher = new EventEmitter() as unknown as FSWatcher;
  const closed = vi.fn();
  (watcher as unknown as { close: () => void }).close = closed;
  handles.installed = { at: gitDir, watcher };
  handles.opened = 0;
  const fired = vi.fn();
  try {
    const stop = gitChanges().watch?.(dir, fired);
    await waitFor(() => handles.opened > 0);

    // One event has queued a re-read, and the failure that follows takes the
    // handle and the queued re-read with it.
    handles.listeners[gitDir]?.('rename', 'index');
    expect(() => { watcher.emit('error', new Error('the watcher failed')); }).not.toThrow();
    expect(closed).toHaveBeenCalledTimes(1);
    await new Promise((r) => { setTimeout(r, 250); });
    expect(fired).not.toHaveBeenCalled();
    expect(() => stop?.()).not.toThrow();
  }
  finally {
    handles.installed = undefined;
  }
});

it('moves the changeset when a branch moves with no index or HEAD write', async () => {
  const dir = repository();
  writeFileSync(join(dir, 'staged.txt'), 'staged\n');
  git(dir, 'add', 'staged.txt');
  const { client, peer: p } = await open(dir, gitChanges());
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await settle(10);

  const seen = (): Record<string, unknown>[] => channelActions(p, CHANGESET);
  git(dir, 'commit', '-q', '-m', 'x');
  await waitFor(() => seen().some((one) => one.type === 'changeset/cleared'));

  // `reset --soft` moves the branch and writes neither the index nor HEAD.
  const beforeReset = seen().length;
  git(dir, 'reset', '--soft', 'HEAD~1');
  await waitFor(() => seen().slice(beforeReset).some((one) => one.type === 'changeset/contentChanged'
    && JSON.stringify(one.files ?? '').includes('staged.txt')));

  // An allow-empty commit moves the branch again and takes the staged file
  // with it, with the working tree untouched either way.
  const beforeCommit = seen().length;
  git(dir, 'commit', '--allow-empty', '-q', '-m', 'y');
  await waitFor(() => seen().slice(beforeCommit).some((one) => one.type === 'changeset/cleared'));
});

it('watches the directory holding the checked-out branch ref', async () => {
  const dir = repository();
  git(dir, 'checkout', '-q', '-b', 'feature/x');
  const gitDir = git(dir, 'rev-parse', '--absolute-git-dir');
  handles.paths = [];
  const stop = gitChanges().watch?.(dir, () => {});
  await waitFor(() => handles.paths.includes(join(gitDir, 'refs', 'heads', 'feature')));
  expect(handles.paths).toContain(gitDir);
  expect(handles.paths).toContain(join(gitDir, 'refs', 'heads', 'feature'));
  stop?.();
});

it('watches the common directory for a linked worktree', async () => {
  const dir = repository();
  const tree = `${dir}-wt`;
  made.push(tree);
  git(dir, 'worktree', 'add', '-q', '-b', 'agents/wt', tree);
  const inside = git(tree, 'rev-parse', '--absolute-git-dir');
  const common = git(tree, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  expect(inside).not.toBe(common);

  handles.paths = [];
  const stop = gitChanges().watch?.(tree, () => {});
  await waitFor(() => handles.paths.includes(join(common, 'refs', 'heads', 'agents')));
  expect(handles.paths).toContain(inside);
  expect(handles.paths).toContain(join(common, 'refs', 'heads', 'agents'));
  stop?.();
});
