/**
 * VS Code's shell integration, put into a shell before it starts.
 *
 * VS Code's `getShellIntegrationInjection`
 * (https://github.com/microsoft/vscode/blob/122ec4fe4431e8435c42e9b609e3a43a60877383/src/vs/platform/terminal/node/terminalEnvironment.ts#L52-L368),
 * which its agent host calls for every terminal it opens
 * (https://github.com/microsoft/vscode/blob/122ec4fe4431e8435c42e9b609e3a43a60877383/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L364-L376).
 * For a shell it knows, it answers the arguments that make the shell read one
 * of VS Code's scripts as it starts, the variables the script reads, and for
 * zsh the files that stand in for the person's own startup files. The script
 * then marks each prompt and command in OSC 633, and reads the person's own
 * startup files itself.
 *
 * The scripts are in `shellintegration/` at this package's root, copied from
 * https://github.com/microsoft/vscode/tree/122ec4fe4431e8435c42e9b609e3a43a60877383/src/vs/workbench/contrib/terminal/common/scripts
 * unchanged. The PowerShell script imports a `psreadline` folder beside it
 * only when `VSCODE_A11Y_MODE` is `1`, which nothing here sets, and it looks
 * before it imports; the folder is not copied.
 *
 * The inputs the agent host passes the same way every time are not
 * parameters here: integration on and forced, no screen reader, no
 * environment variable collections and no environment reporting. With no
 * collections the reference's `addEnvMixinPathPrefix` adds nothing, so it is
 * not carried. The product it names is this one: `ahpd` where the reference
 * names its application, and the stable build's `VSCODE_STABLE`.
 */

import { chmodSync, copyFileSync, lstatSync, mkdirSync, realpathSync, type Stats } from 'node:fs';
import { homedir, release, tmpdir, userInfo } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ShellIntegration } from '@ahpd/sdk';

/** Why a shell gets no injection. */
export type ShellIntegrationInjectionFailureReason =
  | 'UnsupportedWindowsBuild'
  | 'UnsupportedArgs'
  | 'UnsupportedShell'
  | 'FailedToSetStickyBit'
  | 'FailedToCreateTmpDir';

/** What a shell is started with to read the integration script. */
export interface ShellIntegrationConfigInjection {
  readonly type: 'injection';
  /** A new set of arguments to use. */
  readonly newArgs: string[] | undefined;
  /** An environment to mix in to the real one. */
  readonly envMixin?: Record<string, string>;
  /** Files to copy from `source` to `dest` before the shell starts. */
  readonly filesToCopy?: { source: string; dest: string }[];
}

export interface ShellIntegrationInjectionFailure {
  readonly type: 'failure';
  readonly reason: ShellIntegrationInjectionFailureReason;
}

/**
 * The machine a shell starts on: which system, and on Windows its build.
 *
 * Handed in, as the terminal store's platform is, so a case on one system can
 * ask what another would answer.
 */
export interface ShellIntegrationMachine {
  platform: string;
  /** The Windows build number, read only on Windows. */
  windowsBuild: () => number;
}

/** The folder the scripts are in: this package's root, from `src` and from `dist` alike. */
const SCRIPTS = fileURLToPath(new URL('../shellintegration', import.meta.url));

/**
 * The Windows build, from `os.release()`.
 *
 * The reference reads the registry first, through `@vscode/windows-registry`,
 * a native module this package does not depend on, and falls back to this:
 * the third number of `major.minor.build`
 * (https://github.com/microsoft/vscode/blob/122ec4fe4431e8435c42e9b609e3a43a60877383/src/vs/base/node/windowsVersion.ts#L107-L113).
 */
export const windowsBuildNumber = (): number => {
  const build = Number.parseInt(release().split('.')[2] ?? '', 10);
  return Number.isNaN(build) ? 0 : build;
};

/** The machine this runs on. */
const THIS_MACHINE: ShellIntegrationMachine = { platform: process.platform, windowsBuild: windowsBuildNumber };

/**
 * Whether a program is zsh, by its file name.
 *
 * The reference's `isZsh` (`node/agentHostShellUtils.ts`): `zsh` or `zsh.exe`
 * in any case on Windows, `zsh` exactly elsewhere.
 */
