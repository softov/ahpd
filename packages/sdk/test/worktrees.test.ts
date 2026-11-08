import { WAIT_MS } from '../../../tools/wait.ts';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync, existsSync, lstatSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHost as openHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import { gitWorktrees, worktreesOf } from '../src/repo/worktrees.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { fileResources } from '../src/resources/resources.js';
import { localPath, uriOf } from '../src/resources/fileuri.js';
import type { Peer } from '../src/types/rpc.js';
import type { ComputerPort, MachineSource } from '../src/types/computers.js';
import type { GitDir, Worktrees } from '../src/types/worktrees.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { HostOptions } from '../src/types/host.js';

/*
 * A working tree of a session's own.
 *
 * Against a real repository rather than a scripted port, because the whole
 * question is what `git worktree` does: whether the branch is the session's,
 * whether the files a checkout leaves behind arrive, and whether a tree with
 * somebody's uncommitted work in it survives the session that made it. None of
 * that is answerable against a fake that says yes.
 */

let made: string[] = [];

/*
 * Every host a case made, closed after it and before its folders go. A host
 * left open kept its sessions, their git and their watchers for the rest of
 * the file, so each case ran beside every one before it - and a folder one of
 * them was still working in was one Windows would not remove.
 */
const hosts: ReturnType<typeof openHost>[] = [];
const createHost = (options: HostOptions): ReturnType<typeof openHost> => {
  const host = openHost(options);
  hosts.push(host);
  return host;
};

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  // Awaited, with retries: on Windows a git a case started can hold a folder
  // for a moment after the case is over.
  for (const dir of made) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  made = [];
});

/** A repository with one commit, a branch, and files git was told to ignore. */
function repository(): string {
  // Two levels, so the `<repo>.worktrees` sibling is inside the served root
  // rather than beside it - which is the arrangement a host has to serve.
  const root = mkdtempSync(join(tmpdir(), 'ahpd-wt-'));
  made.push(root);
  const dir = join(root, 'project');
  mkdirSync(dir);
  const run = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(dir, 'tracked.txt'), 'tracked\n');
  writeFileSync(join(dir, '.gitignore'), '.env\nnode_modules/\n');
  writeFileSync(join(dir, '.env'), 'SECRET=1\n');
  // An ignored folder with something in it, which is what a link has to reach
  // and what a shallow copy of a directory would be measured against.
  mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'dep', 'index.js'), 'installed\n');
  // The same folder name at a depth, which is what makes `node_modules/` in a
  // `.gitignore` mean every directory of that name rather than the one at the
  // root.
  mkdirSync(join(dir, 'packages', 'app', 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(dir, 'packages', 'app', 'node_modules', 'dep', 'index.js'), 'installed\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  run('branch', 'release');
  return root;
}

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

const serving = (root: string, worktrees: Worktrees = gitWorktrees()) => createHost({
  path: root,
  agents: [echo({ path: join(root, 'project'), pace: 0 })],
  worktrees,
});

/**
 * The git port, with its dirty check and its removals on record.
 *
 * Disposal checks a tree and removes it without being awaited, so a test that
 * expects a tree to be kept waits for the check's answer and then asserts no
 * removal followed, instead of sleeping and hoping the host had decided.
 */
const observed = () => {
  const base = gitWorktrees();
  const checks: Promise<boolean>[] = [];
  const removed: string[] = [];
  const port: Worktrees = {
    ...base,
    dirty: (path, linked) => { const answer = base.dirty(path, linked); checks.push(answer); return answer; },
    remove: (repository, path, branch, linked) => { removed.push(path); return base.remove(repository, path, branch, linked); },
  };
  // Every check answered, and whatever the host did next with the answer run.
  const settled = async (): Promise<void> => {
    await Promise.allSettled(checks);
    await new Promise((r) => { setImmediate(r); });
  };
  return { port, removed, settled };
};

const joined = async (root: string, worktrees?: Worktrees) => {
  const held = serving(root, worktrees);
  const p = peer();
  const client = held.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  return { host: held, client, peer: p };
};

const project = (root: string) => join(root, 'project');

/** The branch checked out in a working tree. */
const branchOf = (where: string) => execFileSync('git', ['-C', where, 'rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();

/**
 * Wait until git has finished taking a session's tree away: the repository
 * lists only itself and the session's branch is gone.
 *
 * Disposal removes the tree and then deletes the branch without being
 * awaited, and both write `.git` after the tree's folder is gone, so a test
 * that stops at the folder leaves `afterEach` removing a repository git is
 * still writing. A probe that fails counts as not yet: git reading
 * `.git/worktrees` while another git is removing an entry from it can fail.
 */
const cleared = async (repository: string, branch: string): Promise<void> => {
  const finished = (): boolean => {
    try {
      const trees = execFileSync('git', ['-C', repository, 'worktree', 'list', '--porcelain'], { stdio: 'pipe' })
        .toString().split('\n').filter((line) => line.startsWith('worktree ')).length;
      const left = execFileSync('git', ['-C', repository, 'branch', '--list', branch], { stdio: 'pipe' }).toString().trim();
      return trees === 1 && left === '';
    } catch {
      return false;
    }
  };
  const limit = Date.now() + 4_000;
  while (!finished()) {
    if (Date.now() > limit) throw new Error(`git never finished removing the worktree on ${branch} in ${repository}`);
    await new Promise((r) => { setTimeout(r, 25); });
  }
};

/** Read the session back until it says what the test is waiting for. */
type Held = { config: { values: Record<string, string> }; workingDirectories?: string[] };
const until = async (
  client: Awaited<ReturnType<typeof joined>>['client'],
  uri: string,
  done: (state: Held) => boolean,
): Promise<Held> => {
  for (let tries = 0; tries < 100; tries++) {
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: Held };
    }).snapshot.state;
    if (done(state)) return state;
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
  throw new Error(`${uri} never got there`);
};

/** Start a turn on a chat and wait until it has finished. */
const say = async (client: Awaited<ReturnType<typeof joined>>['client'], chat: string, turnId: string): Promise<void> => {
  const turns = async (): Promise<number> => ((await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
    snapshot: { state: { turns: unknown[]; activeTurn?: unknown } };
  }).snapshot.state.turns.length);
  const before = await turns();
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chat, clientSeq: 0, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } } },
  });
  /*
   * By the clock, and a failure when it runs out: two hundred 10 ms ticks
   * were three seconds on Windows, and a first turn that makes the worktree
   * took longer on a busy runner, so the case went on to read the folder the
   * session had not yet left.
   */
  for (const until = Date.now() + WAIT_MS; Date.now() < until && await turns() === before;) await new Promise((r) => { setTimeout(r, 10); });
  if (await turns() === before) throw new Error(`turn ${turnId} on ${chat} did not end within ${WAIT_MS} ms`);
  await client.handle({ method: 'unsubscribe', params: { channel: chat } });
};

/** A session's first send, which makes a worktree session's tree, finished. */
const firstSent = async (client: Awaited<ReturnType<typeof joined>>['client'], uri: string): Promise<void> => {
  const { defaultChat } = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  }).snapshot.state;
  await say(client, defaultChat, 'first');
};

/**
 * A session's tree and its default chat, after one finished turn and with
 * nobody watching either: the state a session has to be in to sleep.
 */
const spoken = async (
  client: Awaited<ReturnType<typeof joined>>['client'],
  uri: string,
): Promise<{ where: string; chat: string }> => {
  const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  }).snapshot.state;
  // Read after the turn: a worktree session's tree is made at its first send.
  await say(client, state.defaultChat, 't1');
  const after = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { workingDirectories: string[] } };
  }).snapshot.state;
  const where = localPath(after.workingDirectories[0] ?? '');
  await client.handle({ method: 'unsubscribe', params: { channel: uri } });
  return { where, chat: state.defaultChat };
};

