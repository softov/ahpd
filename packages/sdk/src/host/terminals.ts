import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { ROOT, named, nonPtyShellTerminalOf } from './channels.js';
import { commandTurnKey } from './chatactions.js';
import { localPath } from '../resources/fileuri.js';
import { INTERNAL_ERROR, RpcError } from '../rpc.js';
import { BANG, CLOSING, need } from './common.js';
import { textOf } from './outputs.js';
import { toolCallDurationMs, withToolCallDuration } from '../utils/timing.js';
import { DEFAULT_SHELL_COMMAND_TIMEOUT_MS, executeShellCommand, shellTypeForExecutable } from '../machines/shellcommand.js';
import { shellOf } from '../machines/terminals.js';
import { reason } from '../utils/values.js';
import type { Bag } from '../types/common.js';
import type { Session } from '../types/session.js';
import type { Claim, CommandTerminal, OutputTerminal, OutputTerminals, ShellCommandResult, StartTerminals, Terminal, TerminalStore } from '../types/terminals.js';
import type { OnWire } from '../types/wire.js';
import type { TerminalInfo } from '@microsoft/agent-host-protocol';
import type { ConnectionContext, HostContext } from './context.js';

/**
 * VS Code's `WAIT_FOR_PROMPT_TIMEOUT`: how long a new pseudoterminal's prompt
 * is waited on before the root's list says the terminal anyway.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L33
 */
const PROMPT_WAIT_MS = 10_000;

/**
 * The host's own terminals.
 *
 * The store this host keeps, what the root channel lists from it, the `!`
 * command a turn runs as its local command, and the factory a backend is
 * handed on `Start` so it can open one itself.
 */
export interface Terminals {
  /** A `!` command, run as the turn `turnId` of `chat`, a chat of `session`, and that turn ended. */
  bang(session: Session, chat: string, turnId: string, command: string): void;
  /** Every terminal, as the root channel lists them. */
  terminalInfo(): OnWire<TerminalInfo>[];
  /** The terminal factory a backend is handed on `Start`. */
  heldTerminals(shells: TerminalStore, sessionUri: string, chatUri: string): StartTerminals;
  /**
   * A terminal on a channel of the host's own, for the host itself.
   *
   * The one road all three take: a `!` command's terminal, one a backend opens
   * on `Start`, and the shell an agent's tools run commands in. What each does
   * with the terminal once it exits is its own, which is `onAction`'s.
   */
  heldShell(shells: TerminalStore, asked: HeldShellOptions): Terminal;
  /**
   * A client's action on a terminal of the host's own, once this host has
   * said it, handed to whoever opened the terminal as its own actions are.
   */
  terminalSaid(uri: string, action: Bag): void;
  /** The output terminals a backend may open, handed on `Start`. */
  heldOutputs(sessionUri: string): OutputTerminals;
  /**
   * A client's claim, taken by the terminal and heard by a command running in
   * it, as VS Code's terminal manager sets a claim and fires its change.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L620-L633
   */
  setTerminalClaim(uri: string, claim: Claim): void;
  /** An output terminal let go of with nothing said, answering whether the name was one. */
  dropOutputTerminal(uri: string): boolean;
}

/**
 * What the host opens a terminal of its own with.
 *
 * The fields `TerminalOptions` takes, less the ones the host owns: the URI, the
 * claim, the emit and the registration are all this file's to make, and the
 * caller says only what the process is and gets told what it says.
 */
export interface HeldShellOptions {
  /** The terminal channel's name. The host's callers choose it, as `heldTerminals` does. */
  uri: string;
  /** The directory to start in. */
  cwd: string;
  /** Who is holding it. */
  claim: Claim;
  /** Display name. The shell's own if none is given. */
  name?: string;
  /** One command to run instead of a shell to sit in. */
  command?: string;
  /** The command's arguments, when `command` names a program rather than a line. */
  args?: string[];
  /** Environment variables for the process, over the host's own. */
  env?: Record<string, string | undefined>;
  /** Say the shell is one a person is not watching. */
  nonInteractive?: boolean;
  /** Keep what the shell runs out of the person's history. */
  preventShellHistory?: boolean;
  /** The machine the process runs in, by the id a computer URI names. */
  machine?: string;
  /**
   * Where the terminal's output is kept when it exits, so a call that names it
   * is answered after a restart.
   */
  kept?: { chat: string; key: string; session: string };
  /** Hear each action once it has been routed to the terminal. */
  onAction?: (action: Bag) => void;
}

