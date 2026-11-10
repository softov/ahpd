/** Pull requests, asked of GitHub. */

import { execFile } from 'node:child_process';
import type {
  NewPullRequest, PullRequest, PullRequestCheck, PullRequestChecks, PullRequestComment, PullRequestCore, PullRequestDetail,
  PullRequestFeedbackComment, PullRequestJob, PullRequestJobLog, PullRequestJobStep, PullRequestMergeability, PullRequestMergeMethod,
  PullRequestMergeResult, PullRequestReview, PullRequestReviewThread, PullRequestThreadReply, PullRequests,
} from '../types/github.js';

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
 * `readAgentMergeCI`'s cap on one job log, in characters, and what the tool
 * says a bigger log is: a bounded prefix and the word that it was cut.
 * https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentMergeCIEvidence.ts#L17
 */
const LOG_LIMIT = 48_000;

/** GitHub's two ways for the repair reads: REST, and the one query GraphQL. */
const API = 'https://api.github.com';

/**
 * The review threads, reviews and conversation comments of one pull request,
 * in one query.
 *
 * GitHub resolves a thread only over GraphQL: the REST comments carry a
 * reply's parent but no resolution, so the watch could not tell a thread that
 * still wants an answer from one that is done.
 */
const FEEDBACK_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) { nodes { id isResolved path line comments(first: 50) { nodes { author { login } body createdAt } } } }
      reviews(first: 100) { nodes { id state body submittedAt author { login } } }
      comments(first: 100) { nodes { id body createdAt author { login } } }
    }
  }
}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const arrayOf = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const textOf = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;

/** How a failed `gh` call says `gh` itself is not on this machine. */
const ghAbsent = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

/** How a failed `gh` call says GitHub has nothing at the path. */
const ghNothing = (error: unknown): boolean => /HTTP 404|Not Found \(HTTP 404\)/.test(String((error as Error | undefined)?.message ?? ''));

/** A job log, cut to the cap and saying whether it was. */
const capped = (text: string): PullRequestJobLog =>
  text.length > LOG_LIMIT ? { text: text.slice(0, LOG_LIMIT), truncated: true } : { text, truncated: false };

