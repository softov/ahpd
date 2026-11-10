import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentMerge } from '../src/host/agentmerge.js';
import {
  agentMergeTools, readAgentMergeCIToolName, replyToAgentMergeReviewThreadToolName, rerunAgentMergeWorkflowToolName,
  setAgentMergeEnabledToolName,
} from '../src/tools/agentmerge.js';
import type { HostContext } from '../src/host/context.js';
import type { PullRequestDetail, PullRequestJob, PullRequestMergeResult } from '../src/types/github.js';
import type { ToolCall } from '../src/types/host.js';
import type { Owner } from '../src/types/usage.js';

/*
 * The watch behind Agent Merge.
 *
 * One folder with its pull request read: a failed required check, a review
 * thread and a conflict each ask the chat for one repair turn. A key turned off
 * asks for none, and a merge that is asked for is never the host's to do.
 */

const SESSION = 'ahp-session:/repair';
const CHAT = 'ahp-chat:/repair/main';
const FOLDER = '/work/repair';
const PAGE = 'https://github.com/softov/ahpd/pull/9';

/** The folders a test made, removed with it. */
let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=Agent Merge', '-c', 'user.email=agent@example.com', ...args], {
    encoding: 'utf8', stdio: 'pipe',
  });

/** A folder with one commit, so the watch can read a local HEAD there. */
const repository = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-agent-merge-'));
  made.push(dir);
  git(dir, 'init', '-q');
  git(dir, 'commit', '--allow-empty', '-q', '-m', 'first');
  return dir;
};

/** One more commit in a folder, as a repair turn's work would make. */
const commit = (dir: string, message: string): void => {
  writeFileSync(join(dir, `${message}.txt`), message);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
};

const core: PullRequestDetail['core'] = {
  url: PAGE, number: 9, state: 'open', title: 'Repair the merge', headSha: 'abc123',
  baseRef: 'main', headRef: 'fix/x', draft: false,
};