/**
 * A claim off the wire, or nothing.
 *
 * Parsed rather than cast, which the types are what forced: a claim used to be
 * a `Bag` and anything at all was accepted, so a client could take a terminal
 * with `{}` and the state went out saying so. The two kinds carry different
 * fields and each is checked for its own.
 */
export function claimOf(value: unknown): Claim | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const held = value as Record<string, unknown>;
  if (held.kind === 'client') {
    return typeof held.clientId === 'string'
      ? { kind: 'client', clientId: held.clientId }
      : undefined;
  }
  if (held.kind === 'session') {
    if (typeof held.session !== 'string' || typeof held.chat !== 'string') return undefined;
    return {
      kind: 'session',
      session: held.session,
      chat: held.chat,
      ...(typeof held.turnId === 'string' ? { turnId: held.turnId } : {}),
      ...(typeof held.toolCallId === 'string' ? { toolCallId: held.toolCallId } : {}),
    };
  }
  return undefined;
}

/**
 * How much of an output terminal's text is kept: once it passes the cap, the
 * last part of it, as VS Code keeps a terminal's content.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/terminalConstants.ts#L10-L16
 */
const MAX_CONTENT_LENGTH = 100_000;
const TRIMMED_CONTENT_LENGTH = 80_000;

/**
 * Whether a pseudoterminal runs a terminal, as its state says, for a call that
 * names it. Nothing where the state says nothing, which a call then leaves out.
 */
const ptyOf = (terminal: Terminal): { isPty?: boolean } => {
  const { isPty } = terminal.state();
  return isPty === undefined ? {} : { isPty };
};

