import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { posix } from '../../../tools/posix.ts';
import { githubPullRequests } from '../src/repo/github.js';

/*
 * The pull request of a branch, asked two ways.
 *
 * With a token it is the REST route the reference host takes, and the answer
 * is GitHub's own JSON; without one it is `gh`, whose JSON spells the state
 * differently. Both come out as the same three words, because the row that
 * draws them reads one spelling.
 */

let made: string[] = [];
const was = { path: process.env.PATH };
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
  process.env.PATH = was.path;
  vi.unstubAllGlobals();
});

/** A `gh` on the PATH that answers what it is told to, and records the call. */
const fakeGh = (answer: string, exit = 0): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-gh-'));
  made.push(dir);
  writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho "$@" > "${dir}/asked"\nif [ ${exit} -ne 0 ]; then echo 'gh: not logged in' >&2; exit ${exit}; fi\ncat <<'JSON'\n${answer}\nJSON\n`);
  chmodSync(join(dir, 'gh'), 0o755);
  process.env.PATH = `${dir}:${process.env.PATH ?? ''}`;
  return dir;
};

describe('the pull requests of a branch', () => {
  it('asks the API as the person who lent the token, and reads GitHub\'s own words', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      return {
        ok: true,
        status: 200,
        json: async () => [
          { html_url: 'https://github.com/softov/ahpd/pull/9', state: 'closed', merged_at: '2026-09-13T10:00:00Z' },
          { html_url: 'https://github.com/softov/ahpd/pull/7', state: 'open', merged_at: null, title: 'Port the kqueue build', created_at: '2026-09-01T08:00:00Z' },
          { html_url: 'https://github.com/softov/ahpd/pull/2', state: 'closed', merged_at: null },
        ],
      };
    });
    const found = await githubPullRequests().forBranch({ owner: 'softov', repo: 'ahpd' }, 'fix/kqueue', 'gho_x', '/tmp');
    // When each was opened too, which a session's baseline is read by.
    expect(found).toEqual([
      { url: 'https://github.com/softov/ahpd/pull/9', state: 'merged' },
      { url: 'https://github.com/softov/ahpd/pull/7', state: 'open', title: 'Port the kqueue build', createdAt: '2026-09-01T08:00:00Z' },
      { url: 'https://github.com/softov/ahpd/pull/2', state: 'closed' },
    ]);
    // The reference host's route: head as owner:branch, every state, newest update first.
    expect(calls[0]?.url).toBe('https://api.github.com/repos/softov/ahpd/pulls?head=softov%3Afix%2Fkqueue&state=all&sort=updated&direction=desc&per_page=10');
    expect(calls[0]?.headers.Authorization).toBe('Bearer gho_x');
  });

  it('says so when GitHub refuses, rather than answering none', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(githubPullRequests().forBranch({ owner: 'softov', repo: 'ahpd' }, 'main', 'bad', '/tmp')).rejects.toThrow('401');
  });

  // `fakeGh` puts a `#!/bin/sh` script first on `PATH`, and the host runs it:
  // a POSIX shell outside a terminal, which Windows has not.
  it.skipIf(!posix)('asks gh without a token, and reads its spelling of a state', async () => {
    const dir = fakeGh(JSON.stringify([
      { url: 'https://github.com/softov/ahpd/pull/7', state: 'OPEN', title: 'The fix', updatedAt: '2026-09-12T00:00:00Z', createdAt: '2026-09-01T08:00:00Z' },
      { url: 'https://github.com/softov/ahpd/pull/9', state: 'MERGED', updatedAt: '2026-09-13T00:00:00Z' },
    ]));
    const found = await githubPullRequests().forBranch({ owner: 'softov', repo: 'ahpd' }, 'fix/kqueue', undefined, dir);
    expect(found).toEqual([
      { url: 'https://github.com/softov/ahpd/pull/9', state: 'merged' },
      { url: 'https://github.com/softov/ahpd/pull/7', state: 'open', title: 'The fix', createdAt: '2026-09-01T08:00:00Z' },
    ]);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(dir, 'asked'), 'utf8').trim())
      .toBe('pr list --repo softov/ahpd --head fix/kqueue --state all --limit 10 --json url,state,title,updatedAt,createdAt');
  });

  // `fakeGh` puts a `#!/bin/sh` script first on `PATH`, and the host runs it:
  // a POSIX shell outside a terminal, which Windows has not.
  it.skipIf(!posix)('says what gh said when gh could not answer', async () => {
    const dir = fakeGh('[]', 4);
    await expect(githubPullRequests().forBranch({ owner: 'softov', repo: 'ahpd' }, 'main', undefined, dir)).rejects.toThrow('not logged in');
  });
});