describe('a session with a working tree of its own', () => {
  it('offers a worktree only where there is a repository to make one in, and a folder alone elsewhere, as VS Code\'s host', async () => {
    const root = repository();
    const { client } = await joined(root);
    const offered = await client.handle({
      method: 'resolveSessionConfig',
      params: { channel: 'ahp-root://', provider: 'echo', workingDirectories: [uriOf(project(root))] },
    }) as { schema: { properties: Record<string, { enum?: string[] }> }; values: Record<string, string> };
    expect(offered.schema.properties.isolation?.enum).toEqual(['folder', 'worktree']);
    // One seed, the branch it is on: `release` was made after `main` and sorts
    // above it by commit date, but `main` is checked out. The rest are asked
    // for as they are typed.
    expect(offered.schema.properties.branch?.enum).toEqual(['main']);
    expect(offered.values.branch).toBe('main');
    // `folder`, because every session this daemon has run has been one, and a
    // default that moved them all would be changing where an agent works
    // without being asked.
    expect(offered.values.isolation).toBe('folder');

    const plain = mkdtempSync(join(tmpdir(), 'ahpd-plain-'));
    made.push(plain);
    const bare = await joined(plain);
    const nothing = await bare.client.handle({
      method: 'resolveSessionConfig',
      params: { channel: 'ahp-root://', provider: 'echo', workingDirectories: [uriOf(plain)] },
    }) as { schema: { properties?: Record<string, unknown> } };
    // Not a repository: a folder is all there is, and the row says so read-only.
    // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts#L979-L1003
    expect(nothing.schema.properties?.isolation).toMatchObject({ enum: ['folder'], default: 'folder', readOnly: true });
    expect(nothing.schema.properties?.branch).toBeUndefined();
  });

  /*
   * A key this host owns is taken only in its property's shape: isolation only
   * as its offer allows, the branch as a string, and the pattern keys only as
   * lists of strings, as VS Code's host validates its own keys; anything else
   * leaves the default.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts#L1016-L1018
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L11037-L11055
   */
  it('takes a key it owns only in its property\'s shape, and the default for anything else, as VS Code\'s host', async () => {
    const root = repository();
    const { client } = await joined(root);
    const odd = { isolation: 'elsewhere', branch: ['main'], worktreeIncludeFiles: '.env', worktreeSymlinkFolders: ['node_modules', 7] };
    const offered = await client.handle({
      method: 'resolveSessionConfig',
      params: { channel: 'ahp-root://', provider: 'echo', workingDirectories: [uriOf(project(root))], config: odd },
    }) as { values: Record<string, unknown> };
    expect(offered.values).toMatchObject({ isolation: 'folder', branch: 'main', worktreeIncludeFiles: [], worktreeSymlinkFolders: [] });

    const uri = 'ahp-session:/shaped';
    await client.handle({
      method: 'createSession',
      params: { channel: uri, provider: 'echo', workingDirectories: [uriOf(project(root))], config: odd },
    });
    const created = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { config?: { values: Record<string, unknown> } } };
    }).snapshot.state;
    expect(created.config?.values).toMatchObject({ isolation: 'folder', branch: 'main', worktreeIncludeFiles: [], worktreeSymlinkFolders: [] });
  });

  /*
   * The tree is made at the first send, as VS Code's host resolves a session's
   * worktree on the first send: until then the session reports the folder the
   * client picked.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2195-L2201
   */
  it('makes a worktree on a branch of its own at the first send, and runs the session there', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/isolated';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri,
        provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main' },
      },
    });
    const picked = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[]; defaultChat: string } };
    }).snapshot.state;
    expect(picked.workingDirectories.map(localPath)).toEqual([project(root)]);
    expect(existsSync(worktreesOf(project(root)))).toBe(false);

    await say(client, picked.defaultChat, 't1');
    const state = await until(client, uri, (held) => (held.workingDirectories ?? []).some((one) => localPath(one).startsWith(worktreesOf(project(root)))));
    const where = localPath(state.workingDirectories?.[0] ?? '');
    expect(where.startsWith(worktreesOf(project(root)))).toBe(true);
    expect(existsSync(join(where, 'tracked.txt'))).toBe(true);

    // Its own branch, which is what stops two sessions committing over each
    // other. `--no-track`, so a push inside it does not go at `main`.
    const said = execFileSync('git', ['-C', where, 'rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
    expect(said).toMatch(/^agents\//);
  });

  /*
   * A folder outside a repository is offered folder isolation alone, and a
   * worktree asked for there is not a value that offer takes, so the session
   * works in the folder, as VS Code's host resolves a created session's
   * isolation against the folder's offer and its first send reads that.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts#L1009-L1018
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L1976-L1980
   */
  it('makes a folder session of one asked for a worktree in a folder with no repository, as VS Code\'s host', async () => {
    const root = repository();
    const plain = join(root, 'plain');
    mkdirSync(plain);
    const { client, peer: p } = await joined(root);
    const uri = 'ahp-session:/plain';
    expect(await client.handle({
      method: 'createSession',
      params: { channel: uri, provider: 'echo', workingDirectories: [uriOf(plain)], config: { isolation: 'worktree' } },
    })).toBeNull();
    const { defaultChat, config } = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string; config: { values: Record<string, unknown> } } };
    }).snapshot.state;
    expect(config.values.isolation).toBe('folder');
    await say(client, defaultChat, 't1');
    const types = p.notes.map((one) => (one.params as { action?: { type?: string } }).action?.type);
    expect(types).not.toContain('chat/error');
    expect(types).toContain('session/ready');
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    expect(state.workingDirectories.map(localPath)).toEqual([plain]);
  });

  it('fails a session whose first send could not make its worktree, and announces it after', async () => {
    const root = repository();
    const { client, peer: p } = await joined(root);
    const uri = 'ahp-session:/unmade';
    // A branch is taken as any string, as VS Code's host takes it, so one the
    // repository does not have is found out when the tree is cut.
    expect(await client.handle({
      method: 'createSession',
      params: { channel: uri, provider: 'echo', workingDirectories: [uriOf(project(root))], config: { isolation: 'worktree', branch: 'no-such-branch' } },
    })).toBeNull();
    const { defaultChat } = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state;
    // The list, which hears a session announced.
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } });
    await say(client, defaultChat, 't1');
    const failed = p.notes
      .map((one) => one.params as { channel?: string; action?: { type?: string; part?: unknown } })
      .find((one) => one.channel === defaultChat && one.action?.type === 'chat/error');
    expect(failed?.action?.part).toMatchObject({ error: { errorType: 'sendFailed', message: expect.stringContaining('no-such-branch') } });
    /*
     * The session, still being created, fails its creation after the turn's
     * error and is then announced, as VS Code's host fails a session whose
     * first send could not make its worktree.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2446-L2480
     */
    const order = p.notes.flatMap((one) => {
      if (one.method === 'root/sessionAdded') return ['root/sessionAdded'];
      const type = (one.params as { action?: { type?: string } }).action?.type;
      return type === 'chat/error' || type === 'session/ready' || type === 'session/creationFailed' ? [type] : [];
    });
    expect(order).toEqual(['chat/error', 'session/creationFailed', 'root/sessionAdded']);
  });

  it('puts every session tree under the root the host was given', async () => {
    const root = repository();
    // Somewhere else entirely, which is the arrangement the root exists for: a
    // machine with many repositories gets one folder of trees rather than a
    // `<repo>.worktrees` beside each of them.
    const under = mkdtempSync(join(tmpdir(), 'ahpd-worktrees-'));
    made.push(under);
    const held = createHost({
      path: root,
      agents: [echo({ path: join(root, 'project'), pace: 0 })],
      worktrees: gitWorktrees(),
      worktreesRoot: under,
    });
    const client = held.accept(peer());
    await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
    const uri = 'ahp-session:/rooted';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main' },
      },
    });
    await firstSent(client, uri);
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    const where = localPath(state.workingDirectories[0] ?? '');
    // `<root>/<repo>/<name>`, `<repo>` the repository folder's own name.
    expect(where).toBe(join(under, 'project', 'rooted'));
    // A tree of the repository and not a folder beside it: git is the one that
    // knows, and the session runs in what it made.
    expect(existsSync(join(where, 'tracked.txt'))).toBe(true);
    // git lists a Windows path with forward slashes.
    expect(execFileSync('git', ['-C', project(root), 'worktree', 'list']).toString()).toContain(where.replaceAll('\\', '/'));
  });

  it('brings along the files a checkout leaves behind', async () => {
    const root = repository();
    const { client } = await joined(root);
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/carried',
        provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main', worktreeIncludeFiles: ['.env'] },
      },
    });
    await firstSent(client, 'ahp-session:/carried');
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/carried' } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    const where = localPath(state.workingDirectories[0] ?? '');
    // In the worktree and not in the project it came from, which is the whole
    // assertion: the original has a `.env` already.
    expect(where.startsWith(worktreesOf(project(root)))).toBe(true);
    // Without this the isolation works and the session inside it cannot run
    // anything - a failure the person meets after choosing it.
    expect(readFileSync(join(where, '.env'), 'utf8')).toBe('SECRET=1\n');
  });

  it('reads a session stored with the old spelling back as the list it names', async () => {
    const root = repository();
    const store = memorySessions();
    /*
     * The same agent across two hosts, which is what a restart looks like from
     * here: the backend still lists the session it ran, and the store still
     * holds what the host wrote when it ran.
     *
     * Publishing the key as a list is what the reference backend does, and it
     * is what puts the check in front of the stored value at all: a key no
     * property declares is handed back as stored, so a schema that stayed
     * silent would answer this test without any of it happening.
     */
    const agent = { ...echo({ path: join(root, 'project'), pace: 0 }), schema: () => ({ properties: { worktreeIncludeFiles: { type: 'array' } } }) };
    const first = createHost({ path: root, agents: [agent], worktrees: gitWorktrees(), sessions: store });
    const a = first.accept(peer());
    await a.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
    const uri = 'ahp-session:/stored';
    await a.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main', worktreeIncludeFiles: ['.env'] },
      },
    });
    const live = (await a.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state;
    // One turn through, which is what puts the session in the catalogue: a
    // session nothing ever said to was never run and never had anything
    // written down about it.
    a.handle({
      method: 'dispatchAction',
      params: { channel: live.defaultChat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' } } },
    });
    // Listed once the turn has run, which waits on git making the worktree: slow on Windows.
    let rows: { items: { resource: string }[] } = { items: [] };
    for (const until = Date.now() + 10_000; rows.items.length === 0 && Date.now() < until;) {
      await new Promise((resolve) => { setTimeout(resolve, 60); });
      rows = await a.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as typeof rows;
    }
    const id = rows.items[0]?.resource.replace('ahp-session:/', '') ?? '';

    // What a host that declared the key a string would have written, which is
    // what is on disk now that this host declares it a list.
    store.setConfig(id, { worktreeIncludeFiles: '.env, .env.local' });

    const second = createHost({ path: root, agents: [agent], worktrees: gitWorktrees(), sessions: store });
    const b = second.accept(peer());
    await b.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
    await b.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    const state = (await b.handle({ method: 'subscribe', params: { channel: `echo:/${id}` } }) as {
      snapshot: { state: { config: { values: Record<string, unknown> } } };
    }).snapshot.state;
    /*
     * Read as the list it spells, rather than refused by an array-typed
     * property and replaced with the default - which is none, so the session
     * would silently arrive at a worktree with nothing brought along.
     */
    expect(state.config.values.worktreeIncludeFiles).toEqual(['.env', '.env.local']);
  });

  /*
   * A chat started over is handed its backend's own keys, as every other start
   * is: the window sends its whole bag back, this host's isolation among it,
   * and that key is this host's and goes to no backend.
   */
  it('starts a chat over on its backend\'s own keys, the ones this host owns left out', async () => {
    const root = repository();
    const starts: Start[] = [];
    const base = echo({ path: join(root, 'project'), pace: 0 });
    const agent: Agent = {
      ...base,
      create: (start: Start) => { starts.push(start); return base.create(start); },
      delete: async () => {},
    };
    const host = createHost({ path: root, agents: [agent], worktrees: gitWorktrees() });
    const p = peer();
    const client = host.accept(p);
    await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
    const uri = 'ahp-session:/over';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', workingDirectories: [uriOf(project(root))] } });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    await client.handle({ method: 'dispatchAction', params: { channel: uri, action: { type: 'session/configChanged', config: { isolation: 'folder' } } } });
    await vi.waitFor(() => {
      const said = p.notes.map((one) => one.params as { action?: { type?: string }; rejectionReason?: string })
        .find((one) => one.action?.type === 'session/configChanged');
      expect(said).toBeDefined();
      expect(said?.rejectionReason).toBeUndefined();
    });
    await firstSent(client, uri);
    const { defaultChat } = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state;
    const before = starts.length;
    void client.handle({ method: 'dispatchAction', params: { channel: defaultChat, action: { type: 'chat/truncated' } } });
    await vi.waitFor(() => { expect(starts.length).toBeGreaterThan(before); });
    expect(starts.at(-1)?.settings).toMatchObject({ voice: 'plain' });
    expect(starts.at(-1)?.settings).not.toHaveProperty('isolation');
  });

  /*
   * A session read back after a restart has its config resolved as a created
   * one's, against the folder its choice was made in: the rows are what that
   * folder is offered, and the values are its own, as VS Code's host resolves
   * a restored session's config with the call that resolved its created one.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L14877-L14911
   */
  describe('read back after a restart', () => {
    /** A session made and spoken to on one host, and the same session subscribed on a second host over the same store. */
    const restored = async (root: string, folder: string, config: Record<string, unknown>) => {
      const store = memorySessions();
      const agent = echo({ path: join(root, 'project'), pace: 0 });
      const first = createHost({ path: root, agents: [agent], worktrees: gitWorktrees(), sessions: store });
      const a = first.accept(peer());
      await a.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
      await a.handle({
        method: 'createSession',
        params: { channel: 'ahp-session:/again', provider: 'echo', workingDirectories: [uriOf(folder)], config },
      });
      await firstSent(a, 'ahp-session:/again');
      const rows = await a.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
        items: { resource: string }[];
      };
      const id = rows.items[0]?.resource.replace('ahp-session:/', '') ?? '';
      const second = createHost({ path: root, agents: [agent], worktrees: gitWorktrees(), sessions: store });
      const b = second.accept(peer());
      await b.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
      await b.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
      return (await b.handle({ method: 'subscribe', params: { channel: `echo:/${id}` } }) as {
        snapshot: { state: { config: { schema: { properties: Record<string, { enum?: string[]; readOnly?: boolean }> }; values: Record<string, unknown> } } };
      }).snapshot.state.config;
    };

    it('offers a worktree session its repository\'s isolation and branch, and says it is in a worktree', async () => {
      const root = repository();
      const config = await restored(root, project(root), { isolation: 'worktree', branch: 'main' });
      expect(config.schema.properties.isolation?.enum).toEqual(['folder', 'worktree']);
      expect(config.schema.properties.branch?.enum).toEqual(['main']);
      expect(config.values).toMatchObject({ isolation: 'worktree', branch: 'main' });
    });

    it('offers a session in a folder with no repository the folder alone', async () => {
      const root = repository();
      const plain = join(root, 'plain');
      mkdirSync(plain);
      const config = await restored(root, plain, {});
      expect(config.schema.properties.isolation).toMatchObject({ enum: ['folder'], readOnly: true });
      expect(config.values.isolation).toBe('folder');
    });
  });

  /*
   * A pattern list with an entry that is no pattern is not the property's
   * shape, so the default applies, which brings nothing along, and the
   * session still starts, as VS Code's host takes a pattern list only when
   * every entry is a string.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L11047-L11051
   */
  it('makes the worktree with the default patterns when the list holds anything but patterns, as VS Code\'s host', async () => {
    const root = repository();
    const { client } = await joined(root);
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/odd',
        provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main', worktreeIncludeFiles: ['.env', 7] },
      },
    });
    await firstSent(client, 'ahp-session:/odd');
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/odd' } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    const where = localPath(state.workingDirectories[0] ?? '');
    expect(where.startsWith(worktreesOf(project(root)))).toBe(true);
    expect(existsSync(join(where, 'tracked.txt'))).toBe(true);
    expect(existsSync(join(where, '.env'))).toBe(false);
  });

  it('links the ignored folders a tree is told to, rather than copying them', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/linked';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main', worktreeSymlinkFolders: ['node_modules'] },
      },
    });
    await firstSent(client, uri);
    const where = localPath((await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state.workingDirectories[0] ?? '');
    /*
     * A link, and not a copy.
     *
     * Copying `node_modules` is minutes and gigabytes for a tree that then has
     * its own dependencies drifting out of step with the checkout's; a link is
     * one directory the agent can build against at once.
     */
    expect(lstatSync(join(where, 'node_modules')).isSymbolicLink()).toBe(true);
    // Reading through it lands on the checkout's own file rather than on a
    // copy of it, which is the whole point and the whole cost.
    expect(readFileSync(join(where, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('installed\n');
    expect(readFileSync(join(project(root), 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('installed\n');
    // And the session is still running in it, which is what best effort buys.
    expect(existsSync(join(where, 'tracked.txt'))).toBe(true);
  });

  it('makes the tree anyway when a pattern names nothing, or something tracked', async () => {
    for (const pattern of ['nothing/here', 'tracked.txt']) {
      const root = repository();
      const { client } = await joined(root);
      const uri = `ahp-session:/refused-${pattern.replace(/\W/g, '')}`;
      await client.handle({
        method: 'createSession',
        params: {
          channel: uri, provider: 'echo',
          workingDirectories: [uriOf(project(root))],
          config: { isolation: 'worktree', branch: 'main', worktreeSymlinkFolders: [pattern] },
        },
      });
      await firstSent(client, uri);
      const where = localPath((await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { workingDirectories: string[] } };
      }).snapshot.state.workingDirectories[0] ?? '');
      expect(where.startsWith(worktreesOf(project(root)))).toBe(true);
      // Nothing linked, and the checkout's own file left where git put it: a
      // bad pattern is not a reason a session will not start.
      expect(existsSync(join(where, '.git'))).toBe(true);
      expect(readFileSync(join(where, 'tracked.txt'), 'utf8')).toBe('tracked\n');
      expect(existsSync(join(project(root), 'node_modules'))).toBe(true);
    }
  });

  it('links an ignored folder at any depth, which is what .gitignore syntax means', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/deep';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main', worktreeSymlinkFolders: ['node_modules'] },
      },
    });
    await firstSent(client, uri);
    const where = localPath((await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state.workingDirectories[0] ?? '');
    /*
     * Both, and this is why the patterns are matched by git rather than by the
     * shallow glob the include copy uses. `node_modules/` means every directory
     * of that name at any depth; a glob over one directory would have answered
     * for the root and stopped there, and the session would still fail to
     * build from the package below.
     */
    expect(lstatSync(join(where, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(where, 'packages', 'app', 'node_modules')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(where, 'packages', 'app', 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('installed\n');
  });

  it('drops a pattern reaching outside the repository and links the rest anyway', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/reaching';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main', worktreeSymlinkFolders: ['../elsewhere', 'node_modules'] },
      },
    });
    await firstSent(client, uri);
    const where = localPath((await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state.workingDirectories[0] ?? '');
    // One pattern a person should not have been able to send is not a reason to
    // refuse the one beside it, and not a reason the session will not start.
    expect(lstatSync(join(where, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(where, 'tracked.txt'))).toBe(true);
  });

  it('says on the session why its directory is where it is', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/readable';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main' },
      },
    });
    const config = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: {
        state: {
          config: {
            schema: { properties: Record<string, { readOnly?: boolean; sessionMutable?: boolean; enum?: string[] }> };
            values: Record<string, string>;
          };
        };
      };
    }).snapshot.state.config;
    // The host's keys never reach the backend, and the session channel reports
    // the backend's settings - so without this a worktree session said nothing
    // anywhere about why its directory was where it was.
    expect(config.values.isolation).toBe('worktree');
    expect(config.values.branch).toBe('main');
    /*
     * Offered, not merely reported.
     *
     * A client creates the backend session *before* the first message - the
     * controls need somewhere to write their answers - and draws them from
     * this schema. Marking the row `readOnly`, or leaving it without an
     * `enum`, is a control that cannot be opened, which made isolation
     * unsettable in exactly the phase it is meant to be settable in.
     * `sessionMutable: false` is what closes it afterwards.
     */
    expect(config.schema.properties.isolation?.readOnly).toBeUndefined();
    expect(config.schema.properties.isolation?.enum).toEqual(['folder', 'worktree']);
    expect(config.schema.properties.isolation?.sessionMutable).toBe(false);
    // And the backend's own keys are still there beside them.
    expect(Object.keys(config.schema.properties).length).toBeGreaterThan(2);
  });

  it('offers isolation and a branch on a session created with no config at all', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/unasked';
    // What the window's provisional session sends: `{ isolation: 'folder' }`
    // from an ordinary window, and nothing from the sessions window. It then
    // draws its isolation and branch chips from this session's schema - so a
    // host that echoed back only the keys it was sent drew no chips at all,
    // where the reference host resolves the whole config on creation.
    await client.handle({
      method: 'createSession',
      params: { channel: uri, provider: 'echo', workingDirectories: [uriOf(project(root))] },
    });
    const config = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: {
        state: {
          config: {
            schema: { properties: Record<string, { readOnly?: boolean; sessionMutable?: boolean; enum?: string[]; type?: string }> };
            values: Record<string, string>;
          };
        };
      };
    }).snapshot.state.config;
    expect(config.schema.properties.isolation?.enum).toEqual(['folder', 'worktree']);
    expect(config.schema.properties.branch?.enum).toContain('main');
    expect(config.schema.properties.worktreeIncludeFiles).toBeDefined();
    // A list, which is what 1.140 sends and what it reads back - and not
    // `readOnly`, which would be a control neither a client nor a person at
    // ahpc can open.
    expect(config.schema.properties.worktreeIncludeFiles?.type).toBe('array');
    expect(config.schema.properties.worktreeIncludeFiles?.readOnly).toBeUndefined();
    /*
     * The seventh of the host's own. `readOnly` here and not on the files above
     * because it carries a preference the client already holds rather than a
     * question for a person, which is the same reason the three branch rows are
     * `readOnly`. `sessionMutable: false` closes it once the session has begun,
     * because the links are made when the worktree is.
     */
    expect(config.schema.properties.worktreeSymlinkFolders?.type).toBe('array');
    expect(config.schema.properties.worktreeSymlinkFolders?.readOnly).toBe(true);
    expect(config.schema.properties.worktreeSymlinkFolders?.sessionMutable).toBe(false);
    expect(config.values.isolation).toBe('folder');
    expect(config.values.branch).toBe('main');
  });

  it('answers the branches a client types for, not the whole list', async () => {
    const root = repository();
    const run = (...args: string[]) => execFileSync('git', ['-C', project(root), ...args], { stdio: 'pipe' });
    run('branch', 'feature/parser');
    run('branch', 'feature/reducer');
    run('branch', 'chore/deps');
    const { client } = await joined(root);
    const found = await client.handle({
      method: 'sessionConfigCompletions',
      params: {
        channel: 'ahp-root://', provider: 'echo',
        workingDirectory: uriOf(project(root)),
        property: 'branch', query: 'feature',
      },
    }) as { items: { value: string; label: string }[] };
    /*
     * The one key here with more values than a picker holds.
     *
     * A repository with four hundred branches used to send four hundred, on
     * every resolve, to fill a list nobody can read. `enumDynamic` says the
     * schema carries seeds and this command answers what somebody types.
     */
    expect(found.items.map((one) => one.value).sort()).toEqual(['feature/parser', 'feature/reducer']);

    // Substring, not prefix: somebody looking for `feature/reducer` types
    // `reducer`, and a prefix match would answer nothing.
    const typed = await client.handle({
      method: 'sessionConfigCompletions',
      params: {
        channel: 'ahp-root://', provider: 'echo',
        workingDirectory: uriOf(project(root)),
        property: 'branch', query: 'reducer',
      },
    }) as { items: { value: string }[] };
    expect(typed.items.map((one) => one.value)).toEqual(['feature/reducer']);

    // And a key this host has no lookup for is answered, not refused: the
    // client asked what else there is and nothing else is an answer.
    const none = await client.handle({
      method: 'sessionConfigCompletions',
      params: { channel: 'ahp-root://', provider: 'echo', property: 'permissionMode' },
    }) as { items: unknown[] };
    expect(none.items).toEqual([]);
  });

  it('offers the branch as a choice for either isolation, a folder from the branch checked out and a worktree from the default branch, as VS Code\'s host', async () => {
    const root = repository();
    const run = (...args: string[]) => execFileSync('git', ['-C', project(root), ...args], { stdio: 'pipe' });
    // A remote whose `HEAD` is `main`, which `main` tracks, and `release`
    // checked out.
    run('clone', '-q', '--bare', project(root), join(root, 'remote.git'));
    run('remote', 'add', 'origin', join(root, 'remote.git'));
    run('fetch', '-q', 'origin');
    run('remote', 'set-head', 'origin', 'main');
    run('branch', '-q', '-u', 'origin/main', 'main');
    run('checkout', '-q', 'release');
    const { client } = await joined(root);
    const ask = async (isolation: string) => (await client.handle({
      method: 'resolveSessionConfig',
      params: {
        channel: 'ahp-root://', provider: 'echo',
        workingDirectory: uriOf(project(root)),
        config: { isolation },
      },
    }) as { schema: { properties: Record<string, { enum?: string[]; default?: string; enumDynamic?: boolean; readOnly?: boolean }> } }).schema.properties;

    // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts#L1035-L1063
    expect((await ask('folder')).branch).toMatchObject({ enum: ['release'], default: 'release', enumDynamic: true, readOnly: false });
    expect((await ask('worktree')).branch).toMatchObject({ enum: ['origin/main'], default: 'origin/main', enumDynamic: true, readOnly: false });
  });

  it('answers about the folder the question named, not the host\'s own', async () => {
    const root = repository();
    const { client } = await joined(root);
    /*
     * `workingDirectory`, singular.
     *
     * That is the field `resolveSessionConfig` declares - `createSession`
     * takes the plural and this command does not - and reading the plural
     * meant every answer was computed against the host's first served path.
     * VS Code sends the singular, its path is a repository and the host's root
     * is not, so the isolation control was absent for exactly the folder that
     * could have had one.
     */
    const answered = await client.handle({
      method: 'resolveSessionConfig',
      params: { channel: 'ahp-root://', provider: 'echo', workingDirectory: uriOf(project(root)) },
    }) as { schema: { properties: Record<string, { enum?: string[] }> } };
    expect(answered.schema.properties.isolation?.enum).toEqual(['folder', 'worktree']);
    expect(answered.schema.properties.branch?.enum).toContain('main');
  });

  it('moves a session nobody has spoken in yet into the tree it now asks for', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/pending';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'folder' },
      },
    });
    // The chat the host minted for the session, read off its state.
    const chat = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
    /*
     * The phase this exists for.
     *
     * A client creates the backend session before the first message is sent,
     * because its controls need somewhere to write the answers they collect.
     * Isolation is one of those answers, and a host that fixed it the moment
     * the session existed fixed it before anybody had been asked.
     */
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { isolation: 'worktree', branch: 'main' } } },
    });
    // The first message, which is the session's next turn boundary: the
    // answer is said as it arrives, and the session is started again in the
    // tree there, as VS Code relaunches a runtime at its next turn boundary.
    client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'go', origin: { kind: 'user' } } } },
    });
    // On the directory rather than the value: the answer is recorded as it
    // arrives and the tree is made after it, so a test that waited on the
    // value would be reading the config before the move it asked for.
    const state = await until(
      client,
      uri,
      (held) => (held.workingDirectories?.[0] ?? '') !== uriOf(project(root)),
    );
    expect(state.config.values.isolation).toBe('worktree');
    // In a tree of its own, beside the repository, and not in the repository.
    const where = state.workingDirectories?.[0] ?? '';
    expect(where.startsWith(uriOf(worktreesOf(project(root))))).toBe(true);
    expect(where).not.toBe(uriOf(project(root)));
  });

  it('does not start over for an answer it already has', async () => {
    const root = repository();
    const { client, peer: p } = await joined(root);
    const uri = 'ahp-session:/agreeing';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'folder' },
      },
    });
    // A client sending back the config it was given is agreeing, and a session
    // that disposed and reopened itself to arrive where it already was would
    // be churn a person watches happen.
    // Awaited rather than slept on: the refusal is a notification the handler
    // sends before it answers, so a settled call is the whole of what the
    // assertion needs and a fixed wait is a race under load.
    await client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { isolation: 'folder' } } },
    });
    const refused = p.notes
      .map((note) => (note.params as { rejectionReason?: string }).rejectionReason)
      .filter((reason): reason is string => typeof reason === 'string');
    expect(refused).toEqual([]);
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories?: string[] } };
    }).snapshot.state;
    expect(state.workingDirectories?.[0]).toBe(uriOf(project(root)));
  });

  it('refuses to move one that has already been spoken in', async () => {
    const root = repository();
    const { client, peer: p } = await joined(root);
    const uri = 'ahp-session:/spoken';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'folder' },
      },
    });
    const opened = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state;
    await client.handle({
      method: 'dispatchAction',
      params: { channel: opened.defaultChat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' } } },
    });
    await client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { isolation: 'worktree' } } },
    });
    // Said, rather than accepted and dropped: an agent whose files moved out
    // from under a conversation is the thing this refusal is protecting.
    // Both dispatches are awaited, so the refusal has already been sent when
    // the notes are read; a fixed wait here was a race under load.
    const refused = p.notes
      .map((note) => (note.params as { rejectionReason?: string }).rejectionReason)
      .filter((reason): reason is string => typeof reason === 'string');
    expect(refused.some((reason) => reason.includes('once the session has started'))).toBe(true);
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories?: string[] } };
    }).snapshot.state;
    expect(state.workingDirectories?.[0]).toBe(uriOf(project(root)));
  });

  it('puts a client\'s own prefix in front of the branch it makes', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/prefixed';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main', worktreeBranchPrefix: 'softov/' },
      },
    });
    await firstSent(client, uri);
    const where = localPath((await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state.workingDirectories[0] ?? '');
    // `agents/` is the built-in prefix and the client's goes in front of it,
    // so the branch sorts where the person's other tools expect it to.
    const on = execFileSync('git', ['-C', where, 'rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
    expect(on).toBe(`softov/agents/${'prefixed'.slice(0, 8)}`);
  });

  it('continues the chosen branch when asked not to make one', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/continued';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'release', worktreeCreateNewBranch: 'false' },
      },
    });
    await firstSent(client, uri);
    const where = localPath((await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state.workingDirectories[0] ?? '');
    // Isolated in a directory of its own, and on the branch that was picked
    // rather than one made for it.
    expect(where.startsWith(worktreesOf(project(root)))).toBe(true);
    const on = execFileSync('git', ['-C', where, 'rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
    expect(on).toBe('release');
  });

  it('leaves the folder alone when nobody asked for a worktree', async () => {
    const root = repository();
    const { client } = await joined(root);
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/plain',
        provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'folder' },
      },
    });
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/plain' } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    expect(state.workingDirectories[0]).toBe(uriOf(project(root)));
    expect(existsSync(worktreesOf(project(root)))).toBe(false);
  });

  it('takes a clean worktree away with the session', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/tidy';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main' },
      },
    });
    await firstSent(client, uri);
    const where = localPath((await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state.workingDirectories[0] ?? '');
    expect(existsSync(where)).toBe(true);
    const branch = branchOf(where);

    await client.handle({ method: 'disposeSession', params: { channel: uri } });
    await cleared(project(root), branch);
    expect(existsSync(where)).toBe(false);
  });

  it('keeps one with work in it, rather than deciding what the work was worth', async () => {
    const root = repository();
    const watched = observed();
    const { client } = await joined(root, watched.port);
    const uri = 'ahp-session:/busy';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main' },
      },
    });
    await firstSent(client, uri);
    const where = localPath((await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state.workingDirectories[0] ?? '');
    expect(where.startsWith(worktreesOf(project(root)))).toBe(true);
    // An afternoon's work nobody committed, which is the one thing here a
    // daemon cannot judge the value of.
    writeFileSync(join(where, 'unsaved.txt'), 'the whole point\n');

    await client.handle({ method: 'disposeSession', params: { channel: uri } });
    await watched.settled();
    expect(watched.removed).toEqual([]);
    expect(existsSync(join(where, 'unsaved.txt'))).toBe(true);
    // Still a worktree of the repository, so `git worktree list` finds it.
    const listed = execFileSync('git', ['-C', project(root), 'worktree', 'list']).toString();
    expect(listed).toContain(where.replaceAll('\\', '/'));
  });

  it('takes a clean worktree away with a session deleted after a restart', async () => {
    const root = repository();
    // One backend and one store for both hosts, because what a restart leaves
    // behind is the store and the transcripts rather than the process.
    const agent = echo({ path: project(root), pace: 0 });
    const store = memorySessions();
    const host = (): ReturnType<typeof createHost> => createHost({ path: root, agents: [agent], worktrees: gitWorktrees(), sessions: store });
    const first = host().accept(peer());
    await first.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
    const uri = 'ahp-session:/restarted';
    await first.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main' },
      },
    });
    const { where, chat } = await spoken(first, uri);
    const branch = branchOf(where);
    // The commit it was cut from, which is where this session's work counts
    // from: the record keeps it so the counts survive a restart too.
    const commit = execFileSync('git', ['-C', where, 'rev-parse', 'HEAD']).toString().trim();
    expect(store.worktree?.('restarted')).toEqual({ repository: project(root), path: where, base: 'main', branch, commit });

    // A second host over the same store knows the tree only from the record.
    const second = host().accept(peer());
    await second.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
    await second.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
    await say(second, chat, 't2');
    await second.handle({ method: 'disposeSession', params: { channel: uri } });
    await cleared(project(root), branch);
    expect(existsSync(where)).toBe(false);
    expect(store.worktree?.('restarted')).toBeUndefined();
  });

  it('isolates a session whose host serves only the project itself', async () => {
    const root = repository();
    // Worktrees sit beside their repository, outside `--path`. That was a
    // refusal while `--path` fenced what a client could read; now the
    // session's own files are readable wherever they land.
    const held = createHost({
      path: project(root),
      agents: [echo({ path: project(root), pace: 0 })],
      worktrees: gitWorktrees(),
      resources: fileResources(),
    });
    const client = held.accept(peer());
    await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/outside', provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main' },
      },
    });
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { workingDirectories: string[] }[];
    };
    const where = localPath(listed.items[0]?.workingDirectories[0] ?? '');
    expect(where).not.toBe(project(root));
    const seen = await client.handle({
      method: 'resourceList', params: { channel: 'ahp-root://', uri: uriOf(where) },
    }) as { entries: { name: string }[] };
    expect(seen.entries.map((e) => e.name)).toContain('.git');
  });
});

