/** What git can say about a directory the host serves. */

import { execFile } from 'node:child_process';
import type { DirectoryFacts } from './types/host.js';

/**
 * The branch each served directory is on, as a host's `DirectoryFacts`.
 *
 * Deliberately not part of `createHost`: it spawns `git`, which is a binary
 * rather than a runtime API and may not be installed at all. The daemon wires
 * it in, a library caller opts in, and a host without it still names its
 * projects - so nothing here is load-bearing for the protocol.
 *
 * ```ts
 * createHost({ path, agents: [claude({ paths })], directories: gitBranches() });
 * ```
 */
export function gitBranches(): DirectoryFacts {
  /*
   * The branch, per *directory* rather than per session.
   *
   * A host serving one repository with ninety-eight sessions in it would
   * otherwise ask git ninety-eight times for one answer.
   */
  const facts = new Map<string, Record<string, unknown>>();

  /** Run git in a directory and answer what it said, or nothing at all. */
  const git = (dir: string, args: string[]): Promise<string | undefined> =>
    new Promise((answer) => {
      execFile('git', ['-C', dir, ...args], { timeout: 2000 }, (error, out) => {
        answer(error ? undefined : out.toString().trim());
      });
    });

  /**
   * The owner and repository of a GitHub remote, if the remote is one.
   *
   * Both URL forms git writes: `git@github.com:owner/repo.git` and
   * `https://github.com/owner/repo`. Anything else is a remote this says
   * nothing about rather than one it guesses at.
   */
  const github = (url: string | undefined): { owner: string; repo: string } | undefined => {
    const found = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url ?? '');
    return found ? { owner: found[1] as string, repo: found[2] as string } : undefined;
  };

  /**
   * Ask git, and answer whether what it said differs from what was held.
   *
   * A directory that is not a repository, or one whose HEAD is detached, has
   * no branch and is remembered as having none: `rev-parse --abbrev-ref` says
   * `HEAD` for a detached head, and reporting that would draw a branch called
   * HEAD.
   */
  const refresh = async (dir: string): Promise<boolean> => {
    const said = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branchName = said === undefined || said === '' || said === 'HEAD' ? undefined : said;
    if (branchName === undefined) {
      const had = facts.has(dir);
      facts.delete(dir);
      return had;
    }
    /*
     * The rest in two more calls, both cheap and both answering a question a
     * client draws something from.
     *
     * `status -sb --porcelain` names the upstream and the ahead/behind counts
     * on its first line and one file per line after it, so the count of
     * uncommitted changes comes out of the same call. `remote get-url` is the
     * only way to know whether this is a GitHub repository, which is what
     * turns a client's pull-request affordances on.
     */
    const [status, origin] = await Promise.all([
      git(dir, ['status', '-sb', '--porcelain']),
      git(dir, ['remote', 'get-url', 'origin']),
    ]);
    const lines = (status ?? '').split('\n');
    const head = lines[0] ?? '';
    const upstream = /^## [^.]*\.\.\.(\S+)/.exec(head)?.[1];
    const ahead = Number(/\[.*?ahead (\d+)/.exec(head)?.[1] ?? 0);
    const behind = Number(/\[.*?behind (\d+)/.exec(head)?.[1] ?? 0);
    const owner = github(origin);
    const now: Record<string, unknown> = {
      branchName,
      /*
       * The drift, and only where there is something to drift from.
       *
       * A branch with no upstream is not zero ahead and zero behind, it is
       * neither - and a client draws these as arrows beside the branch, so a
       * pair of zeroes is two arrows saying nothing. The reference host omits
       * them the same way.
       */
      ...(upstream === undefined ? {} : {
        upstreamBranchName: upstream,
        incomingChanges: behind,
        outgoingChanges: ahead,
      }),
      uncommittedChanges: lines.slice(1).filter((one) => one.trim() !== '').length,
      hasGitHubRemote: owner !== undefined,
      ...(owner ? { githubOwner: owner.owner, githubRepo: owner.repo } : {}),
    };
    const before = facts.get(dir);
    if (before !== undefined && JSON.stringify(before) === JSON.stringify(now)) return false;
    facts.set(dir, now);
    return true;
  };

  return {
    /*
     * `git` is the well-known key, and the field names are the reference host's.
   *
   * Not the protocol's: it declares no `_meta` keys at all. The names come
   * from a capture of the other implementation - `branchName`,
   * `upstreamBranchName`, `incomingChanges`, `outgoingChanges`,
   * `uncommittedChanges`, `hasGitHubRemote`, `githubOwner`, `githubRepo` -
   * because a client reads one spelling, and this host used to write `branch`
   * where that client looks for `branchName` and so said nothing at all.
   *
   * Written whole, and correct only because this is the only producer of
   * `_meta` here.
     *
     * Correct only because this is the only producer of `_meta` here:
     * `session/metaChanged` replaces the map entirely, so a host with two of
     * them would have to merge before dispatching rather than after.
     */
    meta: (dir) => {
      const held = facts.get(dir);
      return held === undefined ? undefined : { git: { ...held } };
    },
    refresh,
  };
}