describe('one pull request by its page', () => {
  it('asks the API for each page, and reads a merged, an open and a closed one', async () => {
    const asked: string[] = [];
    const answers: Record<string, unknown> = {
      '9': { html_url: 'https://github.com/softov/ahpd/pull/9', state: 'closed', merged_at: '2026-09-13T10:00:00Z', title: 'Merged' },
      '7': { html_url: 'https://github.com/softov/ahpd/pull/7', state: 'open', merged_at: null, title: 'Open' },
      '2': { html_url: 'https://github.com/softov/ahpd/pull/2', state: 'closed', merged_at: null, title: 'Closed' },
    };
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
      asked.push(`${url} ${init.headers.Authorization}`);
      const number = url.slice(url.lastIndexOf('/') + 1);
      const found = answers[number];
      return found === undefined
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => found };
    });
    const port = githubPullRequests();
    expect(await port.byUrl?.('https://github.com/softov/ahpd/pull/9', 'gho_x', '/tmp'))
      .toEqual({ url: 'https://github.com/softov/ahpd/pull/9', state: 'merged', title: 'Merged' });
    expect(await port.byUrl?.('https://github.com/softov/ahpd/pull/7', 'gho_x', '/tmp'))
      .toEqual({ url: 'https://github.com/softov/ahpd/pull/7', state: 'open', title: 'Open' });
    expect(await port.byUrl?.('https://github.com/softov/ahpd/pull/2/', 'gho_x', '/tmp'))
      .toEqual({ url: 'https://github.com/softov/ahpd/pull/2', state: 'closed', title: 'Closed' });
    // No pull request at the page, and a page that is not a pull request, are none.
    expect(await port.byUrl?.('https://github.com/softov/ahpd/pull/404', 'gho_x', '/tmp')).toBeUndefined();
    expect(await port.byUrl?.('https://example.com/softov/ahpd/pull/9', 'gho_x', '/tmp')).toBeUndefined();
    expect(asked).toEqual([
      'https://api.github.com/repos/softov/ahpd/pulls/9 Bearer gho_x',
      'https://api.github.com/repos/softov/ahpd/pulls/7 Bearer gho_x',
      'https://api.github.com/repos/softov/ahpd/pulls/2 Bearer gho_x',
      'https://api.github.com/repos/softov/ahpd/pulls/404 Bearer gho_x',
    ]);
  });

  it('says so when GitHub refuses, rather than answering none', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(githubPullRequests().byUrl?.('https://github.com/softov/ahpd/pull/9', 'bad', '/tmp')).rejects.toThrow('401');
  });

  // `fakeGh` puts a `#!/bin/sh` script first on `PATH`, and the host runs it:
  // a POSIX shell outside a terminal, which Windows has not.
  it.skipIf(!posix)('asks gh without a token, and reads its spelling of a state', async () => {
    const dir = fakeGh(JSON.stringify({ url: 'https://github.com/softov/ahpd/pull/9', state: 'MERGED', title: 'The fix' }));
    expect(await githubPullRequests().byUrl?.('https://github.com/softov/ahpd/pull/9', undefined, dir))
      .toEqual({ url: 'https://github.com/softov/ahpd/pull/9', state: 'merged', title: 'The fix' });
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(dir, 'asked'), 'utf8').trim()).toBe('pr view https://github.com/softov/ahpd/pull/9 --json url,state,title');
  });
});

