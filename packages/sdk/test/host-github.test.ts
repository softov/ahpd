import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySessions } from '../src/sessions/sessions.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resetSdk, actions, builtServer, claude, createHost, emit, firstMessage, flushed, gitChanges, hello, hostTools, machine,
 peer, sdk, sendAnswered, sessionQueries, settle,
} from './support/host.js';
import { uriOf } from '../src/resources/fileuri.js';
import { WORK, WORK_URI } from './support/work.js';

/** The folder the hosts here serve, as its URI on this system. */
const HOME = WORK_URI;

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

describe('what GitHub knows about the branch', () => {
  /*
   * `_meta.github`, under the reference host's key and field names.
   *
   * The lookup is a port and is faked here; what is under test is the host's
   * half - that the resource is advertised, that a token a client lent is the
   * one spent, that the answer lands on the session and its row under the
   * names the reference client reads, and that it is asked again when a turn
   * ends, like the git facts it sits beside.
   */
  const REPOS = 'https://api.github.com/repos';
  const facts = (git: Record<string, unknown> | undefined) => ({
    meta: () => (git === undefined ? undefined : { git: { ...git } }),
    refresh: async () => false,
  });
  const lookup = (answer: () => { url: string; state: 'open' | 'closed' | 'merged'; createdAt?: string }[]) => {
    const asked: { branch: string; token: string | undefined }[] = [];
    return {
      asked,
      port: {
        resource: { resource: REPOS, resource_name: 'GitHub Repository', authorization_servers: ['https://github.com/login/oauth'], required: false },
        forBranch: async (_repo: unknown, branch: string, token: string | undefined) => {
          asked.push({ branch, token });
          return answer();
        },
        create: async () => { throw new Error('not here'); },
      },
    };
  };
  const onBranch = (branch: string) => ({ branchName: branch, hasGitHubRemote: true, githubOwner: 'softov', githubRepo: 'ahpd' });
  /**
   * A session made and watched, and `github`: its GitHub state once a turn
   * named `turnId` has ended in its chat, which is when the folder is read
   * again.
   */
  const turning = async (client: ReturnType<ReturnType<typeof createHost>['accept']>, session: string) => {
    await client.handle({ method: 'createSession', params: { channel: session, provider: 'claude' } });
    await settle();
    const opened = await client.handle({ method: 'subscribe', params: { channel: session } }) as { snapshot: { state: { defaultChat: string } } };
    const chat = opened.snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    const github = async (on: string, turnId: string) => {
      void client.handle({
        method: 'dispatchAction',
        params: { channel: on, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
      });
      await settle();
      await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });
      await settle(8);
      const state = await client.handle({ method: 'subscribe', params: { channel: session } }) as { snapshot: { state: { _meta?: Record<string, unknown> } } };
      return state.snapshot.state._meta?.github as { pullRequestUrls?: string[]; pullRequestBranchName?: string } | undefined;
    };
    return { chat, github };
  };

  it('advertises the resource on every backend, so a client lends its token', async () => {
    const { port } = lookup(() => []);
    const served = createHost({ path: WORK, agents: [claude({ paths: [WORK] })], ...machine(), github: port });
    const client = served.accept(peer());
    await client.handle(hello(['0.9.0']));
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { agents: { protectedResources?: { resource: string; required?: boolean }[] }[] } };
    }).snapshot.state;
    const resources = state.agents[0]?.protectedResources?.map((one) => one.resource);
    expect(resources).toContain(REPOS);
    expect(state.agents[0]?.protectedResources?.find((one) => one.resource === REPOS)?.required).toBe(false);
    // And takes a token for it, which it would refuse for a resource nobody advertised.
    await expect(client.handle({ method: 'authenticate', params: { resource: REPOS, token: 'gho_x' } })).resolves.toEqual({});
  });

  it('puts the branch\'s pull request on the session and its row, and asks again when a turn ends', async () => {
    let requests: { url: string; state: 'open' | 'closed' | 'merged' }[] = [{ url: 'https://github.com/softov/ahpd/pull/7', state: 'open' }];
    const { port, asked } = lookup(() => requests);
    const served = createHost({
      path: WORK, agents: [claude({ paths: [WORK] })], ...machine(),
      directories: facts(onBranch('fix/kqueue')), github: port,
    });
    const p = peer();
    const client = served.accept(p);
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'authenticate', params: { resource: REPOS, token: 'gho_x' } });
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/pr', provider: 'claude' } });
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/pr' } }) as {
      snapshot: { state: { _meta?: Record<string, unknown>; defaultChat: string } };
    }).snapshot.state;
    expect(state._meta?.github).toEqual({
      owner: 'softov',
      repo: 'ahpd',
      pullRequestUrls: ['https://github.com/softov/ahpd/pull/7'],
      pullRequestBranchName: 'fix/kqueue',
      pullRequestState: 'open',
      pullRequestStateUrl: 'https://github.com/softov/ahpd/pull/7',
      // The pull requests the branch already had when the session began, and
      // nothing promoted to the session yet.
      initialPullRequestUrls: ['https://github.com/softov/ahpd/pull/7'],
      associatedPullRequestUrls: [],
    });
    expect((state._meta?.github as { initialPullRequestUrls?: string[] }).initialPullRequestUrls)
      .toEqual(['https://github.com/softov/ahpd/pull/7']);
    expect((state._meta?.github as { associatedPullRequestUrls?: string[] }).associatedPullRequestUrls).toEqual([]);
    // Beside the git facts, not instead of them: `_meta` is one map.
    expect((state._meta?.git as { branchName: string }).branchName).toBe('fix/kqueue');
    /*
     * And under the per-folder names the 1.140 window reads.
     *
     * `githubData` keyed by the folder, with `workingDirectoryKeys` naming
     * which working directory that folder is. The key is the working
     * directory's own `file://` URI, so the key the host publishes and the
     * string a client looks it up by are one string.
     */
    expect(state._meta?.workingDirectoryKeys).toEqual({ [HOME]: HOME });
    expect(state._meta?.githubData).toEqual({ [HOME]: state._meta?.github });
    // Asked as the person who lent the token.
    expect(asked.at(-1)?.token).toBe('gho_x');
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } });
    await client.handle({ method: 'subscribe', params: { channel: state.defaultChat } });

    // Merged while the agent worked: the turn ending is when it is asked again.
    requests = [{ url: 'https://github.com/softov/ahpd/pull/7', state: 'merged' }];
    client.handle({
      method: 'dispatchAction',
      params: { channel: state.defaultChat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
    });
    await settle();
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });
    await settle(8);
    const moved = actions(p, 'ahp-session:/pr').filter((one) => one.action.type === 'session/metaChanged').at(-1);
    const meta = moved?.action._meta as {
      git?: { branchName?: string };
      github?: { pullRequestState?: string };
      githubData?: Record<string, { pullRequestState?: string }>;
      workingDirectoryKeys?: Record<string, string>;
    } | undefined;
    expect(meta?.github?.pullRequestState).toBe('merged');
    expect(meta?.git?.branchName).toBe('fix/kqueue');
    // The frame carries the whole map, so the per-folder keys move with it -
    // or a producer that wrote its own part would have erased the git facts.
    expect(meta?.workingDirectoryKeys).toEqual({ [HOME]: HOME });
    expect(meta?.githubData?.[HOME]?.pullRequestState).toBe('merged');
    await flushed();
    const row = p.notes.filter((n) => n.method === 'root/sessionSummaryChanged').at(-1);
    const rowMeta = (row?.params as {
      changes: {
        _meta?: {
          github?: { pullRequestState?: string };
          githubData?: Record<string, { pullRequestState?: string }>;
          workingDirectoryKeys?: Record<string, string>;
        };
      };
    }).changes._meta;
    expect(rowMeta?.github?.pullRequestState).toBe('merged');
    expect(rowMeta?.workingDirectoryKeys).toEqual({ [HOME]: HOME });
    expect(rowMeta?.githubData?.[HOME]?.pullRequestState).toBe('merged');
  });

  /*
   * The lists as VS Code's host writes a session's GitHub state: each URL with
   * its host in lower case and no trailing slash, each once, ten at most.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L1435-L1447
   */
  it('writes the pull request the branch\'s lookup found as VS Code\'s host writes it, and the baseline each once and ten at most', async () => {
    const requests = [
      { url: 'https://GitHub.com/softov/ahpd/pull/12/', state: 'open' as const },
      { url: 'https://github.com/softov/ahpd/pull/12', state: 'open' as const },
      ...Array.from({ length: 11 }, (_, at) => ({ url: `https://github.com/softov/ahpd/pull/${11 - at}`, state: 'closed' as const })),
    ];
    const { port } = lookup(() => requests);
    const served = createHost({
      path: WORK, agents: [claude({ paths: [WORK] })], ...machine(),
      directories: facts(onBranch('fix/kqueue')), github: port,
    });
    const client = served.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/many', provider: 'claude' } });
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/many' } }) as {
      snapshot: { state: { _meta?: Record<string, unknown> } };
    }).snapshot.state;
    const ten = Array.from({ length: 10 }, (_, at) => `https://github.com/softov/ahpd/pull/${12 - at}`);
    const github = state._meta?.github as { pullRequestUrls?: string[]; initialPullRequestUrls?: string[] };
    // The one the lookup resolved, its host in lower case and no trailing slash.
    expect(github.pullRequestUrls).toEqual(['https://github.com/softov/ahpd/pull/12']);
    expect(github.initialPullRequestUrls).toEqual(ten);
    expect(state._meta?.githubData).toEqual({ [HOME]: github });
  });

  /*
   * The lookup VS Code's host runs for a session's checkout: never for the
   * base branch, and once a pull request is known for the branch, no other is
   * looked for there; a switch to a branch with none keeps the known ones.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostGitStateService.ts#L219-L275
   */
  it('keeps the pull requests it knew across branches, and asks nothing for the base branch or for another on a branch it answered', async () => {
    const git: Record<string, unknown> = { ...onBranch('fix/a'), baseBranchName: 'main' };
    let requests: { url: string; state: 'open' | 'closed' | 'merged' }[] = [{ url: 'https://github.com/softov/ahpd/pull/1', state: 'open' }];
    const { port, asked } = lookup(() => requests);
    const served = createHost({
      path: WORK, agents: [claude({ paths: [WORK] })], ...machine(),
      directories: facts(git), github: port,
    });
    const client = served.accept(peer());
    await client.handle(hello(['0.9.0']));
    const { chat, github } = await turning(client, 'ahp-session:/moves');
    expect((await github(chat, 't1'))?.pullRequestUrls).toEqual(['https://github.com/softov/ahpd/pull/1']);
    // Another pull request on the same branch is not taken: one is known there.
    requests = [{ url: 'https://github.com/softov/ahpd/pull/2', state: 'open' }];
    expect((await github(chat, 't2'))?.pullRequestUrls).toEqual(['https://github.com/softov/ahpd/pull/1']);
    // A branch with none keeps the known one, though it was asked about.
    git.branchName = 'fix/b';
    requests = [];
    expect(await github(chat, 't3')).toMatchObject({ pullRequestUrls: ['https://github.com/softov/ahpd/pull/1'], pullRequestBranchName: 'fix/a' });
    expect(asked.map((one) => one.branch)).toContain('fix/b');
    // The base branch's pull request is nobody's work: none is taken there.
    git.branchName = 'main';
    requests = [{ url: 'https://github.com/softov/ahpd/pull/9', state: 'open' }];
    expect(await github(chat, 't4')).toMatchObject({ pullRequestUrls: ['https://github.com/softov/ahpd/pull/1'], pullRequestBranchName: 'fix/a' });
  });

  /*
   * With the root's automatic attachment off, VS Code's host looks nothing up
   * and keeps the pull requests a session recorded as artifacts or associated.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostGitStateService.ts#L188-L218
   */
  it('looks up no pull request with automatic attachment off', async () => {
    const { port } = lookup(() => [{ url: 'https://github.com/softov/ahpd/pull/3', state: 'open' }]);
    // The folder is on its branch from the moment the setting is in force.
    const git: Record<string, unknown> = {};
    const served = createHost({
      path: WORK, agents: [claude({ paths: [WORK] })], ...machine(),
      directories: facts(git), github: port,
    });
    const client = served.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'dispatchAction', params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { autoAttachPullRequests: false } } } });
    const { chat, github } = await turning(client, 'ahp-session:/off');
    Object.assign(git, onBranch('fix/c'));
    expect(await github(chat, 't1')).toEqual({ owner: 'softov', repo: 'ahpd' });
  });

  /*
   * Turned off with pull requests held, VS Code's restricted mode keeps each
   * list to the session's artifacts and associated pull requests: the found
   * one, the baseline's and the selection all go when none of them is either.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostPullRequestAssociationResolver.ts#L392-L418
   */
  it('keeps the lists to the session\'s own pull requests once automatic attachment is off', async () => {
    const { port } = lookup(() => [{ url: 'https://github.com/softov/ahpd/pull/4', state: 'open' }]);
    const served = createHost({
      path: WORK, agents: [claude({ paths: [WORK] })], ...machine(),
      directories: facts(onBranch('fix/d')), github: port,
    });
    const client = served.accept(peer());
    await client.handle(hello(['0.9.0']));
    const { chat, github } = await turning(client, 'ahp-session:/restricted');
    expect(await github(chat, 't1')).toMatchObject({
      pullRequestUrls: ['https://github.com/softov/ahpd/pull/4'],
      initialPullRequestUrls: ['https://github.com/softov/ahpd/pull/4'],
    });
    await client.handle({ method: 'dispatchAction', params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { autoAttachPullRequests: false } } } });
    expect(await github(chat, 't2')).toEqual({ owner: 'softov', repo: 'ahpd', initialPullRequestUrls: [], associatedPullRequestUrls: [] });
  });

  it('names the owner and repository alone when the branch has no pull request, and keeps what it held when GitHub does not answer', async () => {
    let fail = false;
    const { port } = lookup(() => { if (fail) throw new Error('offline'); return []; });
    const served = createHost({
      path: WORK, agents: [claude({ paths: [WORK] })], ...machine(),
      directories: facts(onBranch('main')), github: port,
    });
    const client = served.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/none', provider: 'claude' } });
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/none' } }) as {
      snapshot: { state: { _meta?: Record<string, unknown> } };
    }).snapshot.state;
    expect(state._meta?.github).toMatchObject({ owner: 'softov', repo: 'ahpd' });
    fail = true;
    await client.handle({ method: 'unsubscribe', params: { channel: 'ahp-session:/none' } });
    const again = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/none' } }) as {
      snapshot: { state: { _meta?: Record<string, unknown> } };
    }).snapshot.state;
    expect(again._meta?.github).toMatchObject({ owner: 'softov', repo: 'ahpd' });
  });

  it('captures an empty baseline where the branch had no pull request, rather than leaving it absent', async () => {
    const { port } = lookup(() => []);
    const served = createHost({
      path: WORK, agents: [claude({ paths: [WORK] })], ...machine(),
      directories: facts(onBranch('main')), github: port,
    });
    const client = served.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/none', provider: 'claude' } });
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/none' } }) as {
      snapshot: { state: { _meta?: { github?: Record<string, unknown>; githubData?: Record<string, Record<string, unknown>> } } };
    }).snapshot.state;
    // The key is there with an empty array: a branch that had no pull request
    // is a captured answer, which a client can tell from a host that never
    // asked.
    expect(state._meta?.github).toHaveProperty('initialPullRequestUrls');
    expect((state._meta?.github as { initialPullRequestUrls?: unknown }).initialPullRequestUrls).toEqual([]);
    expect((state._meta?.github as { associatedPullRequestUrls?: unknown }).associatedPullRequestUrls).toEqual([]);
    // And the same empty baseline is a captured answer per folder too.
    expect(state._meta?.githubData?.[HOME]).toBe(state._meta?.github);
    expect((state._meta?.githubData?.[HOME] as { initialPullRequestUrls?: unknown }).initialPullRequestUrls)
      .toEqual([]);
  });

  it('captures a baseline for a session it is running, and for no row nobody opened', async () => {
    const url = 'https://github.com/softov/ahpd/pull/7';
    const { port } = lookup(() => [{ url, state: 'open' as const }]);
    // A transcript on disk that this host is not running and that nobody has
    // opened. A baseline written for it would say this is the branch the
    // session began on, which is a branch nobody ever asked about.
    sdk.sessions.push({ sessionId: 'browsed', summary: 'Browsed', lastModified: 1_700_000_000_000, cwd: WORK });
    const store = memorySessions();
    const served = createHost({
      path: WORK, agents: [claude({ paths: [WORK] })], ...machine(),
      directories: facts(onBranch('main')), github: port, sessions: store,
    });
    const client = served.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    await settle();

    // Only the listing, which the GitHub answer went past.
    expect(store.pullRequests('browsed')).toBeUndefined();
    expect(store.pullRequests('live')).toEqual({ initialPullRequestUrls: [url], associatedPullRequestUrls: [] });
  });

  /*
   * VS Code's baseline: a folder session's, of the pull requests GitHub says
   * were opened before the session began, less five minutes of clock skew;
   * a worktree session holds none.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostGitStateService.ts#L396-L411
   */
  it('takes into a baseline only the pull requests opened before the session began', async () => {
    const before = 'https://github.com/softov/ahpd/pull/7';
    const after = 'https://github.com/softov/ahpd/pull/8';
    const store = memorySessions();
    const { port } = lookup(() => [
      { url: after, state: 'open' as const, createdAt: new Date(Date.now() + 60_000).toISOString() },
      { url: before, state: 'open' as const, createdAt: '2020-01-01T00:00:00Z' },
    ]);
    const served = createHost({
      path: WORK, agents: [claude({ paths: [WORK] })], ...machine(),
      directories: facts(onBranch('fix/kqueue')), github: port, sessions: store,
    });
    const client = served.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/old', provider: 'claude' } });
    await settle();
    expect(store.pullRequests('old')).toEqual({ initialPullRequestUrls: [before], associatedPullRequestUrls: [] });
  });

  it('keeps no baseline for a session working in a worktree', async () => {
    const store = memorySessions();
    const { port, asked } = lookup(() => [{ url: 'https://github.com/softov/ahpd/pull/7', state: 'open' as const, createdAt: '2020-01-01T00:00:00Z' }]);
    const served = createHost({
      path: WORK, agents: [claude({ paths: [WORK] })], ...machine(),
      directories: facts(onBranch('fix/kqueue')), github: port, sessions: store,
      worktrees: {
        repository: async () => WORK,
        branches: async () => ['fix/kqueue'],
        create: async () => {},
        dirty: async () => false,
        remove: async () => {},
      },
    });
    const client = served.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/tree', provider: 'claude', workingDirectories: [HOME], config: { isolation: 'worktree' } },
    });
    await settle();
    // A turn's end is when the worktree's own folder is asked about.
    const asks = asked.length;
    // The chat the host minted for the session, read off its state.
    const chat = ((await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/tree' } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
    });
    await settle();
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });
    await settle(8);
    expect(asked.length).toBeGreaterThan(asks);
    expect(store.pullRequests('tree')).toBeUndefined();
  });

  it('publishes no GitHub state at all where there is no GitHub port', async () => {
    const served = createHost({
      path: WORK, agents: [claude({ paths: [WORK] })], ...machine(),
      // A directory with git facts and no pull request port: `_meta` is not
      // empty, but nothing about GitHub was ever captured.
      directories: facts(onBranch('main')),
    });
    const client = served.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/quiet', provider: 'claude' } });
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/quiet' } }) as {
      snapshot: { state: { _meta?: Record<string, unknown> } };
    }).snapshot.state;
    // A key published with nothing under it tells the window the folder is
    // known and has no state, which is a different answer from one never
    // published. The git facts are what is there.
    expect(state._meta?.git).toBeDefined();
    expect(state._meta?.github).toBeUndefined();
    expect(state._meta?.githubData).toBeUndefined();
    expect(state._meta?.workingDirectoryKeys).toBeUndefined();
  });

  /*
   * A chat that is not the session's default has its git state under the
   * scope of its folders, as VS Code's host writes one: `gitData` by the
   * scope's id, the SHA-1 of the folders' sorted keys, and
   * `workingDirectoryScopeIds` from the folder list to that id.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostGitStateService.ts#L959-L972
   */
  it('puts the git state of a second chat under the scope of its folders', async () => {
    const served = createHost({
      path: WORK, agents: [claude({ paths: [WORK] })], ...machine(),
      directories: facts(onBranch('main')),
    });
    const client = served.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/scoped', provider: 'claude' } });
    await settle();
    const meta = async () => ((await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/scoped' } }) as {
      snapshot: { state: { _meta?: Record<string, unknown> } };
    }).snapshot.state._meta ?? {});
    // The default chat alone reads the session's own `git`.
    expect((await meta()).gitData).toBeUndefined();

    await client.handle({ method: 'createChat', params: { channel: 'ahp-session:/scoped', chat: 'ahp-chat:/second' } });
    await settle();
    const scope = createHash('sha1').update(JSON.stringify([HOME])).digest('hex');
    const now = await meta();
    expect(now.gitData).toEqual({ [scope]: now.git });
    expect(now.workingDirectoryScopeIds).toEqual({ [JSON.stringify([HOME])]: scope });
  });

  it('has no `_meta` at all for a directory that has answered nothing', async () => {
    const served = createHost({
      path: WORK, agents: [claude({ paths: [WORK] })], ...machine(),
      directories: facts(undefined),
    });
    const client = served.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/silent', provider: 'claude' } });
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/silent' } }) as {
      snapshot: { state: { _meta?: Record<string, unknown> } };
    }).snapshot.state;
    // No folder key for a folder this host knows nothing about.
    expect(state._meta).toBeUndefined();
  });
});