export function createTerminals(ctx: HostContext): Terminals {
  const { options, terminals, byChat, dispatch, log, fire, dirOfFile, refreshWatched } = ctx;

  /**
   * The output terminals: in the host's map, off the root list.
   *
   * A set of URIs rather than a flag on the terminal, because `Terminal` is
   * the shape the store's own object has and this host should not ask every
   * process-backed terminal to say `false` about something that only ever
   * happens here.
   */
  const outputs = new Set<string>();

  /**
   * What hears the actions said on each terminal a command runs in, by the
   * terminal's name: the store's own, and a client's claim.
   */
  const hearing = new Map<string, Set<(action: Bag) => void>>();
  /** Every hearer of one terminal hears one action. */
  const heard = (uri: string, action: Bag): void => {
    for (const hear of [...(hearing.get(uri) ?? [])]) hear(action);
  };

  /**
   * Open a terminal on a channel of the host's own.
   *
   * The one open block: the options the caller asked for, the emit that routes
   * its actions to the terminal instead of the session, and the registration
   * that makes the channel reachable. What happens once it exits is the
   * caller's, through `onAction`; a terminal whose output is kept when the
   * session goes is the caller's `kept`.
   */
  /** What each held terminal's opener hears, by the terminal's URI. */
  const openers = new Map<string, { terminal: Terminal; onAction: (action: Bag) => void }>();
  const terminalSaid = (uri: string, action: Bag): void => {
    const opener = openers.get(uri);
    if (opener === undefined) return;
    if (terminals.get(uri) !== opener.terminal) {
      openers.delete(uri);
      return;
    }
    opener.onAction(action);
  };

  const heldShell = (shells: TerminalStore, asked: HeldShellOptions): Terminal => {
    if (ctx.closed) throw new Error(CLOSING);
    const terminal = shells.create({
      uri: asked.uri,
      cwd: asked.cwd,
      claim: asked.claim,
      ...(asked.command !== undefined ? { command: asked.command } : {}),
      ...(asked.args !== undefined ? { args: asked.args } : {}),
      ...(asked.env !== undefined ? { env: asked.env } : {}),
      ...(asked.name !== undefined ? { name: asked.name } : {}),
      ...(asked.nonInteractive === true ? { nonInteractive: true } : {}),
      ...(asked.preventShellHistory === true ? { preventShellHistory: true } : {}),
      ...(asked.machine !== undefined ? { machine: asked.machine } : {}),
      emit: (_channel, action) => {
        dispatch(asked.uri, action);
        // Kept before the action reaches whoever asked, so a terminal the
        // action names answers from the moment it can be read.
        if ((action as Bag).type === 'terminal/exited' && asked.kept !== undefined) {
          ctx.keepExited(asked.kept.chat, asked.kept.key, asked.kept.session, terminal.state(), terminal.exitCode());
        }
        asked.onAction?.(action as Bag);
      },
    });
    terminals.set(asked.uri, terminal);
    if (asked.onAction !== undefined) openers.set(asked.uri, { terminal, onAction: asked.onAction });
    return terminal;
  };

  /**
   * One command, in a shell of its own that sits at its prompt, and how it
   * ended.
   *
   * The composer's `!` shorthand runs here rather than in the session,
   * because the shell is the host's: a backend has no port to spawn one
   * through, and the terminal has to be a real channel so the client can
   * watch the output arrive instead of waiting for the whole of it.
   *
   * As the reference host's `!` command runs one: the shell opens to sit in,
   * kept out of the person's history and told nobody is watching it; it is
   * listed once it has printed, or exited, or the prompt's ten seconds have
   * passed, and at once on pipes, where a shell prints nothing until it is
   * given something; `opened` names it then; and the command is typed into it
   * and waited on for VS Code's two minutes.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L52-L117
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L470-L508
   *
   * The shell stays until the session that ran it goes, as the reference host
   * keeps its own alive for the call that names it. It is named after that
   * call's chat and id, and what it printed is kept when the command ends: a
   * call whose terminal a client disposed, or one read back after a restart,
   * names a terminal the host rebuilds from it.
   * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L29-L39
   *
   * Rejects where the command cannot run, the shell it opened closed first.
   */
  const commanded = async (
    command: string,
    cwd: string,
    claim: Claim,
    opened?: (terminal: CommandTerminal) => void,
  ): Promise<{ terminal: CommandTerminal; result: ShellCommandResult }> => {
    const shells = options.terminals;
    if (!shells) throw new Error('There is no shell here to run it in');
    if (ctx.closed) throw new Error(CLOSING);
    // The call this command answers, which every `!` command's claim names.
    const call = claim.kind === 'session' && claim.toolCallId !== undefined
      ? { session: claim.session, chat: claim.chat, key: claim.toolCallId }
      : undefined;
    const uri = call === undefined ? `ahp-terminal:/${crypto.randomUUID()}` : ctx.nonPtyShellTerminalUri(call.session, call.chat, call.key);
    /*
     * The daemon's own shell, `$SHELL`, then `/bin/sh`, or the first
     * PowerShell found on Windows. `defaultShell` is what a client's own
     * terminal opens, and this runs through a session - and a pushed shell
     * must not be what a turn runs, because that is the escalation the review
     * found. Named here, so the command is typed in the syntax of the shell
     * it reaches.
     */
    const shell = shellOf();
    const hears = new Set<(action: Bag) => void>();
    hearing.set(uri, hears);
    let spoke: () => void = () => {};
    const spoken = new Promise<void>((done) => { spoke = done; });
    const terminal = shells.create({
      uri,
      cwd,
      claim,
      name: 'Terminal',
      shell,
      preventShellHistory: true,
      nonInteractive: true,
      emit: (_channel, action) => {
        dispatch(uri, action);
        const type = (action as Bag).type;
        if (type === 'terminal/data' || type === 'terminal/exited') spoke();
        heard(uri, action as Bag);
        if (type !== 'terminal/exited') return;
        hearing.delete(uri);
        if (terminals.get(uri) === terminal) dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
      },
    });
    terminals.set(uri, terminal);
    log(`opened ${uri} for ${command}`);
    if (terminal.state().isPty === true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([spoken, new Promise<void>((done) => { timer = setTimeout(done, PROMPT_WAIT_MS); })]);
      clearTimeout(timer);
    }
    if (terminals.get(uri) === terminal) dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
    const named = { uri, ...ptyOf(terminal) };
    opened?.(named);
    try {
      const result = await executeShellCommand(
        {
          terminal,
          shellType: shellTypeForExecutable(shell),
          hear: (listen) => {
            hears.add(listen);
            return () => { hears.delete(listen); };
          },
        },
        command,
        DEFAULT_SHELL_COMMAND_TIMEOUT_MS,
      );
      // Kept before the call completes, so the terminal it names answers from
      // the moment a client can read the name, and after the shell has gone.
      if (call !== undefined) ctx.keepExited(call.chat, call.key, call.session, terminal.state(), result.exitCode);
      // A command that ran in this session's directory may have moved it: a
      // commit, a checkout, or anything that wrote a file.
      const ranIn = dirOfFile(cwd);
      if (ranIn !== undefined) void refreshWatched(ranIn);
      return { terminal: named, result };
    }
    catch (error) {
      terminal.close();
      terminals.delete(uri);
      hearing.delete(uri);
      dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
      throw error;
    }
  };

  /*
   * A `!` command, run as its turn's local command whatever backend the chat
   * has: a `terminal` call shown as `Terminal`, running at once since the person
   * typed it, its terminal named as soon as it opens, and completed with how
   * the command ended, a non-zero exit with no error and a command that could
   * not run with its error, and how long it ran on the call's `_meta`; then the
   * turn completes whatever the command did, which starts the chat's queue, as
   * the reference host's local command ends its turn.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L52-L158
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L201-L222
   *
   * Said on the chat's own road, which keeps every turn of the chat: its
   * start again, which the chat holds and which is not said twice, then the
   * call and the turn's end, which keeps it as a local turn and lets its
   * sender go. A worker's chat has no road of its own, so its command is said
   * as this host's actions, kept as a local turn here, its `turn_end` raised
   * here and its sender let go.
   */
  const bang = (session: Session, chat: string, turnId: string, command: string): void => {
    /*
     * The command as a provisional title, collapsed to one line and cut at the
     * length VS Code gives a title its active agent falls back on, which a
     * session takes while it has none of its own and replaces with its first
     * real message's, as VS Code's host seeds one from a local command.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L36-L38
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionTitleController.ts#L232-L255
     */
    const suggested = Array.from(command.trim().replace(/\s+/g, ' ')).slice(0, 40).join('').trim();
    if (suggested !== '') session.seedTitle?.(suggested);
    const road = byChat.get(chat);
    const say = (action: Bag): void => {
      if (road === undefined) dispatch(chat, action);
      else road.say(action);
    };
    const turn = ctx.stateOf(chat)?.activeTurn as Bag | undefined;
    const startedAt = typeof turn?.startedAt === 'string' ? turn.startedAt : new Date().toISOString();
    ctx.commandTurns.add(commandTurnKey(chat, turnId));
    if (road !== undefined) say({ type: 'chat/turnStarted', turnId, startedAt, message: turn?.message ?? { text: `${BANG}${command}`, origin: { kind: 'user' } } });
    const toolCallId = crypto.randomUUID();
    const began = Date.now();
    say({ type: 'chat/toolCallStart', turnId, toolCallId, toolName: 'terminal', displayName: 'Terminal', intention: command });
    say({ type: 'chat/toolCallReady', turnId, toolCallId, invocationMessage: command, toolInput: command, confirmed: 'not-needed' });
    // The block a client opens the command's terminal from, with `isPty` where the terminal's state says it.
    const terminalOf = (terminal: CommandTerminal): Bag => ({
      type: 'terminal',
      resource: terminal.uri,
      title: 'Terminal',
      ...(terminal.isPty === undefined ? {} : { isPty: terminal.isPty }),
    });
    const first = session.workingDirectories()[0];
    const where = first === undefined ? options.path : localPath(first);
    void commanded(command, where, { kind: 'session', session: session.uri, chat, turnId, toolCallId }, (opened) => {
      say({ type: 'chat/toolCallContentChanged', turnId, toolCallId, content: [terminalOf(opened)] });
    }).then(
      ({ terminal, result: ran }): Bag => {
        /*
         * Whether it went well, and the line that says how it ended, in the
         * reference host's words for each of the five endings.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L141-L158
         */
        const exitCode = ran.exitCode ?? 0;
        const [success, pastTenseMessage] = ran.status === 'completed'
          ? exitCode === 0 ? [true, 'Ran command'] : [false, `Command exited with code ${String(exitCode)}`]
          : ran.status === 'timeout' ? [false, 'Command timed out']
            : ran.status === 'shellExited' ? [false, 'Shell exited unexpectedly']
              : ran.status === 'background' ? [true, 'Command is running in the background']
                : [true, 'Command opened an interactive terminal'];
        // How the command ended, which the protocol has on a terminal's block once it has exited.
        const exited = ran.status === 'completed' || ran.status === 'shellExited';
        return {
          success,
          pastTenseMessage,
          // The terminal again, with how the command ended, and then the text it printed.
          content: [
            {
              ...terminalOf(terminal),
              ...(exited
                ? { result: { ...(ran.exitCode === undefined ? {} : { exitCode: ran.exitCode }), ...(ran.output === '' ? {} : { preview: ran.output }) } }
                : {}),
            },
            ...(ran.output === '' ? [] : [{ type: 'text', text: ran.output }]),
          ],
        };
      },
      (error: unknown): Bag => ({
        success: false,
        pastTenseMessage: 'Failed to run command',
        error: { message: error instanceof Error ? error.message : String(error) },
      }),
    ).then((result) => {
      const ended = Date.now();
      const _meta = withToolCallDuration(undefined, toolCallDurationMs(began, ended));
      say({ type: 'chat/toolCallComplete', turnId, toolCallId, result, ...(_meta === undefined ? {} : { _meta }) });
      say({ type: 'chat/turnComplete', turnId, duration: Math.max(0, ended - began) });
      if (road !== undefined) return;
      ctx.recordLocalTurn(session.uri, chat, (ctx.stateOf(chat)?.turns ?? []) as Bag[], turnId);
      // The road raises its chat's turn end; a worker's chat, with none, has it raised here.
      ctx.raiseTurnEnd({ session: session.uri, channel: chat, turnId, reason: { kind: 'localCommand' } });
      ctx.forgetSender(turnId);
    });
  };

  /** Every terminal, as the root channel lists them. */
  const terminalInfo = (): OnWire<TerminalInfo>[] =>
    [...terminals.values()]
      // An output terminal runs no process. It is a channel a chat's row
      // points at, not a shell on this machine, so it is not in the list of
      // shells - the same reason VS Code keeps it off the root list.
      .filter((held) => !outputs.has(held.uri))
      .map((held) => ({
        resource: held.uri,
        title: held.title(),
        claim: held.claim(),
        /*
         * The exit code is in here, and only here.
         *
         * `TerminalInfo` declares these four keys and nothing else; the code
         * belongs to `TerminalExitedLifecycleState`, which this returns once the
         * process has gone. A flat one beside it is a key the protocol does not
         * have, and it only appeared on the wire when a terminal happened to
         * exit before the list was taken.
         */
        lifecycle: held.lifecycle(),
      }));

  /**
   * The terminal factory a backend is handed on `Start`.
   *
   * The host owns everything a terminal channel needs, so this is where the
   * backend's request is turned into one: a URI the root list can name, the
   * session's own claim, the registration that makes the channel reachable
   * and the emit that routes an action to the terminal instead of the
   * session. It is the same machinery `commanded` uses for a `!` command,
   * with the options the backend gave and a handle to read the result through.
   *
   * `release` ends a process that has not already gone. Dropping the row
   * without ending the process would leave a shell running that the root list
   * no longer names and no client can reach, which is a leak wearing the
   * clothes of tidiness.
   *
   * A tool call may name the terminal, as an ACP agent's does, so it is named
   * under its chat and a key of its own, and what it printed is kept when it
   * exits: a call that names a released terminal names one the host rebuilds.
   */
  const heldTerminals = (shells: TerminalStore, sessionUri: string, chatUri: string): StartTerminals => ({
    open: (asked) => {
      if (ctx.closed) throw new Error(CLOSING);
      const key = crypto.randomUUID();
      const uri = ctx.nonPtyShellTerminalUri(sessionUri, chatUri, key);
      /*
       * Claimed by the session with the chat, the turn running in it and the
       * tool call the backend named, as VS Code's shell tool claims an
       * agent's terminal.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotShellTools.ts#L196-L202
       */
      const turn = (ctx.stateOf(chatUri)?.activeTurn as Bag | undefined)?.id;
      let spoke: () => void = () => {};
      const spoken = new Promise<void>((done) => { spoke = done; });
      const terminal = shells.create({
        uri,
        cwd: asked.cwd,
        claim: {
          kind: 'session',
          session: sessionUri,
          chat: chatUri,
          ...(typeof turn === 'string' ? { turnId: turn } : {}),
          ...(asked.toolCallId !== undefined ? { toolCallId: asked.toolCallId } : {}),
        },
        command: asked.command,
        ...(asked.args !== undefined ? { args: asked.args } : {}),
        ...(asked.env !== undefined ? { env: asked.env } : {}),
        ...(asked.name !== undefined ? { name: asked.name } : {}),
        /*
         * No shell named, so the daemon's own is used.
         *
         * A backend opening a terminal runs a turn's command, and an automation
         * fires with nobody connected at all, so the pushed `defaultShell` is not
         * what it opens. Answered deliberately (the user, 2026-09-23): the
         * daemon's default only. It costs an agent's terminal the shell you
         * chose in your client, and it closes by construction the path where
         * writing a file and naming it in `defaultShell` made the next tool call
         * run it.
         */
        emit: (_channel, action) => {
          dispatch(uri, action);
          if ((action as Bag).type === 'terminal/data' || (action as Bag).type === 'terminal/exited') spoke();
          // The root list says whether a terminal is still running, so it is
          // stale the moment one exits and reaches nobody unless it moves. A
          // terminal closed and taken off the list was said as it went.
          if ((action as Bag).type === 'terminal/exited') {
            ctx.keepExited(chatUri, key, sessionUri, terminal.state(), terminal.exitCode());
            if (terminals.get(uri) === terminal) dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
            // A command that ran in this session's directory may have moved it.
            const ranIn = dirOfFile(asked.cwd);
            if (ranIn !== undefined) void refreshWatched(ranIn);
          }
        },
      });
      terminals.set(uri, terminal);
      // The same observation the client path makes, so a plugin watching for a
      // shell cannot tell which half of the host opened it.
      void fire({ type: 'terminal_open', terminal: uri, cwd: asked.cwd });
      log(`opened ${uri} for ${sessionUri}`);
      /*
       * Listed once the shell has printed or exited or ten seconds passed, as
       * the reference's terminal manager waits for a pseudoterminal's prompt;
       * a process on pipes is listed at once, as `createTerminal` lists one.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L470-L508
       */
      const list = (): void => {
        if (terminals.get(uri) === terminal) dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
      };
      if (terminal.state().isPty === true) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        void Promise.race([spoken, new Promise<void>((done) => { timer = setTimeout(done, PROMPT_WAIT_MS); })])
          .then(() => { clearTimeout(timer); list(); });
      }
      else list();
      return {
        uri,
        ...ptyOf(terminal),
        output: () => {
          const output = textOf(terminal.state().content);
          const code = terminal.exitCode();
          return {
            output,
            ...(code !== undefined ? { exitCode: code } : {}),
          };
        },
        waitForExit: () => terminal.waitForExit(),
        write: (data) => { terminal.write(data); },
        // The backend's own resize, which is this host's to say.
        resize: (cols, rows) => {
          terminal.resize(cols, rows);
          dispatch(uri, { type: 'terminal/resized', cols, rows });
        },
        // Ends the process and leaves the row, the way `commanded` does: the
        // channel may still be what something points at.
        kill: () => { terminal.close(); },
        release: () => {
          if (terminal.exitCode() === undefined) terminal.close();
          terminals.delete(uri);
          dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
        },
      };
    },
  });

  /**
   * The output terminals a backend may open.
   *
   * No process stands behind one: the backend has the text and the host owns
   * the channel a client subscribes to, so the two halves of a terminal split
   * cleanly. It is in the map all the same, because a snapshot is taken from
   * there and a client opens `ahp-terminal:/<uuid>` the way it opens any
   * other. It is not in `terminalInfo`, which is the list of shells.
   */
  const heldOutputs = (sessionUri: string): OutputTerminals => ({
    create: (asked) => {
      if (ctx.closed) throw new Error(CLOSING);
      const uri = `ahp-terminal:/${crypto.randomUUID()}`;
      const title = asked.title;
      let claim: Claim = { kind: 'session', session: sessionUri, chat: asked.chat };
      let content = '';
      let exitCode: number | undefined;
      let done = false;
      let settle: ((exit: { exitCode?: number; signal?: string }) => void) | undefined;
      const gone = new Promise<{ exitCode?: number; signal?: string }>((resolve) => { settle = resolve; });

      const finish = (code?: number): void => {
        if (done) return;
        done = true;
        exitCode = code;
        dispatch(uri, { type: 'terminal/exited', ...(code === undefined ? {} : { exitCode: code }) });
        settle?.({ ...(code === undefined ? {} : { exitCode: code }) });
      };

      const terminal: Terminal = {
        uri,
        title: () => title,
        claim: () => claim,
        exitCode: () => exitCode,
        lifecycle: () => (done
          ? { status: 'exited', ...(exitCode === undefined ? {} : { exitCode }) }
          : { status: 'running' }),
        /*
         * The five fields VS Code's terminal manager answers an output
         * terminal with: no size and no command detection, there being no
         * process, and one part, there being no command boundaries to divide
         * an output somebody else already ended.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L273-L284
         */
        state: () => ({
          title,
          content: content === '' ? [] : [{ type: 'unclassified', value: content }],
          lifecycle: done
            ? { status: 'exited' as const, ...(exitCode === undefined ? {} : { exitCode }) }
            : { status: 'running' as const },
          claim,
          isPty: false,
        }),
        /*
         * Input has no process to reach, and a client's size, clear and title
         * are its echo's alone: only the claim is applied, as VS Code's
         * terminal manager applies a client's action to an output terminal.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L620-L633
         */
        write: () => {},
        resize: () => {},
        clear: () => {},
        setTitle: () => {},
        setClaim: (next) => { claim = next; },
        close: () => {
          finish();
          outputs.delete(uri);
        },
        waitForExit: () => gone,
        // No process wrote this, so there is no screen to read and none to
        // wait on: the text is all there is of it.
        isInAltBuffer: () => false,
        isBracketedPasteMode: () => false,
        whenAltBuffer: () => Promise.resolve(),
        whenScreenSettled: () => Promise.resolve(),
      };

      outputs.add(uri);
      terminals.set(uri, terminal);
      log(`opened the output terminal ${uri} for ${sessionUri}`);

      /*
       * The owner's text, said as VS Code's terminal manager says an output
       * terminal's whatever its lifecycle: an append that is not empty, kept
       * to the last of it past the content cap; a reset; and a replace said
       * whole, cleared then written.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L876-L921
       */
      return {
        uri,
        append: (text) => {
          if (text === '') return;
          content += text;
          if (content.length > MAX_CONTENT_LENGTH) content = content.slice(-TRIMMED_CONTENT_LENGTH);
          dispatch(uri, { type: 'terminal/data', data: text });
        },
        reset: () => {
          content = '';
          dispatch(uri, { type: 'terminal/cleared' });
        },
        replace: (text) => {
          content = text;
          dispatch(uri, { type: 'terminal/cleared' });
          if (content !== '') dispatch(uri, { type: 'terminal/data', data: content });
        },
        finalize: (code) => { finish(code); },
        dispose: () => {
          if (!done) {
            done = true;
            settle?.({});
          }
          outputs.delete(uri);
          terminals.delete(uri);
        },
      };
    },
  });

  const setTerminalClaim = (uri: string, claim: Claim): void => {
    terminals.get(uri)?.setClaim(claim);
    heard(uri, { type: 'terminal/claimed', claim });
  };

  const dropOutputTerminal = (uri: string): boolean => {
    if (!outputs.delete(uri)) return false;
    terminals.delete(uri);
    hearing.delete(uri);
    return true;
  };

  return { bang, terminalInfo, heldTerminals, heldShell, terminalSaid, heldOutputs, setTerminalClaim, dropOutputTerminal };
}