export const isZsh = (shellPath: string, platform: string = process.platform): boolean => (platform === 'win32'
  ? /^zsh(?:\.exe)?$/iu.test(win32.basename(shellPath))
  : /^zsh$/u.test(posix.basename(shellPath)));

type ShellIntegrationExecutable =
  | 'windows-pwsh'
  | 'windows-pwsh-login'
  | 'pwsh'
  | 'pwsh-login'
  | 'zsh'
  | 'zsh-login'
  | 'bash'
  | 'fish'
  | 'fish-login';

const shellIntegrationArgs = new Map<ShellIntegrationExecutable, string[]>();
// The try catch swallows execution policy errors in the case of the archive distributable
shellIntegrationArgs.set('windows-pwsh', ['-noexit', '-command', 'try { . "{0}\\shellIntegration.ps1" } catch {}{1}']);
shellIntegrationArgs.set('windows-pwsh-login', ['-l', '-noexit', '-command', 'try { . "{0}\\shellIntegration.ps1" } catch {}{1}']);
shellIntegrationArgs.set('pwsh', ['-noexit', '-command', '. "{0}/shellIntegration.ps1"{1}']);
shellIntegrationArgs.set('pwsh-login', ['-l', '-noexit', '-command', '. "{0}/shellIntegration.ps1"']);
shellIntegrationArgs.set('zsh', ['-i']);
shellIntegrationArgs.set('zsh-login', ['-il']);
shellIntegrationArgs.set('bash', ['--init-file', '{0}/shellIntegration-bash.sh']);
shellIntegrationArgs.set('fish', ['--init-command', 'source "{0}/shellIntegration.fish"']);
shellIntegrationArgs.set('fish-login', ['-l', '--init-command', 'source "{0}/shellIntegration.fish"']);
const pwshLoginArgs = ['-login', '-l'];
const shLoginArgs = ['--login', '-l'];
const shInteractiveArgs = ['-i', '--interactive'];
const pwshImpliedArgs = ['-nol', '-nologo'];

/**
 * VS Code's `format`, for the two places these templates have: `{0}` is the
 * scripts' folder and `{1}` whatever follows the PowerShell command.
 */
const format = (template: string, root: string, after = ''): string => template.replaceAll('{0}', root).replaceAll('{1}', after);

/** The arguments a template names, with the folder put in. */
const templated = (which: ShellIntegrationExecutable, after?: string): string[] | undefined => {
  const found = shellIntegrationArgs.get(which);
  if (found === undefined) return undefined;
  // Shallow clone the array to avoid setting the default array
  const args = [...found];
  args[args.length - 1] = format(args[args.length - 1] ?? '', SCRIPTS, after);
  return args;
};

function arePwshLoginArgs(originalArgs: string | readonly string[]): boolean {
  if (typeof originalArgs === 'string') {
    return pwshLoginArgs.includes(originalArgs.toLowerCase());
  }
  const [first = '', second = ''] = originalArgs;
  return (originalArgs.length === 1 && pwshLoginArgs.includes(first.toLowerCase()))
    || (originalArgs.length === 2
      && (pwshLoginArgs.includes(first.toLowerCase()) || pwshLoginArgs.includes(second.toLowerCase()))
      && (pwshImpliedArgs.includes(first.toLowerCase()) || pwshImpliedArgs.includes(second.toLowerCase())));
}

function arePwshImpliedArgs(originalArgs: string | readonly string[]): boolean {
  if (typeof originalArgs === 'string') {
    return pwshImpliedArgs.includes(originalArgs.toLowerCase());
  }
  return originalArgs.length === 0 || (originalArgs.length === 1 && pwshImpliedArgs.includes((originalArgs[0] ?? '').toLowerCase()));
}

function areZshBashFishLoginArgs(originalArgs: string | readonly string[]): boolean {
  if (typeof originalArgs === 'string') {
    return shLoginArgs.includes(originalArgs.toLowerCase());
  }
  const left = originalArgs.filter((arg) => !shInteractiveArgs.includes(arg.toLowerCase()));
  return left.length === 1 && shLoginArgs.includes((left[0] ?? '').toLowerCase());
}

/**
 * The folder zsh is pointed at instead of the person's own: one per user,
 * under the system's temporary folder, that nobody else may enter.
 *
 * The reference sets the sticky bit and owner-only access with `0o1700`, and
 * makes the folder when the mode cannot be set because it is not there yet.
 */