/** A pull request with nothing wrong with it. */
const clean = (): PullRequestDetail => ({
  core,
  checks: { checks: [{ id: '1', name: 'build', type: 'checkRun', status: 'completed', conclusion: 'success', required: true }], requirednessComplete: true },
  mergeability: { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', viewerCanMerge: true, allowedMergeMethods: ['SQUASH', 'MERGE', 'REBASE'] },
  reviewThreads: [],
  submittedReviews: [],
  topLevelComments: [],
});

/** The same pull request with one failed required check. */
const failedCheck = (): PullRequestDetail => ({
  ...clean(),
  checks: { checks: [{ id: '1', name: 'build', type: 'checkRun', status: 'completed', conclusion: 'failure', required: true }], requirednessComplete: true },
});

/** The same pull request with one failed required check, on a workflow run the turn may read. */
const failedRun = (): PullRequestDetail => ({
  ...clean(),
  checks: {
    checks: [{
      id: '1', name: 'build', type: 'checkRun', status: 'completed', conclusion: 'failure', required: true,
      detailsUrl: 'https://github.com/softov/ahpd/actions/runs/77/job/12',
    }],
    requirednessComplete: true,
  },
});

/** The same pull request with one unresolved review thread. */
const reviewThread = (): PullRequestDetail => ({
  ...clean(),
  reviewThreads: [{
    id: 'PRRT_1', path: 'src/a.ts', line: 12, isResolved: false,
    comments: [{ author: 'reviewer', body: 'This leaks.', createdAt: '2026-11-01T00:00:00Z' }],
  }],
});

/** The same pull request with a conflict against its base. */
const conflict = (): PullRequestDetail => ({
  ...clean(),
  mergeability: { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', viewerCanMerge: true },
});

interface WatchTest {
  merge: ReturnType<typeof createAgentMerge>;
  wake: ReturnType<typeof vi.fn>;
  timer: { fire(): void; cancelled: number };
  setDetail(detail: PullRequestDetail | undefined): void;
  setConfig(key: string, value: unknown): void;
  setJobs(jobs: PullRequestJob[]): void;
  setPending(pending: boolean): void;
  setMergeResult(result: PullRequestMergeResult): void;
  mergeCalls: { method: string; headSha: string }[];
  writes: string[];
}

/** One watch over a fake host: a read of the pull request, a turn that records itself, and a timer that waits for its fire. */
const watch = (folder = FOLDER): WatchTest => {
  let detail: PullRequestDetail | undefined = clean();
  const config: Record<string, unknown> = {};
  const wake = vi.fn(async (_session: string, _chat: string, _prompt: string, _sender: Owner | undefined) => {});
  let armed: (() => void) | undefined;
  let jobs: PullRequestJob[] = [];
  let pending = false;
  let mergeResult: PullRequestMergeResult = { outcome: 'merged' };
  const mergeCalls: { method: string; headSha: string }[] = [];
  const writes: string[] = [];
  const timer = {
    cancelled: 0,
    fire: () => { const fire = armed; armed = undefined; fire?.(); },
  };
  const ctx = {
    options: {
      now: () => new Date('2026-11-10T08:00:00Z'),
      timer: (fire: () => void): { cancel(): void } => {
        armed = fire;
        return { cancel: () => { timer.cancelled += 1; } };
      },
      github: {
        resource: { resource: 'https://github.com', scopes_supported: [] },
        detail: async () => detail,
        jobs: async () => jobs,
        jobLog: async () => ({ text: 'setup\nsome error here\ncleanup', truncated: false }),
        pendingReview: async () => pending,
        replyToReviewThread: async () => { writes.push('reply'); return { commentId: 'C1', state: 'PUBLISHED' }; },
        resolveReviewThread: async () => { writes.push('resolve'); return true; },
        rerunWorkflow: async () => { writes.push('rerun'); return true; },
        merge: async (_url: string, method: string, headSha: string) => {
          mergeCalls.push({ method, headSha });
          return mergeResult;
        },
      },
    },
    rootConfig: config,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    closed: false,
    byChat: new Map([[CHAT, { uri: CHAT, chat: { workingDirectories: () => [folder], chatState: () => ({}) } }]]),
    sessionOfChat: () => SESSION,
    dirOf: () => folder,
    describes: () => ({ _meta: { git: { branchName: 'fix/x' }, github: { pullRequestUrls: [PAGE] } } }),
    refreshPullRequests: async () => false,
    getAuthToken: () => 'gho_x',
    beginWakeTurn: wake,
  } as unknown as HostContext;
  return {
    merge: createAgentMerge(ctx),
    wake,
    timer,
    setDetail: (one) => { detail = one; },
    setConfig: (key, value) => { config[key] = value; },
    setJobs: (list) => { jobs = list; },
    setPending: (value) => { pending = value; },
    setMergeResult: (result) => { mergeResult = result; },
    mergeCalls,
    writes,
  };
};

const promptOf = (wake: ReturnType<typeof vi.fn>): string => String((wake.mock.calls[0] as unknown[] | undefined)?.[2] ?? '');

describe('a folder with Agent Merge on', () => {
  it('starts one repair turn for a failed required check', async () => {
    const host = watch();
    host.setDetail(failedCheck());
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    expect(host.wake).toHaveBeenCalledTimes(1);
    expect(promptOf(host.wake)).toContain('fix failed required CI checks');
    expect(promptOf(host.wake)).toContain('Authorized actions this run: fix failed required CI checks');
    // The check's name is in the state, and the pull request is on the turn.
    expect(promptOf(host.wake)).toContain('build');
    expect(host.merge.turnOf(CHAT)?.actions).toEqual(['fixCI']);
    expect(host.merge.turnOf(CHAT)?.pullRequestUrl).toBe(PAGE);
  });

  it('starts one repair turn for a new review thread, naming the thread', async () => {
    const host = watch();
    host.setDetail(reviewThread());
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    expect(host.wake).toHaveBeenCalledTimes(1);
    expect(promptOf(host.wake)).toContain('address review feedback');
    expect(promptOf(host.wake)).toContain('PRRT_1');
    expect(promptOf(host.wake)).toContain('> reviewer: This leaks.');
    expect(host.merge.turnOf(CHAT)?.actions).toEqual(['addressReviews']);
  });

  it('starts one repair turn for a conflict', async () => {
    const host = watch();
    host.setDetail(conflict());
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    expect(host.wake).toHaveBeenCalledTimes(1);
    expect(promptOf(host.wake)).toContain('resolve conflicts');
    expect(host.merge.turnOf(CHAT)?.actions).toEqual(['resolveConflicts']);
  });

  it('starts none where the key is turned off', async () => {
    const host = watch();
    host.setDetail(failedCheck());
    host.setConfig('agentMerge.fixCI', false);
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    expect(host.wake).not.toHaveBeenCalled();
    expect(host.merge.turnOf(CHAT)).toBeUndefined();
  });

  it('starts none where the folder turned the action off, even with the key on', async () => {
    const host = watch();
    host.setDetail(reviewThread());
    await host.merge.enable(CHAT, undefined, { addressReviews: false });
    await host.merge.refresh(CHAT);
    expect(host.wake).not.toHaveBeenCalled();
  });

  it('never merges, whatever else the pull request would allow', async () => {
    const host = watch();
    host.setConfig('agentMerge.mergePullRequest', 'never');
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    expect(host.wake).not.toHaveBeenCalled();
    expect(host.mergeCalls).toEqual([]);
    expect(host.merge.stateOf(CHAT)).toBeDefined();
  });

  it('merges a ready pull request with the method it chose, and stops watching', async () => {
    const host = watch();
    host.setConfig('agentMerge.mergePullRequest', 'always');
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    // `auto` prefers squash, and the merge is pinned to the head it read.
    expect(host.mergeCalls).toEqual([{ method: 'SQUASH', headSha: 'abc123' }]);
    expect(host.wake).not.toHaveBeenCalled();
    expect(host.merge.stateOf(CHAT)).toBeUndefined();
  });

  it('uses an explicit merge method the repository allows', async () => {
    const host = watch();
    host.setConfig('agentMerge.mergePullRequest', 'always');
    host.setConfig('agentMerge.mergeMethod', 'merge');
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    expect(host.mergeCalls).toEqual([{ method: 'MERGE', headSha: 'abc123' }]);
  });

  it('does not merge with a method the repository does not allow', async () => {
    const host = watch();
    host.setConfig('agentMerge.mergePullRequest', 'always');
    host.setConfig('agentMerge.mergeMethod', 'rebase');
    host.setDetail({ ...clean(), mergeability: { ...clean().mergeability, allowedMergeMethods: ['SQUASH'] } });
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    expect(host.mergeCalls).toEqual([]);
    expect(host.merge.stateOf(CHAT)).toBeDefined();
  });

  it('keeps watching when GitHub refuses the merge', async () => {
    const host = watch();
    host.setConfig('agentMerge.mergePullRequest', 'always');
    host.setMergeResult({ outcome: 'refused', message: 'Pull request is not mergeable' });
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    expect(host.mergeCalls).toHaveLength(1);
    expect(host.merge.stateOf(CHAT)).toBeDefined();
  });

  it('merges while unchanged when no repair turn has run', async () => {
    const host = watch(repository());
    host.setConfig('agentMerge.mergePullRequest', 'ifUnchanged');
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    expect(host.mergeCalls).toEqual([{ method: 'SQUASH', headSha: 'abc123' }]);
  });

  it('merges while unchanged when the repair turn committed nothing', async () => {
    const dir = repository();
    const host = watch(dir);
    host.setConfig('agentMerge.mergePullRequest', 'ifUnchanged');
    host.setDetail(failedCheck());
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    expect(host.wake).toHaveBeenCalledTimes(1);
    // The baseline is the worktree the turn started on.
    expect(host.merge.stateOf(CHAT)?.repairBaseCommit).toMatch(/^[0-9a-f]{40}$/);
    host.setDetail(clean());
    host.merge.turnEnded(CHAT);
    await vi.waitFor(() => { expect(host.mergeCalls).toHaveLength(1); });
    expect(host.mergeCalls[0]).toEqual({ method: 'SQUASH', headSha: 'abc123' });
    expect(host.merge.stateOf(CHAT)).toBeUndefined();
  });

  it('turns ifUnchanged off once a repair turn commits, and merges nothing', async () => {
    const dir = repository();
    const host = watch(dir);
    host.setConfig('agentMerge.mergePullRequest', 'ifUnchanged');
    host.setDetail(failedCheck());
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    expect(host.wake).toHaveBeenCalledTimes(1);
    commit(dir, 'repair');
    host.setDetail(clean());
    host.merge.turnEnded(CHAT);
    await vi.waitFor(() => { expect(host.merge.stateOf(CHAT)?.overrides?.mergePullRequest).toBe('never'); });
    // The choice says what will happen, and the baseline is gone with it.
    expect(host.merge.stateOf(CHAT)?.repairBaseCommit).toBeUndefined();
    expect(host.mergeCalls).toEqual([]);
    await host.merge.refresh(CHAT);
    expect(host.mergeCalls).toEqual([]);
    expect(host.merge.stateOf(CHAT)).toBeDefined();
  });

  it('starts a fresh baseline when ifUnchanged is selected again', async () => {
    const dir = repository();
    const host = watch(dir);
    host.setConfig('agentMerge.mergePullRequest', 'ifUnchanged');
    host.setDetail(failedCheck());
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    commit(dir, 'repair');
    host.setDetail(clean());
    host.merge.turnEnded(CHAT);
    await vi.waitFor(() => { expect(host.merge.stateOf(CHAT)?.overrides?.mergePullRequest).toBe('never'); });
    // Selecting it afresh does not hold the earlier repair work against it.
    const answer = JSON.parse(await call(setAgentMergeEnabledToolName, { enabled: true, mergePullRequest: 'ifUnchanged' }, host.merge)) as Record<string, unknown>;
    expect((answer.configuration as Record<string, unknown>).mergePullRequest).toBe('ifUnchanged');
    expect(host.merge.stateOf(CHAT)?.repairBaseCommit).toBeUndefined();
    await host.merge.refresh(CHAT);
    expect(host.mergeCalls).toHaveLength(1);
  });

  it('stops the folder\'s watch when a review reply waits at the turn\'s end', async () => {
    const host = watch();
    host.setDetail(reviewThread());
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    expect(host.wake).toHaveBeenCalledTimes(1);
    host.merge.replyPending(CHAT);
    host.merge.turnEnded(CHAT);
    expect(host.merge.stateOf(CHAT)).toBeUndefined();
    expect(host.merge.turnOf(CHAT)).toBeUndefined();
    // And a read after it asks no more turns.
    await host.merge.refresh(CHAT);
    expect(host.wake).toHaveBeenCalledTimes(1);
  });

  it('asks the pull request again at the turn\'s end, and keeps waiting between reads', async () => {
    const host = watch();
    host.setDetail(failedCheck());
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    expect(host.wake).toHaveBeenCalledTimes(1);
    // The same blockers within the cooldown are not asked again.
    host.merge.turnEnded(CHAT);
    await Promise.resolve();
    expect(host.wake).toHaveBeenCalledTimes(1);
    expect(host.merge.stateOf(CHAT)?.totalPromptCount).toBe(1);
  });

  it('forgets a session\'s watches when the session goes', async () => {
    const host = watch();
    host.setDetail(conflict());
    await host.merge.enable(CHAT, undefined);
    host.merge.forgetSession(SESSION);
    expect(host.merge.stateOf(CHAT)).toBeUndefined();
    expect(host.timer.cancelled).toBeGreaterThan(0);
  });

  it('answers the state it was turned on with, and keeps the branch it watches', async () => {
    const host = watch();
    await host.merge.enable(CHAT, undefined);
    const state = host.merge.stateOf(CHAT);
    expect(state?.enabled).toBe(true);
    expect(state?.target?.branchName).toBe('fix/x');
    expect(state?.target?.pullRequestUrl).toBe(PAGE);
  });

  it('watches the branch and page an operation names, not the facts the folder had before it', () => {
    const host = watch();
    // The session still says `fix/x` and the old page; the create that asked
    // for Agent Merge just opened a different branch off the base.
    const state = host.merge.enableFor(CHAT, {
      branchName: 'agent/port-the-kqueue-build',
      pullRequestUrl: 'https://github.com/softov/ahpd/pull/10',
    });
    expect(state.enabled).toBe(true);
    expect(state.target?.branchName).toBe('agent/port-the-kqueue-build');
    expect(state.target?.pullRequestUrl).toBe('https://github.com/softov/ahpd/pull/10');
    expect(host.merge.stateOf(CHAT)).toBe(state);
  });
});

/** One of the four tools, as the model calls it. */
const toolNamed = (name: string): { definition: { name: string }; run(input: Record<string, unknown>, at: ToolCall): Promise<string> | string } => {
  const found = agentMergeTools().find((one) => one.definition.name === name) as unknown as
    { definition: { name: string }; run(input: Record<string, unknown>, at: ToolCall): Promise<string> | string } | undefined;
  if (found === undefined) throw new Error(`No Agent Merge tool named ${name}.`);
  return found;
};

/** The bind the host gives a tool call: the accessor of the chat the call runs in. */
const at = (merge: ReturnType<typeof createAgentMerge>): ToolCall =>
  ({ agentMerge: () => merge.accessor(CHAT, undefined) }) as unknown as ToolCall;

const call = async (name: string, input: Record<string, unknown>, merge: ReturnType<typeof createAgentMerge>): Promise<string> =>
  await toolNamed(name).run(input, at(merge));

const failure = (overrides: Partial<PullRequestJob> = {}): PullRequestJob => ({
  id: '12', runId: '77', name: 'build', status: 'completed', conclusion: 'failure',
  steps: [{ number: 1, name: 'compile', conclusion: 'failure' }], ...overrides,
});

describe('the Agent Merge tools', () => {
  it('turns monitoring on and answers the configuration it will use', async () => {
    const host = watch();
    const answer = JSON.parse(await call(setAgentMergeEnabledToolName, { enabled: true }, host.merge)) as Record<string, unknown>;
    expect(answer.enabled).toBe(true);
    expect((answer.configuration as Record<string, unknown>).mergePullRequest).toBe('never');
    expect((answer.target as Record<string, unknown>).branchName).toBe('fix/x');
    expect(answer.monitoring).toBe('pending');
  });

  it('refuses the three repair tools outside a turn Agent Merge started', async () => {
    const host = watch();
    await expect(call(readAgentMergeCIToolName, {}, host.merge)).rejects.toThrow(/only available in a turn Agent Merge started/);
    await expect(call(replyToAgentMergeReviewThreadToolName, { threadId: 'PRRT_1', body: 'Fixed.' }, host.merge)).rejects.toThrow(/only available in a turn Agent Merge started/);
    await expect(call(rerunAgentMergeWorkflowToolName, { runId: '77' }, host.merge)).rejects.toThrow(/only available in a turn Agent Merge started/);
  });

  it('reads the failed job of the repair turn, then a numbered search of its log', async () => {
    const host = watch();
    host.setDetail(failedRun());
    host.setJobs([failure()]);
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    const summary = JSON.parse(await call(readAgentMergeCIToolName, {}, host.merge)) as Record<string, unknown>;
    expect(summary.pullRequest).toBe(PAGE);
    expect(summary.headSha).toBe('abc123');
    expect(summary.complete).toBe(true);
    const jobs = summary.jobs as Record<string, unknown>[];
    expect(jobs[0]?.jobId).toBe('12');
    expect(jobs[0]?.evidenceId).toBe('12');
    expect(String(jobs[0]?.excerpt)).toContain('some error here');
    const searched = JSON.parse(await call(readAgentMergeCIToolName, { mode: 'search', evidenceId: '12', query: 'error', contextLines: 0 }, host.merge)) as Record<string, unknown>;
    expect(searched.matches).toBe(1);
    expect((searched.lines as string[])[0]).toBe('2: some error here');
  });

  it('refuses a job or a cursor the turn never handed out', async () => {
    const host = watch();
    host.setDetail(failedRun());
    host.setJobs([failure()]);
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    await expect(call(readAgentMergeCIToolName, { jobId: '99' }, host.merge)).rejects.toThrow(/not a failed job authorized/);
    await expect(call(readAgentMergeCIToolName, { cursor: 'page:2' }, host.merge)).rejects.toThrow(/cursor is not one this tool returned/);
  });

  it('publishes a review reply before it resolves the thread', async () => {
    const host = watch();
    host.setDetail(reviewThread());
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    const answer = JSON.parse(await call(replyToAgentMergeReviewThreadToolName, { threadId: 'PRRT_1', body: 'Fixed in abc.' }, host.merge)) as Record<string, unknown>;
    expect(answer.reply).toBe('succeeded');
    expect(answer.published).toBe(true);
    expect(answer.resolved).toBe(true);
    expect(host.writes).toEqual(['reply', 'resolve']);
  });

  it('refuses a thread the turn was not asked about', async () => {
    const host = watch();
    host.setDetail(reviewThread());
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    await expect(call(replyToAgentMergeReviewThreadToolName, { threadId: 'PRRT_9', body: 'Fixed.' }, host.merge)).rejects.toThrow(/not an unresolved thread authorized/);
  });

  it('does not publish into the person\'s pending review, and stops monitoring at the turn\'s end', async () => {
    const host = watch();
    host.setDetail(reviewThread());
    host.setPending(true);
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    const answer = JSON.parse(await call(replyToAgentMergeReviewThreadToolName, { threadId: 'PRRT_1', body: 'Fixed.' }, host.merge)) as Record<string, unknown>;
    expect(answer).toEqual({ reply: 'pending', threadId: 'PRRT_1', published: false });
    // Nothing was written, and the turn's end stops the folder's watch.
    expect(host.writes).toEqual([]);
    host.merge.turnEnded(CHAT);
    expect(host.merge.stateOf(CHAT)).toBeUndefined();
  });

  it('defers a rerun while the attempt runs, and asks once', async () => {
    const host = watch();
    host.setDetail(failedRun());
    host.setJobs([failure({ status: 'in_progress' })]);
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    const answer = JSON.parse(await call(rerunAgentMergeWorkflowToolName, { runId: '77' }, host.merge)) as Record<string, unknown>;
    expect(answer.outcome).toBe('deferred');
    expect(answer.headSha).toBe('abc123');
    await expect(call(rerunAgentMergeWorkflowToolName, { runId: '77' }, host.merge)).rejects.toThrow(/already asked/);
    expect(host.writes).toEqual([]);
  });

  it('reruns a finished workflow run once', async () => {
    const host = watch();
    host.setDetail(failedRun());
    host.setJobs([failure()]);
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    const answer = JSON.parse(await call(rerunAgentMergeWorkflowToolName, { runId: '77', failedJobsOnly: true }, host.merge)) as Record<string, unknown>;
    expect(answer.outcome).toBe('requested');
    expect(host.writes).toEqual(['rerun']);
  });

  it('refuses a run the turn\'s failed checks did not name', async () => {
    const host = watch();
    host.setDetail(failedRun());
    host.setJobs([failure()]);
    await host.merge.enable(CHAT, undefined);
    await host.merge.refresh(CHAT);
    await expect(call(rerunAgentMergeWorkflowToolName, { runId: '78' }, host.merge)).rejects.toThrow(/not one of this turn's failed required checks/);
  });
});
