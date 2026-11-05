/*
 * Merged sessions archive and delete themselves.
 *
 * A window pushes `autoArchiveMergedSessionsAfterDays` and
 * `autoDeleteArchivedMergedSessionsAfterDays`. An hourly pass archives an
 * inactive session whose related pull requests are merged, stores the time,
 * and later deletes a session it archived that way once its tree is gone.
 *
 * The clock is the host's `now` and `timer`: a case moves the clock by days
 * and fires the hourly pass by hand. GitHub is a fake port that records what
 * it was asked. The trees are real git, with a bare remote for a pushed
 * branch, because whether a branch is pushed is what git says.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { localPath, uriOf as fileUriOf } from '../src/resources/fileuri.js';
import { Status } from '../src/sessions/catalog.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { gitWorktrees } from '../src/repo/worktrees.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { PullRequest, PullRequests } from '../src/types/github.js';
import type { HostOptions } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';
import type { Worktrees } from '../src/types/worktrees.js';

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const DAY = 24 * 60 * 60_000;
const HOUR = 60 * 60_000;
const ARCHIVE = 'autoArchiveMergedSessionsAfterDays';
const DELETE = 'autoDeleteArchivedMergedSessionsAfterDays';
const PR1 = 'https://github.com/softov/ahpd/pull/1';
const PR2 = 'https://github.com/softov/ahpd/pull/2';

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-merged-'));
  made.push(dir);
  return dir;
};

/** A repository with one commit and a bare remote it can push to. */
const repository = (): { root: string; project: string } => {
  const root = temp();
  const project = join(root, 'project');
  const remote = join(root, 'remote.git');
  mkdirSync(project);
  execFileSync('git', ['init', '-q', '--bare', remote], { stdio: 'pipe' });
  const run = (...args: string[]) => execFileSync('git', ['-C', project, ...args], { stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(project, 'tracked.txt'), 'tracked\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  run('remote', 'add', 'origin', remote);
  run('push', '-q', '-u', 'origin', 'main');
  return { root, project };
};

const git = (dir: string, ...args: string[]): string => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString().trim();

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

const pause = (ms = 10): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/** A GitHub port whose answers a case sets, with every question on record. */
const github = (withUrl = true) => {
  const states = new Map<string, PullRequest['state']>();
  let branchAnswer: PullRequest[] = [];
  const asked: string[] = [];
  const port: PullRequests = {
    resource: { resource: 'https://api.github.com/repos', required: false },
    forBranch: async (_repo, branch) => {
      asked.push(`branch ${branch}`);
      return branchAnswer;
    },
    create: async () => { throw new Error('not here'); },
    ...(withUrl
      ? {
        byUrl: async (url: string) => {
          asked.push(`url ${url}`);
          const state = states.get(url);
          return state === undefined ? undefined : { url, state };
        },
      }
      : {}),
  };
  return {
    port,
    asked,
    states,
    branch: (answer: PullRequest[]) => { branchAnswer = answer; },
  };
};

/** Git facts for every folder, on one branch of `softov/ahpd`. */
const onBranch = (branch: string) => ({
  meta: () => ({ git: { branchName: branch, hasGitHubRemote: true, githubOwner: 'softov', githubRepo: 'ahpd' } }),
  refresh: async () => false,
});

interface Setup {
  dir?: string;
  agent?: Agent;
  worktrees?: Worktrees;
  port?: PullRequests;
  pullRequestLookup?: 'url' | 'branch';
  archiveDirtyWorktree?: 'keep' | 'commit';
  directories?: HostOptions['directories'];
  rootConfig?: HostOptions['rootConfig'];
}

/** A host on a fake clock, with two clients and the log on record. */
const hosting = async (setup: Setup = {}) => {
  const dir = setup.dir ?? temp();
  const lines: string[] = [];
  const store = memorySessions();
  let ahead = 0;
  const timers: { fire: () => void; ms: number; done: boolean }[] = [];
  const port = setup.port ?? github().port;
  const host = createHost({
    path: dir,
    agents: [setup.agent ?? echo({ path: dir, pace: 0 })],
    sessions: store,
    github: port,
    onEvent: (line) => { lines.push(line); },
    now: () => new Date(Date.now() + ahead),
    timer: (fire, ms) => {
      const one = { fire, ms, done: false };
      timers.push(one);
      return { cancel: () => { one.done = true; } };
    },
    ...(setup.worktrees === undefined ? {} : { worktrees: setup.worktrees }),
    ...(setup.pullRequestLookup === undefined ? {} : { pullRequestLookup: setup.pullRequestLookup }),
    ...(setup.archiveDirtyWorktree === undefined ? {} : { archiveDirtyWorktree: setup.archiveDirtyWorktree }),
    ...(setup.directories === undefined ? {} : { directories: setup.directories }),
    ...(setup.rootConfig === undefined ? {} : { rootConfig: setup.rootConfig }),
  });
  const first = peer();
  const second = peer();
  const client = host.accept(first);
  const other = host.accept(second);
  for (const one of [client, other]) {
    await one.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
  }

  /** Move the clock forward by days. */
  const days = (count: number): void => { ahead += count * DAY; };
  /** Fire the hourly pass, as an hour going by would. */
  const hour = (): void => {
    for (const one of timers.filter((t) => t.ms === HOUR && !t.done)) {
      one.done = true;
      one.fire();
    }
  };
  /** Push root config keys, as a window does. */
  const push = (config: Record<string, unknown>) => client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config } },
  });
  /** The number of log lines that hold `text`. */
  const count = (text: string): number => lines.filter((one) => one.includes(text)).length;
  /** Wait until `times` log lines hold `text`. */
  const logged = async (text: string, times = 1): Promise<void> => {
    for (let tries = 0; tries < 400; tries++) {
      if (count(text) >= times) return;
      await pause();
    }
    throw new Error(`never logged "${text}" ${times} times in:\n${lines.join('\n')}`);
  };
  /**
   * Open a session in the served folder, or in a tree of its own, and run its
   * first turn to its end: a session made fresh is provisional until its first
   * message, and a pass looks at the sessions this host has announced.
   */
  const open = async (name: string, config: Record<string, unknown> = {}, where = dir) => {
    const channel = `ahp-session:/${name}`;
    await client.handle({
      method: 'createSession',
      params: { channel, provider: 'echo', workingDirectories: [fileUriOf(where)], config },
    });
    await (await say(channel)).done;
    return channel;
  };
  /**
   * Start a turn on a session's default chat. `done` answers once the turn is
   * over, with the folder the session works in then: a worktree session's
   * tree is made at its first send.
   */
  const say = async (channel: string): Promise<{ chat: string; done: Promise<string> }> => {
    const state = async () => (await client.handle({ method: 'subscribe', params: { channel } }) as {
      snapshot: { state: { defaultChat: string; workingDirectories: string[] } };
    }).snapshot.state;
    const chat = (await state()).defaultChat;
    const turns = async (): Promise<number> => ((await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
      snapshot: { state: { turns: unknown[] } };
    }).snapshot.state.turns.length);
    const before = await turns();
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chat, clientSeq: 0, action: { type: 'chat/turnStarted', turnId: `t${before}`, startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } } },
    });
    const done = (async () => {
      for (let tries = 0; tries < 400 && await turns() === before; tries++) await pause();
      const where = localPath((await state()).workingDirectories[0] ?? '');
      await client.handle({ method: 'unsubscribe', params: { channel: chat } });
      await client.handle({ method: 'unsubscribe', params: { channel } });
      return where;
    })();
    return { chat, done };
  };
  /** Archive or unarchive a session, as a person does. */
  const archive = (channel: string, isArchived: boolean) => client.handle({
    method: 'dispatchAction',
    params: { channel, clientSeq: 0, action: { type: 'session/isArchivedChanged', isArchived } },
  });
  const idOf = (channel: string): string => channel.slice('ahp-session:/'.length);
  /** The session's own resource, which is how the log and the catalogue name it. */
  const uriOf = (channel: string): string => channel;
  const archived = (channel: string): boolean => (store.flags(idOf(channel)) & Status.IsArchived) !== 0;
  const stamped = (channel: string): string | undefined => store.autoArchivedAt?.(idOf(channel));
  /** Say which pull requests a session took over. */
  const owns = (channel: string, urls: string[], initial: string[] = []): void => {
    store.setPullRequests(idOf(channel), { initialPullRequestUrls: initial, associatedPullRequestUrls: urls });
  };
  const removed = (p: { notes: { method: string; params: unknown }[] }): string[] =>
    p.notes.filter((one) => one.method === 'root/sessionRemoved').map((one) => String((one.params as { session?: string }).session));
  return {
    client, store, lines, first, second, days, hour, push, count, logged, open, say, archive, archived, stamped, owns, removed, uriOf,
  };
};

