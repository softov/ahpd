/**
 * The argv every `git` this host runs is given.
 *
 * A repository's own files can make git run a program: an fsmonitor its config
 * names, and a submodule's config reached by recursing into a gitlink and a
 * `.git` an agent wrote inside a worktree. So each run turns off the fsmonitor
 * and submodule recursion with `-c`, and a subcommand that would look into
 * submodules is told `--ignore-submodules`.
 */

/** The `-c` pairs before every subcommand. */
export const GIT_HARDENED = ['-c', 'core.fsmonitor=', '-c', 'submodule.recurse=false'] as const;

/** The subcommands that take `--ignore-submodules`. */
const IGNORES_SUBMODULES = new Set(['status', 'diff', 'diff-index', 'diff-files']);

/**
 * `git -c ... -C <dir> <args>`, with `--ignore-submodules` right after a
 * subcommand that takes it. A caller's own `-c` pairs before the subcommand
 * are kept where they are.
 */
export const gitArgv = (dir: string, args: readonly string[]): string[] => {
  let at = 0;
  while (at < args.length && args[at] === '-c') at += 2;
  const subcommand = args[at];
  const own = subcommand !== undefined && IGNORES_SUBMODULES.has(subcommand)
    ? [...args.slice(0, at + 1), '--ignore-submodules', ...args.slice(at + 1)]
    : [...args];
  return [...GIT_HARDENED, '-C', dir, ...own];
};
