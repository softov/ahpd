/**
 * One command, written to an agent's shell, and how it ended.
 *
 * VS Code's `executeShellCommand`
 * (https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/shellCommandExecution.ts):
 * where the terminal detects commands the command ends at the shell's own `D`
 * mark and its output is the `command` part the terminal keeps, and where it
 * does not the command is followed by a line echoing a sentinel with its exit
 * code. What else ends a command is the same in both: the alternate screen, the
 * shell exiting, a client narrowing the claim to the session and chat alone,
 * which moves the command to the background, and the timeout.
 *
 * The output a model reads is cut to `SHELL_COMMAND_MAX_OUTPUT_BYTES`, the
 * number the reference's descriptions name, and has no control sequences.
 */

import type { Bag } from '../types/common.js';
import type { ShellCommandResult, ShellType } from '../types/shells.js';
import type { Terminal } from '../types/terminals.js';

/**
 * The most output a command result hands a model, in characters.
 *
 * 60 KB, the number the reference's tool descriptions promise.
 */
export const SHELL_COMMAND_MAX_OUTPUT_BYTES = 60_000;

/** How long a command is waited for when the call names no timeout: two minutes. */
export const DEFAULT_SHELL_COMMAND_TIMEOUT_MS = 120_000;

/**
 * The start of the line a shell echoes after each command.
 *
 * The reference's own spelling, `<<<COPILOT_SENTINEL_<id>_EXIT_<code>>>>`, kept
 * so a transcript of one host reads the same as the other's.
 */
const SENTINEL_PREFIX = '<<<COPILOT_SENTINEL_';

/*
 * VS Code's `removeAnsiEscapeCodes`
 * (https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/base/common/strings.ts#L847-L886),
 * the three sequence families of the xterm control sequences.
 */