describe('an archived session\'s tree', () => {
  /*
   * Archive gives a clean tree back and keeps its branch; unarchive, or a
   * wake of the archived session, puts it back at the same path on the same
   * branch. Every case waits on the host's own log line for the step it is
   * about, since neither half is awaited by the action that started it.
   */
  const archiving = async (
    root: string,
    options: {
      worktrees?: Worktrees; agent?: Agent; archiveDirtyWorktree?: 'keep' | 'commit'; rootConfig?: HostOptions['rootConfig'];
    } = {},
  ) => {
    const lines: string[] = [];
    const store = memorySessions();
    const host = createHost({
      path: root,
      agents: [options.agent ?? echo({ path: project(root), pace: 0 })],
      worktrees: options.worktrees ?? gitWorktrees(),
      sessions: store,
      onEvent: (line) => { lines.push(line); },
      ...(options.archiveDirtyWorktree === undefined ? {} : { archiveDirtyWorktree: options.archiveDirtyWorktree }),
      ...(options.rootConfig === undefined ? {} : { rootConfig: options.rootConfig }),
    });
    const client = host.accept(peer());
    await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
    /** The first log line that holds `text`, once there is one. */
    const logged = async (text: string): Promise<string> => {
      for (let tries = 0; tries < 400; tries++) {
        const line = lines.find((one) => one.includes(text));
        if (line !== undefined) return line;
        await new Promise((r) => { setTimeout(r, 10); });
      }
      throw new Error(`never logged "${text}" in:\n${lines.join('\n')}`);
    };
    const open = async (name: string, config: Record<string, unknown> = {}) => {
      const channel = `ahp-session:/${name}`;
      await client.handle({
        method: 'createSession',
        params: {
          channel, provider: 'echo',
          workingDirectories: [uriOf(project(root))],
          config: { isolation: 'worktree', branch: 'main', ...config },
        },
      });
      return { channel, ...await spoken(client, channel) };
    };
    const archive = (channel: string, isArchived: boolean) => client.handle({
      method: 'dispatchAction',
      params: { channel, clientSeq: 0, action: { type: 'session/isArchivedChanged', isArchived } },
    });
    return { client, store, lines, logged, open, archive };
  };

  /** The subjects of a branch's commits, newest first. */
  const subjects = (root: string, branch: string): string[] =>
    execFileSync('git', ['-C', project(root), 'log', '--format=%s', branch]).toString().trim().split('\n');

  const branches = (root: string): string => execFileSync('git', ['-C', project(root), 'branch', '--list']).toString();

  it('takes a clean tree away when the archived session sleeps, and keeps its branch', async () => {
    const root = repository();
    const { store, logged, open, archive } = await archiving(root);
    const one = await open('tidy');
    const branch = branchOf(one.where);
    await archive(one.channel, true);
    await logged(`removed ${one.where}`);
    expect(existsSync(one.where)).toBe(false);
    expect(branches(root)).toContain(branch);
    // The record stays, because it is what an unarchive puts the tree back from.
    expect(store.worktree?.('tidy')).toMatchObject({ path: one.where, branch });
  });

  it('keeps a tree with changes nobody committed, and says so', async () => {
    const root = repository();
    const watched = observed();
    const { logged, open, archive } = await archiving(root, { worktrees: watched.port });
    const one = await open('busy');
    writeFileSync(join(one.where, 'unsaved.txt'), 'the whole point\n');
    await archive(one.channel, true);
    await logged(`kept ${one.where}: it has changes nobody committed`);
    expect(watched.removed).toEqual([]);
    expect(readFileSync(join(one.where, 'unsaved.txt'), 'utf8')).toBe('the whole point\n');
  });

  it('puts the tree back on its branch on unarchive, with its folders linked again', async () => {
    const root = repository();
    // `.gitignore` names `node_modules/` as a directory, so git lists the link
    // as untracked; it is the host's own link, and the tree is still clean.
    const { store, logged, open, archive } = await archiving(root);
    const one = await open('linked', { worktreeSymlinkFolders: ['node_modules'] });
    const branch = branchOf(one.where);
    execFileSync('git', ['-C', one.where, 'commit', '-q', '--allow-empty', '-m', 'the session\'s own'], { stdio: 'pipe' });
    expect(lstatSync(join(one.where, 'node_modules')).isSymbolicLink()).toBe(true);
    await archive(one.channel, true);
    await logged(`removed ${one.where}`);
    expect(existsSync(one.where)).toBe(false);
    // The link went, and what it pointed at did not: on Windows a junction
    // left in the tree is a folder git deletes the contents of.
    expect(readFileSync(join(project(root), 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('installed\n');

    await archive(one.channel, false);
    await logged(`put ${one.where} back on ${branch}`);
    expect(branchOf(one.where)).toBe(branch);
    expect(execFileSync('git', ['-C', one.where, 'log', '-1', '--format=%s']).toString().trim()).toBe('the session\'s own');
    expect(lstatSync(join(one.where, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(one.where, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('installed\n');
    expect(store.worktree?.('linked')).toMatchObject({ path: one.where, branch });
  });

  it('takes away and puts back a tree a move left the session, as its own', async () => {
    const root = repository();
    const { store, logged, open, archive } = await archiving(root);
    const one = await open('moved');
    // The tree the session worked in before a move took it to the one it runs in.
    const left = join(`${project(root)}.worktrees`, 'left');
    execFileSync('git', ['-C', project(root), 'worktree', 'add', '-q', '-b', 'agents/left', left, 'main'], { stdio: 'pipe' });
    store.setAdditionalWorktrees?.('moved', [{ repository: project(root), path: left, base: 'main', branch: 'agents/left' }]);

    await archive(one.channel, true);
    await logged(`removed ${one.where}`);
    await logged(`removed ${left}`);
    expect(existsSync(left)).toBe(false);
    expect(branches(root)).toContain('agents/left');

    await archive(one.channel, false);
    await logged(`put ${left} back on agents/left`);
    expect(branchOf(left)).toBe('agents/left');
  });

  it('leaves the tree in place for an archive and an unarchive sent together', async () => {
    const root = repository();
    const { lines, open, archive } = await archiving(root);
    const one = await open('together');
    await Promise.all([archive(one.channel, true), archive(one.channel, false)]);
    await new Promise((r) => { setTimeout(r, 300); });
    expect(existsSync(join(one.where, 'tracked.txt'))).toBe(true);
    expect(lines.some((line) => line.includes(`removed ${one.where}`))).toBe(false);
  });

  it('leaves the tree in place for an unarchive sent while the archive was deciding', async () => {
    const root = repository();
    const base = gitWorktrees();
    // The dirty check held open until the test lets it answer.
    let asked!: () => void;
    const checking = new Promise<void>((r) => { asked = r; });
    let answer!: () => void;
    const answered = new Promise<void>((r) => { answer = r; });
    const removed: string[] = [];
    const port: Worktrees = {
      ...base,
      dirty: async (path, linked) => { asked(); await answered; return base.dirty(path, linked); },
      remove: (repository, path, branch, linked) => { removed.push(path); return base.remove(repository, path, branch, linked); },
    };
    const { lines, open, archive } = await archiving(root, { worktrees: port });
    const one = await open('undecided');
    await archive(one.channel, true);
    await checking;
    await archive(one.channel, false);
    answer();
    await new Promise((r) => { setTimeout(r, 300); });
    expect(removed).toEqual([]);
    expect(existsSync(join(one.where, 'tracked.txt'))).toBe(true);
    expect(lines.some((line) => line.includes(`removed ${one.where}`))).toBe(false);
  });

  it('gives an archived session\'s own tree back, and leaves the tree the window made for it to the window', async () => {
    const root = repository();
    const { client, logged, archive } = await archiving(root);
    const channel = 'ahp-session:/handled';
    await client.handle({
      method: 'createSession',
      params: { channel, provider: 'echo', workingDirectories: [uriOf(project(root))], config: { isolation: 'worktree', branch: 'main' } },
    });
    const { resource } = await client.handle({ method: 'vscode/createAgentHostDetachedWorktree', params: { session: channel, prompt: 'x' } }) as { resource: string };
    const own = await spoken(client, channel);
    expect(own.where).not.toBe(localPath(resource));
    await archive(channel, true);
    await logged(`removed ${own.where}`);
    expect(existsSync(own.where)).toBe(false);
    expect(existsSync(join(localPath(resource), 'tracked.txt'))).toBe(true);
  });

  it('keeps a tree with no branch of its own, and says why', async () => {
    const root = repository();
    const { logged, open, archive } = await archiving(root);
    // A checkout of `release` itself: the branch is not the session's to keep.
    const one = await open('continued', { branch: 'release', worktreeCreateNewBranch: 'false' });
    expect(branchOf(one.where)).toBe('release');
    await archive(one.channel, true);
    await logged(`kept ${one.where}: it has no branch of its own`);
    expect(existsSync(join(one.where, 'tracked.txt'))).toBe(true);
  });

  it('puts the tree back before the agent starts, when an archived session is woken', async () => {
    const root = repository();
    const base = echo({ path: project(root), pace: 0 });
    let where = '';
    // Whether the tree was there each time the backend was asked to run the session.
    const seen: boolean[] = [];
    const agent: Agent = {
      ...base,
      create: (...args: Parameters<Agent['create']>) => { seen.push(where !== '' && existsSync(where)); return base.create(...args); },
    };
    const { client, logged, open, archive } = await archiving(root, { agent });
    const one = await open('woken');
    where = one.where;
    const branch = branchOf(one.where);
    await archive(one.channel, true);
    await logged(`removed ${one.where}`);
    expect(existsSync(one.where)).toBe(false);

    seen.length = 0;
    await say(client, one.chat, 't2');
    await logged(`put ${one.where} back on ${branch}`);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((there) => there)).toBe(true);
    expect(branchOf(one.where)).toBe(branch);
  });

  it('keeps a tree whose HEAD has left its branch with a commit, and says why', async () => {
    const root = repository();
    const { logged, open, archive } = await archiving(root);
    const one = await open('wandered');
    execFileSync('git', ['-C', one.where, 'checkout', '-q', '--detach'], { stdio: 'pipe' });
    execFileSync('git', ['-C', one.where, 'commit', '-q', '--allow-empty', '-m', 'only here'], { stdio: 'pipe' });
    await archive(one.channel, true);
    await logged(`kept ${one.where}: its HEAD is not on a branch`);
    expect(execFileSync('git', ['-C', one.where, 'log', '-1', '--format=%s']).toString().trim()).toBe('only here');
  });

  it('keeps a tree with another branch checked out, and says why', async () => {
    const root = repository();
    const { logged, open, archive } = await archiving(root);
    const one = await open('elsewhere');
    const branch = branchOf(one.where);
    execFileSync('git', ['-C', one.where, 'checkout', '-q', '-b', 'side'], { stdio: 'pipe' });
    await archive(one.channel, true);
    await logged(`kept ${one.where}: it has side checked out rather than ${branch}`);
    expect(existsSync(join(one.where, 'tracked.txt'))).toBe(true);
  });

  it('keeps the tree when the port cannot say which branch it is on', async () => {
    const root = repository();
    const { head: _head, ...port } = gitWorktrees();
    const { logged, open, archive } = await archiving(root, { worktrees: port });
    const one = await open('unread');
    await archive(one.channel, true);
    await logged(`kept ${one.where}: this host cannot tell which branch it has checked out`);
    expect(existsSync(join(one.where, 'tracked.txt'))).toBe(true);
  });

  it('removes a deleted session\'s clean tree with a linked folder in it', async () => {
    const root = repository();
    const { client, logged, open } = await archiving(root);
    const one = await open('linkgone', { worktreeSymlinkFolders: ['node_modules'] });
    expect(lstatSync(join(one.where, 'node_modules')).isSymbolicLink()).toBe(true);
    await client.handle({ method: 'disposeSession', params: { channel: one.channel } });
    await logged(`removed ${one.where}`);
    expect(existsSync(one.where)).toBe(false);
  });

  it('puts the links back when git refuses to remove the tree', async () => {
    const root = repository();
    // A port that misses the untracked file, so git's own refusal is what keeps the tree.
    const port: Worktrees = { ...gitWorktrees(), dirty: async () => false };
    const { logged, open, archive } = await archiving(root, { worktrees: port });
    const one = await open('relinked', { worktreeSymlinkFolders: ['node_modules'] });
    writeFileSync(join(one.where, 'unsaved.txt'), 'kept\n');
    await archive(one.channel, true);
    await logged(`kept ${one.where}: fatal`);
    expect(readFileSync(join(one.where, 'unsaved.txt'), 'utf8')).toBe('kept\n');
    expect(lstatSync(join(one.where, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(one.where, 'packages', 'app', 'node_modules')).isSymbolicLink()).toBe(true);
  });

  it('keeps a deleted session\'s tree whose HEAD has left its branch with a commit', async () => {
    const root = repository();
    const { client, logged, open } = await archiving(root);
    const one = await open('detachedgone');
    execFileSync('git', ['-C', one.where, 'checkout', '-q', '--detach'], { stdio: 'pipe' });
    execFileSync('git', ['-C', one.where, 'commit', '-q', '--allow-empty', '-m', 'only here'], { stdio: 'pipe' });
    await client.handle({ method: 'disposeSession', params: { channel: one.channel } });
    await logged(`kept ${one.where}: its HEAD is not on a branch`);
    expect(execFileSync('git', ['-C', one.where, 'log', '-1', '--format=%s']).toString().trim()).toBe('only here');
  });

  it('keeps a deleted session\'s tree with another branch checked out', async () => {
    const root = repository();
    const { client, logged, open } = await archiving(root);
    const one = await open('sidegone');
    const branch = branchOf(one.where);
    execFileSync('git', ['-C', one.where, 'checkout', '-q', '-b', 'side'], { stdio: 'pipe' });
    await client.handle({ method: 'disposeSession', params: { channel: one.channel } });
    await logged(`kept ${one.where}: it has side checked out rather than ${branch}`);
    expect(existsSync(join(one.where, 'tracked.txt'))).toBe(true);
  });

  it('keeps the tree when git refuses to remove it, and says why', async () => {
    const root = repository();
    const refusing: Worktrees = { ...gitWorktrees(), remove: async () => { throw new Error('refused'); } };
    const { logged, open, archive } = await archiving(root, { worktrees: refusing });
    const one = await open('refused');
    await archive(one.channel, true);
    await logged(`kept ${one.where}: refused`);
    expect(existsSync(join(one.where, 'tracked.txt'))).toBe(true);
  });

  it('says why it could not put a tree back whose branch is gone, and stays unarchived', async () => {
    const root = repository();
    const { store, logged, open, archive } = await archiving(root);
    const one = await open('orphan');
    const branch = branchOf(one.where);
    await archive(one.channel, true);
    await logged(`removed ${one.where}`);
    execFileSync('git', ['-C', project(root), 'branch', '-D', branch], { stdio: 'pipe' });
    await archive(one.channel, false);
    await logged(`could not put ${one.where} back`);
    expect(existsSync(one.where)).toBe(false);
    expect(store.flags('orphan') & 64).toBe(0);
  });

  it('keeps a dirty tree under keep, as it was asked to', async () => {
    const root = repository();
    const watched = observed();
    const { logged, open, archive } = await archiving(root, { worktrees: watched.port, archiveDirtyWorktree: 'keep' });
    const one = await open('kept');
    writeFileSync(join(one.where, 'unsaved.txt'), 'kept\n');
    await archive(one.channel, true);
    await logged(`kept ${one.where}: it has changes nobody committed`);
    expect(watched.removed).toEqual([]);
    expect(existsSync(join(one.where, 'unsaved.txt'))).toBe(true);
  });

  it('commits a dirty tree under commit, then gives the tree back and keeps the branch', async () => {
    const root = repository();
    const { logged, open, archive } = await archiving(root, { archiveDirtyWorktree: 'commit' });
    const one = await open('saved');
    const branch = branchOf(one.where);
    writeFileSync(join(one.where, 'unsaved.txt'), 'the whole point\n');
    writeFileSync(join(one.where, 'tracked.txt'), 'changed\n');
    await archive(one.channel, true);
    await logged(`removed ${one.where}`);
    expect(existsSync(one.where)).toBe(false);
    expect(subjects(root, branch)[0]).toBe('Saving uncommitted changes before archiving session');
    const shown = (file: string): string => execFileSync('git', ['-C', project(root), 'show', `${branch}:${file}`]).toString();
    expect(shown('unsaved.txt')).toBe('the whole point\n');
    expect(shown('tracked.txt')).toBe('changed\n');
    // And back with the work in it.
    await archive(one.channel, false);
    await logged(`put ${one.where} back on ${branch}`);
    expect(readFileSync(join(one.where, 'unsaved.txt'), 'utf8')).toBe('the whole point\n');
  });

  it('commits a dirty tree under commit without the folder it linked', async () => {
    const root = repository();
    const { logged, open, archive } = await archiving(root, { archiveDirtyWorktree: 'commit' });
    const one = await open('linksaved', { worktreeSymlinkFolders: ['node_modules'] });
    const branch = branchOf(one.where);
    writeFileSync(join(one.where, 'unsaved.txt'), 'the whole point\n');
    await archive(one.channel, true);
    await logged(`removed ${one.where}`);
    const files = execFileSync('git', ['-C', project(root), 'show', '--name-only', '--format=', branch]).toString().trim().split('\n');
    expect(subjects(root, branch)[0]).toBe('Saving uncommitted changes before archiving session');
    expect(files).toEqual(['unsaved.txt']);
    expect(execFileSync('git', ['-C', project(root), 'ls-tree', branch, 'node_modules']).toString()).toBe('');
  });

  it('makes no commit for a clean tree under commit, and still gives it back', async () => {
    const root = repository();
    const { logged, open, archive } = await archiving(root, { archiveDirtyWorktree: 'commit' });
    const one = await open('spotless');
    const branch = branchOf(one.where);
    const before = subjects(root, branch);
    await archive(one.channel, true);
    await logged(`removed ${one.where}`);
    expect(existsSync(one.where)).toBe(false);
    expect(subjects(root, branch)).toEqual(before);
  });

  it('keeps a dirty tree under commit when the port cannot commit, and says why', async () => {
    const root = repository();
    const { commit: _commit, ...port } = gitWorktrees();
    const { logged, open, archive } = await archiving(root, { worktrees: port, archiveDirtyWorktree: 'commit' });
    const one = await open('uncommittable');
    writeFileSync(join(one.where, 'unsaved.txt'), 'kept\n');
    await archive(one.channel, true);
    await logged(`kept ${one.where}: it has changes nobody committed, and this host cannot commit them`);
    expect(existsSync(join(one.where, 'unsaved.txt'))).toBe(true);
  });

  it('keeps a dirty tree under commit when the commit fails, and says why', async () => {
    const root = repository();
    const removed: string[] = [];
    const port: Worktrees = {
      ...gitWorktrees(),
      remove: async (repository, path, branch, linked) => { removed.push(path); await gitWorktrees().remove(repository, path, branch, linked); },
      commit: async () => { throw new Error('no identity'); },
    };
    const { logged, open, archive } = await archiving(root, { worktrees: port, archiveDirtyWorktree: 'commit' });
    const one = await open('unsigned');
    writeFileSync(join(one.where, 'unsaved.txt'), 'kept\n');
    await archive(one.channel, true);
    await logged(`kept ${one.where}: could not commit its changes: no identity`);
    expect(removed).toEqual([]);
    expect(readFileSync(join(one.where, 'unsaved.txt'), 'utf8')).toBe('kept\n');
  });

  it('takes a push of archiveDirtyWorktree at once', async () => {
    const root = repository();
    // A daemon that holds the one key, so what it holds is what the push left.
    const held: Record<string, unknown> = {};
    const rootConfig: NonNullable<HostOptions['rootConfig']> = {
      schema: () => ({
        type: 'object',
        properties: { archiveDirtyWorktree: { type: 'string', enum: ['keep', 'commit'], title: 'Archive dirty worktree' } },
      }),
      values: async () => ({ ...held }),
      write: async (values) => { Object.assign(held, values); return {}; },
    };
    const { client, logged, open, archive } = await archiving(root, { rootConfig });
    await client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { archiveDirtyWorktree: 'commit' } } },
    });
    expect(held.archiveDirtyWorktree).toBe('commit');
    const one = await open('pushed');
    const branch = branchOf(one.where);
    writeFileSync(join(one.where, 'unsaved.txt'), 'saved\n');
    await archive(one.channel, true);
    await logged(`removed ${one.where}`);
    expect(subjects(root, branch)[0]).toBe('Saving uncommitted changes before archiving session');
  });
});

describe('a worktree the window makes for itself', () => {
  /*
   * The reference window's dev container flow: a tree of its own, cut for a
   * creating session whose tree is pending and held by a handle, which the
   * window claims, takes down and puts back with the archived bit, deletes,
   * and reconciles against the handles it still holds.
   */
  const DAY = 24 * 60 * 60_000;
  const UNKNOWN = '00000000-0000-4000-8000-000000000000';

  /** A host on a clock a case moves, with a creating worktree session in the served repository. */
  const drafting = async (root: string, uri: string) => {
    let ahead = 0;
    const host = createHost({
      path: root,
      agents: [echo({ path: project(root), pace: 0 })],
      worktrees: gitWorktrees(),
      now: () => new Date(Date.now() + ahead),
    });
    const client = host.accept(peer());
    const said = await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } }) as { _meta?: Record<string, unknown> };
    await client.handle({
      method: 'createSession',
      params: { channel: uri, provider: 'echo', workingDirectories: [uriOf(project(root))], config: { isolation: 'worktree', branch: 'main' } },
    });
    const { handle, resource } = await client.handle({ method: 'vscode/createAgentHostDetachedWorktree', params: { session: uri, prompt: 'port it' } }) as { handle: string; resource: string };
    return { client, said, handle, resource, where: localPath(resource), days: (count: number) => { ahead += count * DAY; } };
  };

  /** A session that has spoken in a folder, which is what makes the folder one a session uses. */
  const working = async (client: Awaited<ReturnType<typeof drafting>>['client'], uri: string, where: string) => {
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', workingDirectories: [uriOf(where)] } });
    await firstSent(client, uri);
  };

  const branches = (root: string): string => execFileSync('git', ['-C', project(root), 'branch', '--list']).toString();

  it('says so on initialize, and cuts a tree of its own for a creating session whose tree is pending, refusing the rest in VS Code\'s words', async () => {
    const root = repository();
    const { client, said, handle, where } = await drafting(root, 'ahp-session:/draft');
    expect(said._meta?.['vscode.detachedWorktrees']).toBe(true);
    expect(handle).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(existsSync(join(where, 'tracked.txt'))).toBe(true);
    expect(branchOf(where)).toBe(`agents/${handle.slice(0, 8)}`);
    // The session's own tree is still its first send's to make, and it is another one.
    await firstSent(client, 'ahp-session:/draft');
    const own = localPath((await until(client, 'ahp-session:/draft', (state) => (state.workingDirectories?.[0] ?? '') !== uriOf(project(root)))).workingDirectories?.[0] ?? '');
    expect(own).not.toBe(where);
    expect(existsSync(join(own, 'tracked.txt'))).toBe(true);
    // A session past creation, one nobody made, and one with no tree pending.
    await expect(client.handle({ method: 'vscode/createAgentHostDetachedWorktree', params: { session: 'ahp-session:/draft', prompt: 'x' } }))
      .rejects.toMatchObject({ code: -32603, message: 'Cannot create detached worktree for non-creating session: ahp-session:/draft' });
    await expect(client.handle({ method: 'vscode/createAgentHostDetachedWorktree', params: { session: 'ahp-session:/nobody', prompt: 'x' } }))
      .rejects.toMatchObject({ code: -32603, message: 'Cannot create detached worktree for non-creating session: ahp-session:/nobody' });
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/plain', provider: 'echo', workingDirectories: [uriOf(project(root))] } });
    await expect(client.handle({ method: 'vscode/createAgentHostDetachedWorktree', params: { session: 'ahp-session:/plain', prompt: 'x' } }))
      .rejects.toMatchObject({ code: -32603, message: 'Session is not configured for worktree isolation: ahp-session:/plain' });
    await expect(client.handle({ method: 'vscode/createAgentHostDetachedWorktree', params: { session: 'ahp-session:/plain' } }))
      .rejects.toMatchObject({ code: -32602, message: 'prompt must be a string' });
  });

  it('claims a handle, takes its tree down when archived and nothing uses it, keeping the branch, and puts it back', async () => {
    const root = repository();
    const { client, handle, where } = await drafting(root, 'ahp-session:/held');
    const branch = branchOf(where);
    await expect(client.handle({ method: 'vscode/claimAgentHostDetachedWorktree', params: { handle } })).resolves.toEqual({});
    await expect(client.handle({ method: 'vscode/claimAgentHostDetachedWorktree', params: { handle: 'nobody' } }))
      .rejects.toMatchObject({ code: -32602, message: 'handle must be a valid worktree handle' });
    await expect(client.handle({ method: 'vscode/claimAgentHostDetachedWorktree', params: { handle: UNKNOWN } }))
      .rejects.toMatchObject({ code: -32603, message: `Unknown detached worktree handle: ${UNKNOWN}` });
    await expect(client.handle({ method: 'vscode/setAgentHostDetachedWorktreeArchived', params: { handle, archived: 'yes' } }))
      .rejects.toMatchObject({ code: -32602, message: 'archived must be a boolean' });
    // Not while a session works in it.
    await working(client, 'ahp-session:/inside', where);
    await client.handle({ method: 'vscode/setAgentHostDetachedWorktreeArchived', params: { handle, archived: true } });
    expect(existsSync(join(where, 'tracked.txt'))).toBe(true);
    await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/inside' } });
    await client.handle({ method: 'vscode/setAgentHostDetachedWorktreeArchived', params: { handle, archived: true } });
    expect(existsSync(where)).toBe(false);
    expect(branches(root)).toContain(branch);
    // Unarchived: put back on its branch.
    await client.handle({ method: 'vscode/setAgentHostDetachedWorktreeArchived', params: { handle, archived: false } });
    expect(existsSync(join(where, 'tracked.txt'))).toBe(true);
    expect(branchOf(where)).toBe(branch);
    // A handle nobody holds is nothing to do.
    await expect(client.handle({ method: 'vscode/setAgentHostDetachedWorktreeArchived', params: { handle: UNKNOWN, archived: true } })).resolves.toEqual({});
  });

  it('deletes a tree once nothing uses it and nobody\'s work is in it, keeping its branch and its handle until then', async () => {
    const root = repository();
    const { client, handle, resource, where } = await drafting(root, 'ahp-session:/gone');
    const branch = branchOf(where);
    const reconcile = () => client.handle({ method: 'vscode/reconcileAgentHostDetachedWorktrees', params: { scope: resource, activeHandles: [] } });
    await working(client, 'ahp-session:/inside', where);
    await client.handle({ method: 'vscode/deleteAgentHostDetachedWorktree', params: { handle } });
    expect(existsSync(join(where, 'tracked.txt'))).toBe(true);
    // A handle the window asked to delete is no longer one it can claim.
    await expect(client.handle({ method: 'vscode/claimAgentHostDetachedWorktree', params: { handle } }))
      .rejects.toMatchObject({ code: -32603, message: `Unknown detached worktree handle: ${handle}` });
    await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/inside' } });
    writeFileSync(join(where, 'work.txt'), 'kept\n');
    await reconcile();
    expect(existsSync(join(where, 'work.txt'))).toBe(true);
    execFileSync('git', ['-C', where, 'clean', '-fq'], { stdio: 'pipe' });
    await reconcile();
    expect(existsSync(where)).toBe(false);
    expect(branches(root)).toContain(branch);
    await expect(client.handle({ method: 'vscode/deleteAgentHostDetachedWorktree', params: { handle } })).resolves.toEqual({});
    await expect(client.handle({ method: 'vscode/deleteAgentHostDetachedWorktree', params: { handle: 'nobody' } }))
      .rejects.toMatchObject({ code: -32602, message: 'handle must be a valid worktree handle' });
  });

  it('lets go of a handle the window no longer names once its grace is up, keeping its branch', async () => {
    const root = repository();
    const { client, handle, resource, where, days } = await drafting(root, 'ahp-session:/seen');
    const branch = branchOf(where);
    const reconcile = (activeHandles: unknown[], scope: unknown = resource) =>
      client.handle({ method: 'vscode/reconcileAgentHostDetachedWorktrees', params: { scope, activeHandles } });
    await expect(reconcile([], '')).rejects.toMatchObject({ code: -32602, message: 'scope must be a non-empty string' });
    await expect(reconcile(['nobody'])).rejects.toMatchObject({ code: -32602, message: 'activeHandles must contain valid worktree handles' });
    await reconcile([]);
    expect(existsSync(join(where, 'tracked.txt'))).toBe(true);
    days(2);
    // Named, so seen; a handle under another scope is left alone.
    await reconcile([handle]);
    await reconcile([], project(root));
    expect(existsSync(join(where, 'tracked.txt'))).toBe(true);
    await reconcile([]);
    expect(existsSync(where)).toBe(false);
    expect(branches(root)).toContain(branch);
    await expect(client.handle({ method: 'vscode/claimAgentHostDetachedWorktree', params: { handle } }))
      .rejects.toMatchObject({ code: -32603, message: `Unknown detached worktree handle: ${handle}` });
  });
});

