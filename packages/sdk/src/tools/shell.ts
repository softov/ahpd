/**
 * The agent terminal tool: shells the agent runs commands in, as terminals
 * the person in the session sees.
 *
 * The reference host's tool set, by name, schema, description and answer
 * (https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/copilot/copilotShellTools.ts#L413-L816):
 * the shell itself (`bash`, or `powershell` where the shell is PowerShell), its
 * `read_`, `write_`, `_shutdown` and `list_` companions, and a stub under the
 * other shell's name that points at the right one. It is offered behind the
 * reference's own root config key, `enableCustomTerminalTool`, and never on
 * Windows, where the reference leaves the agent its own shell.
 *
 * The reference's sandbox lines and its unsandboxed-execution parameters are
 * not here: they belong to its terminal sandbox, and the reference omits them
 * too when that sandbox is off.
 */

import { shellOf } from '../machines/terminals.js';
import { DEFAULT_SHELL_COMMAND_TIMEOUT_MS, isZsh, prepareOutputForModel, shellTypeForExecutable } from '../host/shellcommand.js';
import type { Grant } from '../types/users.js';
import type { HostTool, ToolCall } from '../types/host.js';
import type { ManagedShell, ShellCommandResult, ShellType, Shells } from '../types/shells.js';

/**
 * The root config key that turns the tool on.
 *
 * `CopilotCliConfigKey.EnableCustomTerminalTool`, `common/copilotCliConfig.ts:34`.
 */
export const ENABLE_CUSTOM_TERMINAL_TOOL = 'enableCustomTerminalTool';

/** Every name the tool set has, under either shell, which the switch offers or withholds together. */
export const SHELL_TOOL_NAMES: readonly string[] = (['bash', 'powershell'] as const).flatMap((type) => [
  type,
  `read_${type}`,
  `write_${type}`,
  type === 'bash' ? 'bash_shutdown' : `${type}_shutdown`,
  `list_${type}`,
]);

/**
 * The answer a model gets when a command opens the alternate screen.
 *
 * The reference's `ALT_BUFFER_MESSAGE`, word for word.
 */
const ALT_BUFFER_MESSAGE = 'The command opened the alternate buffer and is still running in the terminal. It likely launched an interactive terminal UI. Use write_bash/write_powershell to interact with it, or shutdown the shell to stop it.';

/** A command's result as the reference words it for the model, and whether its shell stays held. */
interface Worded {
  text: string;
  ok: boolean;
  keepShellBusy?: boolean;
}

/**
 * The reference's `shellCommandResultToExecutionResult`, prefixed with the
 * shell's id as its `executeCommandInShell` does.
 */
const worded = (shell: ManagedShell, result: ShellCommandResult, timeoutMs: number): Worded => {
  const inner = ((): Worded => {
    switch (result.status) {
      case 'completed': {
        const exitCode = result.exitCode ?? 0;
        return { text: `Exit code: ${String(exitCode)}\n${result.output}`, ok: exitCode === 0 };
      }
      case 'shellExited':
        return { text: `Shell exited with code ${String(result.exitCode)}\n${result.output}`, ok: false };
      case 'timeout':
        return { text: `Command timed out after ${String(Math.round(timeoutMs / 1000))}s. Partial output:\n${result.output}`, ok: false };
      case 'background':
        return { text: 'The user chose to continue this command in the background. The terminal is still running.', ok: true, keepShellBusy: true };
      case 'altBuffer':
        return { text: ALT_BUFFER_MESSAGE, ok: false, keepShellBusy: true };
    }
  })();
  return { ...inner, text: `Shell ID: ${shell.id}\n${inner.text}` };
};

/** A failed call: the model reads the message as the call's answer, as it reads a failure result there. */
const failed = (text: string): never => { throw new Error(text); };

/**
 * Refuse a call the turn's person may not make here.
 *
 * This host's own rule, since the reference host serves one person: a tool
 * acts as the person who sent the turn, so it asks the grant a client's own
 * terminal action asks, and is refused in the same words.
 */
const allowed = (at: ToolCall, grant: Grant): void => {
  if (!at.may(grant)) throw new Error(at.refusal(grant));
};

/** The calling session's shells, or the store's own refusal. */
const shellsOf = (at: ToolCall): Shells => at.shells() ?? failed('This host does not serve createTerminal yet');

const isWindowsPowerShell = (envShell: string): boolean => envShell.endsWith('System32\\WindowsPowerShell\\v1.0\\powershell.exe');

