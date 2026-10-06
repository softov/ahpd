/** A working tree of its own, so two sessions in one repository do not collide. */

/** What to make, and from where. */
export interface Worktree {
  /** The repository to make it from. A path, not a URI. */
  repository: string;
  /** The branch to start from. */
  base: string;
  /**
   * The branch to create and check out, or nothing to check out `base` itself.
   *
   * Absent is what `worktreeCreateNewBranch: false` means: the session
   * continues an existing branch rather than starting one. Git refuses a
   * second worktree on a branch already checked out somewhere, which is the
   * right refusal - two sessions on one branch is the collision worktrees
   * exist to prevent.
   */
  branch?: string;
  /**
   * Whether the created branch tracks the upstream of the one it started from.
   *
   * Off unless asked. A tracking branch pushes at its upstream by default, so
   * a `git push` inside a session's worktree would go at the branch it was
   * started *from* - which is the one mistake in here that reaches a shared
   * repository.
   */
  track?: boolean;
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
  /**
   * Git-ignored folders to link in, as patterns relative to the repository.
   *
   * `.gitignore` syntax, so `node_modules/` means every directory of that
   * name at any depth rather than only the one at the root. A folder that is
   * already there is left alone, and only git-ignored folders are eligible:
   * what a link is for is the checkout's build output and installed
   * dependencies, which git carries nothing of.
   *
   * What it costs is that a linked folder is one directory reached from two
   * places. A write into it from inside the worktree is a write into the
   * checkout, and a delete is a delete in both - which is the right trade for
   * a `node_modules` nobody edits by hand and the wrong one for anything else.
   * This is what the person naming the patterns is agreeing to.
   *
   * Run before `include`, and best effort: a link that cannot be made leaves
   * the tree without it rather than stopping the session.
   */
  symlink?: string[];
}

/** Where a directory's repository keeps its history, and where its tree starts. */
export interface GitDir {
  /** The common git directory, absolute: the main repository's `.git` for every worktree of it. */
  gitDir: string;
  /**
   * The tree's own git directory, absolute: the `.git` of a main checkout, and
   * `<gitDir>/worktrees/<name>` for a linked worktree.
   *
   * Both, because the two are what a caller checks a folder against: the tree's
   * own `.git` is a directory naming the first, or a file naming this one.
   */
  worktreeDir: string;
  /** The root of the tree the directory is in: the worktree's own root for a linked worktree. */
  repository: string;
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
   * The repository's git directories and its root, for a directory in one.
   *
   * What a machine needs beside a session's folder for git to work inside it:
   * a linked worktree's `.git` is a file naming the main repository's git
   * directory by absolute path, and a folder below the root finds `.git`
   * above itself. Undefined outside a repository; a rejection, in git's own
   * words, for a folder git refuses. Optional, so a port that makes no
   * worktrees need not answer it.
   *
   * The answer is git's, not a check: a `.git` that names another repository
   * makes git answer that one, and a caller that mounts the answer has to
   * compare it against the folder itself.
   */
  gitDir?(dir: string): Promise<GitDir | undefined>;

  /**
   * The branches this repository has, most useful first.
   *
   * What a client draws the base-branch picker from, and the first is what a
   * session starts from when nobody chooses: the branch checked out, where
   * there is one. An empty list is a real answer - a repository with no
   * commits has no branches - and leaves the control with nothing to choose
   * but the default.
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
  remove(repository: string, path: string, branch?: string): Promise<void>;
}