describe('what a session recorded', () => {
  /*
   * Artifacts and references, on the session and its row under
   * `agentHost/sessionArtifacts`, which is where the reference window draws
   * its pills from; kept by the store, so a restart keeps them; and taken off
   * by the window's own request, `vscode/removeSessionArtifact`.
   */
  const KEY = 'agentHost/sessionArtifacts';
  const withTools = async (pushed: Record<string, unknown> = {}) => {
    const host = createHost({ path: WORK, agents: [claude({ paths: [WORK] })], ...machine(), tools: hostTools() });
    const p = peer();
    const client = host.accept(p);
    const said = await client.handle(hello(['0.9.0'])) as { _meta?: Record<string, unknown> };
    if (Object.keys(pushed).length > 0) {
      client.handle({
        method: 'dispatchAction',
        params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: pushed } },
      });
      await settle();
    }
    const uri = 'ahp-session:/recorded';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
    return { client, peer: p, uri, said };
  };
  const add = (index: number, label: string, link: string) => toolsOf(index)['add_artifact_or_reference']?.handler({ items: [{ type: 'website', label, isArtifact: false, link }] });
  const toolsOf = (index: number) => Object.fromEntries(
    ((builtServer('host', index) as { tools: { name: string; handler: (input: unknown) => Promise<{ content: { text: string }[] }> }[] } | undefined)?.tools ?? [])
      .map((one) => [one.name, one]),
  );

  /** What the session's CLI is told beside a prompt, through its `UserPromptSubmit` hook. */
  const toldOnPrompt = async (): Promise<string> => {
    const hooks = (sessionQueries().at(-1)?.options.hooks as Record<string, { hooks: ((input: unknown, id: undefined, options: { signal: AbortSignal }) => Promise<{ hookSpecificOutput?: { additionalContext?: string } }>)[] }[]> | undefined)?.UserPromptSubmit ?? [];
    const answers = await Promise.all(hooks.flatMap((one) => one.hooks)
      .map((hook) => hook({ hook_event_name: 'UserPromptSubmit', prompt: '' }, undefined, { signal: new AbortController().signal })));
    return answers.map((one) => one.hookSpecificOutput?.additionalContext ?? '').join('\n');
  };

  it('tells the model when to record one, in the reference host\'s words, beside each prompt', async () => {
    const { client, uri } = await withTools();
    // The CLI its first send starts.
    await sendAnswered(client, uri);
    const prompt = sessionQueries().at(-1)?.options.systemPrompt as { type: string; preset: string; append?: string } | undefined;
    expect(prompt).toEqual({ type: 'preset', preset: 'claude_code' });
    expect(await toldOnPrompt()).toContain('Record notable artifacts and references with `add_artifact_or_reference`');
  });

  it('gives the long wording whatever a client pushes, and offers every tool the same', async () => {
    const { client, uri } = await withTools({ telemetryLevel: 'off' });
    await sendAnswered(client, uri);
    const told = await toldOnPrompt();
    expect(told).toContain('Record notable artifacts and references with `add_artifact_or_reference`');
    expect(told).not.toContain('Artifact registration is optional; default to none.');
    // Every tool is offered, in the same order: no root key selects words or
    // availability.
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { serverTools?: { name: string; description?: string }[] } };
    }).snapshot.state;
    const tools = state.serverTools ?? [];
    expect(tools.map((one) => one.name)).toEqual([
      'list_sessions', 'get_current_session', 'set_workspace', 'create_session', 'create_chat',
      'rename_chat', 'send_message', 'get_session_context', 'delete_session',
      'add_artifact_or_reference', 'remove_artifact_or_reference', 'list_artifacts_and_references',
      'ahp_resource', 'ahp_terminals', 'schedule_wakeup', 'ask_user',
    ]);
    expect(tools.find((one) => one.name === 'add_artifact_or_reference')?.description).toContain('Record one or more artifacts or references so they are surfaced next to the chat input.');
  });

  it('publishes them on the session and its row, and says the change as the whole map', async () => {
    const { client, peer: p, uri } = await withTools();
    // A session has a row from its first message, on the chat the host minted for it.
    await firstMessage(client, ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat);
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    expect(String((await add(-1, 'Docs', 'https://example.com/docs'))?.content[0]?.text)).toMatch(/^Added reference: [0-9a-f-]+$/);
    const moved = actions(p, uri).filter((one) => one.action.type === 'session/metaChanged').at(-1);
    const meta = moved?.action._meta as Record<string, unknown> | undefined;
    const held = meta?.[KEY] as { id: string; label: string }[] | undefined;
    expect(held?.map((one) => one.label)).toEqual(['Docs']);
    await flushed();
    const row = p.notes.filter((n) => n.method === 'root/sessionSummaryChanged').at(-1);
    expect(((row?.params as { changes: { _meta?: Record<string, unknown> } }).changes._meta)?.[KEY]).toEqual(held);
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as { snapshot: { state: { _meta?: Record<string, unknown> } } }).snapshot.state;
    expect(state._meta?.[KEY]).toEqual(held);
  });

  it('takes one off at the window\'s request, which initialize said it may make', async () => {
    const { client, peer: p, uri, said } = await withTools();
    expect(said._meta?.['vscode.removeSessionArtifact']).toBe(true);
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    await add(-1, 'Docs', 'https://example.com/docs');
    await add(-1, 'Issue', 'https://example.com/issues/1');
    const held = ((actions(p, uri).filter((one) => one.action.type === 'session/metaChanged').at(-1)?.action._meta as Record<string, unknown>)[KEY]) as { id: string; label: string }[];
    expect(held).toHaveLength(2);
    await client.handle({ method: 'vscode/removeSessionArtifact', params: { session: uri, artifactId: held[0]?.id } });
    const left = ((actions(p, uri).filter((one) => one.action.type === 'session/metaChanged').at(-1)?.action._meta as Record<string, unknown>)[KEY]) as { label: string }[];
    expect(left.map((one) => one.label)).toEqual(['Issue']);
    // The last one gone takes the key with it, the way the reference host drops an empty slot.
    await client.handle({ method: 'vscode/removeSessionArtifact', params: { session: uri, artifactId: held[1]?.id } });
    const meta = actions(p, uri).filter((one) => one.action.type === 'session/metaChanged').at(-1)?.action._meta as Record<string, unknown> | undefined;
    expect(meta?.[KEY]).toBeUndefined();
    // Nothing to do is nothing said: no action for an id nobody has.
    const before = actions(p, uri).length;
    await client.handle({ method: 'vscode/removeSessionArtifact', params: { session: uri, artifactId: 'nobody' } });
    expect(actions(p, uri).length).toBe(before);
  });

  /*
   * VS Code's params and restore: each refused in its words, a chat's URI
   * among them, and a session it cannot restore refused -32001.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3400-L3417
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3600-L3612
   */
  it('refuses a removal\'s params and a session it cannot restore, in VS Code\'s words', async () => {
    const { client, uri } = await withTools();
    const remove = (params: Record<string, unknown>) => client.handle({ method: 'vscode/removeSessionArtifact', params });
    await expect(remove({ session: uri, artifactId: ' ' })).rejects.toMatchObject({ code: -32602, message: 'artifactId must be a non-empty string' });
    await expect(remove({ session: 'not a uri', artifactId: 'a' })).rejects.toMatchObject({ code: -32602, message: 'session must be a valid URI string' });
    for (const session of ['ahp-chat:/one', 'ahp-session://elsewhere/one', 'ahp-session:/one?x', 'ahp-session:/']) {
      await expect(remove({ session, artifactId: 'a' })).rejects.toMatchObject({ code: -32602, message: 'session must be an Agent Session URI' });
    }
    await expect(remove({ session: 'ahp-session:/nobody', artifactId: 'a' }))
      .rejects.toMatchObject({ code: -32001, message: 'No agent for session: ahp-session:/nobody' });
    expect(await remove({ session: uri, artifactId: 'nobody' })).toEqual({});
  });
});

