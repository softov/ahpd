import { ROOT } from './channels.js';
import { localPath } from '../fileuri.js';
import { INTERNAL_ERROR, RpcError } from '../rpc.js';
import { CLOSING, need } from './common.js';
import { named } from './channels.js';
import type { Bag } from '../types/common.js';
import type { Claim, StartTerminals, TerminalStore } from '../types/terminals.js';
import type { Ran } from '../types/session.js';
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
  /** One command, in a terminal of its own, and what it did. */
  commanded(command: string, cwd: string, claim: Claim): Promise<Ran>;
  /** Every terminal, as the root channel lists them. */
  terminalInfo(): OnWire<TerminalInfo>[];
  /** The terminal factory a backend is handed on `Start`. */
  heldTerminals(shells: TerminalStore, sessionUri: string, chatUri: string): StartTerminals;
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

export function createTerminals(ctx: HostContext): Terminals {
  const { options, terminals, dispatch, log, fire, dirOfFile, refreshWatched } = ctx;

  /**
   * One command, in a terminal of its own, and what it did.
   *
   * The composer's `!` shorthand runs here rather than in the session,
   * because the shell is the host's: a backend has no port to spawn one
   * through, and the terminal has to be a real channel so the client can
   * watch the output arrive instead of waiting for the whole of it.
   *
   * The terminal is kept after the command exits. It is what the finished
   * tool call points at, and disposing it would leave a transcript naming a
   * channel that answers nothing - so it stays, exited, until the session
   * that ran it goes.
   */
  const commanded = async (command: string, cwd: string, claim: Claim): Promise<Ran> => {
    const shells = options.terminals;
    if (!shells) return { success: false, said: 'There is no shell here to run it in', output: '' };
    if (ctx.closed) return { success: false, said: CLOSING, output: '' };
    const uri = `ahp-terminal:/${crypto.randomUUID()}`;
    return await new Promise<Ran>((resolve) => {
      const terminal = shells.create({
        uri,
        cwd,
        claim,
        command,
        name: 'Terminal',
        // No shell named, so `shellOf` takes the daemon's own: `$SHELL`, then
        // `/bin/sh`. `defaultShell` is a connection's preference and this runs
        // through a session, which has no connection - and a person's shell
        // must not be what a turn runs, because that is the escalation the
        // review found.
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
          const printed = terminal.state().content
            .map((part) => ('value' in part && typeof part.value === 'string' ? part.value : ''))
            .join('');
          resolve({
            success: code === 0,
            said: code === 0 ? 'Ran the command' : `The command exited with code ${String(code)}`,
            output: printed,
            terminal: uri,
            code,
          });
        },
      });
      terminals.set(uri, terminal);
      log(`ran ${command} in ${uri}`);
      dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
    });
  };

  /** Every terminal, as the root channel lists them. */
  const terminalInfo = (): OnWire<TerminalInfo>[] =>
    [...terminals.values()].map((held) => ({
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
   */
  const heldTerminals = (shells: TerminalStore, sessionUri: string, chatUri: string): StartTerminals => ({
    open: (asked) => {
      if (ctx.closed) throw new Error(CLOSING);
      const uri = `ahp-terminal:/${crypto.randomUUID()}`;
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
        output: () => {
          /*
           * The protocol's own recipe for turning typed parts back into the
           * stream they came from: a command's output, or an unclassified
           * part's value.
           */
          const output = terminal.state().content
            .map((part) => (part.type === 'command' ? part.output : part.value))
            .join('');
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

  return { commanded, terminalInfo, heldTerminals };
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
      if (!claim) throw new RpcError(-32602, 'That is not a terminal claim');
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
      return {};
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
      return {};
    },
  };
}