describe('the git directory a folder belongs to', () => {
  const run = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });

  it('answers the main repository\'s .git for a linked worktree, and the worktree as its root', async () => {
    const root = repository();
    const tree = join(root, 'tree');
    run(project(root), 'worktree', 'add', '-q', tree, 'release');
    // Both directories, because a caller checks that the tree's own `.git`
    // names the worktree entry git answers for it.
    await expect(gitWorktrees().gitDir?.(tree)).resolves.toEqual({
      gitDir: join(realpathSync(project(root)), '.git'),
      worktreeDir: join(realpathSync(project(root)), '.git', 'worktrees', 'tree'),
      repository: realpathSync(tree),
    });
  });

  it('answers the repository root for a folder below it', async () => {
    const root = repository();
    await expect(gitWorktrees().gitDir?.(join(project(root), 'packages', 'app'))).resolves.toEqual({
      gitDir: join(realpathSync(project(root)), '.git'),
      worktreeDir: join(realpathSync(project(root)), '.git'),
      repository: realpathSync(project(root)),
    });
  });

  it('answers nothing outside a repository', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'ahpd-nogit-'));
    made.push(outside);
    await expect(gitWorktrees().gitDir?.(outside)).resolves.toBeUndefined();
  });

  it('rejects in git\'s own words for a folder git refuses', async () => {
    const root = repository();
    writeFileSync(join(project(root), '.git', 'config'), '[core\nbroken');
    await expect(gitWorktrees().gitDir?.(project(root))).rejects.toThrow(/config/);
  });
});