/**
 * The two commands a client opens and closes a shell with.
 */
export interface TerminalMethods {
  createTerminal: (params: Record<string, unknown>) => Promise<unknown>;
  disposeTerminal: (params: Record<string, unknown>) => Promise<unknown>;
}

export function createTerminalMethods(ctx: HostContext, _conn: ConnectionContext): TerminalMethods {
  const {
    claimable, dirOfFile, dispatch, fire, log, options, refreshWatched, terminalInfo, terminals,
  } = ctx;

  return {
    /**
     * A shell on this machine.
     *
     * The client picks the URI, as it does for a session, so it can
     * subscribe without a round trip in between. The connection token is
     * what decides who gets one, as it is for a session, so it opens in the
     * folder the client names.
     */
    createTerminal: async (params) => {
      // Before the URI is looked at. A host that opens no shells at all
      // should say that, not complain about the argument to a request it
      // was never going to answer.
      const shells = need(options.terminals, 'createTerminal');
      const uri = named(String(params.channel ?? ''), 'terminal');
      // In the reference's words, as the plain error it throws.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L306-L310
      if (terminals.has(uri))
        throw new Error(`Terminal already exists: ${uri}`);
      // The host names these, and a client's shell under one would answer for
      // the terminal a tool call names.
      if (nonPtyShellTerminalOf(uri) !== undefined)
        throw new RpcError(-32003, `${uri} is a name this host keeps for the terminals a tool result names`);
      claimable(uri, 'terminal');
      /*
       * The folder the client names, as a `file:` URI or a path, and the home
       * folder where it names none, or one that is not a folder here: a shell
       * started in a folder that is not there exits at once. As VS Code's
       * terminal manager resolves it.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L962-L992
       */
      const given = typeof params.cwd === 'string' ? localPath(params.cwd) : '';
      const folder = given !== '' && given !== '/' && await stat(given).then((found) => found.isDirectory(), () => false);
      const asked = folder ? given : process.env.HOME || process.env.USERPROFILE || process.cwd();
      if (!folder && given !== '') log(`${uri}: ${given} is not a folder here, so it opens in ${asked}`);
      /*
       * The host's `defaultShell` where a client pushed one this machine can
       * run, and the system's shell otherwise, as VS Code's terminal manager
       * reads it.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L949-L960
       */
      const configured = typeof ctx.rootConfig.defaultShell === 'string' && ctx.rootConfig.defaultShell !== ''
        ? ctx.rootConfig.defaultShell
        : undefined;
      const shell = configured === undefined ? undefined : await access(configured, constants.X_OK).then(
        () => configured,
        (error: unknown) => {
          log(`the defaultShell ${configured} cannot run here, so ${uri} opens the system shell: ${reason(error)}`);
          return undefined;
        },
      );
      /*
       * Whose terminal this is, taken as the client sent it, and a client's
       * with no id where it sent none, as the reference's terminal manager
       * takes it.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L421
       */
      const claim = (params.claim ?? { kind: 'client', clientId: '' }) as Claim;
      if (ctx.closed) throw new RpcError(INTERNAL_ERROR, CLOSING);
      /*
       * The shell's first words, or its exit: what the root's list waits on
       * below.
       */
      let spoke: () => void = () => {};
      const spoken = new Promise<void>((done) => { spoke = done; });
      const terminal = shells.create({
        uri,
        cwd: asked,
        claim,
        ...(shell === undefined ? {} : { shell }),
        ...(typeof params.name === 'string' ? { name: params.name } : {}),
        ...(typeof params.cols === 'number' ? { cols: params.cols } : {}),
        ...(typeof params.rows === 'number' ? { rows: params.rows } : {}),
        emit: (_channel, action) => {
          dispatch(uri, action);
          if ((action as Bag).type === 'terminal/data' || (action as Bag).type === 'terminal/exited') spoke();
          /*
           * A terminal that exited is a different row on the root channel
           * as well, and that list only moved when one was created or
           * disposed - so the catalogue went on describing a dead shell as
           * running until somebody closed it.
           *
           * Worse since 0.9.0 rather than new: the old shape said nothing
           * about a terminal that had not exited, and this one says
           * `{ status: 'running' }` out loud. A stale silence is a client
           * with less to go on; a stale assertion is a client that has
           * been told something untrue.
           */
          if ((action as Bag).type === 'terminal/exited') {
            // A terminal closed and taken off the list was said as it went.
            if (terminals.get(uri) === terminal) dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
            // A command that ran in this session's directory may have moved
            // it: a commit, a checkout, or anything that wrote a file.
            const ranIn = dirOfFile(asked);
            if (ranIn !== undefined) void refreshWatched(ranIn);
          }
        },
      });
      terminals.set(uri, terminal);
      void fire({ type: 'terminal_open', terminal: uri, cwd: asked });
      log(`opened ${uri} in ${asked}`);
      /*
       * Listed, and answered, once the shell has printed or exited or ten
       * seconds passed, as the reference's terminal manager waits for a
       * pseudoterminal's prompt before it lists a terminal. A shell on pipes
       * prints no prompt until it is given something to run, so it is listed
       * at once.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L470-L508
       */
      if (terminal.state().isPty === true) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([spoken, new Promise<void>((done) => { timer = setTimeout(done, PROMPT_WAIT_MS); })]);
        clearTimeout(timer);
      }
      if (terminals.get(uri) === terminal) dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
      return null;
    },
    /*
     * A terminal closed, and one this host does not hold is closed already,
     * answered `null` either way, as the reference host answers two windows
     * closing the same terminal.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L937-L947
     */
    /*
     * A terminal a client is done with, as VS Code's terminal manager disposes
     * one: an output terminal dropped with nothing said, it being on no list,
     * a process terminal ended and the list said, a name this host holds no
     * terminal under answered all the same.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L936-L947
     */
    disposeTerminal: async (params) => {
      const uri = String(params.channel ?? '');
      const terminal = terminals.get(uri);
      if (!terminal) return null;
      if (ctx.dropOutputTerminal(uri)) {
        log(`dropped the output terminal ${uri}`);
        return null;
      }
      terminals.delete(uri);
      terminal.close();
      log(`closed ${uri}`);
      dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
      return null;
    },
  };
}