describe('the archive of a merged session', () => {
  it('archives a merged session idle for 8 days with the key at 7, and stores the time', async () => {
    const pulls = github();
    const h = await hosting({ port: pulls.port });
    const one = await h.open('merged');
    h.owns(one, [PR1]);
    pulls.states.set(PR1, 'merged');
    h.days(8);
    await h.push({ [ARCHIVE]: 7 });
    await h.logged('merged sessions: looked at 1, archived 1');
    expect(h.archived(one)).toBe(true);
    const at = h.stamped(one);
    expect(at).toBeDefined();
    expect(Date.now() + 8 * DAY - Date.parse(at as string)).toBeLessThan(60_000);
    expect(h.count(`archived ${h.uriOf(one)}: its pull requests are merged (${PR1})`)).toBe(1);
  });

  it('keeps a session with an open pull request, or with none merged', async () => {
    const pulls = github();
    const h = await hosting({ port: pulls.port });
    const open = await h.open('open');
    const closed = await h.open('closed');
    h.owns(open, [PR1, PR2]);
    h.owns(closed, ['https://github.com/softov/ahpd/pull/3']);
    pulls.states.set(PR1, 'merged');
    pulls.states.set(PR2, 'open');
    pulls.states.set('https://github.com/softov/ahpd/pull/3', 'closed');
    h.days(8);
    await h.push({ [ARCHIVE]: 7 });
    await h.logged('merged sessions: looked at 2, archived 0');
    expect(h.archived(open)).toBe(false);
    expect(h.archived(closed)).toBe(false);
    expect(h.stamped(open)).toBeUndefined();
  });

  it('keeps a session idle for 6 days, and archives it once it is 8', async () => {
    const pulls = github();
    const h = await hosting({ port: pulls.port });
    const one = await h.open('recent');
    h.owns(one, [PR1]);
    pulls.states.set(PR1, 'merged');
    h.days(6);
    await h.push({ [ARCHIVE]: 7 });
    await pause(100);
    expect(pulls.asked).toEqual([]);
    expect(h.archived(one)).toBe(false);
    h.days(2);
    h.hour();
    await h.logged('merged sessions: looked at 1, archived 1');
    expect(h.archived(one)).toBe(true);
  });

  it('keeps a session while it runs a turn', async () => {
    const dir = temp();
    const pulls = github();
    const h = await hosting({ dir, port: pulls.port, agent: echo({ path: dir, pace: 100 }) });
    const one = await h.open('talking');
    h.owns(one, [PR1]);
    pulls.states.set(PR1, 'merged');
    h.days(8);
    const turn = await h.say(one);
    await h.push({ [ARCHIVE]: 7 });
    await pause(100);
    expect(pulls.asked).toEqual([]);
    expect(h.archived(one)).toBe(false);
    await turn.done;
    h.hour();
    await h.logged('merged sessions: looked at 1, archived 1');
    expect(h.archived(one)).toBe(true);
  });

  it('does not count a pull request the branch had before the session, unless the session took it over', async () => {
    const pulls = github();
    const h = await hosting({ port: pulls.port, pullRequestLookup: 'branch', directories: onBranch('feature') });
    const one = await h.open('baseline');
    h.owns(one, [], [PR1]);
    pulls.branch([{ url: PR1, state: 'merged' }]);
    h.days(8);
    await h.push({ [ARCHIVE]: 7 });
    await h.logged('merged sessions: looked at 1, archived 0');
    expect(h.archived(one)).toBe(false);
    h.owns(one, [PR1], []);
    h.hour();
    await h.logged('merged sessions: looked at 1, archived 1');
    expect(h.archived(one)).toBe(true);
  });

  it('takes 0, -1, 1.5 and a string as off', async () => {
    const pulls = github();
    const h = await hosting({ port: pulls.port });
    const one = await h.open('off');
    h.owns(one, [PR1]);
    pulls.states.set(PR1, 'merged');
    h.days(8);
    for (const value of [0, -1, 1.5, '7']) {
      await h.push({ [ARCHIVE]: value });
      h.hour();
      await pause(50);
    }
    expect(pulls.asked).toEqual([]);
    expect(h.archived(one)).toBe(false);
    await h.push({ [ARCHIVE]: 7 });
    await h.logged('merged sessions: looked at 1, archived 1');
  });

  it('archives nothing while no window has pushed the key', async () => {
    const pulls = github();
    const h = await hosting({ port: pulls.port });
    const one = await h.open('unsaid');
    h.owns(one, [PR1]);
    pulls.states.set(PR1, 'merged');
    h.days(8);
    h.hour();
    h.hour();
    await pause(100);
    expect(pulls.asked).toEqual([]);
    expect(h.archived(one)).toBe(false);
  });

  it('runs a pass as soon as the key is pushed', async () => {
    const pulls = github();
    const h = await hosting({ port: pulls.port });
    const one = await h.open('pushed');
    h.owns(one, [PR1]);
    pulls.states.set(PR1, 'merged');
    h.days(8);
    // No hour goes by: the push alone runs the pass.
    await h.push({ [ARCHIVE]: 7 });
    await h.logged('merged sessions: looked at 1, archived 1');
    expect(pulls.asked).toEqual([`url ${PR1}`]);
  });

  it('clears the stored time on unarchive', async () => {
    const pulls = github();
    const h = await hosting({ port: pulls.port });
    const one = await h.open('back');
    h.owns(one, [PR1]);
    pulls.states.set(PR1, 'merged');
    h.days(8);
    await h.push({ [ARCHIVE]: 7 });
    await h.logged('merged sessions: looked at 1, archived 1');
    expect(h.stamped(one)).toBeDefined();
    await h.archive(one, false);
    expect(h.archived(one)).toBe(false);
    expect(h.stamped(one)).toBeUndefined();
  });
});