const zshFolder = (): { folder: string } | ShellIntegrationInjectionFailure => {
  let username: string;
  try {
    username = userInfo().username;
  }
  catch {
    username = 'unknown';
  }
  const folder = join(realpathSync(tmpdir()), `${username}-ahpd-zsh`);
  /*
   * The name is known in advance and the temporary folder is shared, so
   * another user can make it first. A symlink there would send the chmod and
   * the copies of four zsh startup files wherever it points, the person's own
   * home included; a folder someone else owns would hold files they wrote.
   * Either way the shell starts with no integration.
   */
  let found: Stats | undefined;
  try {
    found = lstatSync(folder);
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { type: 'failure', reason: 'FailedToCreateTmpDir' };
  }
  if (found !== undefined) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    if (found.isSymbolicLink() || !found.isDirectory() || (uid !== undefined && found.uid !== uid)) {
      return { type: 'failure', reason: 'FailedToCreateTmpDir' };
    }
    try {
      chmodSync(folder, 0o1700);
      return { folder };
    }
    catch {
      return { type: 'failure', reason: 'FailedToSetStickyBit' };
    }
  }
  try {
    mkdirSync(folder, { mode: 0o700 });
  }
  catch {
    return { type: 'failure', reason: 'FailedToCreateTmpDir' };
  }
  try {
    chmodSync(folder, 0o1700);
  }
  catch {
    return { type: 'failure', reason: 'FailedToSetStickyBit' };
  }
  return { folder };
};

/**
 * For a shell and the arguments it would start with, what to start it with
 * instead so it reads VS Code's integration script, or why it cannot.
 *
 * `env` is the environment the shell is given, which is where a person's own
 * `ZDOTDIR` is read from; the folder zsh is pointed at sends it back there.
 * The nonce goes to the script, which writes it after each command line it
 * reports, so a command line some program prints cannot pass for the shell's.
 */