describe('the git directory a machine for an isolated session is handed', () => {
  /** The real port, with `gitDir` answering the lie instead of what git said. */
  const lying = (lie: (found: GitDir) => GitDir): Worktrees => {
    const base = gitWorktrees();
    return {
      ...base,
      gitDir: async (dir) => {
        const found = await base.gitDir?.(dir);
        return found === undefined ? undefined : lie(found);
      },
    };
  };

  it('hands none where it is not the one the session was isolated from, and names it', async () => {
    const root = repository();
    const asked: MachineSource[] = [];
    const lines: string[] = [];
    const computers: ComputerPort = {
      how: async () => undefined,
      create: async (source) => { asked.push(source); return 'box'; },
    };
    const host = createHost({
      path: root,
      agents: [echo({ path: project(root), pace: 0 })],
      // The git directory git answered is another repository's, which is what
      // a `.git` naming one would make it: the session was isolated from a
      // tree of `project`, so no other directory is the machine's to mount.
      worktrees: lying((found) => ({ ...found, gitDir: join(root, 'elsewhere', '.git') })),
      computers,
      onEvent: (line) => { lines.push(line); },
    });
    const client = host.accept(peer());
    await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/borrowed',
        provider: 'echo',
        workingDirectories: [uriOf(project(root))],
        config: { isolation: 'worktree', branch: 'main', computer: 'disposable:box' },
      },
    });
    for (let i = 0; i < 40; i++) await new Promise((r) => { setImmediate(r); });

    expect(asked).toHaveLength(1);
    expect(asked[0]?.folder).toBeDefined();
    expect(asked[0]?.gitDir).toBeUndefined();
    expect(lines.filter((line) => line.includes(join(root, 'elsewhere', '.git')))).toHaveLength(1);
  });
});
