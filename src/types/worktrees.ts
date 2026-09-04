/** A working tree of its own, so two sessions in one repository do not collide. */

/** What to make, and from where. */
export interface Worktree {
  /** The repository to make it from. A path, not a URI. */
  repository: string;
  /** The branch to start from. */
  base: string;
  /** The branch to create and check out. */
  branch: string;
  /** Where to put it. */
  path: string;
  /**
   * Git-ignored files to copy in, as glob patterns relative to the repository.
   *
   * A checkout carries what git tracks and nothing else, so a worktree of an
   * ordinary project has no `.env`, no `node_modules`, and none of the local
   * configuration the thing needs to run. Without these the isolation works
   * and the session inside it cannot build - which is a failure the person
   * meets after choosing it rather than while choosing it.
   */
  include?: string[];
}

/**
 * Making and unmaking git worktrees.
 *
 * A port for the reason `DirectoryFacts` and `ChangesetSource` are ports: it
 * spawns `git`, which is a binary rather than a runtime API and may not be
 * installed. A host given none advertises no `isolation` at all, which is the
 * honest answer - a client draws the control a host says it has.
 *
 * Deliberately not part of `ChangesetSource`. That port describes changes; a
 * worktree is a directory, and the two happen to share an implementation
 * rather than a subject.
 */
export interface Worktrees {
  /**
   * The repository root above this directory, if it is in one.
   *
   * The root and not the directory: a worktree is made from the repository,
   * and a session pointed at `src/` inside one is still a session in it.
   * Undefined means there is no repository here and no isolation to offer.
   */
  repository(dir: string): Promise<string | undefined>;

  /**
   * The branches this repository has, most useful first.
   *
   * What a client draws the base-branch picker from. An empty list is a real
   * answer - a repository with no commits has no branches - and leaves the
   * control with nothing to choose but the default.
   */
  branches(repository: string): Promise<string[]>;

  /** Make one. Answers the path it made, which is where the session runs. */
  create(worktree: Worktree): Promise<void>;

  /**
   * Whether anything in it is uncommitted.
   *
   * Asked before it is removed, and the answer decides whether it is: work
   * nobody committed is work this daemon cannot judge the value of.
   */
  dirty(path: string): Promise<boolean>;

  /**
   * Take one away, and the branch with it if nothing else points at it.
   *
   * Only ever called for a worktree this host made and only when `dirty`
   * answered no.
   */
  remove(repository: string, path: string): Promise<void>;
}
