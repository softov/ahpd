import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, win32 } from 'node:path';
import { terminalReducer, type TerminalContentPart } from '@microsoft/agent-host-protocol';
import { localPath, uriOf } from '../resources/fileuri.js';
import { shellEnvOf, type ShellEnv } from './shellenv.js';
import { osc633Of } from './osc633.js';
import type { Pty, Screen, ShellIntegration, SpawnPty, SpawnScreen, Terminal, TerminalOptions, TerminalStore } from '../types/terminals.js';

/**
 * A shell on the host machine, as a terminal channel.
 *
 * Pipes, not a pseudoterminal: a PTY needs a native binding this daemon does
 * not depend on, and the protocol has `isPty: false` for exactly this - "output
 * is plain text and clients do not need to parse VT sequences". So a command
 * runs and its output arrives, and anything that draws itself with cursor
 * movement will not look right. Said in the state rather than discovered.
 *
 * `node:child_process` is used because all three supported runtimes provide it.
 */

/**
 * Runs a program for its effect, and lets go of it.
 *
 * Handed in rather than reached for, so a case on one machine can read what
 * another would run: the one program this starts is `taskkill`, which is an
 * executable and which a build on Linux has none of.
 */
export type RunQuietly = (program: string, argv: string[]) => void;

/** The real one: start it, and say nothing about it. */
const quietly: RunQuietly = (program, argv) => {
  /*
   * Both pipes ignored: a terminal is being ended, and a program started to
   * end it has nobody left to tell. The `error` listener is the load-bearing
   * part - without it a missing executable arrives as an unhandled event,
   * which takes the daemon down while it is tidying a terminal away.
   */
  spawn(program, argv, { stdio: 'ignore', windowsHide: true }).on('error', () => {});
};

/**
 * Starts a shell under pipes, and answers the runtime's handle.
 *
 * Handed in for the same reason as `RunQuietly`: `cmd.exe`'s line and the
 * verbatim flag are what a Windows run needs and what a case on Linux cannot
 * otherwise read, since both are options to the spawn rather than arguments.
 */
