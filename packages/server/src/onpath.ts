/**
 * Where a command is on PATH, which is how a setup asks what a machine has.
 *
 * The lookup is a function of its own because two things ask it: `ahpd
 * configure` offers the agents it finds, and `ahpd doctor` will report the
 * runtimes. Neither should answer with a half-read PATH, so every way of not
 * finding one answers nothing rather than the first candidate that exists.
 *
 * Away from Windows a file is a command when it is a regular file with an
 * execute bit. On Windows the name is tried with each extension in `PATHEXT`,
 * so `gemini` finds `gemini.cmd`, and then as it is written, in each folder in
 * turn, as VS Code's `findExecutable` tries them
 * (src/vs/base/node/processes.ts L121-L137 at 6b68d3fe); the extensions come
 * from `PATHEXT` because a `.cmd` shim is exactly what npm installs.
 *
 * The daemon's `onPath` setting says which lookup a setup runs: `runnable`, the
 * default, is the one above, and `findExecutable` is VS Code's own, which takes
 * any file that is not a folder and reads every entry that is not absolute, the
 * empty one among them, against the working directory.
 */

import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, posix, win32 } from 'node:path';

/** Which lookup a setup runs, as the daemon's `onPath` setting names it. */
export type OnPathLookup = 'runnable' | 'findExecutable';

/** What `PATHEXT` holds when the environment names none. */
const WINDOWS_EXTENSIONS = ['.COM', '.EXE', '.BAT', '.CMD'];

/** Whether a path names a file this system could run. */
const runnable = (file: string, platform: NodeJS.Platform): boolean => {
  try {
    const held = statSync(file);
    if (!held.isFile()) return false;
    // Windows has no execute bit in the POSIX sense, and `statSync` reports one
    // for every file it finds; the extension is what made it a candidate.
    return platform === 'win32' || (held.mode & 0o111) !== 0;
  }
  catch {
    // A missing file, or a directory on the way that cannot be read.
    return false;
  }
};

/** The names a command may have on `platform`, most specific first. */
const namesOf = (command: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] => {
  if (platform !== 'win32') return [command];
  const extensions = (env.PATHEXT ?? WINDOWS_EXTENSIONS.join(';'))
    .split(';')
    .map((one) => one.trim())
    .filter((one) => one !== '');
  const lower = command.toLowerCase();
  // A command that already names an extension `PATHEXT` knows is not tried
  // again with another one, which would look for `gemini.cmd.exe`.
  if (extensions.some((extension) => lower.endsWith(extension.toLowerCase()))) return [command];
  return [...extensions.map((extension) => `${command}${extension}`), command];
};

/**
 * A file found on Windows, named as its folder holds it.
 *
 * Windows finds `gemini.CMD` when the file is `gemini.cmd`, since a name is the
 * same file in any case and `PATHEXT` lists its extensions in capitals - and a
 * setup that showed the first would name a file nobody wrote.
 */
const spelledAsHeld = (dir: string, name: string): string => {
  const lower = name.toLowerCase();
  try {
    const held = readdirSync(dir).find((one) => one.toLowerCase() === lower);
    return join(dir, held ?? name);
  }
  catch {
    return join(dir, name);
  }
};

/**
 * VS Code's lookup, as `findExecutable` makes it
 * (src/vs/base/node/processes.ts L69-L140 at 6b68d3fe): a file is a command when
 * it is there and is not a folder, a command with a folder in it is read
 * against the working directory, each entry that is not absolute is joined to
 * the working directory, Windows tries each `PATHEXT` extension before the name
 * as written, and the working directory answers last.
 */
const findExecutable = (
  command: string,
  path: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  cwd: string,
): string | undefined => {
  const paths = platform === 'win32' ? win32 : posix;
  const exists = (file: string): boolean => {
    if (!existsSync(file)) return false;
    try {
      return !statSync(file).isDirectory();
    }
    catch (error) {
      // A link whose target this user cannot read, which VS Code reads by
      // the link itself.
      if ((error as NodeJS.ErrnoException).code !== 'EACCES') return false;
      try { return !lstatSync(file).isDirectory(); }
      catch { return false; }
    }
  };
  if (paths.isAbsolute(command)) return exists(command) ? command : undefined;
  if (paths.dirname(command) !== '.') {
    const full = paths.join(cwd, command);
    return exists(full) ? full : undefined;
  }
  for (const entry of path.split(paths.delimiter)) {
    const full = paths.isAbsolute(entry) ? paths.join(entry, command) : paths.join(cwd, entry, command);
    if (platform === 'win32') {
      for (const extension of (env.PATHEXT || WINDOWS_EXTENSIONS.join(';')).split(';')) {
        if (exists(`${full}${extension}`)) return `${full}${extension}`;
      }
    }
    if (exists(full)) return full;
  }
  const full = paths.join(cwd, command);
  return exists(full) ? full : undefined;
};

/**
 * The full path of `command` on `path`, or nothing when it is not there.
 *
 * `path` is the PATH text itself, because a caller may have been given one as a
 * setting and a test has none of its own. The platform and the environment are
 * arguments too, so the Windows rules can be exercised where they are not the
 * running system's. An absolute command names its own file and is not looked up
 * on PATH at all. `lookup` is the daemon's `onPath` setting, and `cwd` the
 * working directory `findExecutable` reads a relative entry against.
 */
export const onPath = (
  command: string,
  path: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  lookup: OnPathLookup = 'runnable',
  cwd: string = process.cwd(),
): string | undefined => {
  if (command === '') return undefined;
  if (lookup === 'findExecutable') return findExecutable(command, path, platform, env, cwd);
  const absolute = platform === 'win32' ? win32.isAbsolute(command) : isAbsolute(command);
  if (absolute) return runnable(command, platform) ? command : undefined;
  const split = platform === 'win32' ? ';' : ':';
  const names = namesOf(command, platform, env);
  for (const dir of path.split(split)) {
    // An empty entry stands for the current directory on POSIX. A setup that
    // reported a command from the directory it happened to run in would be
    // answering about a folder rather than about what the machine installs.
    if (dir === '') continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (runnable(candidate, platform)) return platform === 'win32' ? spelledAsHeld(dir, name) : candidate;
    }
  }
  return undefined;
};
