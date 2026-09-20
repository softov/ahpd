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
export interface PullRequests {
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
   * Open one, from a branch already pushed, answering its page.
   *
   * `head` is the branch on the repository's own remote; a fork is
   * `owner:branch`, the way GitHub spells it. The same token rule as
   * `forBranch`.
   */
  create(repo: { owner: string; repo: string }, wanted: NewPullRequest, token: string | undefined, cwd: string): Promise<PullRequest>;
}

/** What a pull request is opened with. */
export interface NewPullRequest {
  title: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
}
