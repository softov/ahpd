/** Pull requests, asked of GitHub. */

import { execFile } from 'node:child_process';
import type { NewPullRequest, PullRequest, PullRequests } from './types/github.js';

/** The reference host's resource for a github.com token, verbatim. */
const RESOURCE = {
  resource: 'https://api.github.com/repos',
  resource_name: 'GitHub Repository',
  authorization_servers: ['https://github.com/login/oauth'],
  scopes_supported: ['repo'],
  required: false,
};

/** At most this many for one branch: the row draws one and lists the rest. */
const MOST = 10;

/**
 * The pull requests of a branch, as a host's `PullRequests`.
 *
 * Two ways to ask, tried in this order. With a token a client lent through
 * `authenticate`, the REST API directly - the same route the reference host
 * takes, `pulls?head=owner:branch&state=all`, sorted by last update. Without
 * one, `gh pr list`, which reads the login `gh auth login` left on this
 * machine; a machine with neither answers none rather than failing.
 *
 * ```ts
 * createHost({ path, agents, directories: gitBranches(), github: githubPullRequests() });
 * ```
 */
export function githubPullRequests(): PullRequests {
  /** GitHub's own word for a state, as the row's. */
  const stateOf = (state: unknown, merged: boolean): PullRequest['state'] => {
    if (merged) return 'merged';
    return String(state ?? '').toLowerCase() === 'open' ? 'open' : 'closed';
  };

  const byApi = async (owner: string, repo: string, branch: string, token: string): Promise<PullRequest[]> => {
    const head = encodeURIComponent(`${owner}:${branch}`);
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls?head=${head}&state=all&sort=updated&direction=desc&per_page=${MOST}`;
    const answer = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!answer.ok) throw new Error(`GitHub answered ${answer.status} for ${owner}/${repo}#${branch}`);
    const items = await answer.json() as { html_url?: unknown; state?: unknown; merged_at?: unknown }[];
    return items
      .filter((item) => typeof item.html_url === 'string')
      .map((item) => ({ url: item.html_url as string, state: stateOf(item.state, item.merged_at != null) }));
  };

  const byGh = (owner: string, repo: string, branch: string, cwd: string): Promise<PullRequest[]> =>
    new Promise((answer, refuse) => {
      execFile('gh', [
        'pr', 'list', '--repo', `${owner}/${repo}`, '--head', branch, '--state', 'all',
        '--limit', String(MOST), '--json', 'url,state,updatedAt',
      ], { cwd, timeout: 10_000, maxBuffer: 1 << 20 }, (error, out, bad) => {
        if (error) {
          refuse(new Error(bad.toString().trim() || error.message));
          return;
        }
        const items = JSON.parse(out.toString()) as { url?: unknown; state?: unknown; updatedAt?: unknown }[];
        answer(items
          .filter((item) => typeof item.url === 'string')
          .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
          .map((item) => ({ url: item.url as string, state: stateOf(item.state, String(item.state).toUpperCase() === 'MERGED') })));
      });
    });

  const createByApi = async (owner: string, repo: string, wanted: NewPullRequest, token: string): Promise<PullRequest> => {
    const answer = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ title: wanted.title, body: wanted.body, head: wanted.head, base: wanted.base, draft: wanted.draft }),
      signal: AbortSignal.timeout(20_000),
    });
    const said = await answer.json().catch(() => ({})) as { html_url?: unknown; message?: unknown; errors?: { message?: unknown }[] };
    if (!answer.ok || typeof said.html_url !== 'string') {
      const why = [said.message, ...(said.errors ?? []).map((one) => one.message)].filter((one) => typeof one === 'string').join(': ');
      throw new Error(`GitHub would not open the pull request (${answer.status})${why ? `: ${why}` : ''}`);
    }
    return { url: said.html_url, state: 'open' };
  };

  const createByGh = (owner: string, repo: string, wanted: NewPullRequest, cwd: string): Promise<PullRequest> =>
    new Promise((answer, refuse) => {
      execFile('gh', [
        'pr', 'create', '--repo', `${owner}/${repo}`, '--head', wanted.head, '--base', wanted.base,
        '--title', wanted.title, '--body', wanted.body, ...(wanted.draft ? ['--draft'] : []),
      ], { cwd, timeout: 30_000, maxBuffer: 1 << 20 }, (error, out, bad) => {
        if (error) {
          refuse(new Error(bad.toString().trim() || error.message));
          return;
        }
        // `gh` prints the page it opened, and nothing else, on success.
        const url = out.toString().trim().split('\n').find((line) => /^https:\/\//.test(line));
        if (url === undefined) {
          refuse(new Error(`gh opened a pull request but did not say where: ${out.toString().trim()}`));
          return;
        }
        answer({ url, state: 'open' });
      });
    });

  return {
    resource: RESOURCE,
    forBranch: async ({ owner, repo }, branch, token, cwd) => {
      if (token !== undefined) return byApi(owner, repo, branch, token);
      return byGh(owner, repo, branch, cwd);
    },
    create: async ({ owner, repo }, wanted, token, cwd) => {
      if (token !== undefined) return createByApi(owner, repo, wanted, token);
      return createByGh(owner, repo, wanted, cwd);
    },
  };
}