describe('the pull request a create-pr recorded', () => {
  /*
   * `create-pr` answers what it opened or found again, and the host records it
   * as a session artifact before asking GitHub about the branch. A real
   * repository is used because the operation is git: it branches, commits and
   * pushes. GitHub is faked, since what is under test is what the host does
   * with the operation's own answer.
   */
  const KEY = 'agentHost/sessionArtifacts';
  const URL = 'https://github.com/softov/ahpd/pull/1';
  const here: string[] = [];
  afterEach(async () => {
    // Awaited rather than sync: on Windows a folder stays held until what the
    // test opened there is let go, which happens on the event loop a sync
    // retry blocks.
    for (const dir of here) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    here.length = 0;
  });

  const git = (dir: string, ...args: string[]): string =>
    execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString().trim();

  /** A repository with a bare `origin` beside it, on `main`, with one commit. */
  const repository = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-host-pr-'));
    here.push(root);
    const origin = join(root, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    const dir = join(root, 'work');
    execFileSync('git', ['clone', '-q', origin, dir], { stdio: 'pipe' });
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'checkout', '-q', '-b', 'main');
    writeFileSync(join(dir, 'tracked.txt'), 'one\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'first');
    git(dir, 'push', '-q', '-u', 'origin', 'main');
    git(dir, 'remote', 'set-head', 'origin', 'main');
    return dir;
  };

  /**
   * GitHub, as far as the host and the operation ask it.
   *
   * Nothing is open until `create` opens it, which is what makes the operation
   * take the opened path and the host's later refresh agree with it.
   */
  const lookup = (url: string) => {
    const asked: { branch: string; token: string | undefined }[] = [];
    let opened: { url: string; state: 'open'; title: string } | undefined;
    return {
      asked,
      port: {
        resource: { resource: 'https://api.github.com/repos', resource_name: 'GitHub Repository', authorization_servers: ['https://github.com/login/oauth'], required: false },
        forBranch: async (_repo: unknown, branch: string, token: string | undefined) => {
          asked.push({ branch, token });
          return opened === undefined ? [] : [opened];
        },
        create: async (_repo: unknown, wanted: { title: string }) => {
          opened = { url, state: 'open' as const, title: wanted.title };
          return opened;
        },
      },
    };
  };

  /** The directory's git facts, with a GitHub remote the local clone does not have. */
  const facts = (dir: string) => ({
    meta: () => ({
      git: {
        branchName: git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'),
        hasGitHubRemote: true,
        githubOwner: 'softov',
        githubRepo: 'ahpd',
      },
    }),
    refresh: async () => false,
  });

  /** A host on a real repository, its changes source and the fake GitHub, with tools, GitHub opening `opened`. */
  async function withRepo(baseline?: { initialPullRequestUrls: string[]; associatedPullRequestUrls: string[] }, opened = URL) {
    const dir = repository();
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    const fake = lookup(opened);
    const store = memorySessions();
    // A baseline the session already carries. The directory facts are asked
    // again and know nothing of it, which is a session that outlived the
    // branch's pull request.
    if (baseline !== undefined) store.setPullRequests('pr', baseline);
    const changes = gitChanges();
    const host = createHost({
      path: dir,
      agents: [claude({ paths: [dir] })],
      ...machine(),
      directories: facts(dir),
      github: fake.port,
      changes,
      tools: hostTools(),
      sessions: store,
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/pr';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } });
    await settle(8);
    /*
     * Wait for the source, not for ticks.
     *
     * `operations` answers from a cache `git status` fills, and the host fills
     * it in the background: `refreshFacts` is fired and not awaited. `create-pr`
     * is offered only while the working tree is dirty, so a `git` spawn that
     * has not returned yet offers nothing and the invocation is refused. Eight
     * macrotasks are enough when the machine is idle and not when it is not,
     * which is the whole of why this read flaked. Awaiting the refresh the host
     * would make anyway is the same work with a settled answer.
     */
    await changes.refresh?.(dir);
    return { dir, fake, client, peer: p, uri, changeset: `${uri}/changeset/uncommitted` };
  }

  const toolsOf = () => Object.fromEntries(
    ((builtServer('host') as { tools: { name: string; handler: (input: unknown) => Promise<{ content: { text: string }[] }> }[] } | undefined)?.tools ?? [])
      .map((one) => [one.name, one]),
  );

  const create = async (client: { handle(r: { method: string; params: unknown }): unknown }, changeset: string) => {
    return await client.handle({
      method: 'invokeChangesetOperation',
      params: { channel: changeset, operationId: 'create-pr', _meta: { 'vscode.pullRequest': { title: 'Fix the thing', description: 'Because.' } } },
    }) as { followUp?: { content: { uri: string } } };
  };

  it('records it as an artifact and puts its URL on the branch', async () => {
    const { dir, fake, client, peer: p, uri, changeset } = await withRepo();
    const done = await create(client, changeset);
    expect(done.followUp?.content.uri).toBe(URL);
    expect(fake.asked.length).toBeGreaterThan(0);
    await settle(8);

    const moved = actions(p, uri).filter((one) => one.action.type === 'session/metaChanged').at(-1);
    const meta = moved?.action._meta as Record<string, unknown> | undefined;
    const held = meta?.[KEY] as { type: string; isArtifact: boolean; link: string }[] | undefined;
    expect(held).toHaveLength(1);
    expect(held?.[0]).toMatchObject({ type: 'pullRequest', isArtifact: true, link: URL });
    expect((meta?.github as { pullRequestUrls?: string[] } | undefined)?.pullRequestUrls?.[0]).toBe(URL);
  });

  /*
   * The session's lists under the URL VS Code's host writes, its host in lower
   * case and no trailing slash, and the artifact under the link as opened.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostPullRequestOperationProvider.ts#L267-L286
   */
  it('records the pull request it opened under the URL VS Code\'s host writes', async () => {
    const opened = 'https://GitHub.com/softov/ahpd/pull/1/';
    const { client, peer: p, uri, changeset } = await withRepo(undefined, opened);
    await create(client, changeset);
    await settle(8);
    const moved = actions(p, uri).filter((one) => one.action.type === 'session/metaChanged').at(-1);
    const meta = moved?.action._meta as Record<string, unknown> | undefined;
    const github = meta?.github as { pullRequestUrls?: string[]; associatedPullRequestUrls?: string[] } | undefined;
    expect(github?.pullRequestUrls).toEqual([URL]);
    expect(github?.associatedPullRequestUrls).toEqual([URL]);
    expect((meta?.[KEY] as { link: string }[] | undefined)?.[0]?.link).toBe(opened);
  });

  it('moves a pull request the branch already had out of the baseline, in the same move as the artifact', async () => {
    const { dir, client, peer: p, uri, changeset } = await withRepo({ initialPullRequestUrls: [URL], associatedPullRequestUrls: [] });
    // The branch already had it, so the session inherited it as its baseline.
    const before = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { _meta?: { github?: Record<string, unknown> } } };
    }).snapshot.state;
    expect((before._meta?.github as { initialPullRequestUrls?: unknown } | undefined)?.initialPullRequestUrls).toEqual([URL]);
    await create(client, changeset);
    await settle(8);

    const moved = actions(p, uri).filter((one) => one.action.type === 'session/metaChanged').at(-1);
    const meta = moved?.action._meta as Record<string, unknown> | undefined;
    const github = meta?.github as {
      pullRequestUrls?: string[]; initialPullRequestUrls?: string[]; associatedPullRequestUrls?: string[];
    } | undefined;
    // Gone from the baseline, first among the session's own, and still known
    // to the branch under the whole set.
    expect(github?.initialPullRequestUrls).toEqual([]);
    expect(github?.associatedPullRequestUrls).toEqual([URL]);
    expect(github?.pullRequestUrls).toEqual([URL]);
    // The artifact rode the same `session/metaChanged`, so a client never saw
    // one without the other.
    const held = meta?.[KEY] as { type: string; isArtifact: boolean; link: string }[] | undefined;
    expect(held).toHaveLength(1);
    expect(held?.[0]).toMatchObject({ type: 'pullRequest', isArtifact: true, link: URL });
  });

  it('associates a pull request the branch did not have, leaving the empty baseline alone', async () => {
    const { dir, client, peer: p, uri, changeset } = await withRepo();
    const before = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { _meta?: { github?: Record<string, unknown> } } };
    }).snapshot.state;
    // The branch had none, and that is a captured baseline rather than an
    // absent one.
    expect((before._meta?.github as { initialPullRequestUrls?: unknown } | undefined)?.initialPullRequestUrls).toEqual([]);
    await create(client, changeset);
    await settle(8);

    const moved = actions(p, uri).filter((one) => one.action.type === 'session/metaChanged').at(-1);
    const github = (moved?.action._meta as Record<string, unknown> | undefined)?.github as {
      initialPullRequestUrls?: string[]; associatedPullRequestUrls?: string[];
    } | undefined;
    expect(github?.initialPullRequestUrls).toEqual([]);
    expect(github?.associatedPullRequestUrls).toEqual([URL]);
  });

  it('promotes a reference the session already held, keeping its id', async () => {
    const { dir, client, peer: p, uri, changeset } = await withRepo();
    const added = await toolsOf()['add_artifact_or_reference']?.handler({
      items: [{ type: 'pullRequest', label: 'The fix', isArtifact: false, link: URL }],
    });
    const id = /^Added reference: ([0-9a-f-]+)$/.exec(String(added?.content[0]?.text))?.[1];
    expect(id).toBeDefined();
    await create(client, changeset);
    await settle(8);

    const moved = actions(p, uri).filter((one) => one.action.type === 'session/metaChanged').at(-1);
    const held = (moved?.action._meta as Record<string, unknown> | undefined)?.[KEY] as { id: string; isArtifact: boolean; link: string }[] | undefined;
    expect(held).toHaveLength(1);
    expect(held?.[0]).toMatchObject({ id, isArtifact: true, link: URL });
  });

  it('re-declares commit with the new subject when the session is renamed', async () => {
    const { client, peer: p, uri, changeset } = await withRepo();
    await client.handle({ method: 'subscribe', params: { channel: changeset } });
    await settle(6);

    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/titleChanged', title: 'Fix the build' } },
    });
    await settle(6);

    const moved = actions(p, changeset).filter((one) => one.action.type === 'changeset/operationsChanged').at(-1);
    const commit = (moved?.action.operations as { id: string; confirmation?: string }[] | undefined)
      ?.find((one) => one.id === 'commit');
    expect(commit?.confirmation).toContain("'Fix the build'");
  });
});