export const getShellIntegrationInjection = (
  executable: string,
  originalArgs: string | readonly string[] | undefined,
  nonce: string,
  env: Record<string, string | undefined> | undefined,
  machine: ShellIntegrationMachine = THIS_MACHINE,
): ShellIntegrationConfigInjection | ShellIntegrationInjectionFailure => {
  const isWindows = machine.platform === 'win32';
  // Shell integration requires Windows 10 build 18309+ (ConPTY support)
  if (isWindows && machine.windowsBuild() < 18309) {
    return { type: 'failure', reason: 'UnsupportedWindowsBuild' };
  }

  const shell = isWindows ? win32.basename(executable).toLowerCase() : posix.basename(executable);
  const type = 'injection';
  let newArgs: string[] | undefined;
  const envMixin: Record<string, string> = {
    VSCODE_INJECTION: '1',
    VSCODE_NONCE: nonce,
  };

  // Windows
  if (isWindows) {
    if (shell === 'pwsh.exe' || shell === 'powershell.exe') {
      envMixin.VSCODE_A11Y_MODE = '0';
      if (originalArgs === undefined || arePwshImpliedArgs(originalArgs)) {
        newArgs = templated('windows-pwsh', '');
      }
      else if (arePwshLoginArgs(originalArgs)) {
        newArgs = templated('windows-pwsh-login', '');
      }
      if (newArgs === undefined) {
        return { type: 'failure', reason: 'UnsupportedArgs' };
      }
      envMixin.VSCODE_STABLE = '1';
      return { type, newArgs, envMixin };
    }
    if (shell === 'bash.exe') {
      if (originalArgs === undefined || originalArgs.length === 0) {
        newArgs = templated('bash');
      }
      else if (areZshBashFishLoginArgs(originalArgs)) {
        envMixin.VSCODE_SHELL_LOGIN = '1';
        newArgs = templated('bash');
      }
      if (newArgs === undefined) {
        return { type: 'failure', reason: 'UnsupportedArgs' };
      }
      envMixin.VSCODE_STABLE = '1';
      return { type, newArgs, envMixin };
    }
    return { type: 'failure', reason: 'UnsupportedShell' };
  }

  // Linux & macOS
  switch (shell) {
    case 'bash': {
      if (originalArgs === undefined || originalArgs.length === 0) {
        newArgs = templated('bash');
      }
      else if (areZshBashFishLoginArgs(originalArgs)) {
        envMixin.VSCODE_SHELL_LOGIN = '1';
        newArgs = templated('bash');
      }
      if (newArgs === undefined) {
        return { type: 'failure', reason: 'UnsupportedArgs' };
      }
      envMixin.VSCODE_STABLE = '1';
      return { type, newArgs, envMixin };
    }
    case 'fish': {
      if (originalArgs === undefined || originalArgs.length === 0) {
        newArgs = templated('fish');
      }
      else if (areZshBashFishLoginArgs(originalArgs)) {
        newArgs = templated('fish-login');
      }
      if (newArgs === undefined) {
        return { type: 'failure', reason: 'UnsupportedArgs' };
      }
      return { type, newArgs, envMixin };
    }
    case 'pwsh': {
      if (originalArgs === undefined || arePwshImpliedArgs(originalArgs)) {
        newArgs = templated('pwsh', '');
      }
      else if (arePwshLoginArgs(originalArgs)) {
        newArgs = templated('pwsh-login', '');
      }
      if (newArgs === undefined) {
        return { type: 'failure', reason: 'UnsupportedArgs' };
      }
      envMixin.VSCODE_STABLE = '1';
      return { type, newArgs, envMixin };
    }
    case 'zsh': {
      if (originalArgs === undefined || originalArgs.length === 0) {
        newArgs = templated('zsh');
      }
      else if (areZshBashFishLoginArgs(originalArgs)) {
        newArgs = templated('zsh-login');
      }
      if (newArgs === undefined) {
        return { type: 'failure', reason: 'UnsupportedArgs' };
      }

      // Move .zshrc into $ZDOTDIR as the way to activate the script
      const made = zshFolder();
      if ('type' in made) return made;
      envMixin.ZDOTDIR = made.folder;
      envMixin.USER_ZDOTDIR = env?.ZDOTDIR ?? homedir();
      const filesToCopy = [
        { source: join(SCRIPTS, 'shellIntegration-rc.zsh'), dest: join(made.folder, '.zshrc') },
        { source: join(SCRIPTS, 'shellIntegration-profile.zsh'), dest: join(made.folder, '.zprofile') },
        { source: join(SCRIPTS, 'shellIntegration-env.zsh'), dest: join(made.folder, '.zshenv') },
        { source: join(SCRIPTS, 'shellIntegration-login.zsh'), dest: join(made.folder, '.zlogin') },
      ];
      return { type, newArgs, envMixin, filesToCopy };
    }
    default:
      return { type: 'failure', reason: 'UnsupportedShell' };
  }
};

/**
 * The injection, as the terminal store's port.
 *
 * The store hands a shell's path, the arguments it would start with, the
 * environment it would be given and the terminal's nonce, and this answers
 * what to start it with instead - or nothing, for a shell VS Code's injection
 * does not know, which leaves the shell exactly as it was.
 *
 * The files a shell needs on disk are copied here, before the answer, because
 * the store keeps no filesystem of its own: zsh reads the four startup files
 * from `$ZDOTDIR`, and a copy that fails is swallowed for the reason VS Code
 * swallows it - another process may be writing the same folder, and the shell
 * is better off with the integration than without it.
 *
 * `machine` is the computer a terminal's process was placed in, and is always
 * absent today: the store asks no port for a shell in a machine. It is passed
 * so a runtime that can copy or mount the scripts there answers for one.
 */
export const shellIntegration: ShellIntegration = (shell, args, env, nonce, machine) => {
  void machine;
  const asked = getShellIntegrationInjection(shell, [...args], nonce, env);
  if (asked.type !== 'injection') return undefined;
  for (const file of asked.filesToCopy ?? []) {
    try {
      mkdirSync(dirname(file.dest), { recursive: true });
      copyFileSync(file.source, file.dest);
    }
    catch { /* another process may be using the same folder, as the reference swallows it */ }
  }
  return {
    ...(asked.newArgs === undefined ? {} : { newArgs: asked.newArgs }),
    ...(asked.envMixin === undefined ? {} : { envMixin: asked.envMixin }),
  };
};
