import { ROOT, named, retainedTerminalOf, retainedTerminalUri } from './channels.js';
import { commandTurnKey } from './chatactions.js';
import { localPath } from '../resources/fileuri.js';
import { INTERNAL_ERROR, INVALID_PARAMS, RpcError } from '../rpc.js';
import { BANG, CLOSING, need } from './common.js';
import { textOf } from './outputs.js';
import { callTimes } from '../utils/timing.js';
import type { Bag } from '../types/common.js';
import type { Session } from '../types/session.js';
import type { Claim, CommandTerminal, OutputTerminal, OutputTerminals, Ran, StartTerminals, Terminal, TerminalStore } from '../types/terminals.js';
import type { OnWire } from '../types/wire.js';
import type { TerminalInfo } from '@microsoft/agent-host-protocol';
import type { ConnectionContext, HostContext } from './context.js';

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
  /** The output terminals a backend may open, handed on `Start`. */
  heldOutputs(sessionUri: string): OutputTerminals;
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
 * The scrollback cap an output terminal shares with a process one.
 *
 * The same number `machines/terminals.ts` keeps, and for the same reason: a
 * backend polling a shell that ran for a day must not hold a day of text for a
 * client that may never come back.
 */
const KEEP = 200_000;

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
   * Open a terminal on a channel of the host's own.
   *
   * The one open block: the options the caller asked for, the emit that routes
   * its actions to the terminal instead of the session, and the registration
   * that makes the channel reachable. What happens once it exits is the
   * caller's, through `onAction`; a terminal whose output is kept when the
   * session goes is the caller's `kept`.
   */
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
    return terminal;
  };

  /**
   * One command, in a terminal of its own, and what it did.
   *
   * The composer's `!` shorthand runs here rather than in the session,
   * because the shell is the host's: a backend has no port to spawn one
   * through, and the terminal has to be a real channel so the client can
   * watch the output arrive instead of waiting for the whole of it.
   *
   * The terminal stays, exited, until the session that ran it goes, as the
   * reference host keeps its own alive for the call that names it. It is
   * named after that call's chat and id, and what it printed is kept when it
   * exits: a call whose terminal a client disposed, or one read back after a
   * restart, names a terminal the host rebuilds from it.
   * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L29-L39
   *
   * `opened` hears the terminal once it is a channel a client can subscribe
   * to, which is when the call names it. Rejects where the command cannot run.
   */
  const commanded = async (
    command: string,
    cwd: string,
    claim: Claim,
    opened?: (terminal: CommandTerminal) => void,
  ): Promise<Ran> => {
    const shells = options.terminals;
    if (!shells) throw new Error('There is no shell here to run it in');
    if (ctx.closed) throw new Error(CLOSING);
    // The call this command answers, which every `!` command's claim names.
    const call = claim.kind === 'session' && claim.toolCallId !== undefined
      ? { session: claim.session, chat: claim.chat, key: claim.toolCallId }
      : undefined;
    const uri = call === undefined ? `ahp-terminal:/${crypto.randomUUID()}` : retainedTerminalUri(call.chat, call.key);
    return await new Promise<Ran>((resolve) => {
      /*
       * No shell named, so `shellOf` takes the daemon's own: `$SHELL`, then
       * `/bin/sh`, or the first PowerShell found on Windows. `defaultShell`
       * is what a client's own terminal opens, and this runs through a
       * session - and a pushed shell must not be what a turn runs, because
       * that is the escalation the review found.
       */
      const terminal = heldShell(shells, {
        uri,
        cwd,
        claim,
        command,
        name: 'Terminal',
        onAction: (action) => {
          if (action.type !== 'terminal/exited') return;
          dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
          // A command that ran in this session's directory may have moved it:
          // a commit, a checkout, or anything that wrote a file.
          const ranIn = dirOfFile(cwd);
          if (ranIn !== undefined) void refreshWatched(ranIn);
          const code = terminal.exitCode() ?? 0;
          /*
           * Read off the terminal rather than accumulated here.
           *
           * The store already keeps the output for a client that subscribes
           * late, capped, and a second copy in this closure would be the same
           * bytes held twice and the cap applied to only one of them.
           */
          const state = terminal.state();
          const printed = textOf(state.content);
          // Kept before the call completes, so the terminal it names answers
          // from the moment a client can read the name.
          if (call !== undefined) ctx.keepExited(call.chat, call.key, call.session, state, terminal.exitCode());
          resolve({ output: printed, terminal: uri, ...ptyOf(terminal), code });
        },
      });
      log(`ran ${command} in ${uri}`);
      dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
      opened?.({ uri, ...ptyOf(terminal) });
    });
  };

  /*
   * A `!` command, run as its turn's local command whatever backend the chat
   * has: a `terminal` call shown as `Terminal`, running at once since the person
   * typed it, its terminal named as soon as it opens, and completed with how
   * the command ended, a non-zero exit with no error and a command that could
   * not run with its error; then the turn completes whatever the command did,
   * which starts the chat's queue, as the reference host's local command ends
   * its turn.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L52-L158
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L201-L222
   *
   * Said on the chat's own road, which keeps every turn of the chat: its
   * start again, which the chat holds and which is not said twice, then the
   * call and the turn's end, which keeps it as a local turn and lets its
   * sender go. A worker's chat has no road of its own, so its command is said
   * as this host's actions, kept as a local turn here and its sender let go.
   */
  const bang = (session: Session, chat: string, turnId: string, command: string): void => {
    const road = byChat.get(chat);
    const say = (action: Bag): void => {
      if (road === undefined) dispatch(chat, action);
      else road.say(action);
    };
    const turn = ctx.stateOf(chat)?.activeTurn as Bag | undefined;
    const startedAt = typeof turn?.startedAt === 'string' ? turn.startedAt : new Date().toISOString();
    ctx.commandTurns.set(commandTurnKey(chat, turnId), false);
    if (road !== undefined) say({ type: 'chat/turnStarted', turnId, startedAt, message: turn?.message ?? { text: `${BANG}${command}`, origin: { kind: 'user' } } });
    const toolCallId = crypto.randomUUID();
    const began = Date.now();
    say({ type: 'chat/toolCallStart', turnId, toolCallId, toolName: 'terminal', displayName: 'Terminal', intention: command });
    say({ type: 'chat/toolCallReady', turnId, toolCallId, invocationMessage: command, toolInput: command, confirmed: 'not-needed', _meta: callTimes(began) });
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
      (ran): Bag => ({
        success: ran.code === 0,
        pastTenseMessage: ran.code === 0 ? 'Ran command' : `Command exited with code ${String(ran.code)}`,
        // The terminal again, with how the command ended, and then the text it printed.
        content: [
          {
            ...terminalOf({ uri: ran.terminal, ...(ran.isPty === undefined ? {} : { isPty: ran.isPty }) }),
            result: { exitCode: ran.code, ...(ran.output === '' ? {} : { preview: ran.output }) },
          },
          ...(ran.output === '' ? [] : [{ type: 'text', text: ran.output }]),
        ],
      }),
      (error: unknown): Bag => ({
        success: false,
        pastTenseMessage: 'Failed to run command',
        error: { message: error instanceof Error ? error.message : String(error) },
      }),
    ).then((result) => {
      const ended = Date.now();
      say({ type: 'chat/toolCallComplete', turnId, toolCallId, result, _meta: callTimes(began, ended) });
      say({ type: 'chat/turnComplete', turnId, duration: Math.max(0, ended - began) });
      if (road !== undefined) return;
      ctx.keepLocalTurn(session.uri, chat, (ctx.stateOf(chat)?.turns ?? []) as Bag[], turnId);
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
      const uri = retainedTerminalUri(chatUri, key);
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
      const terminal = heldShell(shells, {
        uri,
        cwd: asked.cwd,
        claim: { kind: 'session', session: sessionUri, chat: chatUri },
        command: asked.command,
        ...(asked.args !== undefined ? { args: asked.args } : {}),
        ...(asked.env !== undefined ? { env: asked.env } : {}),
        ...(asked.name !== undefined ? { name: asked.name } : {}),
        kept: { chat: chatUri, key, session: sessionUri },
        onAction: (action) => {
          // The root list says whether a terminal is still running, so it is
          // stale the moment one exits and reaches nobody unless it moves.
          if (action.type !== 'terminal/exited') return;
          dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
          // A command that ran in this session's directory may have moved it.
          const ranIn = dirOfFile(asked.cwd);
          if (ranIn !== undefined) void refreshWatched(ranIn);
        },
      });
      // The same observation the client path makes, so a plugin watching for a
      // shell cannot tell which half of the host opened it.
      void fire({ type: 'terminal_open', terminal: uri, cwd: asked.cwd });
      log(`opened ${uri} for ${sessionUri}`);
      dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
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
      let title = asked.title;
      let claim: Claim = { kind: 'session', session: sessionUri, chat: asked.chat };
      let cols = 80;
      let rows = 24;
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
        state: () => ({
          title,
          cols,
          rows,
          // One part: there are no command boundaries to divide an output
          // somebody else already ended.
          content: content === '' ? [] : [{ type: 'unclassified', value: content }],
          claim,
          supportsCommandDetection: false,
          isPty: asked.isPty === true,
          lifecycle: done
            ? { status: 'exited' as const, ...(exitCode === undefined ? {} : { exitCode }) }
            : { status: 'running' as const },
          ...(exitCode === undefined ? {} : { exitCode }),
        }),
        // Input has no process to reach, and goes nowhere. A size is kept,
        // since the state reports one and a client draws to it.
        write: () => {},
        resize: (nextCols, nextRows) => {
          cols = nextCols;
          rows = nextRows;
        },
        clear: () => { content = ''; },
        setTitle: (next) => { title = next; },
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

      return {
        uri,
        append: (text) => {
          if (done) return;
          content = (content + text).slice(-KEEP);
          dispatch(uri, { type: 'terminal/data', data: text });
        },
        reset: () => {
          if (done) return;
          content = '';
          dispatch(uri, { type: 'terminal/cleared' });
        },
        replace: (text) => {
          if (done) return;
          // Cleared then written, in that order, so a client's reducer ends
          // with exactly what this keeps - and the same text a late subscriber
          // reads, rather than the uncapped one a live client saw arrive.
          content = text.slice(-KEEP);
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

  return { bang, terminalInfo, heldTerminals, heldShell, heldOutputs };
}

/**
 * The two commands a client opens and closes a shell with.
 */
export interface TerminalMethods {
  createTerminal: (params: Record<string, unknown>) => Promise<unknown>;
  disposeTerminal: (params: Record<string, unknown>) => Promise<unknown>;
}

export function createTerminalMethods(ctx: HostContext, conn: ConnectionContext): TerminalMethods {
  const { connection } = conn;
  const {
    claimable, dir, dirOfFile, dispatch, fire, log, options, refreshWatched, terminalInfo, terminals,
  } = ctx;

  return {
    /**
     * A shell on this machine.
     *
     * The client picks the URI, as it does for a session, so it can
     * subscribe without a round trip in between. `cwd` is checked against
     * the directories this host serves - a terminal is arbitrary code on
     * the machine, and one that started anywhere would be a host that
     * hands out a shell wherever it is asked.
     */
    createTerminal: async (params) => {
      // Before the URI is looked at. A host that opens no shells at all
      // should say that, not complain about the argument to a request it
      // was never going to answer.
      const shells = need(options.terminals, 'createTerminal');
      const uri = named(String(params.channel ?? ''), 'terminal');
      if (terminals.has(uri))
        throw new RpcError(-32003, `${uri} already exists`);
      // The host names these, and a client's shell under one would answer for
      // the terminal a tool call names.
      if (retainedTerminalOf(uri) !== undefined)
        throw new RpcError(-32003, `${uri} is a name this host keeps for the terminals a tool result names`);
      claimable(uri, 'terminal');
      const asked = typeof params.cwd === 'string' ? localPath(params.cwd) : dir;
      /*
       * Whose terminal this is, checked rather than taken.
       *
       * A claim used to be a `Bag` and anything at all was accepted, so a
       * client could take a terminal with `{}` and the channel then said
       * so to everyone watching. Absent is this connection, which is the
       * ordinary case; present and malformed is a refusal, because a
       * client that meant to name a session and got it wrong should hear
       * about it rather than quietly become the owner.
       */
      const claim = params.claim === undefined
        ? { kind: 'client' as const, clientId: connection.clientId }
        : claimOf(params.claim);
      if (!claim) throw new RpcError(INVALID_PARAMS, 'That is not a terminal claim');
      if (ctx.closed) throw new RpcError(INTERNAL_ERROR, CLOSING);
      const terminal = shells.create({
        uri,
        cwd: asked,
        claim,
        // The host's `defaultShell`, if a client pushed one: the one value
        // every client's terminal opens, as the reference host's terminal
        // manager reads it.
        // https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L949-L960
        ...(typeof ctx.rootConfig.defaultShell === 'string'
          ? { shell: ctx.rootConfig.defaultShell }
          : {}),
        ...(typeof params.name === 'string' ? { name: params.name } : {}),
        ...(typeof params.cols === 'number' ? { cols: params.cols } : {}),
        ...(typeof params.rows === 'number' ? { rows: params.rows } : {}),
        emit: (_channel, action) => {
          dispatch(uri, action);
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
            dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
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
      dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
      return null;
    },
    disposeTerminal: async (params) => {
      const uri = String(params.channel ?? '');
      const terminal = terminals.get(uri);
      if (!terminal)
        throw new RpcError(-32008, `No terminal at ${uri}`);
      terminal.close();
      terminals.delete(uri);
      log(`closed ${uri}`);
      dispatch(ROOT, { type: 'root/terminalsChanged', terminals: terminalInfo() });
      return null;
    },
  };
}