/** `createPowerShellModelDescription` with the sandbox off. */
const powerShellDescription = (shellType: string, shellPath: string): string => {
  const isWinPwsh = isWindowsPowerShell(shellPath);
  return [
    `This tool allows you to execute ${isWinPwsh ? 'Windows PowerShell 5.1' : 'PowerShell'} commands in a persistent terminal session, preserving environment variables, working directory, and other context across multiple commands.`,
    '',
    'Command Execution:',
    isWinPwsh ? '- Use semicolons ; to chain commands on one line, NEVER use && even when asked explicitly' : '- Prefer ; when chaining commands on one line',
    '- Prefer pipelines | for object-based data flow',
    '- Never create a sub-shell (eg. powershell -c "command") unless explicitly asked',
    '',
    'Directory Management:',
    '- Prefer relative paths when navigating directories, only use absolute when the path is far away or the current cwd is not expected',
    '- By default (mode=sync), shell and cwd are reused by subsequent sync commands',
    '- Use $PWD or Get-Location for current directory',
    '- Use Push-Location/Pop-Location for directory stack',
    '',
    'Program Execution:',
    '- Supports .NET, Python, Node.js, and other executables',
    '- Install modules via Install-Module, Install-Package',
    '- Use Get-Command to verify cmdlet/function availability',
    '',
    'Async Mode:',
    '- For long-running tasks (e.g., servers), use mode=async',
    '- Returns a terminal ID for checking status and runtime later',
    '- Use Start-Job for background PowerShell jobs',
    '',
    `Use write_${shellType} to send commands or input to a terminal session.`,
    '',
    'Output Management:',
    '- Output is automatically truncated if longer than 60KB to prevent context overflow',
    '- Use Select-Object, Where-Object, Format-Table to filter output',
    '- Use -First/-Last parameters to limit results',
    '- For pager commands, add | Out-String or | Format-List',
    '',
    'Best Practices:',
    '- Use proper cmdlet names instead of aliases in scripts',
    '- Quote paths with spaces: "C:\\Path With Spaces"',
    '- Prefer PowerShell cmdlets over external commands when available',
    '- Prefer idiomatic PowerShell like Get-ChildItem instead of dir or ls for file listings',
    '- Use Test-Path to check file/directory existence',
    '- Be specific with Select-Object properties to avoid excessive output',
    '- Avoid printing credentials unless absolutely required',
    '',
    'Interactive Input Handling:',
    '- When a terminal command is waiting for interactive input, do NOT suggest alternatives or ask the user whether to proceed. Instead, use the ask_user tool to collect the needed values from the user, then send them.',
    `- Send exactly one answer per prompt using write_${shellType}. Never send multiple answers in a single send.`,
    `- After each send, call read_${shellType} to read the next prompt before sending the next answer.`,
    '- Continue one prompt at a time until the command finishes.',
  ].join('\n');
};

/** `createGenericDescription` with the sandbox off. */
const genericDescription = (shellType: string): string => [`
Command Execution:
- Use && to chain simple commands on one line
- Prefer pipelines | over temporary files for data flow
- Never create a sub-shell (eg. bash -c "command") unless explicitly asked

Directory Management:
- Prefer relative paths when navigating directories, only use absolute when the path is far away or the current cwd is not expected
- By default (mode=sync), shell and cwd are reused by subsequent sync commands
- Use $PWD for current directory references
- Consider using pushd/popd for directory stack management
- Supports directory shortcuts like ~ and -

Program Execution:
- Supports Python, Node.js, and other executables
- Install packages via package managers (brew, apt, etc.)
- Use which or command -v to verify command availability

Async Mode:
- For long-running tasks (e.g., servers), use mode=async
- Returns a terminal ID for checking status and runtime later

Use write_${shellType} to send commands or input to a terminal session.`, `

Output Management:
- Output is automatically truncated if longer than 60KB to prevent context overflow
- Use head, tail, grep, awk to filter and limit output size
- For pager commands, disable paging: git --no-pager or add | cat
- Use wc -l to count lines before displaying large outputs

Best Practices:
- Quote variables: "$var" instead of $var to handle spaces
- Use find with -exec or xargs for file operations
- Be specific with commands to avoid excessive output
- Avoid printing credentials unless absolutely required
- NEVER run sleep or similar wait commands in a terminal. You will be automatically notified on your next turn when async terminal commands or timed-out sync commands complete or need input. Do NOT poll for completion.

Interactive Input Handling:
- When a terminal command is waiting for interactive input, do NOT suggest alternatives or ask the user whether to proceed. Instead, use the ask_user tool to collect the needed values from the user, then send them.
- Send exactly one answer per prompt using write_${shellType}. Never send multiple answers in a single send.
- After each send, call read_${shellType} to read the next prompt before sending the next answer.
- Continue one prompt at a time until the command finishes.`].join('');