describe('what a repair turn reads of one pull request', () => {
  const page = 'https://github.com/softov/ahpd/pull/9';

  /** The REST answers and the one query a detail read asks for, keyed by what asks. */
  const detailAnswers = (): Map<string, unknown> => new Map<string, unknown>([
    ['repos/softov/ahpd', {
      allow_merge_commit: true,
      allow_squash_merge: true,
      allow_rebase_merge: false,
    }],
    ['repos/softov/ahpd/pulls/9', {
      html_url: page,
      number: 9,
      state: 'open',
      merged_at: null,
      title: 'Repair the merge',
      draft: false,
      mergeable: true,
      mergeable_state: 'clean',
      head: { sha: 'abc123', ref: 'fix/x', repo: { permissions: { push: false } } },
      base: { ref: 'main', repo: { permissions: { push: true } } },
    }],
    ['repos/softov/ahpd/commits/abc123/check-runs?per_page=100', {
      check_runs: [{ id: 1, name: 'build', status: 'completed', conclusion: 'success', details_url: 'https://github.com/softov/ahpd/runs/1' }],
    }],
    ['repos/softov/ahpd/commits/abc123/status', {
      statuses: [{ context: 'ci/lint', state: 'success', target_url: 'https://ci.example.com/lint' }],
    }],
    ['repos/softov/ahpd/branches/main/protection/required_status_checks', {
      contexts: ['build'],
      checks: [{ context: 'ci/lint' }],
    }],
  ]);

  const answerFor = (answers: Map<string, unknown>) => async (url: string) => {
    if (url === 'https://api.github.com/graphql') {
      return {
        ok: true, status: 200,
        json: async () => ({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: { nodes: [{
                  id: 'PRRT_1', path: 'src/a.ts', line: 12, isResolved: false,
                  comments: { nodes: [{ author: { login: 'reviewer' }, body: 'This leaks.', createdAt: '2026-11-01T00:00:00Z' }] },
                }] },
                reviews: { nodes: [{ id: 'PRR_1', state: 'CHANGES_REQUESTED', body: 'Not yet.', submittedAt: '2026-11-01T01:00:00Z', author: { login: 'reviewer' } }] },
                comments: { nodes: [{ id: 'IC_1', body: 'A note.', createdAt: '2026-11-01T02:00:00Z', author: { login: 'softov' } }] },
              },
            },
          },
        }),
      };
    }
    const path = url.slice('https://api.github.com/'.length);
    const found = answers.get(path);
    return found === undefined
      ? { ok: false, status: 404, json: async () => ({}) }
      : { ok: true, status: 200, text: async () => JSON.stringify(found), json: async () => found };
  };

  it('reads the core, both kinds of check, mergeability and the reviews from the token', async () => {
    vi.stubGlobal('fetch', answerFor(detailAnswers()));
    const detail = await githubPullRequests().detail?.(page, 'gho_x', '/tmp');
    expect(detail).toEqual({
      core: {
        url: page, number: 9, state: 'open', title: 'Repair the merge', headSha: 'abc123',
        baseRef: 'main', headRef: 'fix/x', draft: false,
      },
      checks: {
        checks: [
          { id: '1', name: 'build', type: 'checkRun', status: 'completed', conclusion: 'success', required: true, detailsUrl: 'https://github.com/softov/ahpd/runs/1' },
          { id: 'ci/lint/success', name: 'ci/lint', type: 'statusContext', status: 'SUCCESS', required: true, detailsUrl: 'https://ci.example.com/lint' },
        ],
        requirednessComplete: true,
      },
      // What merging needs is on the base repository, not the head's fork, and
      // so are the methods the repository permits.
      mergeability: { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', viewerCanMerge: true, allowedMergeMethods: ['SQUASH', 'MERGE'] },
      reviewThreads: [{
        id: 'PRRT_1', path: 'src/a.ts', line: 12, isResolved: false,
        comments: [{ author: 'reviewer', body: 'This leaks.', createdAt: '2026-11-01T00:00:00Z' }],
      }],
      submittedReviews: [{ id: 'PRR_1', state: 'CHANGES_REQUESTED', author: 'reviewer', body: 'Not yet.', submittedAt: '2026-11-01T01:00:00Z' }],
      topLevelComments: [{ id: 'IC_1', author: 'softov', body: 'A note.', createdAt: '2026-11-01T02:00:00Z' }],
    });
  });

  it('marks requiredness unknown when branch protection cannot be read, rather than guessing', async () => {
    // A 403 is "you may not see the protection"; a 404 would be "the branch is
    // not protected", which is a complete answer of no required checks.
    const answers = answerFor(detailAnswers());
    vi.stubGlobal('fetch', async (url: string) => url.endsWith('/protection/required_status_checks')
      ? { ok: false, status: 403, json: async () => ({}) }
      : answers(url));
    const detail = await githubPullRequests().detail?.(page, 'gho_x', '/tmp');
    expect(detail?.checks.requirednessComplete).toBe(false);
    expect(detail?.checks.checks.map((check) => check.required)).toEqual([undefined, undefined]);
  });

  it('reads the jobs of a run, and caps a log at what readAgentMergeCI keeps', async () => {
    const job = {
      id: 7, run_id: 9, name: 'build', status: 'completed', conclusion: 'failure',
      head_sha: 'abc123', run_attempt: 1, check_run_url: 'https://api.github.com/repos/softov/ahpd/check-runs/1',
      steps: [{ number: 1, name: 'compile', status: 'completed', conclusion: 'failure' }],
    };
    const long = 'x'.repeat(50_000);
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/actions/runs/9/jobs?per_page=100')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ jobs: [job] }), json: async () => ({ jobs: [job] }) };
      }
      if (url.endsWith('/actions/jobs/7/logs')) {
        return { ok: true, status: 200, text: async () => long, json: async () => ({}) };
      }
      return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    });
    const port = githubPullRequests();
    expect(await port.jobs?.(page, '9', 'gho_x', '/tmp')).toEqual([{
      id: '7', runId: '9', name: 'build', status: 'completed', conclusion: 'failure',
      headSha: 'abc123', runAttempt: 1, checkRunId: '1',
      steps: [{ number: 1, name: 'compile', status: 'completed', conclusion: 'failure' }],
    }]);
    expect(await port.jobLog?.(page, '7', 'gho_x', '/tmp')).toEqual({ text: 'x'.repeat(48_000), truncated: true });
  });

  it('answers nothing for a log that is gone', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, text: async () => '', json: async () => ({}) }));
    expect(await githubPullRequests().jobLog?.(page, '7', 'gho_x', '/tmp')).toBeUndefined();
  });

  // `fakeGh` puts a `#!/bin/sh` script first on `PATH`, and the host runs it:
  // a POSIX shell outside a terminal, which Windows has not.
  it.skipIf(!posix)('reads it through gh too, when no token was lent', async () => {
    const dir = fakeGh(JSON.stringify({ jobs: [{ id: 7, run_id: 9, name: 'build' }] }));
    expect(await githubPullRequests().jobs?.(page, '9', undefined, dir)).toEqual([
      { id: '7', runId: '9', name: 'build' },
    ]);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(dir, 'asked'), 'utf8').trim())
      .toBe('api repos/softov/ahpd/actions/runs/9/jobs?per_page=100');
  });

  it('answers nothing where there is neither a token nor a gh to ask', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'ahpd-no-gh-'));
    made.push(empty);
    process.env.PATH = empty;
    expect(await githubPullRequests().detail?.(page, undefined, empty)).toBeUndefined();
    expect(await githubPullRequests().jobs?.(page, '9', undefined, empty)).toBeUndefined();
    expect(await githubPullRequests().jobLog?.(page, '7', undefined, empty)).toBeUndefined();
  });
});

