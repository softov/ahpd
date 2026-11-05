import { randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import type { Bag } from '../types/common.js';
import type { ShellCommandResult, Terminal } from '../types/terminals.js';

/*
 * A command run in a shell that sits at its prompt, and how it ended.
 *
 * VS Code's shell command runner, which its agent host's `!` command and its
 * shell tools share: the command is typed into the shell, and its end is read
 * from the shell integration's mark where the shell writes those, and from a
 * line echoed after it where it does not.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/shellCommandExecution.ts
 */

/** The most of what a command printed that its result carries, counted from its end. */
export const SHELL_COMMAND_MAX_OUTPUT_BYTES = 80_000;

/** How long a command is waited on, two minutes. */
export const DEFAULT_SHELL_COMMAND_TIMEOUT_MS = 120_000;

/**
 * The start of the line echoed after a command in a shell that marks nothing,
 * `<<<COPILOT_SENTINEL_<id>_EXIT_<code>>>>` whole.
 */
const SENTINEL_PREFIX = '<<<COPILOT_SENTINEL_';

/** The kind of shell a command runs in, which decides the echoed line and the history prefix. */
export type ShellType = 'bash' | 'powershell';

/** The kind of a shell by its executable's name, and the platform's own kind for a name it does not know. */
export function shellTypeForExecutable(shellPath: string, platform: string = process.platform): ShellType {
  const lastSep = Math.max(shellPath.lastIndexOf('/'), shellPath.lastIndexOf('\\'));
  const named = shellPath.slice(lastSep + 1).toLowerCase();
  const base = named.endsWith('.exe') ? named.slice(0, -'.exe'.length) : named;
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
}

/**
 * A space before the command, which keeps it out of a POSIX shell's history
 * once the integration script has read `VSCODE_PREVENT_SHELL_HISTORY`;
 * PowerShell keeps it out through PSReadLine, with nothing before it.
 */
const prefixForHistorySuppression = (shellType: ShellType): string => (shellType === 'powershell' ? '' : ' ');

/** Whether a command spans lines: a line break no backslash continues. */
const isMultilineCommand = (command: string): boolean => /(?<!\\)\n/.test(command.replace(/\r\n|\r/g, '\n'));

/** The line that echoes the exit code of the command before it, with this run's id. */
const buildSentinelCommand = (sentinelId: string, shellType: ShellType): string => (shellType === 'powershell'
  ? `Write-Output "${SENTINEL_PREFIX}${sentinelId}_EXIT_$LASTEXITCODE>>>"`
  : `echo "${SENTINEL_PREFIX}${sentinelId}_EXIT_$?>>>"`);

/**
 * The echoed line in what the terminal printed, the latest one that carries a
 * number: a shell under a pseudoterminal echoes the line it was typed as well,
 * `$?` and all, and that copy is passed over.
 */
function parseSentinel(content: string, sentinelId: string): { found: boolean; exitCode: number; outputBeforeSentinel: string } {
  const marker = `${SENTINEL_PREFIX}${sentinelId}_EXIT_`;
  let markerIndex = content.lastIndexOf(marker);
  while (markerIndex !== -1) {
    const afterMarker = content.substring(markerIndex + marker.length);
    const endIdx = afterMarker.indexOf('>>>');
    if (endIdx !== -1) {
      const exitCodeStr = afterMarker.substring(0, endIdx).trim();
      if (/^-?\d+$/.test(exitCodeStr)) {
        return { found: true, exitCode: Number.parseInt(exitCodeStr, 10), outputBeforeSentinel: content.substring(0, markerIndex) };
      }
    }
    markerIndex = content.lastIndexOf(marker, markerIndex - 1);
  }
  return { found: false, exitCode: -1, outputBeforeSentinel: content };
}

/** What a command printed, without its escape sequences, trimmed, and cut to the last of it a result carries. */
const prepareOutputForModel = (rawOutput: string): string => {
  const text = stripVTControlCharacters(rawOutput).trim();
  return text.length > SHELL_COMMAND_MAX_OUTPUT_BYTES ? text.substring(text.length - SHELL_COMMAND_MAX_OUTPUT_BYTES) : text;
};

/** Everything the terminal holds, as VS Code's terminal manager reads its content. */
const getContent = (terminal: Terminal): string =>
  terminal.state().content.map((part) => (part.type === 'command' ? part.output : part.value)).join('');

/**
 * Type text into a terminal, as VS Code's terminal manager sends it: wrapped
 * for a bracketed paste where the caller asks and the program turned that on,
 * each line break made an Enter, and one more Enter to run it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L107-L116
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L530-L538
 *
 * Enter is a carriage return to a pseudoterminal, whose line discipline reads
 * it as a line's end, and a line feed to a shell this host runs on pipes,
 * which has no line discipline to read one.
 */
const sendText = (terminal: Terminal, data: string, options: { shouldExecute: boolean; bracketedPasteMode?: boolean }): void => {
  const enter = terminal.state().isPty === true ? '\r' : '\n';
  const pasted = options.bracketedPasteMode === true && terminal.isBracketedPasteMode() ? `\u001b[200~${data}\u001b[201~` : data;
  const typed = pasted.replace(/\r?\n/g, enter);
  terminal.write(options.shouldExecute && !typed.endsWith(enter) ? `${typed}${enter}` : typed);
};

/** The terminal a command runs in, and how to hear what is said on it. */
export interface ShellCommandTarget {
  /** The terminal, its shell already at its prompt. */
  readonly terminal: Terminal;
  /** The kind of shell it runs. */
  readonly shellType: ShellType;
  /**
   * Hear each action said on the terminal's channel, the store's own and a
   * client's claim, until the function this answers is called: what VS Code's
   * terminal manager offers as an event of each kind.
   */
  readonly hear: (listen: (action: Bag) => void) => () => void;
}

/**
 * The command's end where it switches to the alternate screen, as VS Code
 * reads a full-screen program. A store with no screen answers at once, with
 * its terminal on no alternate screen, so only a screen showing one ends it.
 */
const registerAltBufferHandler = (terminal: Terminal, finish: (result: ShellCommandResult) => void): void => {
  void terminal.whenAltBuffer().then(() => {
    if (terminal.isInAltBuffer()) finish({ status: 'altBuffer', output: '' });
  });
};

/** A claim that names the session and no tool call, which is a client letting the command go on in the background. */
const narrowed = (action: Bag): boolean => {
  if (action.type !== 'terminal/claimed' || typeof action.claim !== 'object' || action.claim === null) return false;
  const claim = action.claim as Bag;
  return claim.kind === 'session' && (claim.toolCallId === undefined || claim.toolCallId === '');
};

/** The exit code a `terminal/exited` says, or the terminal's own. */
const exitedWith = (terminal: Terminal, action: Bag): number | undefined =>
  typeof action.exitCode === 'number' ? action.exitCode : terminal.exitCode();

/**
 * Run a command in a terminal whose shell sits at its prompt, and answer once
 * it finishes, runs past `timeoutMs`, is let go on in the background, opens a
 * full-screen program, or the shell exits: through the shell integration's
 * marks where the shell writes them, and a line echoed after it otherwise.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/shellCommandExecution.ts#L185-L209
 */
export function executeShellCommand(
  target: ShellCommandTarget,
  command: string,
  timeoutMs: number,
  platform: string = process.platform,
): Promise<ShellCommandResult> {
  return target.terminal.state().supportsCommandDetection === true
    ? executeCommandWithShellIntegration(target, command, timeoutMs, platform)
    : executeCommandWithSentinel(target, command, timeoutMs, platform);
}

/**
 * Through the shell integration: the shell's own mark that the command
 * finished carries its exit code, and its output is the command's part of
 * the terminal's content.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/shellCommandExecution.ts#L224-L285
 */
async function executeCommandWithShellIntegration(
  target: ShellCommandTarget,
  command: string,
  timeoutMs: number,
  platform: string,
): Promise<ShellCommandResult> {
  const { terminal } = target;
  let stop: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = new Promise<ShellCommandResult>((resolve) => {
    let resolved = false;
    const finish = (ended: ShellCommandResult): void => {
      if (resolved) return;
      resolved = true;
      stop();
      clearTimeout(timer);
      resolve(ended);
    };
    stop = target.hear((action) => {
      if (action.type === 'terminal/commandFinished') {
        const part = terminal.state().content.find((one) => one.type === 'command' && one.commandId === action.commandId);
        const exitCode = typeof action.exitCode === 'number' ? action.exitCode : 0;
        finish({ status: 'completed', exitCode, output: prepareOutputForModel(part?.type === 'command' ? part.output : '') });
      }
      else if (action.type === 'terminal/exited') {
        const exitCode = exitedWith(terminal, action);
        finish({ status: 'shellExited', ...(exitCode === undefined ? {} : { exitCode }), output: prepareOutputForModel(getContent(terminal)) });
      }
      else if (narrowed(action)) finish({ status: 'background', output: '' });
    });
    registerAltBufferHandler(terminal, finish);
    timer = setTimeout(() => {
      finish({ status: 'timeout', output: prepareOutputForModel(getContent(terminal)) });
    }, timeoutMs);
  });
  try {
    sendText(terminal, `${prefixForHistorySuppression(target.shellType)}${command}`, {
      shouldExecute: true,
      bracketedPasteMode: platform === 'darwin' || isMultilineCommand(command),
    });
  }
  catch (error) {
    stop();
    clearTimeout(timer);
    throw error;
  }
  return await result;
}

/**
 * Through a line echoed after the command, where the shell marks nothing: the
 * line carries the command's exit code and an id this run made, and what came
 * before it since the command was typed is the command's output.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/shellCommandExecution.ts#L287-L372
 */
async function executeCommandWithSentinel(
  target: ShellCommandTarget,
  command: string,
  timeoutMs: number,
  platform: string,
): Promise<ShellCommandResult> {
  const { terminal } = target;
  const sentinelId = randomUUID().replaceAll('-', '');
  const sentinelCmd = buildSentinelCommand(sentinelId, target.shellType);
  const offsetBefore = getContent(terminal).length;
  let stop: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = new Promise<ShellCommandResult>((resolve) => {
    let resolved = false;
    const finish = (ended: ShellCommandResult): void => {
      if (resolved) return;
      resolved = true;
      stop();
      clearTimeout(timer);
      resolve(ended);
    };
    const checkForSentinel = (): void => {
      const fullContent = getContent(terminal);
      // The store trims its content past its cap, so an offset taken before
      // the trim reads from the start of what is left.
      const newContent = fullContent.substring(Math.min(offsetBefore, fullContent.length));
      const parsed = parseSentinel(newContent, sentinelId);
      if (parsed.found) finish({ status: 'completed', exitCode: parsed.exitCode, output: prepareOutputForModel(parsed.outputBeforeSentinel) });
    };
    stop = target.hear((action) => {
      if (action.type === 'terminal/data') checkForSentinel();
      else if (action.type === 'terminal/exited') {
        const exitCode = exitedWith(terminal, action);
        finish({ status: 'shellExited', ...(exitCode === undefined ? {} : { exitCode }), output: prepareOutputForModel(getContent(terminal).substring(offsetBefore)) });
      }
      else if (narrowed(action)) finish({ status: 'background', output: '' });
    });
    registerAltBufferHandler(terminal, finish);
    timer = setTimeout(() => {
      finish({ status: 'timeout', output: prepareOutputForModel(getContent(terminal).substring(offsetBefore)) });
    }, timeoutMs);
    checkForSentinel();
  });
  try {
    sendText(terminal, `${prefixForHistorySuppression(target.shellType)}${command}`, {
      shouldExecute: true,
      bracketedPasteMode: platform === 'darwin' || isMultilineCommand(command),
    });
    sendText(terminal, sentinelCmd, { shouldExecute: true });
  }
  catch (error) {
    stop();
    clearTimeout(timer);
    throw error;
  }
  return await result;
}