/** `createBashModelDescription` with the sandbox off. */
const bashDescription = (): string => [
  'This tool allows you to execute shell commands in a persistent bash terminal session, preserving environment variables, working directory, and other context across multiple commands.',
  genericDescription('bash'),
  '- Use [[ ]] for conditional tests instead of [ ]',
  '- Prefer $() over backticks for command substitution',
  '- Use set -e at start of complex commands to exit on errors',
].join('\n');

/** `createZshModelDescription` with the sandbox off. */
const zshDescription = (): string => [
  'This tool allows you to execute shell commands in a persistent zsh terminal session, preserving environment variables, working directory, and other context across multiple commands.',
  genericDescription('bash'),
  '- Use type to check command type (builtin, function, alias)',
  '- Use jobs, fg, bg for job control',
  '- Use [[ ]] for conditional tests instead of [ ]',
  '- Prefer $() over backticks for command substitution',
  '- Take advantage of zsh globbing features (**, extended globs). Note: unmatched globs fail by default (zsh: no matches found) - use a glob qualifier like *(N) or quote the glob if it should be literal',
  '',
  'zsh pitfalls - these WILL cause errors or hangs:',
  '- NEVER use bare == or === as separators (e.g. echo === triggers zsh equals expansion). Quote them: echo \'===\'',
  '- NEVER use status as a variable name (it is read-only in zsh). Use exit_code or ret instead',
].join('\n');

/**
 * The command and timeout every shell tool takes, as the reference declares
 * them.
 *
 * `mode` is this host's own field: the reference's description promises
 * `mode=async` and its schema has no such parameter, so the model is offered
 * the one its words already describe.
 */
const commandSchema = {
  type: 'object' as const,
  properties: {
    command: { type: 'string', description: 'The command to execute' },
    timeout: { type: 'number', description: 'Timeout in milliseconds (default 120000)' },
    mode: {
      type: 'string',
      enum: ['sync', 'async'],
      description: 'Run the command and answer with its output when it ends (sync, the default), or start it in the background and answer at once with the shell id (async). The end of an async command wakes this session.',
    },
  },
  required: ['command'],
};

/** The line a row shows for a command: its first line, which is what a client has room for. */
const rowLabel = (command: string): string => {
  const line = command.split(/\r?\n/u, 1)[0]?.trim() ?? '';
  return line === '' ? 'Shell command' : line;
};

/** The answer an async command is given: its shell, and what happens next. */
const asyncAnswer = (shell: ManagedShell): string =>
  `Shell ID: ${shell.id}\nThe command is running in the background. It is shown as a task in this chat, and this session is woken with its output when it ends.`;

/**
 * The tool set for the shell this host runs.
 *
 * The reference resolves the shell once per session from its terminal
 * manager; this host's shells all run the store's default program, so the
 * set is built once from that program.
 */
