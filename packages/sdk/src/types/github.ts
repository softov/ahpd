/** What GitHub knows about a branch, for the row a client draws it on. */

import type { Bag } from './common.js';

/** One pull request, as much of it as a session row draws. */
export interface PullRequest {
  /** Its page, which is also its identity. */
  url: string;
  /** Open, closed without merging, or merged. */
  state: 'open' | 'closed' | 'merged';
  /** Its title, when the answer carried one; a port is not required to. */
  title?: string;
  /** When it was opened, ISO 8601, when the answer carried it. */
  createdAt?: string;
}

/**
 * Asking GitHub about a branch.
 *
 * A port for the reason `DirectoryFacts` is one, and one more: it spawns
 * `gh` or talks to the network, and it may need a token a client lent. A host
 * given none says nothing under `_meta.github` and advertises no GitHub
 * resource, so no client is asked to sign in for a thing that will not be
 * asked. `githubPullRequests()` is the one that ships with this package.
 */
export interface PullRequests extends PullRequestWrites {
  /**
   * The protected resource a token for this is pushed under.
   *
   * Advertised on every backend, the way the reference host advertises it, so
   * a client that has a GitHub session lends it through `authenticate` and
   * the lookups below run as that person. `required: false`: without a token
   * `gh` may answer instead, and a host with neither still runs sessions.
   */
  resource: Bag;
  /**
   * The pull requests whose head is `branch`, most recently updated first.
   *
   * `token` is a client's, when one lent it; without one the implementation
   * may ask however else it can, or answer none. `cwd` is a directory in the
   * repository, for an implementation that asks a tool which reads its own
   * credentials from there.
   */
  forBranch(repo: { owner: string; repo: string }, branch: string, token: string | undefined, cwd: string): Promise<PullRequest[]>;
  /**
   * One pull request, by its page, or undefined when GitHub has no pull
   * request there.
   *
   * The same token rule as `forBranch`. Optional: a host whose port has none
   * asks by branch instead.
   */
  byUrl?(url: string, token: string | undefined, cwd: string): Promise<PullRequest | undefined>;
  /**
   * Open one, from a branch already pushed, answering its page.
   *
   * `head` is the branch on the repository's own remote; a fork is
   * `owner:branch`, the way GitHub spells it. The same token rule as
   * `forBranch`.
   */
  create(repo: { owner: string; repo: string }, wanted: NewPullRequest, token: string | undefined, cwd: string): Promise<PullRequest>;
  /**
   * Everything a repair turn reads of one pull request: its core, the checks
   * on its head, its mergeability, its review threads, its submitted reviews
   * and its conversation comments.
   *
   * The same token rule as `forBranch`, and one answer more: a host with
   * neither a token nor a `gh` answers nothing rather than failing, and no
   * pull request at the page is nothing too. Optional, so a port that only
   * lists and opens pull requests serves the rest of the host as it did.
   */
  detail?(url: string, token: string | undefined, cwd: string): Promise<PullRequestDetail | undefined>;
  /** The jobs of one workflow run of a pull request's head, or nothing when it or `gh` is gone. */
  jobs?(url: string, runId: string, token: string | undefined, cwd: string): Promise<PullRequestJob[] | undefined>;
  /**
   * One job's log, capped at what `readAgentMergeCI` keeps: 48,000 characters,
   * with `truncated` saying whether there was more.
   */
  jobLog?(url: string, jobId: string, token: string | undefined, cwd: string): Promise<PullRequestJobLog | undefined>;
}

/** What a pull request is opened with. */
export interface NewPullRequest {
  title: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
}

/** The pull request itself, as a repair turn reads it. */
export interface PullRequestCore {
  /** Its page, which is also its identity. */
  url: string;
  /** Its number on the repository. */
  number: number;
  /** Open, closed without merging, or merged. */
  state: 'open' | 'closed' | 'merged';
  title: string;
  /** The commit its checks and mergeability are read at. */
  headSha: string;
  /** The branch it merges into. */
  baseRef: string;
  /** The branch it comes from. */
  headRef: string;
  /** Whether it is still a draft. */
  draft: boolean;
}