export type SpawnShell = (shell: string, args: string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;

/**
 * The real one: Node's `spawn`.
 *
 * Cast because `SpawnOptions` alone does not promise piped stdio; this is the
 * one call that always passes `stdio: ['pipe', 'pipe', 'pipe']`, so the three
 * streams are there.
 */
const shells: SpawnShell = (shell, args, options) =>
  spawn(shell, args, options) as ChildProcessWithoutNullStreams;

/**
 * The Windows shell, in the order VS Code looks for one.
 *
 * PowerShell 7 where its installer put it and then wherever `PATH` names it,
 * because a machine can have it unpacked somewhere the installer never ran;
 * then the Windows PowerShell the system has had since Windows 7; then
 * `cmd.exe`, which every Windows has and which is the last thing that can be
 * started. Nothing here reads `SHELL`: it is a POSIX convention, and the value
 * a person has on Windows is whatever Git Bash or Cygwin last left behind - a
 * path a terminal would try to start and fail on.
 *
 * Read as Windows paths whatever machine this runs on, because the branch that
 * reads them is the Windows one. `ComSpec` is taken as it is rather than
 * checked: Windows sets it to the command interpreter, and an environment that
 * names one which is not there is not one this can tell from a machine where
 * it is.
 */
const windowsShell = (
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean,
): string => {
  const installed = env.ProgramFiles === undefined
    ? []
    : [win32.join(env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe')];
  const onPath = (env.PATH ?? '').split(';')
    .filter((folder) => folder !== '')
    .map((folder) => win32.join(folder, 'pwsh.exe'));
  const pwsh = [...installed, ...onPath].find((one) => exists(one));
  if (pwsh !== undefined) return pwsh;
  const system = env.SystemRoot === undefined
    ? undefined
    : win32.join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (system !== undefined && exists(system)) return system;
  return env.ComSpec ?? 'cmd.exe';
};

/**
 * What runs, when nothing else was asked for.
 *
 * `asked` is the host's `defaultShell` for a client's terminal, and it wins on
 * either system: somebody who named a shell gets that shell, and failing to
 * start it is the answer rather than a reason to quietly pick another.
 *
 * The platform, the environment and the check for a file are handed in, so a
 * case on Linux can ask what a Windows machine would answer - there is no
 * other way to exercise the lookup from here.
 */
export const shellOf = (
  asked?: string,
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
): string => {
  if (asked !== undefined) return asked;
  return platform === 'win32' ? windowsShell(env, exists) : env.SHELL ?? '/bin/sh';
};

/**
 * One word, quoted for a POSIX shell.
 *
 * Single quotes keep everything literal except the quote itself, so a quote is
 * written by closing, escaping and reopening: `it's` becomes `'it'\''s'`.
 */
const quoted = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;

/**
 * One word, quoted for PowerShell.
 *
 * PowerShell's single quotes are literal the way a POSIX shell's are, and a
 * quote inside one is written by doubling it rather than by closing and
 * reopening: `it's` becomes `'it''s'`.
 */
const psQuoted = (word: string): string => `'${word.replaceAll("'", "''")}'`;

/**
 * One argument escaped for the C runtime, for Windows PowerShell 5.1 to pass on.
 *
 * Windows PowerShell builds a program's command line by wrapping a word with
 * whitespace in double quotes and copying the rest as it is, so a `"` inside a
 * word ends the program's argument there, a trailing `\` escapes the closing
 * quote, and an empty word is dropped. The C runtime's own rules undo this
 * escape: `\"` is a quote, and backslashes count only in front of one.
 * PowerShell 7.3 escapes the words itself, so this is for `powershell.exe`
 * alone.
 */
const crtEscaped = (word: string): string => {
  if (word === '') return '""';
  const escaped = word.replace(/(\\*)"/g, '$1$1\\"');
  return /\s/.test(word) ? escaped.replace(/(\\+)$/, '$1$1') : escaped;
};

/** Whether a shell is Windows PowerShell, which passes a program's words unescaped. */
const isWindowsPowerShell = (shell: string): boolean =>
  ['powershell', 'powershell.exe'].includes(basename(shell).toLowerCase());

/**
 * One word, quoted for `cmd.exe`.
 *
 * Double quotes, which is all `cmd.exe` has. They are enough for the spaces
 * and the `&`s a path is made of, and a word holding a double quote of its own
 * is the case this does not answer - `cmd.exe` has no way to write one.
 */
const cmdQuoted = (word: string): string => `"${word}"`;

/** Which shell a path names, read from the name of its file. */
type ShellKind = 'powershell' | 'cmd' | 'posix';

/**
 * What a shell's path says about it: its kind, and its file's own name.
 *
 * The kind is read from the file's name, because that is the one part of a
 * shell that says what it is: `pwsh.exe` and `powershell.exe` both take
 * PowerShell's arguments, `cmd.exe` takes `cmd.exe`'s, and everything else -
 * `sh`, `bash`, `zsh`, `fish` - reads a command line the POSIX way. Anything
 * unrecognised is POSIX, which is what every shell but these two is.
 *
 * `file` is the name it was read from, lowercased, for the parts that are
 * about one shell rather than one kind: zsh prints a partial-line marker
 * unless it is told not to.
 */
const kindOf = (shell: string): { kind: ShellKind; file: string } => {
  const file = basename(shell).toLowerCase();
  if (file === 'pwsh' || file === 'pwsh.exe' || file === 'powershell' || file === 'powershell.exe')
    return { kind: 'powershell', file };
  return { kind: file === 'cmd' || file === 'cmd.exe' ? 'cmd' : 'posix', file };
};

/**
 * The flag a shell takes one command with.
 *
 * `-c` for a POSIX shell. PowerShell has no `-c` of its own - it reads `-c` as
 * `-Command` but only when it is the last argument, which this is not - so it
 * is spelled out, with `-NoProfile` in front of it so a person's profile does
 * not run and print its own output into a command's answer. `cmd.exe` reads
 * `/c` and wants `/d` and `/s` with it: `/d` skips the autorun registry keys,
 * and `/s` is what makes it strip the outer quotes of the line it is given.
 */
const flagOf = (kind: ShellKind): string[] =>
  kind === 'powershell' ? ['-NoProfile', '-Command'] : kind === 'cmd' ? ['/d', '/s', '/c'] : ['-c'];

/**
 * What PowerShell runs after a command, so the command's exit code is its own.
 *
 * `-Command` exits 0 or 1 by `$?` and drops a program's own code: `node -e
 * "process.exit(7)"` ends the shell with 1. This exits with `$LASTEXITCODE`
 * when the line failed on a program, and 1 when it failed on a cmdlet, which
 * sets no code. On a line of its own, so a comment at the end of the command
 * does not swallow it.
 */
const PS_EXIT = 'if (-not $?) { exit $(if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }) }';

/** The line as the shell of `kind` is given it, with what it needs around it. */
const shellLine = (kind: ShellKind, line: string): string =>
  kind === 'powershell' ? `${line}\n${PS_EXIT}` : kind === 'cmd' ? `"${line}"` : line;

/**
 * An argv as one line for the shell of `kind`.
 *
 * PowerShell needs `&` in front of it: without the call operator, a quoted
 * path is a string and the shell prints it rather than running it. Windows
 * PowerShell is given the words after the program escaped for the C runtime.
 */
const argvLine = (kind: ShellKind, argv: string[], windowsPowerShell = false): string => {
  if (kind === 'powershell') {
    const [program = '', ...words] = argv;
    return ['&', psQuoted(program), ...words.map((word) => psQuoted(windowsPowerShell ? crtEscaped(word) : word))].join(' ');
  }
  return argv.map(kind === 'cmd' ? cmdQuoted : quoted).join(' ');
};

/**
 * What a shell says about itself, in the escape sequences it says it with.
 *
 * OSC 133 is the command-boundary convention a shell's own prompt writes -
 * `A` before the prompt, `B` where the command starts, `C` where its output
 * does, `D;<code>` when it finished - and OSC 7 is the directory. OSC 633 is
 * the same thing as VS Code's shell integration scripts write it: `A`, `B`,
 * `C` and `D` mean what their OSC 133 twins mean, `E;<line>;<nonce>` is the
 * command line itself, and `P;Cwd=<path>` is the directory. They arrive mixed
 * into the output, and this takes them out of it: a server MUST NOT include
 * shell integration escape sequences in `terminal/data`, which a client would
 * otherwise count as output
 * (https://microsoft.github.io/agent-host-protocol/specification/terminal-channel).
 * The rest of the bytes go to the client, which is drawing a terminal.
 *
 * Only under a pseudoterminal, because only then is there a shell running its
 * own prompt to emit them.
 */
const MARKS = /\u001b\](133|633|7);([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;

/**
 * The most of a chunk's end held back as the start of a mark.
 *
 * The reference host's bound on an escape sequence it holds for the next
 * chunk, so one that never finishes cannot hold back output
 * (https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/copilot/copilotNonPtyShellTerminals.ts#L59-L60).
 */
const HELD = 1024;

/** How each mark the store reads begins. */
const OPENERS = ['\u001b]133;', '\u001b]633;', '\u001b]7;'];

/**
 * Where a mark that the next chunk may finish starts, at the end of `data`.
 *
 * A pseudoterminal hands output over in whatever pieces it read, so one mark
 * can arrive in two. What could still become one is held, and the answer is
 * `data.length` when nothing could: an open sequence that is not a mark, such
 * as a title, goes on to the client, which joins the pieces itself.
 */
const unfinished = (data: string): number => {
  const start = data.lastIndexOf('\u001b]');
  if (start !== -1 && data.length - start <= HELD) {
    const rest = data.slice(start);
    const open = !rest.includes('\u0007') && !rest.includes('\u001b\\');
    if (open && OPENERS.some((opener) => rest.startsWith(opener) || opener.startsWith(rest))) return start;
  }
  // A lone escape at the very end can be the start of either.
  return data.endsWith('\u001b') ? data.length - 1 : data.length;
};

/**
 * Open one.
 *
 * `pty`, `shellEnv`, `platform`, `run`, `start`, `shellIntegration` and
 * `spawnScreen` are the machine's own: a pseudoterminal to run under, the
 * environment an operator gives every shell, which system this is, how a
 * program is started to end a tree, how the shell itself is started, VS Code's
 * shell integration to put into it, and the screen that keeps what a terminal
 * emulator would show. All seven are handed in rather than reached for, which
 * is the only way a case on Linux can ask what a Windows machine would do.
 */
export function createTerminal(
  options: TerminalOptions,
  pty?: SpawnPty,
  shellEnv?: ShellEnv,
  platform: string = process.platform,
  run: RunQuietly = quietly,
  start: SpawnShell = shells,
  shellIntegration?: ShellIntegration,
  spawnScreen?: SpawnScreen,
): Terminal {
  const { uri, cwd, emit } = options;
  /** Windows, where a shell is started without `detached` and ended by pid. */
  const windows = platform === 'win32';
  // Asked for once and kept: the search behind it reads the filesystem, and a
  // `!` command opens a terminal of its own each time it runs.
  const shell = shellOf(options.shell, platform);
  // `basename`, which is the runtime's own: a Windows shell's path is separated
  // by `\`, and cutting at the last `/` would leave the whole path as the title.
  let title = options.name ?? basename(shell);
  let claim = options.claim;
  let cols = options.cols ?? 80;
  let rows = options.rows ?? 24;
  let exitCode: number | undefined;
  /** The signal that ended the process, when the runtime named one. */
  let signal: string | undefined;
  /**
   * Resolved once, when the process goes.
   *
   * `ended` is the single place that knows it has, so `waitForExit` is this
   * promise rather than a second watcher racing the emitter. A terminal that
   * has already gone hands back the resolved promise, which is what makes the
   * call immediate rather than a wait that never ends.
   */
  let settle: ((exit: { exitCode?: number; signal?: string }) => void) | undefined;
  const gone = new Promise<{ exitCode?: number; signal?: string }>((resolve) => { settle = resolve; });
  /**
   * Everything written so far, so a client that subscribes late sees it, in
   * the parts a client watching from the start built from the same actions.
   *
   * The protocol package's own `terminalReducer` folds each action in, as
   * `spawn.ts` folds a chat's with `chatReducer`: a hand-rolled folder would
   * be a second answer to what a terminal action means.
   *
   * Capped: a terminal left running `tail -f` for a day is a host holding a
   * day of output for a client that may never come back. Past the cap, whole
   * parts go from the front and then the first part's text, as the reference
   * host trims its content
   * (https://github.com/microsoft/vscode/blob/122ec4fe4431e8435c42e9b609e3a43a60877383/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L831-L853).
   */
  let content: TerminalContentPart[] = [];
  /** The characters `content` holds. */
  let size = 0;
  const KEEP = 200_000;

  const sizeOf = (part: TerminalContentPart): number => (part.type === 'command' ? part.output.length : part.value.length);
  const tell = (action: { type: string } & Record<string, unknown>): void => {
    try {
      content = terminalReducer({ content } as never, action as never).content;
    }
    catch { /* an action the reducer will not take leaves the content as it was */ }
    if (action.type === 'terminal/data') size += String(action.data).length;
    if (action.type === 'terminal/cleared') size = 0;
    if (size > KEEP) {
      const parts = [...content];
      while (size > KEEP && parts.length > 1) size -= sizeOf(parts.shift() as TerminalContentPart);
      const head = parts[0];
      if (size > KEEP && head !== undefined) {
        const excess = size - KEEP;
        parts[0] = head.type === 'command' ? { ...head, output: head.output.slice(excess) } : { ...head, value: head.value.slice(excess) };
        size -= excess;
      }
      content = parts;
    }
    emit('terminal', action);
  };

  const said = (data: string): void => {
    tell({ type: 'terminal/data', data });
  };

  /*
   * The shell's own flag for one command, and nothing when there is no command.
   *
   * A shell given one runs the one thing and exits. Under pipes that is the
   * only completion signal there is; under a pseudoterminal the shell says so
   * itself, in OSC 133.
   *
   * Two shapes arrive here and they are not the same thing. With `args` the
   * caller is naming a program, so the argv is quoted word by word and the
   * shell is asked to run exactly that. Without it the caller is handing over
   * a line - the `!` prefix in the composer is one - and that line is already
   * shell syntax: quoting it would ask the shell for a program named after the
   * whole line, which is a command that never existed.
   *
   * Which flag and which quoting is the shell's, not this host's: a line
   * written for one shell is not a line the others read, and the composer's
   * `!echo hi` reaches PowerShell as `echo hi` and `cmd.exe` as the same.
   */
  const { kind, file } = kindOf(shell);
  /**
   * The value the integration script is given, and the one an `E` mark has to
   * carry for its line to be read as the shell's.
   */
  const nonce = options.nonce ?? randomUUID();
  /** The line the shell is asked to run, once there is one. */
  const line = options.command === undefined
    ? undefined
    : options.args === undefined
      ? options.command
      : argvLine(kind, [options.command, ...options.args], isWindowsPowerShell(shell));
  /*
   * `cmd.exe` takes its line inside one more pair of double quotes, which its
   * `/s` strips. Not decoration: Node turns an argv into a Windows command
   * line with backslash escapes for inner quotes - `\"` - and `cmd.exe` reads
   * no such escape, so a path with a space in it and a line such as `echo "a"`
   * both arrive broken without this. The spawn is told the argv is verbatim
   * for the same reason, and both are what Node's own `shell: true` does.
   */
  let args = line === undefined ? [] : [...flagOf(kind), shellLine(kind, line)];
  const environment: Record<string, string | undefined> = {
    // The operator's map over the daemon's own environment, which is what
    // makes a service unit with a private `XDG_CONFIG_HOME` reach its shells.
    ...shellEnvOf(process.env, shellEnv),
    // Asked for last, because the caller's variables sit over the host's and
    // these three over the caller's: a terminal's own size and kind are not
    // something a command may disagree with.
    ...options.env,
    // A real terminal under a pty, and an honest `dumb` without one.
    TERM: pty ? (process.env.TERM ?? 'xterm-256color') : 'dumb',
    COLUMNS: String(cols),
    LINES: String(rows),
  };
  /*
   * A name a caller spelled with nothing is a name they want gone.
   *
   * `spawn` would otherwise pass the name on with the text `undefined` in it,
   * which is a value nobody asked for and one a command would read as set.
   */
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete environment[name];
  }
  /*
   * The two flags a caller opens a shell with, set the way VS Code's agent
   * host sets them
   * (https://github.com/microsoft/vscode/blob/122ec4fe4431e8435c42e9b609e3a43a60877383/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L332-L355).
   *
   * Asked last, over the caller's own variables: a shell nobody is watching is
   * a fact about the terminal, and a command that paginates or asks a question
   * would wait for an answer that never comes. `PROMPT_EOL_MARK` is zsh's
   * partial-line marker - a `%` after output with no newline - and an empty
   * one is what keeps a `%` out of what an agent reads back.
   */
  if (options.preventShellHistory === true) environment.VSCODE_PREVENT_SHELL_HISTORY = '1';
  if (options.nonInteractive === true) {
    environment.LC_ALL = 'C.UTF-8';
    environment.PAGER = '';
    environment.GIT_PAGER = '';
    environment.GH_PAGER = '';
    environment.GIT_TERMINAL_PROMPT = '0';
    environment.DEBIAN_FRONTEND = 'noninteractive';
    if (file === 'zsh' || file === 'zsh.exe') environment.PROMPT_EOL_MARK = '';
  }
  /*
   * VS Code's shell integration, for a shell opened to sit in.
   *
   * A shell given a command runs it and exits, a terminal on pipes has no
   * prompt to mark, and a shell in a machine has no scripts there to read, so
   * none of the three is asked. What the port answers replaces the arguments
   * the shell would start with and mixes its variables over the environment it
   * would be given; a port that answers nothing, or throws, leaves the shell
   * starting exactly as it would have.
   *
   * `machine` is passed though it is always absent here: the day a runtime can
   * copy or mount the scripts in one, the port already knows which terminal
   * asked for it.
   */
  if (options.command === undefined && pty !== undefined && options.machine === undefined && shellIntegration !== undefined) {
    try {
      const asked = shellIntegration(shell, args, environment, nonce, options.machine);
      if (asked !== undefined) {
        if (asked.newArgs !== undefined) args = asked.newArgs;
        Object.assign(environment, asked.envMixin);
      }
    }
    catch { /* a port that cannot answer leaves the shell as it was */ }
  }

  /** Where the shell says it is, once it has said. */
  let where = cwd;
  /** The command being run, from `C` until `D`. */
  let command: { id: string; line: string; at: number } | undefined;
  /** What has been typed since the prompt, so the command line can be read back. */
  let typed = '';
  /** The command line the integration reported, carrying this terminal's nonce. */
  let reported: string | undefined;
  /**
   * Whether the shell writes OSC 633.
   *
   * From the first of those marks its commands are read from them alone: its
   * prompt may also write OSC 133 - fish does from 4.0, and so does a prompt
   * set up for another terminal - and reading both would report one command
   * twice. Both kinds are still stripped from the output.
   */
  let integrated = false;
  /**
   * Whether the shell has marked a command boundary.
   *
   * A shell under a pseudoterminal may print no marks at all, and the protocol
   * sends `terminal/commandDetectionAvailable` when shell integration becomes
   * available, so it goes out with the first OSC 133 mark and the state
   * reports it from then on - as the reference host announces it with the
   * first sequence a terminal writes
   * (https://github.com/microsoft/vscode/blob/122ec4fe4431e8435c42e9b609e3a43a60877383/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L709-L715).
   */
  let detected = false;
  /** The end of the last chunk, while it may be the start of a mark. */
  let held = '';

  /** Say the shell has marked a command boundary, once. */
  const detect = (): void => {
    if (detected) return;
    detected = true;
    tell({ type: 'terminal/commandDetectionAvailable' });
  };

  /** A command's output begins, as a `C` says, with the line it ran. */
  const executed = (line: string): void => {
    command = { id: `c${String(Date.now())}`, line, at: Date.now() };
    tell({
      type: 'terminal/commandExecuted',
      commandId: command.id,
      commandLine: command.line,
      timestamp: command.at,
    });
  };

  /** The command ended, as a `D` says, with the code the mark carries. */
  const finished = (code: number | undefined): void => {
    if (command === undefined) return;
    tell({
      type: 'terminal/commandFinished',
      commandId: command.id,
      ...(code !== undefined && Number.isFinite(code) ? { exitCode: code } : {}),
      durationMs: Date.now() - command.at,
    });
    command = undefined;
  };

  /** The shell's directory, as a path on this machine. */
  const moved = (path: string): void => {
    if (path === '' || path === where) return;
    where = path;
    tell({ type: 'terminal/cwdChanged', cwd: uriOf(path) });
  };

  /** Say what one mark meant. */
  const meant = (kind: string | undefined, body: string): void => {
    if (kind === '7') {
      // `file://host/path`, per the convention. The host part is dropped:
      // the path is on this machine, and that is what a client opens.
      moved(localPath(body));
      return;
    }
    if (kind === '633') {
      /*
       * The shell writes VS Code's marks. Any of them means the integration
       * loaded, including the ones this reads nothing from, so OSC 133 is
       * left alone from here on - see `integrated`.
       */
      integrated = true;
      const event = osc633Of(body);
      if (event === undefined) return;
      detect();
      switch (event.type) {
        case 'PromptStart':
          typed = '';
          return;
        case 'CommandLine':
          // Only a line the script wrote, carrying this terminal's nonce.
          if (event.nonce === nonce) reported = event.commandLine;
          return;
        case 'CommandExecuted':
          executed(reported ?? typed.trim());
          reported = undefined;
          return;
        case 'CommandFinished':
          finished(event.exitCode);
          return;
        case 'Property':
          // The script writes the directory as a plain path, where OSC 7
          // writes a URI: `P;Cwd=/tmp`, not `P;Cwd=file://host/tmp`.
          if (event.key === 'Cwd') moved(event.value);
          return;
        default:
          // `B`, and any event this reads nothing from.
          return;
      }
    }
    // A prompt's own marks, while the integration's are not the ones read.
    if (integrated) return;
    detect();
    const mark = body.split(';')[0];
    if (mark === 'A') { typed = ''; return; }
    if (mark === 'C') { executed(typed.trim()); return; }
    if (mark !== 'D') return;
    finished(Number(body.split(';')[1]));
  };

  /**
   * Say a chunk of output without the shell's marks, and what each mark meant
   * where it stood.
   *
   * Where it stood is the protocol's order: the output said between a
   * command's `terminal/commandExecuted` and its `terminal/commandFinished` is
   * the command's, so what came before a mark is said before the mark's
   * action, as the reference host says each run of output and each sequence
   * in the order they arrived
   * (https://github.com/microsoft/vscode/blob/122ec4fe4431e8435c42e9b609e3a43a60877383/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L654-L705).
   */
  const read = (chunk: string): void => {
    /*
     * The screen sees the chunk first, marks and all.
     *
     * A terminal emulator draws what the program wrote, so it is fed the bytes
     * as they came rather than the output left after the marks were taken out:
     * a program's own cursor movement and modes live in the same stream. The
     * port answers a query by writing back to the program, and the write is
     * what settles it, so nothing here waits on it.
     */
    void screen?.write(chunk);
    const data = held + chunk;
    const end = unfinished(data);
    held = data.slice(end);
    let from = 0;
    for (const found of data.slice(0, end).matchAll(MARKS)) {
      if (found.index > from) said(data.slice(from, found.index));
      from = found.index + found[0].length;
      meant(found[1], found[2] ?? '');
    }
    if (end > from) said(data.slice(from, end));
  };

  /*
   * What a pseudoterminal is started with.
   *
   * `node-pty` takes the whole command line as one string, and passes a string
   * to the Windows process verbatim - an argv is escaped for the C runtime
   * instead, which is the mistake the outer quotes above exist to avoid. So
   * `cmd.exe` gets the line whole, outer quotes and all, and every other shell
   * gets the argv it was started with.
   */
  const ptyArgs: string[] | string = kind === 'cmd' && line !== undefined ? args.join(' ') : args;
  const terminal: Pty | undefined = pty?.(shell, ptyArgs, {
    ...(cwd !== undefined ? { cwd } : {}),
    cols,
    rows,
    env: environment,
  });
  /*
   * The screen, for a terminal a program draws on.
   *
   * Only under a pseudoterminal: a shell on pipes is fed plain text, and there
   * is no cursor or mode for an emulator to keep. A port that throws leaves
   * the terminal without one rather than failing to start, since a screen is
   * something a caller reads and never something a shell needs.
   */
  let screen: Screen | undefined;
  if (terminal !== undefined && spawnScreen !== undefined) {
    try {
      screen = spawnScreen({
        cols,
        rows,
        // The answer to a program's query, which belongs on its input.
        write: (data) => { terminal.write(data); },
      });
    }
    catch { /* a port that cannot make one leaves the terminal as it was */ }
  }

  if (terminal !== undefined) {
    terminal.onData(read);
    terminal.onExit(({ exitCode: code }) => {
      // What was held as the start of a mark was output after all.
      if (held !== '') said(held);
      held = '';
      exitCode = code;
      ended();
    });
  }

  const child = terminal !== undefined ? undefined : start(shell, args, {
    cwd,
    /*
     * Its own process group, so a signal reaches what it started.
     *
     * A shell reading from a pipe runs each command as its own child, and a
     * signal sent to the shell alone leaves the command running. The group is
     * what a terminal driver would have signalled, and this has no driver.
     *
     * Windows has no process group to signal, and `detached` there means
     * something else entirely - a console of its own - so it is left off and
     * the tree is ended with `taskkill` instead.
     */
    ...(windows ? {} : { detached: true }),
    // No console window for the shell to open over whatever the daemon is
    // drawing. Said rather than left to the default, which is to show one.
    windowsHide: true,
    /*
     * `cmd.exe` reads the argv as a command line, with no escaping on the way
     * in - see the outer quotes on its line above. Every other shell gets the
     * runtime's own quoting, which is what a POSIX shell and PowerShell both
     * expect their arguments to have been written with.
     */
    ...(kind === 'cmd' ? { windowsVerbatimArguments: true } : {}),
    // A shell reading commands from a pipe. Without a pseudoterminal there is
    // no point asking it to be interactive: it would print a prompt nobody
    // can answer the way it expects.
    stdio: ['pipe', 'pipe', 'pipe'],
    env: environment,
  });

  /**
   * End the shell and everything it started, on Windows.
   *
   * The tree, named by the shell's own pid, because there is no group there to
   * signal. `/F` because without it `taskkill` asks each process to close, and
   * one with no window to close is left running - and the caller here has
   * already decided the tree is going.
   */
  const endTree = (pid: number): void => { run('taskkill', ['/pid', String(pid), '/T', '/F']); };

  // Each pipe decodes as one stream, so a character whose bytes arrive in two
  // reads comes out whole, as `node-pty` reads its terminal
  // (https://nodejs.org/api/stream.html#readablesetencodingencoding,
  // https://github.com/microsoft/node-pty/blob/v1.1.0/src/unixTerminal.ts#L109-L111).
  child?.stdout.setEncoding('utf8');
  child?.stderr.setEncoding('utf8');
  child?.stdout.on('data', (chunk: string) => said(chunk));
  child?.stderr.on('data', (chunk: string) => said(chunk));
  /**
   * Said once, whichever of the three got here first.
   *
   * `error` and `close` can both fire for one failed spawn, and a terminal
   * that announced its own exit twice would be one every client draws as
   * having died, come back, and died again.
   */
  let announced = false;
  const ended = (): void => {
    if (announced) return;
    announced = true;
    // The program has gone, so nothing is left to draw. Let the screen go with
    // it rather than once the terminal is dropped, which may be much later.
    screen?.dispose();
    tell({ type: 'terminal/exited', exitCode });
    // The same moment, for a caller waiting rather than watching: the code is
    // set before this runs, so what resolves here is what the event carried.
    settle?.({
      ...(exitCode !== undefined ? { exitCode } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });
  };
  child?.on('error', (error: Error) => {
    said(`${error.message}\n`);
    exitCode = 127;
    ended();
  });
  child?.on('exit', (code: number | null, by: string | null) => {
    // A signal is not an exit code, and 128+n is the shell's own convention
    // for one - better than reporting nothing, which reads as still running.
    exitCode = code ?? (by ? 128 : 0);
    // Named, when it was: a caller told only `128` cannot tell somebody's
    // SIGINT from a program that chose to exit 128.
    if (by) signal = by;
  });
  /*
   * Announced on `close` rather than on `exit`, which is a race this lost.
   *
   * `exit` fires when the process goes; `close` fires once its pipes are
   * drained. Between the two there is output already written and not yet
   * read, so a host that reported the exit on `exit` reported a command's
   * result before the result had arrived - which is exactly what a `!`
   * command in the composer reads back.
   */
  child?.on('close', () => {
    // A process that closed without an exit event was killed outright.
    exitCode ??= 0;
    ended();
  });

  return {
    uri,
    title: () => title,
    claim: () => claim,
    exitCode: () => exitCode,
    waitForExit: () => gone,
    /*
     * What the program drew, from the screen when there is one.
     *
     * A terminal on pipes has no screen, and one whose store kept none has
     * nothing to ask: none of those is on another buffer, and none has a paste
     * mode. `whenAltBuffer` answers at once for them rather than leaving a
     * caller waiting for a change nothing will report.
     */
    isInAltBuffer: () => screen?.isInAltBuffer() ?? false,
    isBracketedPasteMode: () => screen?.isBracketedPasteMode() ?? false,
    whenAltBuffer: () => screen?.whenAltBuffer() ?? Promise.resolve(),
    whenScreenSettled: () => screen?.whenSettled?.() ?? Promise.resolve(),
    lifecycle: () => (exitCode === undefined
      ? { status: 'running' }
      : { status: 'exited', exitCode }),

    state: () => ({
      title,
      // Encoded, because a client reads this the way it read the one it sent:
      // `file://` and a raw path is a different folder the moment the path
      // holds a space or a `#`.
      cwd: uriOf(cwd),
      cols,
      rows,
      // The parts a client watching from the start built: one `unclassified`
      // part where the shell marks nothing, and a `command` part for each
      // command it marks. The protocol's shape, not a flat string.
      content: [...content],
      claim,
      // Detection once the shell has marked a boundary, which only a shell
      // running its own prompt under a pseudoterminal does. VT sequences for
      // a client to parse come with the pseudoterminal itself.
      supportsCommandDetection: detected,
      isPty: terminal !== undefined,
      /*
       * Both spellings, because this host speaks five versions.
       *
       * `lifecycle` is what 0.9.0 requires and is not optional there - a
       * client reading `lifecycle.status` on a 0.8.0-shaped terminal gets
       * `undefined`, which reads as a process that never exits. The flat
       * `exitCode` is what every version before it reads, and this daemon
       * negotiates down to 0.5.1.
       */
      lifecycle: exitCode === undefined
        ? { status: 'running' }
        : { status: 'exited', exitCode },
      ...(exitCode !== undefined ? { exitCode } : {}),
    }),

    write: (data) => {
      // Nothing reaches a process that has exited: its code is set at `exit`,
      // and its pipes can still read as writable until `close`.
      if (exitCode !== undefined) return;
      /*
       * `^C` is a signal, and there is nothing here to turn it into one.
       *
       * A pseudoterminal has a line discipline that sees the byte and sends
       * SIGINT to the foreground group. Pipes have none, so the byte arrives
       * as input and the command runs on - which is a terminal a runaway
       * command cannot be stopped in. Sending the signal is what the driver
       * would have done. On Windows there is no signal to send either, so the
       * command's tree is ended by pid instead.
       */
      /*
       * Under a pseudoterminal the byte is the signal.
       *
       * A pty has a line discipline: `^C` reaches it as input and it sends
       * SIGINT to the foreground group itself, which is the whole point of
       * having one. So this writes it through and does nothing clever.
       */
      if (terminal !== undefined) {
        terminal.write(data);
        // Kept so a command line can be read back at the next `C` mark; the
        // shell echoes what was typed, but the echo arrives as output and
        // this is the only place the input itself is seen.
        typed += data;
        return;
      }
      const at = data.indexOf('\u0003');
      if (at !== -1) {
        const rest = data.slice(0, at) + data.slice(at + 1);
        if (rest !== '' && child?.stdin.writable) child.stdin.write(rest);
        /*
         * The group, named by the child's own pid, and only when there is one.
         *
         * A spawn that failed leaves no pid, and `0` is not a safe stand-in:
         * to `kill` it means every process in *this* process group, so a
         * terminal whose shell never started would signal the host and
         * whatever started the host.
         */
        const group = child?.pid;
        if (group === undefined) return;
        /*
         * Windows: the tree, by pid, because there is no group to name and no
         * signal a shell there acts on.
         *
         * `/T /F` rather than `/T`, which asks a process to close and leaves a
         * windowless one running - a `^C` that stops nothing is the one thing
         * this exists to prevent. POSIX draws the difference between an
         * interrupt and a kill; Windows has nothing here to draw it with, so
         * both are the same tree-ending call.
         */
        if (windows) { endTree(group); return; }
        try { process.kill(-group, 'SIGINT'); }
        // The group is gone, which is the outcome asked for.
        catch { /* nothing left to interrupt */ }
        return;
      }
      if (child?.stdin.writable) child.stdin.write(data);
    },

    // Told, when there is something to tell: a pseudoterminal gets the new
    // size and sends SIGWINCH itself. Without one these are kept because the
    // state reports them and a client draws to them.
    resize: (nextCols, nextRows) => {
      terminal?.resize(nextCols, nextRows);
      // The screen keeps the same geometry, or a program's cursor sits where
      // the client no longer draws.
      screen?.resize(nextCols, nextRows);
      cols = nextCols;
      rows = nextRows;
    },

    // The scrollback and nothing else. `cols`, `rows`, `title` and `claim` are
    // untouched, which is what the reference suite checks for.
    clear: () => {
      content = [];
      size = 0;
    },

    setTitle: (next) => { title = next; },

    setClaim: (next) => { claim = next; },

    close: () => {
      if (terminal !== undefined) {
        terminal.kill();
        return;
      }
      child?.stdin.end();
      // The group, not the shell: detached, its children outlive it otherwise.
      // Only when there is a pid to name it - see the interrupt above.
      /*
       * No pid is a shell that never started, so there is nothing to end. Not
       * `child.kill()` either: on Windows Node throws `kill EINVAL` for a
       * process that was never spawned, and `close` must not throw.
       */
      const group = child?.pid;
      if (group === undefined) return;
      // Windows: the tree, by pid, which is what `/T` is for - see `endTree`.
      if (windows) { endTree(group); return; }
      try { process.kill(-group, 'SIGKILL'); }
      catch { child?.kill(); }
    },
  };
}

/**
 * A shell on this machine, as a host's `TerminalStore`.
 *
 * Kept out of `createHost` for the reason above: spawning is the runtime's
 * business, and a host that opens no terminal should not have to have one.
 *
 * ```ts
 * createHost({ path, agents, terminals: shellTerminals() });
 * ```
 *
 * Given a `pty` it runs shells under a pseudoterminal instead, which is what
 * makes shell integration possible: the shell prints its own OSC 133 marks, so
 * command boundaries and the working directory become facts rather than
 * guesses. The binding is handed in because it is native code - `node-pty` is
 * the daemon's dependency and never this library's, and a host on another
 * runtime passes whatever it has.
 *
 * ```ts
 * import { spawn } from 'node-pty';
 * createHost({ path, agents, terminals: shellTerminals({ pty: spawn }) });
 * ```
 *
 * `shellEnv` is the environment the operator names for every shell this store
 * opens: each name in it is set, and a name set to `null` is removed from what
 * the daemon itself runs with. A caller asking for one terminal still wins
 * over it, because a terminal somebody opened is theirs.
 *
 * `shellIntegration` is VS Code's shell integration, put into a shell opened
 * to sit in: with it, a shell that has a script for its kind marks each prompt,
 * command, exit code and directory, and the store reads those marks as command
 * boundaries. It is a port because the scripts are files, which this library
 * does not carry - `@ahpd/server` has them and hands its own.
 *
 * `screen` is the emulated screen each terminal under a pseudoterminal is fed
 * with: a caller reads the alternate buffer and bracketed paste from it, and
 * a program that asks for the cursor gets its answer. The emulator is the
 * daemon's dependency rather than this library's, so it is a port too - a
 * store given none answers `false` and never waits.
 *
 * `platform`, `run` and `spawn` are the machine's own as well, and are for a
 * case that has to ask what another system would do - or, for `spawn`, read
 * what the pipe path asks of the runtime. An ordinary caller names none.
 */
export const shellTerminals = (
  options: {
    pty?: SpawnPty;
    shellEnv?: ShellEnv;
    platform?: string;
    run?: RunQuietly;
    spawn?: SpawnShell;
    shellIntegration?: ShellIntegration;
    screen?: SpawnScreen;
  } = {},
): TerminalStore => ({
  create: (asked) => createTerminal(
    asked,
    options.pty,
    options.shellEnv,
    options.platform,
    options.run,
    options.spawn,
    options.shellIntegration,
    options.screen,
  ),
});
