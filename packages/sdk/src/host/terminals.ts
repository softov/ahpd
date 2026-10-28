import { ROOT, named, retainedTerminalOf, retainedTerminalUri } from './channels.js';
import { localPath } from '../resources/fileuri.js';
import { INTERNAL_ERROR, INVALID_PARAMS, RpcError } from '../rpc.js';
import { CLOSING, need } from './common.js';
import { textOf } from './outputs.js';
import type { Bag } from '../types/common.js';
import type { Claim, OutputTerminal, OutputTerminals, StartTerminals, Terminal, TerminalStore } from '../types/terminals.js';
import type { CommandTerminal, Ran } from '../types/session.js';
import type { OnWire } from '../types/wire.js';
import type { TerminalInfo } from '@microsoft/agent-host-protocol';
import type { ConnectionContext, HostContext } from './context.js';

/**
 * The host's own terminals.
 *
 * The store this host keeps, what the root channel lists from it, the `!`
 * command a turn may run, and the factory a backend is handed on `Start` so it
 * can open one itself.
 */
export interface Terminals {
  /** One command, in a terminal of its own, and what it did; `opened` hears the terminal as it opens. */
  commanded(command: string, cwd: string, claim: Claim, opened?: (terminal: CommandTerminal) => void): Promise<Ran>;
  /** Every terminal, as the root channel lists them. */
  terminalInfo(): OnWire<TerminalInfo>[];
  /** The terminal factory a backend is handed on `Start`. */
  heldTerminals(shells: TerminalStore, sessionUri: string, chatUri: string): StartTerminals;
  /** The output terminals a backend may open, handed on `Start`. */
  heldOutputs(sessionUri: string): OutputTerminals;
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
  const { options, terminals, dispatch, log, fire, dirOfFile, refreshWatched } = ctx;

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
   * to, which is when the call names it.
   */
  const commanded = async (
    command: string,
    cwd: string,
    claim: Claim,
    opened?: (terminal: CommandTerminal) => void,
  ): Promise<Ran> => {
    const shells = options.terminals;
    if (!shells) return { success: false, said: 'There is no shell here to run it in', output: '' };
    if (ctx.closed) return { success: false, said: CLOSING, output: '' };
    // The call this command answers, which every `!` command's claim names.
    const call = claim.kind === 'session' && claim.toolCallId !== undefined
      ? { session: claim.session, chat: claim.chat, key: claim.toolCallId }
      : undefined;
    const uri = call === undefined ? `ahp-terminal:/${crypto.randomUUID()}` : retainedTerminalUri(call.chat, call.key);
    return await new Promise<Ran>((resolve) => {
      const terminal = shells.create({
        uri,
        cwd,
        claim,
        command,
        name: 'Terminal',
        // No shell named, so `shellOf` takes the daemon's own: `$SHELL`, then
        // `/bin/sh`, or the first PowerShell found on Windows. `defaultShell`
        // is a connection's preference and this runs through a session, which
        // has no connection - and a person's shell must not be what a turn
        // runs, because that is the escalation the review found.
        emit: (_channel, action) => {
          dispatch(uri, action);
          if ((action as Bag).type !== 'terminal/exited') return;
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
          resolve({
            success: code === 0,
            said: code === 0 ? 'Ran the command' : `The command exited with code ${String(code)}`,
            output: printed,
            terminal: uri,
            ...ptyOf(terminal),
            code,
          });
        },
      });
      terminals.set(uri, terminal);
      log(`ran ${command} in ${uri}`);
      dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
      opened?.({ uri, ...ptyOf(terminal) });
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
      const terminal = shells.create({
        uri,
        cwd: asked.cwd,
        claim: { kind: 'session', session: sessionUri, chat: chatUri },
        command: asked.command,
        ...(asked.args !== undefined ? { args: asked.args } : {}),
        ...(asked.env !== undefined ? { env: asked.env } : {}),
        ...(asked.name !== undefined ? { name: asked.name } : {}),
        /*
         * No shell named, so the daemon's own is used.
         *
         * A backend opening a terminal has a session and no connection, and an
         * automation fires with nobody connected at all - so there is no person
         * here whose preference this could be. Answered deliberately (the user,
         * 2026-09-23): the host's default only, never somebody's. It costs an
         * agent's terminal the shell you chose in your client, and it closes by
         * construction the path where writing a file and naming it in
         * `defaultShell` made the next tool call run it.
         */
        emit: (_channel, action) => {
          dispatch(uri, action);
          // The root list says whether a terminal is still running, so it is
          // stale the moment one exits and reaches nobody unless it moves.
          if ((action as Bag).type === 'terminal/exited') {
            ctx.keepExited(chatUri, key, sessionUri, terminal.state(), terminal.exitCode());
            dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
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
        resize: (cols, rows) => { terminal.resize(cols, rows); },
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
          cols: 80,
          rows: 24,
          // One part: there are no command boundaries to divide an output
          // somebody else already ended.
          content: content === '' ? [] : [{ type: 'unclassified', value: content }],
          claim,
          supportsCommandDetection: false,
          isPty: false,
          lifecycle: done
            ? { status: 'exited' as const, ...(exitCode === undefined ? {} : { exitCode }) }
            : { status: 'running' as const },
          ...(exitCode === undefined ? {} : { exitCode }),
        }),
        // A client typing into an output is not a client typing into a
        // process: there is nothing on the other end to receive it.
        write: () => {},
        resize: () => {},
        clear: () => {
          content = '';
          dispatch(uri, { type: 'terminal/cleared' });
        },
        setTitle: (next) => {
          if (title === next) return;
          title = next;
          dispatch(uri, { type: 'terminal/titleChanged', title });
        },
        setClaim: (next) => {
          claim = next;
          dispatch(uri, { type: 'terminal/claimed', claim });
        },
        close: () => {
          finish();
          outputs.delete(uri);
        },
        waitForExit: () => gone,
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

  return { commanded, terminalInfo, heldTerminals, heldOutputs };
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
        // This connection's own shell, if it pushed one. Per connection
        // rather than per host: two people on one daemon each get theirs,
        // and neither can name the binary the other's terminal opens.
        ...(typeof connection.config?.defaultShell === 'string'
          ? { shell: connection.config.defaultShell }
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
