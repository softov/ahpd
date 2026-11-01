import { WAIT_MS } from '../../../tools/wait.ts';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, type FSWatcher } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { changesetReducer } from '@microsoft/agent-host-protocol';
import { gitChanges } from '../src/sessions/changes.js';
import { gitBranches } from '../src/repo/git.js';
import { gitWorktrees } from '../src/repo/worktrees.js';
import { createHost } from '../src/host.js';
import { fileResources, uriOf } from '../src/resources/resources.js';
import { shellTerminals } from '../src/machines/terminals.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Listed, Start } from '../src/types/agent.js';
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
afterEach(async () => {
  // Awaited rather than sync: on Windows a folder stays held until what the
  // test opened there is let go, which happens on the event loop a sync
  // retry blocks.
  for (const dir of made) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

const waitFor = async (ready: () => Promise<boolean> | boolean, ms = WAIT_MS): Promise<void> => {
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

/**
 * One client on one session in `dir`, watching the session and nothing else.
 *
 * `where` names a working folder explicitly, which is what gives the session a
 * baseline: a session started on the host's own path has none, and no row of
 * its own is read.
 */
const open = async (dir: string, changes: ChangesetSource, agent: Agent = echo({ path: dir }), where?: string) => {
  const host = createHost({ path: dir, agents: [agent], resources: fileResources(), terminals: shellTerminals(), changes });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await client.handle({
    method: 'createSession',
    params: { channel: URI, provider: 'echo', ...(where === undefined ? {} : { workingDirectories: [uriOf(where)] }) },
  });
  await client.handle({ method: 'subscribe', params: { channel: URI } });
  await settle(8);
  return { client, peer: p, dir };
};

/** A source that wraps the real one and counts what the host asks of it. */
interface Calls {
  /** Re-reads begun. */
  refresh: number;
  /** Re-reads that have answered. */
  finished: number;
  watched: (() => void) | undefined;
  stopped: number;
  watches: number;
}

/**
 * The git source with its watch replaced by one the test fires, counting what
 * the host asks of it. `ready`, when given, is what the watch says it is armed
 * on; without it the watch says nothing, as a source that cannot tell.
 */
const counting = (ready?: Promise<void>): { calls: Calls; source: ChangesetSource } => {
  const base = gitChanges();
  const calls: Calls = { refresh: 0, finished: 0, watched: undefined, stopped: 0, watches: 0 };
  return {
    calls,
    source: {
      ...base,
      refresh: async (dir) => {
        calls.refresh += 1;
        try {
          return await base.refresh?.(dir) ?? false;
        }
        finally {
          calls.finished += 1;
        }
      },
      watch: (_dir, onChange) => {
        calls.watches += 1;
        calls.watched = onChange;
        const stop = (): void => {
          calls.stopped += 1;
          calls.watched = undefined;
        };
        return ready === undefined ? stop : Object.assign(stop, { ready });
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
    === "Commit as 'Echo session'? The whole changeset takes 1 staged file.");
});

/** The actions that carry files, which a recomputation must not send. */
const FILE_ACTIONS = [
  'changeset/contentChanged', 'changeset/fileSet', 'changeset/fileRemoved', 'changeset/cleared',
];

/** Each action as one word, with a status named where the status is the point. */
const kindsOf = (actions: Record<string, unknown>[]): string[] => actions
  .map((one) => (one.type === 'changeset/statusChanged' ? `status:${String(one.status)}` : String(one.type)));

/**
 * The git source with its watch the test fires, and a re-read that always says
 * something moved.
 *
 * The triggers are not what these cases are about, so nothing has to move in
 * the tree for a re-read to be asked for.
 */
const reReads = (): { calls: Calls; source: ChangesetSource } => {
  const base = gitChanges();
  const calls: Calls = { refresh: 0, finished: 0, watched: undefined, stopped: 0, watches: 0 };
  return {
    calls,
    source: {
      ...base,
      refresh: async (dir) => {
        calls.refresh += 1;
        try {
          await base.refresh?.(dir);
          return true;
        }
        finally {
          calls.finished += 1;
        }
      },
      watch: (_dir, onChange) => {
        calls.watches += 1;
        calls.watched = onChange;
        return (): void => {
          calls.stopped += 1;
          calls.watched = undefined;
        };
      },
    },
  };
};

it('says recomputing before a re-read that finds the same files, and ready after', async () => {
  const dir = repository();
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  const { calls, source } = reReads();
  const { client, peer: p } = await open(dir, source);
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await waitFor(() => calls.watches === 1 && calls.finished === calls.refresh);
  const before = channelActions(p, CHANGESET).length;

  calls.watched?.();
  await waitFor(() => kindsOf(channelActions(p, CHANGESET).slice(before)).includes('status:ready'));

  const after = channelActions(p, CHANGESET).slice(before);
  // The status is the whole of what moved, so the two are all that arrives.
  expect(kindsOf(after).slice(0, 2)).toEqual(['status:recomputing', 'status:ready']);
  expect(after.filter((one) => FILE_ACTIONS.includes(String(one.type)))).toEqual([]);
});

it('says recomputing before a re-read that finds a file, and the old files stay until ready', async () => {
  const dir = repository();
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  const { calls, source } = counting();
  const { client, peer: p } = await open(dir, source);
  const answer = await client.handle({ method: 'subscribe', params: { channel: CHANGESET } }) as {
    snapshot: { state: { status: string; files: { id: string }[] } };
  };
  await waitFor(() => calls.watches === 1 && calls.finished === calls.refresh);
  const before = channelActions(p, CHANGESET).length;

  writeFileSync(join(dir, 'b.txt'), 'b\n');
  calls.watched?.();
  await waitFor(() => kindsOf(channelActions(p, CHANGESET).slice(before)).includes('status:recomputing'));
  await waitFor(() => kindsOf(channelActions(p, CHANGESET).slice(before)).includes('status:ready'));

  const after = channelActions(p, CHANGESET).slice(before);
  const kinds = kindsOf(after);
  const recomputing = kinds.indexOf('status:recomputing');
  const ready = kinds.indexOf('status:ready');
  const file = kinds.findIndex((one) => FILE_ACTIONS.includes(one));
  expect(kinds.slice(recomputing, ready + 1)).toEqual(['status:recomputing', 'status:ready']);
  expect(file).toBeGreaterThan(ready);

  // A client replaying these keeps the files it had while the read ran, which
  // is what `recomputing` is for.
  let state = answer.snapshot.state as unknown as Parameters<typeof changesetReducer>[0];
  const held: { id: string }[] = answer.snapshot.state.files;
  let during: { status: string; files: { id: string }[] } | undefined;
  for (const one of after) {
    state = changesetReducer(state, one as unknown as Parameters<typeof changesetReducer>[1]);
    if (one.type === 'changeset/statusChanged' && one.status === 'recomputing') {
      during = state as unknown as { status: string; files: { id: string }[] };
    }
  }
  expect(during?.status).toBe('recomputing');
  expect(during?.files.map((one) => one.id)).toEqual(held.map((one) => one.id));
  expect(during?.files.map((one) => one.id)).not.toContain('b.txt');
});

/** A changeset source whose subscribe read answers, and whose every re-read after it answers `next`. */
const reReadAnswering = (source: ChangesetSource, next: () => Promise<undefined>): { changes: ChangesetSource; reads: () => number } => {
  const base = gitChanges();
  let reads = 0;
  return {
    changes: {
      ...source,
      // The subscribe's own read answers, so the changeset is on screen; the
      // re-reads that follow answer `next`.
      state: async (at, session, scope) => {
        reads += 1;
        return reads > 1 ? await next() : await base.state(at, session, scope);
      },
    },
    reads: () => reads,
  };
};

it('says a re-read that fails as the error the protocol names, with its cause', async () => {
  const dir = repository();
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  const { calls, source } = reReads();
  const { changes, reads } = reReadAnswering(source, async () => { throw new Error('the read failed'); });
  const { client, peer: p } = await open(dir, changes);
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await waitFor(() => calls.watches === 1 && calls.finished === calls.refresh);
  const before = channelActions(p, CHANGESET).length;

  calls.watched?.();
  await waitFor(() => kindsOf(channelActions(p, CHANGESET).slice(before)).includes('status:error'));

  // `error` is the status of a computation that failed, its cause beside it,
  // and the files stay the last completed result.
  // https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-changeset/state.ts#L119-L141
  const after = channelActions(p, CHANGESET).slice(before);
  expect(reads()).toBeGreaterThan(1);
  expect(kindsOf(after).slice(0, 2)).toEqual(['status:recomputing', 'status:error']);
  expect(after.find((one) => one.status === 'error')?.error).toEqual({ errorType: 'computeFailed', message: 'the read failed' });
  expect(after.filter((one) => FILE_ACTIONS.includes(String(one.type)))).toEqual([]);
});

it('puts the status back when a re-read gives nothing', async () => {
  const dir = repository();
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  const { calls, source } = reReads();
  const { changes, reads } = reReadAnswering(source, async () => undefined);
  const { client, peer: p } = await open(dir, changes);
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await waitFor(() => calls.watches === 1 && calls.finished === calls.refresh);
  const before = channelActions(p, CHANGESET).length;

  calls.watched?.();
  await waitFor(() => kindsOf(channelActions(p, CHANGESET).slice(before)).includes('status:ready'));

  const after = channelActions(p, CHANGESET).slice(before);
  expect(reads()).toBeGreaterThan(1);
  expect(kindsOf(after).slice(0, 2)).toEqual(['status:recomputing', 'status:ready']);
  expect(after.filter((one) => FILE_ACTIONS.includes(String(one.type)))).toEqual([]);
});

it('says nothing on a changeset channel nobody watches', async () => {
  const dir = repository();
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  const second = 'ahp-session:/t';
  const secondChangeset = `${second}/changeset/uncommitted`;
  const { calls, source } = reReads();
  const host = createHost({
    path: dir, agents: [echo({ path: dir })], resources: fileResources(), terminals: shellTerminals(), changes: source,
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await client.handle({ method: 'createSession', params: { channel: second, provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: URI } });
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await waitFor(() => calls.watches === 1 && calls.finished === calls.refresh);

  calls.watched?.();
  await waitFor(() => kindsOf(channelActions(p, CHANGESET)).includes('status:ready'));
  // The second session is in the same directory and its changeset is nobody's
  // screen, so the re-read says nothing about it.
  expect(channelActions(p, secondChangeset)).toEqual([]);
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
    params: { uri: uriOf(join(dir, 'fresh.txt')), data: 'new\n', encoding: 'utf-8' },
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

/** An echo backend whose emitter the test holds, so it can end a turn itself. */
const endable = (dir: string): { held: { emit?: Start['emit'] }; agent: Agent } => {
  const held: { emit?: Start['emit'] } = {};
  const base = echo({ path: dir });
  return {
    held,
    agent: {
      ...base,
      create: (start: Start) => {
        held.emit = start.emit;
        return base.create(start);
      },
    },
  };
};

/** Every action the peer was sent, whichever channel it was for. */
const actionsOf = (p: ReturnType<typeof peer>): Record<string, unknown>[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => (n.params as { action: Record<string, unknown> }).action);

const carriedFiles = (p: ReturnType<typeof peer>, channel: string, name: string): boolean =>
  channelActions(p, channel).some((one) => JSON.stringify(one.files ?? '').includes(name));

it('pushes the files of a watched changeset when a turn ends', async () => {
  const dir = repository();
  const { held, agent } = endable(dir);
  // A watch that never fires, so only what the host does can push these.
  const { calls, source } = counting();
  const { client, peer: p } = await open(dir, source, agent);
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await waitFor(() => calls.watches === 1 && calls.finished === calls.refresh);

  // A tool call that wrote nothing: its own mid-turn re-read finds the same
  // files, so the turn's end is the only thing left that can push these.
  const before = calls.refresh;
  held.emit?.('chat', { type: 'chat/toolCallComplete', turnId: 't1', toolCallId: 'c1', result: {} });
  await waitFor(() => calls.finished >= before + 1);

  writeFileSync(join(dir, 'from-turn.txt'), 'made\n');
  held.emit?.('chat', { type: 'chat/turnComplete', turnId: 't1', duration: 1 });
  await waitFor(() => carriedFiles(p, CHANGESET, 'from-turn.txt'));
});

it('pushes a turn\'s files when no tool call completed in the turn', async () => {
  const dir = repository();
  const { held, agent } = endable(dir);
  const { calls, source } = counting();
  const { client, peer: p } = await open(dir, source, agent);
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await waitFor(() => calls.watches === 1 && calls.finished === calls.refresh);

  writeFileSync(join(dir, 'from-turn.txt'), 'made\n');
  held.emit?.('chat', { type: 'chat/turnComplete', turnId: 't1', duration: 1 });
  await waitFor(() => carriedFiles(p, CHANGESET, 'from-turn.txt'));
  // No tool call ran, so the turn's end is the whole of what pushed these.
  expect(actionsOf(p).some((one) => one.type === 'chat/toolCallComplete')).toBe(false);
});

it('runs no changeset read when a turn ends with no watched changeset', async () => {
  const dir = repository();
  const { held, agent } = endable(dir);
  const base = gitChanges();
  let reads = 0;
  const changes: ChangesetSource = {
    ...base,
    // A re-read that always says the files moved, so a turn's end would push
    // them if any channel were watching one.
    refresh: async (at) => { await base.refresh?.(at); return true; },
    state: async (at, session, scope) => { reads += 1; return await base.state(at, session, scope); },
  };
  const { client } = await open(dir, changes, agent);
  await settle(8);
  const before = reads;

  writeFileSync(join(dir, 'unwatched.txt'), 'made\n');
  held.emit?.('chat', { type: 'chat/turnComplete', turnId: 't1', duration: 1 });
  await settle(20);
  await new Promise((r) => { setTimeout(r, 200); });
  expect(reads).toBe(before);
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
      params: { uri: uriOf(join(dir, `f${String(i)}.txt`)), data: 'x\n', encoding: 'utf-8' },
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
    params: { channel: terminal, claim: { kind: 'client', clientId: 'probe' }, cwd: uriOf(dir) },
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
  // Counted from a host with its watch open and no re-read running.
  await waitFor(() => calls.watches === 1 && calls.finished === calls.refresh);
  calls.refresh = 0;
  calls.finished = 0;

  for (let i = 0; i < 20; i++) calls.watched?.();
  await waitFor(() => calls.finished >= 2 && calls.finished === calls.refresh);
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

it('reads the directory again once its watch says it is armed, and not before', async () => {
  const dir = repository();
  let arm: () => void = () => {};
  const ready = new Promise<void>((resolve) => { arm = resolve; });
  const { calls, source } = counting(ready);
  const { client } = await open(dir, source);
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await waitFor(() => calls.watches === 1 && calls.finished === calls.refresh);

  const before = calls.refresh;
  arm();
  await waitFor(() => calls.finished === before + 1);
  expect(calls.refresh).toBe(before + 1);
});

it('sees a commit made right after the first read, before the watch is armed', async () => {
  const dir = repository();
  writeFileSync(join(dir, 'staged.txt'), 'staged\n');
  git(dir, 'add', 'staged.txt');
  const { client, peer: p } = await open(dir, gitChanges());
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });

  git(dir, 'commit', '-q', '-m', 'x');
  await waitFor(() => channelActions(p, CHANGESET).some((one) => one.type === 'changeset/cleared'));
});

it('moves the changeset when a branch moves with no index or HEAD write', async () => {
  const dir = repository();
  writeFileSync(join(dir, 'staged.txt'), 'staged\n');
  git(dir, 'add', 'staged.txt');
  const { client, peer: p } = await open(dir, gitChanges());
  await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });

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

it('ends quietly a re-read whose directory is removed while it runs', async () => {
  const dir = repository();
  /** Held by the test, so the directory can go while a re-read is in `refresh`. */
  let release: (moved: boolean) => void = () => {};
  let gated = false;
  let threw = false;
  const { calls, source } = counting();
  const changes: ChangesetSource = {
    ...source,
    refresh: async (at) => {
      if (!gated) return await source.refresh?.(at) ?? false;
      return await new Promise<boolean>((resolve) => { release = resolve; });
    },
  };
  // Facts that fail for a directory that is gone, as a port reading git would.
  const directories = {
    meta: (at: string) => {
      if (!existsSync(at)) {
        threw = true;
        throw new Error(`${at} is gone`);
      }
      return {};
    },
    refresh: async () => false,
  };
  const rejected: unknown[] = [];
  const onRejected = (reason: unknown): void => { rejected.push(reason); };
  process.on('unhandledRejection', onRejected);
  try {
    const host = createHost({ path: dir, agents: [echo({ path: dir })], resources: fileResources(), changes, directories });
    const client = host.accept(peer());
    await client.handle({
      method: 'initialize',
      params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
    });
    await client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
    await client.handle({ method: 'subscribe', params: { channel: URI } });
    await client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
    await waitFor(() => calls.watches === 1);

    gated = true;
    calls.watched?.();
    // Awaited, with retries: on Windows the watcher can hold the folder a moment
    // longer. The re-read waits at its gate until the release below.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    release(true);
    await waitFor(() => threw);
    // Node reports an unhandled rejection once the microtasks after it have run.
    await new Promise((resolve) => { setImmediate(resolve); });
    await new Promise((resolve) => { setImmediate(resolve); });
    expect(rejected).toEqual([]);
  }
  finally {
    process.off('unhandledRejection', onRejected);
  }
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

/*
 * A directory outside the host's `path`.
 *
 * Only `browsable()` is read at startup, so a session anywhere else has no git
 * facts, no pull requests and no counts until something reads them. The two
 * readers under test are the first subscribe to a changeset there and a pass
 * over the stored sessions' directories once the host has started.
 */

/** A directory that is not a repository, for the host's own `path`. */
const elsewhere = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-home-'));
  made.push(dir);
  return dir;
};

/** A repository with a GitHub `origin` and one uncommitted file. */
const onGitHub = (): string => {
  const dir = repository();
  git(dir, 'remote', 'add', 'origin', 'git@github.com:owner/repo.git');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  return dir;
};

/** GitHub, answering that the branch has no pull request. */
const noRequests = () => {
  const asked: string[] = [];
  return {
    asked,
    port: {
      resource: { resource: 'https://api.github.com/repos' },
      forBranch: async (_repo: unknown, branch: string) => { asked.push(branch); return []; },
      create: async () => { throw new Error('not here'); },
    },
  };
};

const hello = { method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } };

const rowsMoved = (p: ReturnType<typeof peer>, session: string): Record<string, unknown>[] => p.notes
  .filter((n) => n.method === 'root/sessionSummaryChanged')
  .map((n) => n.params as { session: string; changes: Record<string, unknown> })
  .filter((n) => n.session === session)
  .map((n) => n.changes);

/** Every operation id the first subscribe answers for a session made in `dir`. */
const firstOperations = async (dir: string, github?: ReturnType<typeof noRequests>['port']) => {
  const home = elsewhere();
  const host = createHost({
    path: home, agents: [echo({ path: home })], resources: fileResources(), terminals: shellTerminals(),
    changes: gitChanges(), directories: gitBranches(), ...(github === undefined ? {} : { github }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello);
  await client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo', workingDirectories: [uriOf(dir)] } });
  const answer = await client.handle({ method: 'subscribe', params: { channel: CHANGESET } }) as {
    snapshot: { state: { files: unknown[]; operations?: { id: string }[] } };
  };
  return { peer: p, state: answer.snapshot.state, ids: (answer.snapshot.state.operations ?? []).map((one) => one.id) };
};

it('offers the pull request pair on the first subscribe in a directory outside the path', async () => {
  const dir = onGitHub();
  const fake = noRequests();
  const { ids } = await firstOperations(dir, fake.port);
  expect(ids).toContain('create-pr');
  expect(ids).toContain('prepare-pull-request');
  // Asked about the branch before answering, which needs the facts' remote.
  expect(fake.asked).toEqual(['main']);
});

it('offers no pull request on the first subscribe when there is no GitHub to ask', async () => {
  const dir = onGitHub();
  const { ids } = await firstOperations(dir);
  expect(ids).toContain('commit');
  expect(ids).not.toContain('create-pr');
  expect(ids).not.toContain('prepare-pull-request');
});

it('announces the session\'s counts on the first subscribe in a directory outside the path', async () => {
  const dir = onGitHub();
  const { peer: p } = await firstOperations(dir);
  // The row is published under its provider's name, and its last move holds
  // the counts once the folder was read.
  const counted = rowsMoved(p, 'ahp-session:/s').at(-1);
  expect((counted?.changes as { files?: number } | undefined)?.files).toBe(1);
});

it('answers a subscribe in a directory that is not a repository, when its facts fail', async () => {
  const dir = elsewhere();
  const home = elsewhere();
  const host = createHost({
    path: home, agents: [echo({ path: home })], resources: fileResources(), terminals: shellTerminals(),
    changes: gitChanges(), github: noRequests().port,
    directories: { meta: () => undefined, refresh: async () => { throw new Error('no git here'); } },
  });
  const client = host.accept(peer());
  await client.handle(hello);
  await client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo', workingDirectories: [uriOf(dir)] } });
  const answer = await client.handle({ method: 'subscribe', params: { channel: `${URI}/changeset/session` } }) as {
    snapshot: { state: { files: unknown[]; operations?: unknown[] } };
  };
  expect(answer.snapshot.state.files).toEqual([]);
  expect(answer.snapshot.state.operations).toBeUndefined();
});

/** An echo backend whose catalogue holds one stored session in `dir`. */
const storing = (home: string, dir: string): Agent => {
  const base = echo({ path: home });
  const row: Listed = {
    id: 'stored',
    title: 'Stored',
    createdAt: '2026-09-27T00:00:00.000Z',
    modifiedAt: '2026-09-27T00:00:00.000Z',
    workingDirectories: [uriOf(dir)],
  };
  return { ...base, list: async () => [row] };
};

/** A changes source that counts its re-reads per directory. */
const perDirectory = (): { reads: Map<string, number>; source: ChangesetSource } => {
  const base = gitChanges();
  const reads = new Map<string, number>();
  return {
    reads,
    source: {
      ...base,
      refresh: async (dir) => {
        reads.set(dir, (reads.get(dir) ?? 0) + 1);
        return await base.refresh?.(dir) ?? false;
      },
    },
  };
};

it('lists a stored session outside the path with its counts, with no turn and no subscribe', async () => {
  const dir = onGitHub();
  const home = elsewhere();
  const { reads, source } = perDirectory();
  const host = createHost({
    path: home, agents: [storing(home, dir)], resources: fileResources(), terminals: shellTerminals(),
    changes: source, directories: gitBranches(),
  });
  const client = host.accept(peer());
  await client.handle(hello);
  await waitFor(() => source.summary(dir) !== undefined);
  const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string; changes?: { files?: number } }[];
  };
  expect(listed.items.find((one) => one.resource === 'ahp-session:/stored')?.changes?.files).toBe(1);
  expect(reads.get(dir)).toBe(1);
});

it('tells a client already connected that a stored session\'s counts arrived', async () => {
  const dir = onGitHub();
  const home = elsewhere();
  const host = createHost({
    path: home, agents: [storing(home, dir)], resources: fileResources(), terminals: shellTerminals(),
    changes: gitChanges(), directories: gitBranches(),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello);
  await waitFor(() => rowsMoved(p, 'ahp-session:/stored').length > 0);
  const moved = rowsMoved(p, 'ahp-session:/stored').at(-1);
  expect((moved?.changes as { files?: number } | undefined)?.files).toBe(1);
});

it('does not read a second time a stored session\'s directory that is already served', async () => {
  const dir = onGitHub();
  const { reads, source } = perDirectory();
  const host = createHost({
    path: dir, agents: [storing(dir, dir)], resources: fileResources(), terminals: shellTerminals(),
    changes: source, directories: gitBranches(),
  });
  const client = host.accept(peer());
  await client.handle(hello);
  await waitFor(() => source.summary(dir) !== undefined);
  await settle(20);
  await new Promise((r) => { setTimeout(r, 200); });
  expect(reads.get(dir)).toBe(1);
});

/** `storing`, with a transcript to serve its row from. */
const stored = (home: string, dir: string): Agent => ({ ...storing(home, dir), transcript: async () => [] });

it('tells a client watching a stored session\'s changeset that a commit cleared it', async () => {
  const dir = repository();
  writeFileSync(join(dir, 'staged.txt'), 'staged\n');
  git(dir, 'add', 'staged.txt');
  const home = elsewhere();
  const host = createHost({
    path: home, agents: [stored(home, dir)], resources: fileResources(), terminals: shellTerminals(),
    changes: gitChanges(), directories: gitBranches(),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello);
  await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
  const changeset = 'ahp-session:/stored/changeset/uncommitted';
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/stored' } });
  const answer = await client.handle({ method: 'subscribe', params: { channel: changeset } }) as {
    snapshot: { state: { files: unknown[] } };
  };
  expect(answer.snapshot.state.files).toHaveLength(1);

  git(dir, 'commit', '-q', '-m', 'x');
  await waitFor(() => channelActions(p, changeset).some((one) => one.type === 'changeset/cleared'));
});

it('keeps a stored session\'s git watch while its changeset is watched, and closes it after', async () => {
  const dir = repository();
  const home = elsewhere();
  const { calls, source } = counting();
  const host = createHost({
    path: home, agents: [stored(home, dir)], resources: fileResources(), terminals: shellTerminals(),
    changes: source, directories: gitBranches(),
  });
  const client = host.accept(peer());
  await client.handle(hello);
  await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
  const changeset = 'ahp-session:/stored/changeset/uncommitted';
  await client.handle({ method: 'subscribe', params: { channel: changeset } });
  await waitFor(() => calls.watches === 1 && calls.finished === calls.refresh);

  const before = calls.refresh;
  calls.watched?.();
  await waitFor(() => calls.finished === before + 1);
  expect(calls.stopped).toBe(0);

  await client.handle({ method: 'unsubscribe', params: { channel: changeset } });
  expect(calls.stopped).toBe(1);
});

/*
 * A row's counts move while the turn runs, and not only when it ends.
 *
 * A build is one turn of hours, and its row showed the counts from when the
 * turn started. A finished tool call is where the tree can have moved, so it is
 * where the row is read - and the read is coalesced, because a turn of many
 * tool calls would otherwise cost a `git diff` apiece.
 */

const SESSION = 'ahp-session:/s';

/** A repository in a folder of its own, so the trees cut beside it are cleaned with it. */
const insideAProject = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-tree-'));
  made.push(root);
  const dir = join(root, 'project');
  mkdirSync(dir);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  writeFileSync(join(dir, 'tracked.txt'), 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
};

/** The tree the host cut, read from git's own list. */
const cutTree = (repository: string): string => {
  for (const block of git(repository, 'worktree', 'list', '--porcelain').split('\n\n')) {
    if (block.includes('refs/heads/agents/')) return block.split('\n')[0]?.replace(/^worktree /, '') ?? '';
  }
  throw new Error('the host cut no tree');
};

/** One client and one session in a tree the host cuts for it. */
const openInTree = async (repository_: string, changes: ChangesetSource, agent: Agent) => {
  const host = createHost({
    path: repository_,
    agents: [agent],
    resources: fileResources(),
    terminals: shellTerminals(),
    changes,
    worktrees: gitWorktrees(),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello);
  await client.handle({
    method: 'createSession',
    params: {
      channel: URI,
      provider: 'echo',
      workingDirectories: [uriOf(repository_)],
      config: { isolation: 'worktree', branch: 'main' },
    },
  });
  await waitFor(() => git(repository_, 'worktree', 'list', '--porcelain').includes('refs/heads/agents/'));
  return { client, peer: p, where: cutTree(repository_) };
};

/** What the last row a session was sent says its counts are. */
/** The counts the last change since `from` that carried any said: a change carries the fields that moved. */
const countsMoved = (p: ReturnType<typeof peer>, from: number): { files?: number; additions?: number; deletions?: number } | undefined =>
  (rowsMoved(p, SESSION).slice(from).filter((one) => one.changes !== undefined).at(-1)?.changes as
    { files?: number; additions?: number; deletions?: number } | undefined);

it('moves a session row at a tool call, from its baseline, before the turn ends', async () => {
  const dir = repository();
  const { held, agent } = endable(dir);
  const { client, peer: p } = await open(dir, gitChanges(), agent, dir);
  // The baseline is written and read before the row can move from it.
  await waitFor(() => rowsMoved(p, SESSION).length > 0);
  const from = rowsMoved(p, SESSION).length;

  writeFileSync(join(dir, 'from-tool.txt'), 'made\n');
  held.emit?.('chat', { type: 'chat/toolCallComplete', turnId: 't1', toolCallId: 'c1', result: {} });

  await waitFor(() => countsMoved(p, from)?.files === 1);
  expect(countsMoved(p, from)).toEqual({ files: 1, additions: 1, deletions: 0 });
  // Nothing ended the turn, which is what used to be the only time a row was read.
  expect(channelActions(p, URI).some((one) => one.type === 'chat/turnComplete')).toBe(false);
});

it('moves a worktree row at a tool call, from its branch, before the turn ends', async () => {
  const project = insideAProject();
  const { held, agent } = endable(project);
  const { client, peer: p, where } = await openInTree(project, gitChanges(), agent);
  await waitFor(() => rowsMoved(p, SESSION).length > 0);
  const from = rowsMoved(p, SESSION).length;

  writeFileSync(join(where, 'from-tool.txt'), 'made\n');
  held.emit?.('chat', { type: 'chat/toolCallComplete', turnId: 't1', toolCallId: 'c1', result: {} });

  await waitFor(() => countsMoved(p, from)?.files === 1);
  expect(countsMoved(p, from)).toEqual({ files: 1, additions: 1, deletions: 0 });
  expect(channelActions(p, URI).some((one) => one.type === 'chat/turnComplete')).toBe(false);
});

it('runs at most two summary reads for a burst of ten tool calls', async () => {
  const dir = repository();
  const { held, agent } = endable(dir);
  const base = gitChanges();
  const reads = { started: 0, finished: 0 };
  const changes: ChangesetSource = {
    ...base,
    sessionSummary: async (at, session, running) => {
      reads.started += 1;
      try {
        return await base.sessionSummary?.(at, session, running) ?? { files: 0, additions: 0, deletions: 0 };
      }
      finally {
        reads.finished += 1;
      }
    },
  };
  const { client } = await open(dir, changes, agent, dir);
  await waitFor(() => reads.finished >= 1);
  reads.started = 0;
  reads.finished = 0;

  for (let i = 0; i < 10; i++) {
    writeFileSync(join(dir, `t${String(i)}.txt`), 'x\n');
    held.emit?.('chat', { type: 'chat/toolCallComplete', turnId: 't1', toolCallId: `c${String(i)}`, result: {} });
  }
  await waitFor(() => reads.finished >= 2 && reads.finished === reads.started);
  // One read running and one waiting behind it, as `refreshWatched` does.
  expect(reads.started).toBeGreaterThan(1);
  expect(reads.started).toBeLessThanOrEqual(2);
});

it('sends no row for a tool call that changes nothing', async () => {
  const dir = repository();
  const { held, agent } = endable(dir);
  const base = gitChanges();
  const reads = { finished: 0 };
  const changes: ChangesetSource = {
    ...base,
    sessionSummary: async (at, session, running) => {
      try {
        return await base.sessionSummary?.(at, session, running) ?? { files: 0, additions: 0, deletions: 0 };
      }
      finally {
        reads.finished += 1;
      }
    },
  };
  const { client, peer: p } = await open(dir, changes, agent, dir);
  await waitFor(() => reads.finished >= 1);
  await settle(10);
  const before = rowsMoved(p, SESSION).length;
  const finishedBefore = reads.finished;

  held.emit?.('chat', { type: 'chat/toolCallComplete', turnId: 't1', toolCallId: 'c1', result: {} });
  // The read still runs; it is what it finds that says nothing new.
  await waitFor(() => reads.finished > finishedBefore);
  await settle(10);
  expect(rowsMoved(p, SESSION).length).toBe(before);
});