describe('the tree of a session the host archived', () => {
  /** A merged session in a tree of its own, with one finished turn so it can sleep. */
  const treed = async (setup: Setup = {}) => {
    const { root, project } = repository();
    const pulls = github();
    const h = await hosting({ dir: root, agent: echo({ path: project, pace: 0 }), worktrees: gitWorktrees(), port: pulls.port, ...setup });
    const one = await h.open('treed', { isolation: 'worktree', branch: 'main' }, project);
    const where = await (await h.say(one)).done;
    h.owns(one, [PR1]);
    pulls.states.set(PR1, 'merged');
    const branch = git(where, 'rev-parse', '--abbrev-ref', 'HEAD');
    return { h, one, where, branch, project };
  };

  /** Archive it by the pass. */
  const pass = async (h: Awaited<ReturnType<typeof hosting>>): Promise<void> => {
    h.days(8);
    await h.push({ [ARCHIVE]: 7 });
    await h.logged('merged sessions: looked at 1, archived 1');
  };

  it('removes a clean tree whose branch is pushed, and keeps the branch', async () => {
    const { h, where, branch, project } = await treed();
    git(where, 'push', '-q', '-u', 'origin', branch);
    await pass(h);
    await h.logged(`removed ${where}`);
    expect(existsSync(where)).toBe(false);
    expect(git(project, 'branch', '--list', branch)).toContain(branch);
  });

  it('keeps a clean tree with commits nobody pushed', async () => {
    const { h, where, branch } = await treed();
    git(where, 'push', '-q', '-u', 'origin', branch);
    git(where, 'commit', '-q', '--allow-empty', '-m', 'not pushed');
    await pass(h);
    await h.logged(`kept ${where}: its branch has no upstream or has commits nobody pushed`);
    expect(existsSync(join(where, 'tracked.txt'))).toBe(true);
  });

  it('keeps a clean tree whose branch has no upstream', async () => {
    const { h, where } = await treed();
    await pass(h);
    await h.logged(`kept ${where}: its branch has no upstream or has commits nobody pushed`);
    expect(existsSync(join(where, 'tracked.txt'))).toBe(true);
  });

  it('keeps a dirty tree under commit, and commits nothing', async () => {
    const { h, where, branch } = await treed({ archiveDirtyWorktree: 'commit' });
    git(where, 'push', '-q', '-u', 'origin', branch);
    writeFileSync(join(where, 'unsaved.txt'), 'kept\n');
    const head = git(where, 'rev-parse', 'HEAD');
    await pass(h);
    await h.logged(`kept ${where}: it has changes nobody committed`);
    expect(existsSync(join(where, 'unsaved.txt'))).toBe(true);
    expect(git(where, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('keeps a session whose dirty tree stayed on disk, past the delete days', async () => {
    const { h, one, where } = await treed();
    writeFileSync(join(where, 'unsaved.txt'), 'kept\n');
    await pass(h);
    await h.logged(`kept ${where}: it has changes nobody committed`);
    h.days(31);
    await h.push({ [DELETE]: 30 });
    await h.logged('merged sessions: looked at 1, archived 0, deleted 0');
    expect(h.removed(h.first)).toEqual([]);
    expect(h.archived(one)).toBe(true);
  });
});

describe('the delete of a session the host archived', () => {
  /** A merged session the pass archived. */
  const archivedByPass = async () => {
    const pulls = github();
    const h = await hosting({ port: pulls.port });
    const one = await h.open('done');
    h.owns(one, [PR1]);
    pulls.states.set(PR1, 'merged');
    h.days(8);
    await h.push({ [ARCHIVE]: 7 });
    await h.logged('merged sessions: looked at 1, archived 1');
    return { h, one, pulls };
  };

  it('deletes it 31 days later with the key at 30, and every client is told', async () => {
    const { h, one } = await archivedByPass();
    h.days(29);
    await h.push({ [DELETE]: 30 });
    await pause(100);
    expect(h.removed(h.first)).toEqual([]);
    h.days(2);
    h.hour();
    await h.logged('merged sessions: looked at 1, archived 0, deleted 1');
    expect(h.removed(h.first)).toEqual([h.uriOf(one)]);
    expect(h.removed(h.second)).toEqual([h.uriOf(one)]);
    expect(h.count(`deleted ${h.uriOf(one)}: archived at`)).toBe(1);
  });

  it('keeps a session of the same age that a person archived', async () => {
    const pulls = github();
    const h = await hosting({ port: pulls.port });
    const one = await h.open('by-hand');
    h.owns(one, [PR1]);
    pulls.states.set(PR1, 'merged');
    await h.archive(one, true);
    h.days(40);
    await h.push({ [ARCHIVE]: 7, [DELETE]: 30 });
    h.hour();
    await pause(100);
    expect(pulls.asked).toEqual([]);
    expect(h.removed(h.first)).toEqual([]);
    expect(h.archived(one)).toBe(true);
  });

  it('keeps a session a person unarchived and archived again', async () => {
    const { h, one, pulls } = await archivedByPass();
    await h.archive(one, false);
    await h.archive(one, true);
    expect(h.stamped(one)).toBeUndefined();
    const before = pulls.asked.length;
    h.days(31);
    await h.push({ [DELETE]: 30 });
    h.hour();
    await pause(100);
    expect(pulls.asked.length).toBe(before);
    expect(h.removed(h.first)).toEqual([]);
  });

  it('deletes nothing with the delete key at 0', async () => {
    const { h, one, pulls } = await archivedByPass();
    const before = pulls.asked.length;
    h.days(60);
    await h.push({ [DELETE]: 0 });
    h.hour();
    await pause(100);
    expect(pulls.asked.length).toBe(before);
    expect(h.removed(h.first)).toEqual([]);
    expect(h.archived(one)).toBe(true);
  });
});

describe('how the pass looks a pull request up', () => {
  it('asks byUrl for each related URL under url, and archives when each is merged', async () => {
    const pulls = github();
    const h = await hosting({ port: pulls.port });
    const one = await h.open('by-url');
    h.owns(one, [PR1, PR2]);
    pulls.states.set(PR1, 'merged');
    pulls.states.set(PR2, 'merged');
    h.days(8);
    await h.push({ [ARCHIVE]: 7 });
    await h.logged('merged sessions: looked at 1, archived 1');
    expect(pulls.asked).toEqual([`url ${PR1}`, `url ${PR2}`]);
  });

  /*
   * VS Code's lifecycle reads a related pull request it cannot resolve as one
   * that keeps the session from being archived.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionLifecycle.ts#L229-L241
   */
  it('keeps a session one of whose related pull requests GitHub answers nothing for', async () => {
    const pulls = github();
    const h = await hosting({ port: pulls.port });
    const one = await h.open('unresolved');
    h.owns(one, [PR1, PR2]);
    pulls.states.set(PR1, 'merged');
    h.days(8);
    await h.push({ [ARCHIVE]: 7 });
    await h.logged('merged sessions: looked at 1, archived 0');
    expect(h.archived(one)).toBe(false);
  });

  it('asks forBranch under branch, and archives when the related ones are merged', async () => {
    const pulls = github();
    const h = await hosting({ port: pulls.port, pullRequestLookup: 'branch', directories: onBranch('feature') });
    const one = await h.open('by-branch');
    h.owns(one, []);
    pulls.branch([{ url: PR1, state: 'merged' }]);
    pulls.asked.length = 0;
    h.days(8);
    await h.push({ [ARCHIVE]: 7 });
    await h.logged('merged sessions: looked at 1, archived 1');
    expect(pulls.asked).toContain('branch feature');
    expect(pulls.asked.some((one) => one.startsWith('url '))).toBe(false);
  });

  it('asks a port with no byUrl by branch under url, and says so once', async () => {
    const pulls = github(false);
    const h = await hosting({ port: pulls.port, directories: onBranch('feature') });
    const one = await h.open('no-url-1');
    const two = await h.open('no-url-2');
    h.owns(one, []);
    h.owns(two, []);
    pulls.branch([{ url: PR1, state: 'open' }]);
    h.days(8);
    await h.push({ [ARCHIVE]: 7 });
    await h.logged('merged sessions: looked at 2, archived 0');
    h.hour();
    await h.logged('merged sessions: looked at 2, archived 0', 2);
    expect(pulls.asked).toContain('branch feature');
    expect(h.count('the GitHub port cannot look a pull request up by its URL')).toBe(1);
  });

  it('takes a push of pullRequestLookup at the next pass', async () => {
    // A daemon that holds the one key, so what it holds is what the push left.
    const held: Record<string, unknown> = {};
    const rootConfig: NonNullable<HostOptions['rootConfig']> = {
      schema: () => ({
        type: 'object',
        properties: { pullRequestLookup: { type: 'string', enum: ['url', 'branch'], title: 'Pull request lookup' } },
      }),
      values: async () => ({ ...held }),
      write: async (values) => { Object.assign(held, values); return {}; },
    };
    const pulls = github();
    const h = await hosting({ port: pulls.port, directories: onBranch('feature'), rootConfig });
    const one = await h.open('switched');
    h.owns(one, [PR1]);
    pulls.states.set(PR1, 'open');
    pulls.branch([{ url: PR1, state: 'merged' }]);
    h.days(8);
    await h.push({ [ARCHIVE]: 7 });
    await h.logged('merged sessions: looked at 1, archived 0');
    expect(pulls.asked).toContain(`url ${PR1}`);
    await h.push({ pullRequestLookup: 'branch' });
    expect(held.pullRequestLookup).toBe('branch');
    await pause(50);
    pulls.asked.length = 0;
    h.hour();
    await h.logged('merged sessions: looked at 1, archived 1');
    expect(pulls.asked).toContain('branch feature');
    expect(pulls.asked.some((line) => line.startsWith('url '))).toBe(false);
  });
});