describe('merging a pull request', () => {
  const page = 'https://github.com/softov/ahpd/pull/9';

  it('merges through the token at the head it was given, with the method it chose', async () => {
    const calls: { url: string; init: { method?: string; body?: string } }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { method?: string; body?: string }) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ merged: true, message: 'Pull Request successfully merged' }) };
    });
    const result = await githubPullRequests().merge?.(page, 'SQUASH', 'abc123', 'gho_x', '/tmp');
    expect(result).toEqual({ outcome: 'merged', message: 'Pull Request successfully merged' });
    expect(calls[0]?.url).toBe('https://api.github.com/repos/softov/ahpd/pulls/9/merge');
    expect(calls[0]?.init.method).toBe('PUT');
    // The head is GitHub's own check: a head that moved is refused, not merged.
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ merge_method: 'squash', sha: 'abc123' });
  });

  it('answers a refusal as GitHub gave it, rather than throwing', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 405, json: async () => ({ message: 'Pull Request is not mergeable' }) }));
    expect(await githubPullRequests().merge?.(page, 'MERGE', 'abc123', 'gho_x', '/tmp'))
      .toEqual({ outcome: 'refused', message: 'Pull Request is not mergeable' });
  });

  it('says the outcome is indeterminate when GitHub itself failed', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 502, json: async () => ({ message: 'Server Error' }) }));
    expect((await githubPullRequests().merge?.(page, 'REBASE', 'abc123', 'gho_x', '/tmp'))?.outcome).toBe('indeterminate');
  });

  it.skipIf(!posix)('merges through gh too, when no token was lent', async () => {
    const dir = fakeGh(JSON.stringify({ merged: true, message: 'Pull Request successfully merged' }));
    expect(await githubPullRequests().merge?.(page, 'MERGE', 'abc123', undefined, dir))
      .toEqual({ outcome: 'merged', message: 'Pull Request successfully merged' });
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(dir, 'asked'), 'utf8').trim())
      .toBe('api -X PUT repos/softov/ahpd/pulls/9/merge -f merge_method=merge -f sha=abc123');
  });

  it('refuses a page that is not a GitHub pull request', async () => {
    expect(await githubPullRequests().merge?.('https://example.com/pull/9', 'SQUASH', 'abc123', undefined, '/tmp'))
      .toEqual({ outcome: 'refused', message: 'https://example.com/pull/9 is not a GitHub pull request page' });
  });
});

