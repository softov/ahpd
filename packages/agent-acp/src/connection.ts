/**
 * The ACP connection: one command spawned, and one client over its stdio.
 *
 * `@agentclientprotocol/sdk` owns the JSON-RPC framing, the request ids and
 * the notification routing, so all this file does is spawn the program, hand
 * the SDK its two byte streams, and name the calls a session makes on a
 * connection. The `Client` handler is the server's way in: every
 * `session/update` it sends arrives at `sessionUpdate`, and every permission
 * it asks for arrives at `requestPermission`.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk';
import type {
  Client,
  ClientCapabilities,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
} from '@agentclientprotocol/sdk';
import type { AcpConnection, AcpConnectionOptions } from './types.js';

/**
 * What this bridge answers a permission request with when nobody can be asked.
 *
 * `cancelled` is the protocol's refusal, and refusing is the honest answer: a
 * client that allowed a tool silently would be a client deciding policy.
 */
const REFUSED: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } };

/** The version this bridge reports; it names the AHP package rather than a harness. */
const CLIENT_INFO = { name: 'ahpd', version: '0.0.1' };

/**
 * How long a call that failed because the stream closed waits to hear why.
 *
 * The child's stdout can end a moment before its `exit` arrives, and the exit
 * code is the sentence a person needs; a server that closed its stdout and
 * kept running is never heard, so the wait is bounded.
 */
const EXIT_GRACE_MS = 1000;

/** The sentence for a server that could not be started at all. */
const unstarted = (command: string, cwd: string | undefined, error: NodeJS.ErrnoException): Error => {
  if (error.code === 'ENOENT' && cwd !== undefined && !existsSync(cwd)) {
    return new Error(`${command} could not be started in ${cwd}, which does not exist`);
  }
  if (error.code === 'ENOENT') {
    return new Error(`${command} was not found; install it, or put its directory on the PATH the daemon runs with`);
  }
  return new Error(`${command} could not be started: ${error.message}`);
};

/** The sentence for a server that exited, by its code or the signal that ended it. */
const exited = (command: string, code: number | null, signal: NodeJS.Signals | null): Error =>
  new Error(code !== null ? `${command} exited with code ${code}` : `${command} exited on ${signal ?? 'an unknown signal'}`);

/**
 * Spawn one ACP server and speak the protocol to it.
 *
 * The environment is the daemon's with the package's own over the top, the way
 * a subprocess is given its parent's: a server finds its own `PATH` and its
 * own credentials unless something named one, which is the whole reason a
 * token does not have to be repeated in a configuration.
 */