/**
 * One check on a pull request's head.
 *
 * `type` is which of GitHub's two things reported it: a check run, or a
 * commit status context. `required` is what branch protection says, and it is
 * absent when requiredness could not be read.
 */
export interface PullRequestCheck {
  id: string;
  name: string;
  type: 'checkRun' | 'statusContext';
  status?: string;
  conclusion?: string;
  required?: boolean;
  /** Where GitHub draws the check, which names the workflow run it belongs to. */
  detailsUrl?: string;
}

/** Every check on a head, and whether the required ones could be told apart. */
export interface PullRequestChecks {
  checks: PullRequestCheck[];
  requirednessComplete: boolean;
}

/** What GitHub says about merging it, at one moment. */
export interface PullRequestMergeability {
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  /** GitHub's finer word, such as `BEHIND` or `BLOCKED`. */
  mergeStateStatus?: string;
  /** Whether the person reading holds write access to the repository. */
  viewerCanMerge: boolean;
}

/** One comment on a review thread. */
export interface PullRequestFeedbackComment {
  author?: string;
  body: string;
  createdAt?: string;
}

/** One review thread, with the comments on it oldest first. */
export interface PullRequestReviewThread {
  /** GitHub's node id, which a reply is addressed to. */
  id: string;
  path?: string;
  line?: number;
  isResolved: boolean;
  comments: PullRequestFeedbackComment[];
}

/** One review a person submitted, as the review gate reads it. */
export interface PullRequestReview {
  id: string;
  state: string;
  author?: string;
  body: string;
  submittedAt?: string;
}

/** One conversation comment on the pull request itself. */
export interface PullRequestComment {
  id: string;
  author?: string;
  body: string;
  createdAt?: string;
}

/** Everything a repair turn reads of one pull request, at one head. */
export interface PullRequestDetail {
  core: PullRequestCore;
  checks: PullRequestChecks;
  mergeability: PullRequestMergeability;
  reviewThreads: PullRequestReviewThread[];
  submittedReviews: PullRequestReview[];
  topLevelComments: PullRequestComment[];
}

/** One step of a workflow job. */
export interface PullRequestJobStep {
  number: number;
  name: string;
  status?: string;
  conclusion?: string;
}

/** One job of a workflow run, as CI diagnostics read it. */
export interface PullRequestJob {
  id: string;
  runId: string;
  name: string;
  status?: string;
  conclusion?: string;
  headSha?: string;
  runAttempt?: number;
  /** The check run this job reports, when it reports one. */
  checkRunId?: string;
  steps?: PullRequestJobStep[];
}

/** A job's log, as much of it as one read keeps. */
export interface PullRequestJobLog {
  text: string;
  /** Whether the log had more than `text` holds. */
  truncated: boolean;
}

/** A review thread reply, once GitHub has taken it. */
export interface PullRequestThreadReply {
  /** The comment's node id, when GitHub named one. */
  commentId: string;
  /** GitHub's word for it: `PUBLISHED`, or `PENDING` when it sits in the person's draft review. */
  state?: string;
}

/** What a repair turn writes back: a reply on a review thread, its resolution, and a workflow rerun. */
export interface PullRequestWrites {
  /** Whether the person has a draft review on the pull request that nothing may submit or discard. */
  pendingReview?(url: string, token: string | undefined, cwd: string): Promise<boolean | undefined>;
  /** Reply on one review thread, answering the comment GitHub made. */
  replyToReviewThread?(threadId: string, body: string, token: string | undefined, cwd: string): Promise<PullRequestThreadReply | undefined>;
  /**
   * Resolve one review thread, answering whether it is resolved now. A reply
   * is published before its thread is resolved; nothing here resolves one the
   * person has not answered.
   */
  resolveReviewThread?(threadId: string, token: string | undefined, cwd: string): Promise<boolean>;
  /** Rerun a workflow run of the pull request, failed jobs only or whole. */
  rerunWorkflow?(url: string, runId: string, failedJobsOnly: boolean, token: string | undefined, cwd: string): Promise<boolean>;
}