export const shellTools = (executable: string = shellOf()): HostTool[] => {
  const shellType: ShellType = shellTypeForExecutable(executable);
  const description = shellType === 'bash'
    ? (isZsh(executable) ? zshDescription() : bashDescription())
    : powerShellDescription(shellType, executable);
  const shutdownName = shellType === 'bash' ? 'bash_shutdown' : `${shellType}_shutdown`;
  const otherShellType: ShellType = shellType === 'bash' ? 'powershell' : 'bash';
  const redirectMessage = `This tool is disabled because the configured shell is ${executable}. Use the \`${shellType}\` tool instead.`;

  /** The shell a call names, or the newest one, as the reference picks it. */
  const named = (shells: Shells, id: unknown): ManagedShell | undefined => {
    if (typeof id === 'string' && id !== '') return shells.get(id);
    const all = shells.list();
    return all[all.length - 1];
  };

  const primary: HostTool = {
    definition: {
      name: shellType,
      description,
      inputSchema: commandSchema,
    },
    effects: { reads: true, writes: true, network: true, destructive: true },
    overridesBuiltInTool: true,
    run: async (input, at) => {
      allowed(at, 'terminal:create');
      const shells = shellsOf(at);
      const command = typeof input.command === 'string' ? input.command : failed('Invalid input: command must be a string.');
      const timeoutMs = typeof input.timeout === 'number' ? input.timeout : DEFAULT_SHELL_COMMAND_TIMEOUT_MS;
      const mode = input.mode ?? 'sync';
      if (mode !== 'sync' && mode !== 'async') failed('Invalid input: mode must be "sync" or "async".');
      const turnId = at.turn();
      const ref = await shells.acquire({
        chat: at.chat,
        ...(turnId !== undefined ? { turnId } : {}),
        ...(at.toolCallId !== undefined ? { toolCallId: at.toolCallId } : {}),
        ...(at.opened === undefined ? {} : { opened: at.opened }),
      });
      if (mode === 'async') {
        /*
         * Answered at once, and the shell stays the call's until the command
         * ends: the row below is the only thing a client has to watch it by,
         * and the shell it runs in is not offered to the next command.
         */
        const rows = at.background();
        const id = `shell:${ref.shell.id}`;
        rows.set({
          kind: 'shell',
          id,
          label: rowLabel(command),
          startedAt: new Date().toISOString(),
          command,
          terminal: ref.shell.terminalUri,
          /*
           * The stop is an interrupt. Under a pseudoterminal the byte is the
           * line discipline's, which signals the foreground group; on pipes
           * the store turns it into SIGINT itself. The row goes when the
           * command has really ended, which is the report just below - a row
           * taken down here would show work gone while it ran.
           */
          stop: async () => {
            if (shells.lifecycle(ref.shell).status !== 'running') return false;
            shells.send(ref.shell, '\u0003');
            return true;
          },
        });
        void shells.start(ref.shell, command)
          .finally(() => { rows.remove(id); ref.release(); })
          .catch(() => { /* a call already answered has nowhere to say it could not start */ });
        return asyncAnswer(ref.shell);
      }
      let release = true;
      try {
        const result = worded(ref.shell, await shells.run(ref.shell, command, timeoutMs), timeoutMs);
        if (result.keepShellBusy === true) {
          release = false;
          shells.hold(ref.shell);
        }
        return result.ok ? result.text : failed(result.text);
      }
      finally {
        if (release) ref.release();
      }
    },
  };

  const read: HostTool = {
    definition: {
      name: `read_${shellType}`,
      description: `Read the latest output from a running ${shellType} shell.`,
      inputSchema: {
        type: 'object',
        properties: {
          shell_id: { type: 'string', description: 'Shell ID to read from (optional; uses latest shell if omitted)' },
        },
      },
      annotations: { readOnlyHint: true },
    },
    confirm: false,
    overridesBuiltInTool: true,
    run: (input, at) => {
      allowed(at, 'terminal:output');
      const shells = shellsOf(at);
      const shell = named(shells, input.shell_id);
      if (shell === undefined) return failed('No active shell found.');
      const content = shells.content(shell);
      return content === '' ? '(no output)' : prepareOutputForModel(content);
    },
  };

  const write: HostTool = {
    definition: {
      name: `write_${shellType}`,
      description: `Send input to a running ${shellType} shell (e.g. answering a prompt, sending Ctrl+C).`,
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Text to write to the shell stdin' },
        },
        required: ['command'],
      },
    },
    confirm: false,
    overridesBuiltInTool: true,
    run: (input, at) => {
      allowed(at, 'terminal:input');
      const shells = shellsOf(at);
      const all = shells.list();
      const shell = all[all.length - 1];
      if (shell === undefined) return failed('No active shell found.');
      shells.send(shell, String(input.command ?? ''));
      return 'Input sent to shell.';
    },
  };

  const shutdown: HostTool = {
    definition: {
      name: shutdownName,
      description: `Stop a ${shellType} shell.`,
      inputSchema: {
        type: 'object',
        properties: {
          shell_id: { type: 'string', description: 'Shell ID to stop (optional; stops latest shell if omitted)' },
        },
      },
    },
    confirm: false,
    overridesBuiltInTool: true,
    run: (input, at) => {
      allowed(at, 'terminal:dispose');
      const shells = shellsOf(at);
      if (typeof input.shell_id === 'string' && input.shell_id !== '') {
        return shells.shutdown(input.shell_id) ? 'Shell stopped.' : failed('Shell not found.');
      }
      const all = shells.list();
      const shell = all[all.length - 1];
      if (shell === undefined) return failed('No active shell to stop.');
      shells.shutdown(shell.id);
      return 'Shell stopped.';
    },
  };

  const list: HostTool = {
    definition: {
      name: `list_${shellType}`,
      description: `List active ${shellType} shell instances.`,
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    confirm: false,
    overridesBuiltInTool: true,
    run: (_input, at) => {
      const shells = shellsOf(at);
      const all = shells.list();
      if (all.length === 0) return 'No active shells.';
      return all.map((one) => {
        const state = shells.lifecycle(one);
        const status = state.status === 'exited'
          ? state.exitCode === undefined ? 'exited' : `exited (${String(state.exitCode)})`
          : 'running';
        return `- ${one.id}: ${one.shellType} [${status}]`;
      }).join('\n');
    },
  };

  // The other shell's name answers with the right one, so a model that reaches
  // for it is told which shell runs here rather than told the tool is unknown.
  const redirect: HostTool = {
    definition: {
      name: otherShellType,
      description: redirectMessage,
      inputSchema: commandSchema,
    },
    confirm: false,
    overridesBuiltInTool: true,
    run: () => failed(redirectMessage),
  };

  return [primary, read, write, shutdown, list, redirect];
};