export function connectAcp(options: AcpConnectionOptions): AcpConnection {
  const child = spawn(options.command, options.args ?? [], {
    env: { ...process.env, ...options.env },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  // Drained rather than inherited: a server that chatters on stderr must not
  // block on a full pipe, and it must not write into the daemon's own output.
  child.stderr.resume();

  /** Why the server is gone, once it is; undefined while it runs. */
  let death: Error | undefined;
  let heardDeath: (why: Error) => void = () => {};
  const ended = new Promise<Error>((resolve) => { heardDeath = resolve; });
  const die = (why: Error): void => {
    if (death !== undefined) return;
    death = why;
    heardDeath(why);
  };
  /*
   * An `error` with no pid is a program that never started. One after a start
   * is a failed kill or write, which the exit that follows reports; it is
   * listened for either way, because an unheard `error` ends the daemon.
   */
  child.on('error', (error: NodeJS.ErrnoException) => {
    if (child.pid === undefined) die(unstarted(options.command, options.cwd, error));
  });
  child.on('exit', (code, signal) => { die(exited(options.command, code, signal)); });

  const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));

  const handlers = options.handlers;
  const {
    readTextFile, writeTextFile, createTerminal, terminalOutput,
    waitForTerminalExit, killTerminal, releaseTerminal,
  } = handlers;

  /*
   * The handshake says what this client can answer, and only that.
   *
   * A capability advertised without an implementation is a server request
   * nobody answers, and one left unadvertised is a request a conformant server
   * never makes - so both are derived from the same handlers rather than
   * written twice.
   */
  const clientCapabilities: ClientCapabilities = {
    ...(readTextFile !== undefined || writeTextFile !== undefined
      ? {
          fs: {
            ...(readTextFile !== undefined ? { readTextFile: true } : {}),
            ...(writeTextFile !== undefined ? { writeTextFile: true } : {}),
          },
        }
      : {}),
    ...(createTerminal !== undefined ? { terminal: true } : {}),
  };

  const client: Client = {
    /*
     * One update, routed by the session id the server named.
     *
     * A connection is opened per AHP session, so there is one conversation
     * here; the id is still passed through, because a server is free to send
     * an update for a session this bridge did not open and dropping it is
     * better than writing it into the wrong turn.
     */
    sessionUpdate: (params: SessionNotification): void => {
      handlers.update(params.sessionId, params.update);
    },
    /*
     * A person's answer, or the protocol's refusal.
     *
     * The optional members below are the same shape: present only when the
     * session has something to answer with, which is also what the handshake
     * advertised.
     */
    requestPermission: async (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
      const answer = await handlers.permission?.(params);
      if (answer === undefined || answer === 'cancelled') return REFUSED;
      return { outcome: { outcome: 'selected', optionId: answer.optionId } };
    },
    ...(readTextFile !== undefined ? { readTextFile } : {}),
    ...(writeTextFile !== undefined ? { writeTextFile } : {}),
    ...(createTerminal !== undefined ? { createTerminal } : {}),
    ...(terminalOutput !== undefined ? { terminalOutput } : {}),
    ...(waitForTerminalExit !== undefined ? { waitForTerminalExit } : {}),
    ...(killTerminal !== undefined ? { killTerminal } : {}),
    ...(releaseTerminal !== undefined ? { releaseTerminal } : {}),
  };

  const connection = new ClientSideConnection((_agent) => client, stream);

  /**
   * The handshake's reply, kept so it is asked for once.
   *
   * A server is told what a client can do at the start of a connection and
   * never again, so `initialize` answers the held reply on a second call
   * rather than negotiating twice.
   */
  let handshake: InitializeResponse | undefined;

  /**
   * One call, failed with the server's death rather than the SDK's closed stream.
   *
   * A call made after the server is gone fails at once, and one in flight fails
   * when it goes even if the stream is still held open by something the server
   * started.
   */
  const heard = <T>(call: () => Promise<T>): Promise<T> => {
    if (death !== undefined) return Promise.reject(death);
    const answered = call().catch(async (why: unknown) => {
      if (death === undefined && connection.signal.aborted) {
        await Promise.race([ended, new Promise((resolve) => { setTimeout(resolve, EXIT_GRACE_MS).unref(); })]);
      }
      throw death ?? why;
    });
    return Promise.race([answered, ended.then((why): never => { throw why; })]);
  };

  return {
    initialize: (): Promise<InitializeResponse> => {
      if (handshake !== undefined) return Promise.resolve(handshake);
      return heard(() => connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities,
        clientInfo: CLIENT_INFO,
      })).then((reply) => {
        handshake = reply;
        return reply;
      });
    },
    newSession: (request: NewSessionRequest): Promise<NewSessionResponse> => heard(() => connection.newSession(request)),
    loadSession: (request: LoadSessionRequest): Promise<LoadSessionResponse> => heard(() => connection.loadSession(request)),
    listSessions: (request: ListSessionsRequest): Promise<ListSessionsResponse> =>
      heard(() => connection.listSessions(request)),
    setSessionMode: (request: SetSessionModeRequest): Promise<SetSessionModeResponse> =>
      heard(() => connection.setSessionMode(request)),
    setSessionConfigOption: (request: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse> =>
      heard(() => connection.setSessionConfigOption(request)),
    prompt: (sessionId: string, text: string): Promise<PromptResponse> => heard(() => connection.prompt({
      sessionId,
      prompt: [{ type: 'text', text }],
    })),
    cancel: (sessionId: string): Promise<void> => heard(() => connection.cancel({ sessionId })),
    ended,
    close: async (): Promise<void> => {
      // The stdin end is what a well-behaved server reads as a shutdown; the
      // kill is for one that does not.
      child.stdin.end();
      child.kill();
      await ended;
    },
  };
}