const CSI_SEQUENCE = /(?:\x1b\[|\x9b)[=?>!]?[\d;:]*["$#'* ]?[a-zA-Z@^`{}|~]/;
const OSC_SEQUENCE = /(?:\x1b\]|\x9d).*?(?:\x1b\\|\x07|\x9c)/;
const ESC_SEQUENCE = /\x1b(?:[ #%\(\)\*\+\-\.\/]?[a-zA-Z0-9\|}~@])/;
const CONTROL_SEQUENCES = new RegExp(`(?:${[CSI_SEQUENCE.source, OSC_SEQUENCE.source, ESC_SEQUENCE.source].join('|')})`, 'g');

/** A string with every terminal control sequence taken out. */
export const removeAnsiEscapeCodes = (text: string): string => (text ? text.replace(CONTROL_SEQUENCES, '') : text);

/**
 * The kind of shell a program is, by its file name.
 *
 * The reference's `shellTypeForExecutable`: PowerShell by name, every POSIX
 * shell and launcher of one as `bash`, and the platform's own for a name it
 * does not know.
 */
export const shellTypeForExecutable = (shellPath: string, platform: string = process.platform): ShellType => {
  const lastSep = Math.max(shellPath.lastIndexOf('/'), shellPath.lastIndexOf('\\'));
  const base = shellPath.slice(lastSep + 1).toLowerCase().replace(/\.exe$/u, '');
  switch (base) {
    case 'pwsh':
    case 'powershell':
    case 'pwsh-preview':
      return 'powershell';
    case 'bash':
    case 'sh':
    case 'zsh':
    case 'fish':
    case 'csh':
    case 'ksh':
    case 'nu':
    case 'xonsh':
    case 'git-cmd':
    case 'wsl':
    case 'ubuntu':
    case 'ubuntu1804':
    case 'kali':
    case 'debian':
    case 'opensuse-42':
    case 'sles-12':
      return 'bash';
    default:
      return platform === 'win32' ? 'powershell' : 'bash';
  }
};

/**
 * Whether a program is zsh, by its file name.
 *
 * The reference's `isZsh` (`node/agentHostShellUtils.ts`): `zsh` or `zsh.exe`
 * in any case on Windows, `zsh` exactly elsewhere. The description a zsh shell
 * is offered with names its own pitfalls, so the tool set asks this once.
 */
export const isZsh = (shellPath: string, platform: string = process.platform): boolean => {
  const lastSep = Math.max(shellPath.lastIndexOf('/'), shellPath.lastIndexOf('\\'));
  const base = shellPath.slice(lastSep + 1);
  return platform === 'win32' ? /^zsh(?:\.exe)?$/iu.test(base) : /^zsh$/u.test(base);
};

/**
 * The space a POSIX shell keeps a command out of its history for.
 *
 * Under `HISTCONTROL=ignorespace` or `HIST_IGNORE_SPACE`, a command that starts
 * with a space is not recorded. PowerShell keeps its history elsewhere.
 */
export const prefixForHistorySuppression = (shellType: ShellType): string => (shellType === 'powershell' ? '' : ' ');

/** A command that spans lines, by an unescaped newline. */
export const isMultilineCommand = (command: string): boolean => /(?<!\\)\n/u.test(command.replace(/\r\n|\r/gu, '\n'));

/**
 * Whether a command is typed as a paste.
 *
 * The reference's `shouldUseBracketedPasteMode`: on macOS always, and a command
 * of more than one line anywhere. It is pasted only where the shell has turned
 * bracketed paste on.
 */
const shouldUseBracketedPasteMode = (command: string, platform: string = process.platform): boolean =>
  platform === 'darwin' || isMultilineCommand(command);

/** The command a shell echoes its sentinel with, carrying the last exit code. */
export const sentinelCommand = (id: string, shellType: ShellType): string => (shellType === 'powershell'
  ? `Write-Output "${SENTINEL_PREFIX}${id}_EXIT_$LASTEXITCODE>>>"`
  : `echo "${SENTINEL_PREFIX}${id}_EXIT_$?>>>"`);

/**
 * The newest complete sentinel in some output, and what came before it.
 *
 * A shell under a pseudoterminal echoes the command it was typed, so the
 * sentinel's own command line is in the output too, with `$?` where the code
 * will be: an occurrence whose code is not a number is that echo, and the scan
 * goes on to an earlier one.
 */
export const parseSentinel = (content: string, id: string): { found: true; exitCode: number; before: string } | { found: false } => {
  const marker = `${SENTINEL_PREFIX}${id}_EXIT_`;
  let at = content.lastIndexOf(marker);
  while (at !== -1) {
    const after = content.substring(at + marker.length);
    const end = after.indexOf('>>>');
    if (end !== -1) {
      const code = after.substring(0, end).trim();
      if (/^-?\d+$/u.test(code)) return { found: true, exitCode: Number.parseInt(code, 10), before: content.substring(0, at) };
    }
    at = content.lastIndexOf(marker, at - 1);
  }
  return { found: false };
};

/**
 * Output as a model reads it: no control sequences, no outer whitespace, and
 * the last `SHELL_COMMAND_MAX_OUTPUT_BYTES` characters at most.
 */
export const prepareOutputForModel = (raw: string): string => {
  const text = removeAnsiEscapeCodes(raw).trim();
  return text.length > SHELL_COMMAND_MAX_OUTPUT_BYTES ? text.substring(text.length - SHELL_COMMAND_MAX_OUTPUT_BYTES) : text;
};

/**
 * What a command needs of the terminal it runs in.
 *
 * `listen` is the manager's subscription to the terminal's actions, so this
 * module never reaches for the store: it hears what the shell said, and reads
 * the terminal's content when it needs the output.
 */
export interface ShellCommandAsk {
  terminal: Terminal;
  shellType: ShellType;
  command: string;
  /** How long the command is waited for. Absent for one that runs until it ends. */
  timeoutMs?: number;
  /**
   * Whether only the command's own end ends it: its mark, its sentinel or the
   * shell's exit, and not the alternate screen or a claim a client narrowed.
   *
   * Those two end a call that is waiting for an answer, because the command
   * outlives it. A command started in the background is not answered, so
   * neither is anything to end: it runs until it is over or its shell goes.
   */
  untilItEnds?: boolean;
  /** Hear each action the terminal sends, and answer the stop. */
  listen(onAction: (action: Bag) => void): () => void;
  log(message: string): void;
  /**
   * The command ended while still running, with what the shell will say when
   * it is over: the manager keeps the shell busy until then.
   */
  stillRunning?(how: { commandId?: string; sentinel?: string }): void;
}

/**
 * Everything the terminal holds, as a client reading it late would.
 *
 * The protocol's own recipe for the stream behind the typed parts: a command's
 * output, or an unclassified part's value.
 */
const contentOf = (terminal: Terminal): string => terminal.state().content
  .map((part) => (part.type === 'command' ? part.output : part.value))
  .join('');

/** The output of the command a marked part names, and its code. */
const partOf = (terminal: Terminal, commandId: string): { output: string; exitCode?: number } => {
  const part = terminal.state().content.find((one) => one.type === 'command' && one.commandId === commandId);
  if (part === undefined || part.type !== 'command') return { output: '' };
  return { output: part.output, ...(part.exitCode === undefined ? {} : { exitCode: part.exitCode }) };
};

/** What a terminal has said since a command was written, counted from its end. */
interface Started {
  /** How many characters the terminal has said since the command was written. */
  received: number;
}

/**
 * The content between the start of a command and a point in what it said.
 *
 * The terminal keeps its last 200,000 characters and, once it holds that many,
 * drops one for each it takes, so a length taken at the start stops naming the
 * place the command began. The place is counted back from the end instead, by
 * what the terminal has said since.
 */
const between = (terminal: Terminal, started: Started, from: number, to: number = started.received): string => {
  const full = contentOf(terminal);
  const at = (point: number): number => Math.max(0, full.length - (started.received - point));
  return full.substring(at(from), at(to));
};

/**
 * Text as a shell reads it.
 *
 * The reference's `formatTerminalText`. Under a pseudoterminal a line ends in
 * a carriage return, which is what the line discipline reads as Enter; a shell
 * on pipes reads a newline, so on pipes the newline stays.
 */
export const shellText = (terminal: Terminal, text: string, execute: boolean, paste: boolean): string => {
  const end = terminal.state().isPty === true ? '\r' : '\n';
  const wrapped = paste ? `\x1b[200~${text}\x1b[201~` : text;
  const body = wrapped.replace(/\r?\n/gu, end);
  return execute && !body.endsWith(end) ? `${body}${end}` : body;
};

/**
 * Run one command, and answer how it ended.
 *
 * Where the terminal detects commands, the command ends at the shell's `D` and
 * its output is the `command` part the terminal keeps. Where it does not, the
 * command is followed by a line echoing a sentinel with its exit code, and the
 * output between the two is the result. The alternate screen, the shell's
 * exit, a claim a client narrowed to the session and chat alone, and the
 * timeout end it too, as they do in the reference.
 */
export async function executeShellCommand(asked: ShellCommandAsk): Promise<ShellCommandResult> {
  const { terminal, log } = asked;
  // Asked once, before the command is written, as the reference asks: a shell
  // that has marked no boundary yet is sent a sentinel instead.
  const marked = terminal.state().supportsCommandDetection === true;
  const sentinel = marked ? undefined : crypto.randomUUID().replaceAll('-', '');
  const started: Started = { received: 0 };

  /** The output a timeout, an exit or the alternate screen hands back. */
  const partial = (commandId: string | undefined): string => {
    if (!marked) return prepareOutputForModel(between(terminal, started, 0));
    if (commandId === undefined) return '';
    return prepareOutputForModel(partOf(terminal, commandId).output);
  };

  const result = new Promise<ShellCommandResult>((resolve) => {
    let done = false;
    const stops: (() => void)[] = [];
    /** The command this execution started, once the shell has said it began. */
    let commandId: string | undefined;
    const finish = (answer: ShellCommandResult): void => {
      if (done) return;
      done = true;
      for (const stop of stops) stop();
      // Still running in the shell, so the manager hears its actual end rather
      // than treating the shell as idle the moment the call is answered.
      if (answer.status === 'background' || answer.status === 'altBuffer') {
        asked.stillRunning?.({
          ...(commandId === undefined ? {} : { commandId }),
          ...(sentinel === undefined ? {} : { sentinel }),
        });
      }
      resolve(answer);
    };
    stops.push(asked.listen((action) => {
      switch (action.type) {
        case 'terminal/commandExecuted': {
          // The first command the shell starts after this one is written is
          // this one; a command it began before the write is not.
          if (marked && commandId === undefined) commandId = String(action.commandId);
          return;
        }
        case 'terminal/commandFinished': {
          if (!marked || commandId === undefined || String(action.commandId) !== commandId) return;
          const part = partOf(terminal, commandId);
          const reported = Number(action.exitCode);
          const code = Number.isFinite(reported) ? reported : part.exitCode ?? 0;
          finish({ status: 'completed', exitCode: code, output: prepareOutputForModel(part.output) });
          return;
        }
        case 'terminal/data': {
          started.received += String(action.data ?? '').length;
          if (sentinel === undefined) return;
          const parsed = parseSentinel(between(terminal, started, 0), sentinel);
          if (parsed.found) finish({ status: 'completed', exitCode: parsed.exitCode, output: prepareOutputForModel(parsed.before) });
          return;
        }
        case 'terminal/exited': {
          const code = Number(action.exitCode);
          log(`the shell ${terminal.uri} exited with ${String(action.exitCode)}`);
          finish({
            status: 'shellExited',
            ...(Number.isFinite(code) ? { exitCode: code } : {}),
            output: partial(commandId),
          });
          return;
        }
        case 'terminal/claimed': {
          if (asked.untilItEnds === true) return;
          const claim = action.claim as Bag | undefined;
          if (claim?.kind === 'session' && claim.toolCallId === undefined) {
            log(`the command in ${terminal.uri} goes on in the background`);
            finish({ status: 'background', output: '' });
          }
          return;
        }
        default:
      }
    }));
    if (asked.timeoutMs !== undefined) {
      const timer = setTimeout(() => {
        log(`the command in ${terminal.uri} ran past ${String(asked.timeoutMs)} ms`);
        finish({ status: 'timeout', output: partial(commandId) });
      }, asked.timeoutMs);
      stops.push(() => { clearTimeout(timer); });
    }
    /*
     * The reference's `registerAltBufferHandler`, which settles at once on a
     * screen already showing the alternate one.
     *
     * A terminal with no screen answers `whenAltBuffer` at once, because there
     * is no buffer for it to enter; the answer is therefore read from the
     * terminal, and only one on the alternate buffer ends its command there.
     * A screenful terminal that resolves the wait is on it, and one that was
     * disposed while the call ran is not.
     */
    if (asked.untilItEnds !== true) void terminal.whenAltBuffer().then(() => {
      if (done || !terminal.isInAltBuffer()) return;
      log(`the command in ${terminal.uri} entered the alternate screen`);
      finish({ status: 'altBuffer', output: '' });
    });
    // A shell that exited while it was waited on sends no exit again, and
    // answers as one that exits under its command.
    const gone = terminal.exitCode();
    if (gone !== undefined) {
      log(`the shell ${terminal.uri} exited with ${String(gone)}`);
      finish({ status: 'shellExited', exitCode: gone, output: partial(commandId) });
    }
  });

  /*
   * A command of several lines is pasted, where the shell turned bracketed
   * paste on, so its own prompt does not run each line as it arrives.
   *
   * `whenScreenSettled` settles once the screen has read what the shell said
   * before the call, which is what makes the paste mode the mode of the prompt
   * just written rather than of one a chunk behind.
   */
  const line = `${prefixForHistorySuppression(asked.shellType)}${asked.command}`;
  let paste = false;
  if (shouldUseBracketedPasteMode(asked.command)) {
    await terminal.whenScreenSettled();
    paste = terminal.isBracketedPasteMode();
  }
  terminal.write(shellText(terminal, line, true, paste));
  if (sentinel !== undefined) terminal.write(shellText(terminal, sentinelCommand(sentinel, asked.shellType), true, false));
  return await result;
}
