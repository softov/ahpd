/** What git can say about a directory the host serves. */

import { execFile } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { ProjectInfo } from '@microsoft/agent-host-protocol';
import { uriOf } from '../resources/fileuri.js';
import type { DirectoryFacts } from '../types/host.js';
import { gitArgv } from './hardened.js';

/**
 * The environment every `git` here runs with: the inherited one, with
 * `GIT_OPTIONAL_LOCKS=0`, git's switch for a background process. A `git
 * status` then refreshes no index, so it never holds `.git/index.lock` while a
 * person's own `git add` needs it. A lock git cannot do without is still taken.
 */
const quiet = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_OPTIONAL_LOCKS: '0' });

/**
 * The project and the branch of each served directory, as a host's
 * `DirectoryFacts`.
 *
 * Deliberately not part of `createHost`: it spawns `git`, which is a binary
 * rather than a runtime API and may not be installed at all. The daemon wires
 * it in, and a library caller opts in.
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
  /** The project of each directory git placed in a repository, by directory. */
  const projects = new Map<string, ProjectInfo>();
  /** Every directory whose project was read, placed in a repository or not. */
  const read = new Set<string>();

  /** Run git in a directory and answer what it said, or nothing at all. */
  const git = (dir: string, args: string[]): Promise<string | undefined> =>
    new Promise((answer) => {
      execFile('git', gitArgv(dir, args), { timeout: 2000, env: quiet(), windowsHide: true }, (error, out) => {
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
   * The project a directory's sessions are in, as VS Code's agents resolve
   * it: the primary checkout of the repository the directory is in, which is
   * the first record `git worktree list` gives, or the repository's own root
   * where it gives none, named by its basename; nothing outside git.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotGitProject.ts#L18-L30
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostGitService.ts#L158-L166
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostGitService.ts#L1855-L1862
   */
  const projectOf = async (dir: string): Promise<ProjectInfo | undefined> => {
    const root = await git(dir, ['rev-parse', '--show-toplevel']);
    if (root === undefined || root === '') return undefined;
    const listed = await git(root, ['worktree', 'list', '--porcelain', '-z']);
    const primary = listed?.split('\0\0').find((record) => record.startsWith('worktree '))?.split('\0')[0]?.slice('worktree '.length);
    // git writes a Windows path with forward slashes; this host's own
    // spelling is what a URI is made from.
    const path = resolve(primary === undefined || primary === '' ? root : primary);
    return { uri: uriOf(path), displayName: basename(path) || uriOf(path) };
  };

  /**
   * Ask git, and answer whether what it said differs from what was held.
   *
   * A directory that is not a repository, or one whose HEAD is detached, has
   * no branch and is remembered as having none: `rev-parse --abbrev-ref` says
   * `HEAD` for a detached head, and reporting that would draw a branch called
   * HEAD. Its project is read first, since a detached head is still in its
   * repository.
   */
  const readProject = async (dir: string): Promise<boolean> => {
    const project = await projectOf(dir);
    read.add(dir);
    const placed = !isDeepStrictEqual(projects.get(dir), project);
    if (project === undefined) projects.delete(dir);
    else projects.set(dir, project);
    return placed;
  };
  /*
   * A directory's project read once, and kept until `refresh` reads it again,
   * as VS Code's git service keeps a folder's repository root and its primary
   * worktree root once it has asked git for them.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostGitService.ts#L225-L270
   */
  const refreshProject = async (dir: string): Promise<boolean> => (read.has(dir) ? false : readProject(dir));
  const refresh = async (dir: string): Promise<boolean> => {
    const placed = await readProject(dir);
    const said = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branchName = said === undefined || said === '' || said === 'HEAD' ? undefined : said;
    if (branchName === undefined) {
      const had = facts.has(dir);
      facts.delete(dir);
      return had || placed;
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
    if (before !== undefined && JSON.stringify(before) === JSON.stringify(now)) return placed;
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
    project: (dir) => {
      const held = projects.get(dir);
      return held === undefined ? undefined : { ...held };
    },
    refreshProject,
    refresh,
  };
}