/**
 * The pull requests of a branch, as a host's `PullRequests`.
 *
 * Two ways to ask, tried in this order. With a token a client lent through
 * `authenticate`, the REST API directly - the same route the reference host
 * takes, `pulls?head=owner:branch&state=all`, sorted by last update. Without
 * one, `gh pr list`, which reads the login `gh auth login` left on this
 * machine; a machine with neither answers none rather than failing.
 *
 * One pull request is asked for by its page the same two ways: the API's
 * `pulls/<number>`, or `gh pr view`.
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
    const items = await answer.json() as { html_url?: unknown; state?: unknown; merged_at?: unknown; title?: unknown; created_at?: unknown }[];
    return items
      .filter((item) => typeof item.html_url === 'string')
      .map((item) => ({
        url: item.html_url as string,
        state: stateOf(item.state, item.merged_at != null),
        ...(typeof item.title === 'string' ? { title: item.title } : {}),
        ...(typeof item.created_at === 'string' ? { createdAt: item.created_at } : {}),
      }));
  };

  const byGh = (owner: string, repo: string, branch: string, cwd: string): Promise<PullRequest[]> =>
    new Promise((answer, refuse) => {
      execFile('gh', [
        'pr', 'list', '--repo', `${owner}/${repo}`, '--head', branch, '--state', 'all',
        '--limit', String(MOST), '--json', 'url,state,title,updatedAt,createdAt',
      ], { cwd, timeout: 10_000, maxBuffer: 1 << 20, windowsHide: true }, (error, out, bad) => {
        if (error) {
          refuse(new Error(bad.toString().trim() || error.message));
          return;
        }
        const items = JSON.parse(out.toString()) as { url?: unknown; state?: unknown; updatedAt?: unknown; title?: unknown; createdAt?: unknown }[];
        answer(items
          .filter((item) => typeof item.url === 'string')
          .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
          .map((item) => ({
            url: item.url as string,
            state: stateOf(item.state, String(item.state).toUpperCase() === 'MERGED'),
            ...(typeof item.title === 'string' ? { title: item.title } : {}),
            ...(typeof item.createdAt === 'string' ? { createdAt: item.createdAt } : {}),
          })));
      });
    });

  /** A pull request's page as its repository and number, or nothing for a page that is not one. */
  const pageOf = (url: string): { owner: string; repo: string; number: string } | undefined => {
    const found = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(url.trim());
    if (found === null) return undefined;
    return { owner: found[1] as string, repo: found[2] as string, number: found[3] as string };
  };

  const oneByApi = async (url: string, token: string): Promise<PullRequest | undefined> => {
    const page = pageOf(url);
    if (page === undefined) return undefined;
    const answer = await fetch(`https://api.github.com/repos/${page.owner}/${page.repo}/pulls/${page.number}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    });
    // No pull request at that page is an answer, and every other refusal is not.
    if (answer.status === 404) return undefined;
    if (!answer.ok) throw new Error(`GitHub answered ${answer.status} for ${url}`);
    const item = await answer.json() as { html_url?: unknown; state?: unknown; merged_at?: unknown; title?: unknown };
    if (typeof item.html_url !== 'string') return undefined;
    return {
      url: item.html_url,
      state: stateOf(item.state, item.merged_at != null),
      ...(typeof item.title === 'string' ? { title: item.title } : {}),
    };
  };

  const oneByGh = (url: string, cwd: string): Promise<PullRequest | undefined> =>
    new Promise((answer, refuse) => {
      execFile('gh', ['pr', 'view', url, '--json', 'url,state,title'], { cwd, timeout: 10_000, maxBuffer: 1 << 20, windowsHide: true }, (error, out, bad) => {
        if (error) {
          refuse(new Error(bad.toString().trim() || error.message));
          return;
        }
        const item = JSON.parse(out.toString()) as { url?: unknown; state?: unknown; title?: unknown };
        if (typeof item.url !== 'string') {
          answer(undefined);
          return;
        }
        answer({
          url: item.url,
          state: stateOf(item.state, String(item.state).toUpperCase() === 'MERGED'),
          ...(typeof item.title === 'string' ? { title: item.title } : {}),
        });
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
      ], { cwd, timeout: 30_000, maxBuffer: 1 << 20, windowsHide: true }, (error, out, bad) => {
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

  /** One REST read as the token route asks it: the body, nothing for a 404, an error for the rest. */
  const readByApi = async (path: string, token: string): Promise<unknown | undefined> => {
    const answer = await fetch(`${API}/${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (answer.status === 404) return undefined;
    if (!answer.ok) throw new Error(`GitHub answered ${answer.status} for ${path}`);
    const body = await answer.text();
    return body.trim() === '' ? undefined : JSON.parse(body);
  };

  /** `gh api`, answering what it printed. A failure keeps `gh`'s own words and exit kind. */
  const ghApi = (args: string[], cwd: string, maxBuffer = 8 << 20): Promise<string> =>
    new Promise((answer, refuse) => {
      execFile('gh', args, { cwd, timeout: 60_000, maxBuffer, windowsHide: true }, (error, out, bad) => {
        if (error !== null) {
          const failure = new Error(bad.toString().trim() || error.message) as NodeJS.ErrnoException;
          failure.code = (error as NodeJS.ErrnoException).code;
          refuse(failure);
          return;
        }
        answer(out.toString());
      });
    });

  /**
   * One GitHub read, by the token when there is one and by `gh` when there is
   * not.
   *
   * Nothing where the two routes cannot be asked - no token lent and no `gh`
   * on this machine - and nothing where GitHub has nothing at the path. Any
   * other refusal is the read failing, and says so.
   */
  const read = async (path: string, token: string | undefined, cwd: string): Promise<unknown | undefined> => {
    if (token !== undefined) return readByApi(path, token);
    try {
      const out = await ghApi(['api', path], cwd);
      return out.trim() === '' ? undefined : JSON.parse(out);
    }
    catch (error) {
      if (ghAbsent(error) || ghNothing(error)) return undefined;
      throw error;
    }
  };

  /** The pull request itself, as much of it as the reads below are aimed at. */
  const coreIn = (raw: Record<string, unknown>, page: { owner: string; repo: string; number: string }): PullRequestCore | undefined => {
    const head = isRecord(raw.head) ? raw.head : {};
    const base = isRecord(raw.base) ? raw.base : {};
    const headSha = textOf(head.sha);
    if (headSha === undefined) return undefined;
    const state: PullRequestCore['state'] = raw.merged_at != null
      ? 'merged'
      : String(raw.state ?? '').toLowerCase() === 'open' ? 'open' : 'closed';
    return {
      url: textOf(raw.html_url) ?? `https://github.com/${page.owner}/${page.repo}/pull/${page.number}`,
      number: typeof raw.number === 'number' ? raw.number : Number(page.number),
      state,
      title: textOf(raw.title) ?? '',
      headSha,
      baseRef: textOf(base.ref) ?? '',
      headRef: textOf(head.ref) ?? '',
      draft: raw.draft === true,
    };
  };

  /** Whether the person behind the read may push to the repository, which is what merging needs. */
  const mayMerge = (raw: Record<string, unknown>): boolean => {
    const head = isRecord(raw.head) ? raw.head : {};
    const base = isRecord(raw.base) ? raw.base : {};
    // The base repository is the one a merge writes to; a head on a fork is
    // not the place the permission is read from.
    const permissions = (isRecord(base.repo) ? base.repo.permissions : undefined)
      ?? (isRecord(head.repo) ? head.repo.permissions : undefined);
    return isRecord(permissions) && (permissions.push === true || permissions.maintain === true || permissions.admin === true);
  };

  /**
   * The merge methods a repository permits, or nothing when its settings say
   * nothing either way. A repository with all three off answers an empty list,
   * which is an answer.
   */
  const mergeMethodsIn = (raw: unknown): PullRequestMergeMethod[] | undefined => {
    if (!isRecord(raw)) return undefined;
    if (raw.allow_merge_commit === undefined && raw.allow_squash_merge === undefined && raw.allow_rebase_merge === undefined) return undefined;
    const methods: PullRequestMergeMethod[] = [];
    if (raw.allow_squash_merge === true) methods.push('SQUASH');
    if (raw.allow_merge_commit === true) methods.push('MERGE');
    if (raw.allow_rebase_merge === true) methods.push('REBASE');
    return methods;
  };

  /** The classes of failure a review thread can be answered through, as one list. */
  const commentsIn = (raw: unknown): PullRequestFeedbackComment[] => arrayOf(raw).flatMap((one) => {
    if (!isRecord(one)) return [];
    const body = textOf(one.body);
    if (body === undefined) return [];
    const author = isRecord(one.author) ? textOf(one.author.login) : undefined;
    const createdAt = textOf(one.createdAt);
    return [{ ...(author !== undefined ? { author } : {}), body, ...(createdAt !== undefined ? { createdAt } : {}) }];
  });

  /** Review threads, submitted reviews and conversation comments, from the one query. */
  const feedbackOf = async (
    page: { owner: string; repo: string; number: string },
    token: string | undefined,
    cwd: string,
  ): Promise<{ threads: PullRequestReviewThread[]; reviews: PullRequestReview[]; comments: PullRequestComment[] } | undefined> => {
    let answer: unknown;
    if (token !== undefined) {
      const told = await fetch(`${API}/graphql`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: FEEDBACK_QUERY, variables: { owner: page.owner, repo: page.repo, number: Number(page.number) } }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!told.ok) throw new Error(`GitHub answered ${told.status} for ${page.owner}/${page.repo}#${page.number}'s reviews`);
      answer = await told.json();
    }
    else {
      try {
        answer = JSON.parse(await ghApi([
          'api', 'graphql', '-f', `query=${FEEDBACK_QUERY}`,
          '-F', `owner=${page.owner}`, '-F', `repo=${page.repo}`, '-F', `number=${page.number}`,
        ], cwd));
      }
      catch (error) {
        if (ghAbsent(error) || ghNothing(error)) return undefined;
        throw error;
      }
    }
    if (!isRecord(answer)) return undefined;
    const mistakes = arrayOf(answer.errors).map((one) => isRecord(one) ? textOf(one.message) : undefined).filter((one) => one !== undefined);
    if (mistakes.length > 0) throw new Error(`GitHub would not read ${page.owner}/${page.repo}#${page.number}'s reviews: ${mistakes.join('; ')}`);
    const repository = isRecord(answer.data) ? answer.data.repository : undefined;
    const pull = isRecord(repository) ? repository.pullRequest : undefined;
    if (!isRecord(pull)) return undefined;
    const nodes = (raw: unknown): unknown[] => isRecord(raw) ? arrayOf(raw.nodes) : [];
    const threads = nodes(pull.reviewThreads).flatMap((one): PullRequestReviewThread[] => {
      if (!isRecord(one)) return [];
      const id = textOf(one.id);
      if (id === undefined) return [];
      const path = textOf(one.path);
      const line = typeof one.line === 'number' ? one.line : undefined;
      return [{
        id,
        ...(path !== undefined ? { path } : {}),
        ...(line !== undefined ? { line } : {}),
        isResolved: one.isResolved === true,
        comments: commentsIn(isRecord(one.comments) ? one.comments.nodes : undefined),
      }];
    });
    const reviews = nodes(pull.reviews).flatMap((one): PullRequestReview[] => {
      if (!isRecord(one)) return [];
      const id = textOf(one.id);
      const state = textOf(one.state);
      if (id === undefined || state === undefined) return [];
      const author = isRecord(one.author) ? textOf(one.author.login) : undefined;
      const submittedAt = textOf(one.submittedAt);
      return [{
        id,
        state,
        body: textOf(one.body) ?? '',
        ...(author !== undefined ? { author } : {}),
        ...(submittedAt !== undefined ? { submittedAt } : {}),
      }];
    });
    const comments = nodes(pull.comments).flatMap((one): PullRequestComment[] => {
      if (!isRecord(one)) return [];
      const id = textOf(one.id);
      const body = textOf(one.body);
      if (id === undefined || body === undefined) return [];
      const author = isRecord(one.author) ? textOf(one.author.login) : undefined;
      const createdAt = textOf(one.createdAt);
      return [{ id, body, ...(author !== undefined ? { author } : {}), ...(createdAt !== undefined ? { createdAt } : {}) }];
    });
    return { threads, reviews, comments };
  };

  /** Every check on one head, and whether the required ones could be told apart. */
  const checksIn = async (page: { owner: string; repo: string; number: string }, core: PullRequestCore, token: string | undefined, cwd: string): Promise<PullRequestChecks> => {
    const runs = await read(`repos/${page.owner}/${page.repo}/commits/${core.headSha}/check-runs?per_page=100`, token, cwd);
    const statuses = await read(`repos/${page.owner}/${page.repo}/commits/${core.headSha}/status`, token, cwd);
    const required = new Set<string>();
    let requirednessComplete = true;
    try {
      const protection = await read(`repos/${page.owner}/${page.repo}/branches/${encodeURIComponent(core.baseRef)}/protection/required_status_checks`, token, cwd);
      if (isRecord(protection)) {
        for (const context of arrayOf(protection.contexts)) if (typeof context === 'string') required.add(context);
        for (const check of arrayOf(protection.checks)) if (isRecord(check) && typeof check.context === 'string') required.add(check.context);
      }
    }
    catch {
      requirednessComplete = false;
    }
    const checks: PullRequestCheck[] = [];
    for (const one of arrayOf(isRecord(runs) ? runs.check_runs : undefined)) {
      if (!isRecord(one)) continue;
      const id = one.id === undefined ? undefined : String(one.id);
      const name = textOf(one.name);
      if (id === undefined || name === undefined) continue;
      const status = textOf(one.status);
      const conclusion = textOf(one.conclusion);
      const detailsUrl = textOf(one.details_url);
      checks.push({
        id,
        name,
        type: 'checkRun',
        ...(status !== undefined ? { status } : {}),
        ...(conclusion !== undefined ? { conclusion } : {}),
        ...(requirednessComplete ? { required: required.has(name) } : {}),
        ...(detailsUrl !== undefined ? { detailsUrl } : {}),
      });
    }
    for (const one of arrayOf(isRecord(statuses) ? statuses.statuses : undefined)) {
      if (!isRecord(one)) continue;
      const name = textOf(one.context);
      const status = textOf(one.state);
      if (name === undefined) continue;
      const target = textOf(one.target_url);
      checks.push({
        id: `${name}/${status ?? ''}`,
        name,
        type: 'statusContext',
        ...(status !== undefined ? { status: status.toUpperCase() } : {}),
        ...(requirednessComplete ? { required: required.has(name) } : {}),
        ...(target !== undefined ? { detailsUrl: target } : {}),
      });
    }
    return { checks, requirednessComplete };
  };

  const jobsIn = (raw: unknown): PullRequestJob[] => arrayOf(isRecord(raw) ? raw.jobs : undefined).flatMap((one) => {
    if (!isRecord(one)) return [];
    const id = one.id === undefined ? undefined : String(one.id);
    const runId = one.run_id === undefined ? undefined : String(one.run_id);
    const name = textOf(one.name);
    if (id === undefined || runId === undefined || name === undefined) return [];
    const status = textOf(one.status);
    const conclusion = textOf(one.conclusion);
    const headSha = textOf(one.head_sha);
    const runAttempt = typeof one.run_attempt === 'number' ? one.run_attempt : undefined;
    const checkRunId = /\/check-runs\/(\d+)\/?$/.exec(textOf(one.check_run_url) ?? '')?.[1];
    const steps = arrayOf(one.steps).flatMap((step): PullRequestJobStep[] => {
      if (!isRecord(step) || typeof step.number !== 'number') return [];
      const stepName = textOf(step.name);
      if (stepName === undefined) return [];
      const stepStatus = textOf(step.status);
      const stepConclusion = textOf(step.conclusion);
      return [{
        number: step.number,
        name: stepName,
        ...(stepStatus !== undefined ? { status: stepStatus } : {}),
        ...(stepConclusion !== undefined ? { conclusion: stepConclusion } : {}),
      }];
    });
    return [{
      id,
      runId,
      name,
      ...(status !== undefined ? { status } : {}),
      ...(conclusion !== undefined ? { conclusion } : {}),
      ...(headSha !== undefined ? { headSha } : {}),
      ...(runAttempt !== undefined ? { runAttempt } : {}),
      ...(checkRunId !== undefined ? { checkRunId } : {}),
      ...(steps.length > 0 ? { steps } : {}),
    }];
  });

  const detailOf = async (url: string, token: string | undefined, cwd: string): Promise<PullRequestDetail | undefined> => {
    const page = pageOf(url);
    if (page === undefined) return undefined;
    const raw = await read(`repos/${page.owner}/${page.repo}/pulls/${page.number}`, token, cwd);
    if (!isRecord(raw)) return undefined;
    const core = coreIn(raw, page);
    if (core === undefined) return undefined;
    const [checks, feedback, settings] = await Promise.all([
      checksIn(page, core, token, cwd),
      feedbackOf(page, token, cwd),
      // The repository's settings say which merge methods it permits. A read
      // that fails says nothing, which is not "none are permitted".
      read(`repos/${page.owner}/${page.repo}`, token, cwd).catch(() => undefined),
    ]);
    if (feedback === undefined) return undefined;
    const mergeStateStatus = textOf(raw.mergeable_state);
    const allowedMergeMethods = mergeMethodsIn(settings);
    const mergeability: PullRequestMergeability = {
      mergeable: raw.mergeable === true ? 'MERGEABLE' : raw.mergeable === false ? 'CONFLICTING' : 'UNKNOWN',
      ...(mergeStateStatus !== undefined ? { mergeStateStatus: mergeStateStatus.toUpperCase() } : {}),
      viewerCanMerge: mayMerge(raw),
      ...(allowedMergeMethods !== undefined ? { allowedMergeMethods } : {}),
    };
    return {
      core,
      checks,
      mergeability,
      reviewThreads: feedback.threads,
      submittedReviews: feedback.reviews,
      topLevelComments: feedback.comments,
    };
  };

  const jobsOf = async (url: string, runId: string, token: string | undefined, cwd: string): Promise<PullRequestJob[] | undefined> => {
    const page = pageOf(url);
    if (page === undefined) return undefined;
    const raw = await read(`repos/${page.owner}/${page.repo}/actions/runs/${runId}/jobs?per_page=100`, token, cwd);
    return isRecord(raw) ? jobsIn(raw) : undefined;
  };

  const logOf = async (url: string, jobId: string, token: string | undefined, cwd: string): Promise<PullRequestJobLog | undefined> => {
    const page = pageOf(url);
    if (page === undefined) return undefined;
    const path = `repos/${page.owner}/${page.repo}/actions/jobs/${jobId}/logs`;
    if (token !== undefined) {
      // GitHub answers the logs route with a redirect to a signed download,
      // which `fetch` follows for us.
      const answer = await fetch(`${API}/${path}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (answer.status === 404) return undefined;
      if (!answer.ok) throw new Error(`GitHub answered ${answer.status} for job ${jobId}`);
      return capped(await answer.text());
    }
    try {
      return capped(await ghApi(['api', path], cwd, 16 << 20));
    }
    catch (error) {
      if (ghAbsent(error) || ghNothing(error)) return undefined;
      throw error;
    }
  };

  /**
   * One GraphQL call, by the token a client lent or by `gh`.
   *
   * Nothing where `gh` is absent, which is the same answer the reads give;
   * GitHub's own refusals are thrown, because a reply that was not taken is
   * not a reply.
   */
  const graphql = async (
    query: string,
    variables: Record<string, string>,
    token: string | undefined,
    cwd: string,
  ): Promise<Record<string, unknown> | undefined> => {
    let body: unknown;
    if (token !== undefined) {
      const answer = await fetch(`${API}/graphql`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!answer.ok) throw new Error(`GitHub answered ${answer.status} for graphql`);
      body = await answer.json();
    }
    else {
      const args = ['api', 'graphql', '-f', `query=${query}`];
      for (const [name, value] of Object.entries(variables)) args.push('-f', `${name}=${value}`);
      try {
        body = JSON.parse(await ghApi(args, cwd));
      }
      catch (error) {
        if (ghAbsent(error)) return undefined;
        throw error;
      }
    }
    if (!isRecord(body)) return undefined;
    if (Array.isArray(body.errors) && body.errors.length > 0) throw new Error(`GitHub refused the call: ${JSON.stringify(body.errors)}`);
    return isRecord(body.data) ? body.data : undefined;
  };

  /** The payload of one named field of a GraphQL answer, or an empty object. */
  const payloadOf = (data: Record<string, unknown> | undefined, field: string): Record<string, unknown> =>
    isRecord(data?.[field]) ? data[field] as Record<string, unknown> : {};

  /**
   * Whether the person has a review drafted and not yet submitted on the
   * pull request.
   *
   * A reply made while one is open lands in that review and stays unpublished,
   * and nothing here may submit or discard it: the tool says so and stops the
   * folder's watch instead.
   */
  const pendingReviewOf = async (url: string, token: string | undefined, cwd: string): Promise<boolean | undefined> => {
    const data = await graphql(
      'query($url:URI!){resource(url:$url){... on PullRequest{viewerLatestReview{state}}}}',
      { url },
      token,
      cwd,
    );
    if (data === undefined) return undefined;
    const review = isRecord(payloadOf(data, 'resource').viewerLatestReview)
      ? payloadOf(data, 'resource').viewerLatestReview as Record<string, unknown>
      : {};
    return String(review.state ?? '').toUpperCase() === 'PENDING';
  };

  /** Reply on one review thread, answering the comment GitHub made. */
  const replyToThread = async (
    threadId: string,
    body: string,
    token: string | undefined,
    cwd: string,
  ): Promise<PullRequestThreadReply | undefined> => {
    const data = await graphql(
      'mutation($thread:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$thread,body:$body}){comment{id state url}}}',
      { thread: threadId, body },
      token,
      cwd,
    );
    if (data === undefined) return undefined;
    const comment = payloadOf(payloadOf(data, 'addPullRequestReviewThreadReply'), 'comment');
    const state = textOf(comment.state);
    return { commentId: textOf(comment.id) ?? '', ...(state !== undefined ? { state: state.toUpperCase() } : {}) };
  };

  /** Resolve one review thread, answering whether GitHub says it is resolved. */
  const resolveThreadOf = async (threadId: string, token: string | undefined, cwd: string): Promise<boolean> => {
    const data = await graphql(
      'mutation($thread:ID!){resolveReviewThread(input:{threadId:$thread}){thread{id isResolved}}}',
      { thread: threadId },
      token,
      cwd,
    );
    return payloadOf(payloadOf(data, 'resolveReviewThread'), 'thread').isResolved === true;
  };

  /** Rerun a workflow run, failed jobs only or whole. */
  const rerunOf = async (
    url: string,
    runId: string,
    failedJobsOnly: boolean,
    token: string | undefined,
    cwd: string,
  ): Promise<boolean> => {
    const page = pageOf(url);
    if (page === undefined) return false;
    const path = `repos/${page.owner}/${page.repo}/actions/runs/${runId}/${failedJobsOnly ? 'rerun-failed-jobs' : 'rerun'}`;
    if (token === undefined) {
      try {
        await ghApi(['api', '-X', 'POST', path], cwd);
        return true;
      }
      catch (error) {
        if (ghAbsent(error)) return false;
        throw error;
      }
    }
    const answer = await fetch(`${API}/${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!answer.ok) throw new Error(`GitHub answered ${answer.status} for ${path}`);
    return true;
  };

  /** What `gh` or the REST route said about a merge, as the one answer the host reads. */
  const mergedFrom = (said: unknown): PullRequestMergeResult => {
    const message = isRecord(said) ? textOf(said.message) : undefined;
    const merged = isRecord(said) && said.merged === true;
    return { outcome: merged ? 'merged' : 'refused', ...(message !== undefined ? { message } : {}) };
  };

  /**
   * Merge the pull request at one head, with one method.
   *
   * GitHub refuses a head that has moved, so the `headSha` a decision was made
   * on is sent with it: a merge can never take work nobody read. A refusal is
   * GitHub's answer and is not thrown; a transport failure is, because whether
   * the merge happened is then unknown.
   */
  const mergeOf = async (
    url: string,
    method: PullRequestMergeMethod,
    headSha: string,
    token: string | undefined,
    cwd: string,
  ): Promise<PullRequestMergeResult> => {
    const page = pageOf(url);
    if (page === undefined) return { outcome: 'refused', message: `${url} is not a GitHub pull request page` };
    const path = `repos/${page.owner}/${page.repo}/pulls/${page.number}/merge`;
    if (token === undefined) {
      try {
        return mergedFrom(JSON.parse(await ghApi([
          'api', '-X', 'PUT', path,
          '-f', `merge_method=${method.toLowerCase()}`,
          '-f', `sha=${headSha}`,
        ], cwd)));
      }
      catch (error) {
        if (ghAbsent(error)) return { outcome: 'indeterminate', message: 'gh is not available to merge' };
        const message = (error as Error).message;
        // `gh` hands GitHub's refusal back as a failure; only the API's own
        // fault says nothing about whether the merge happened.
        return { outcome: /HTTP 5\d\d/.test(message) ? 'indeterminate' : 'refused', message };
      }
    }
    const answer = await fetch(`${API}/${path}`, {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ merge_method: method.toLowerCase(), sha: headSha }),
      signal: AbortSignal.timeout(30_000),
    });
    const said = await answer.json().catch(() => ({}));
    const result = mergedFrom(said);
    return answer.status >= 500 ? { ...result, outcome: 'indeterminate' } : result;
  };

  return {
    resource: RESOURCE,
    forBranch: async ({ owner, repo }, branch, token, cwd) => {
      if (token !== undefined) return byApi(owner, repo, branch, token);
      return byGh(owner, repo, branch, cwd);
    },
    byUrl: async (url, token, cwd) => {
      if (token !== undefined) return oneByApi(url, token);
      return oneByGh(url, cwd);
    },
    create: async ({ owner, repo }, wanted, token, cwd) => {
      if (token !== undefined) return createByApi(owner, repo, wanted, token);
      return createByGh(owner, repo, wanted, cwd);
    },
    detail: (url, token, cwd) => detailOf(url, token, cwd),
    jobs: (url, runId, token, cwd) => jobsOf(url, runId, token, cwd),
    jobLog: (url, jobId, token, cwd) => logOf(url, jobId, token, cwd),
    pendingReview: (url, token, cwd) => pendingReviewOf(url, token, cwd),
    replyToReviewThread: (threadId, body, token, cwd) => replyToThread(threadId, body, token, cwd),
    resolveReviewThread: (threadId, token, cwd) => resolveThreadOf(threadId, token, cwd),
    rerunWorkflow: (url, runId, failedJobsOnly, token, cwd) => rerunOf(url, runId, failedJobsOnly, token, cwd),
    merge: (url, method, headSha, token, cwd) => mergeOf(url, method, headSha, token, cwd),
  };
}
