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
  const branches = new Map<string, string>();

  /**
   * Ask git, and answer whether what it said differs from what was held.
   *
   * A directory that is not a repository, or one whose HEAD is detached, has
   * no branch and is remembered as having none: `rev-parse --abbrev-ref` says
   * `HEAD` for a detached head, and reporting that would draw a branch called
   * HEAD.
   */
  const refresh = async (dir: string): Promise<boolean> => {
    const found = await new Promise<string | undefined>((answer) => {
      execFile(
        'git',
        ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { timeout: 2000 },
        (error, out) => {
          if (error) return answer(undefined);
          const name = out.toString().trim();
          answer(name === '' || name === 'HEAD' ? undefined : name);
        },
      );
    });
    const before = branches.get(dir);
    if (before === found) return false;
    if (found === undefined) branches.delete(dir);
    else branches.set(dir, found);
    return true;
  };

  return {
    /*
     * `git` is the protocol's well-known key, and this writes it whole.
     *
     * Correct only because this is the only producer of `_meta` here:
     * `session/metaChanged` replaces the map entirely, so a host with two of
     * them would have to merge before dispatching rather than after.
     */
    meta: (dir) => {
      const branch = branches.get(dir);
      return branch === undefined ? undefined : { git: { branch } };
    },
    refresh,
  };
}
