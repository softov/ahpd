/**
 * The ACP connection: one command spawned, and one client over its stdio.
 *
 * `@agentclientprotocol/sdk` owns the JSON-RPC framing, the request ids and
 * the notification routing, so all this file does is spawn the program, hand
 * the SDK its two byte streams, and name the calls a session makes on a
 * connection. The client app is the server's way in: every `session/update` it
 * sends arrives at the handler registered for it, and every permission it asks
 * for arrives at the one for that.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { PROTOCOL_VERSION, client, methods, ndJsonStream } from '@agentclientprotocol/sdk';
import type {
  AuthenticateRequest,
  AuthenticateResponse,
  ClientCapabilities,
  ContentBlock,
  InitializeRequest,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptResponse,
  RequestPermissionResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
} from '@agentclientprotocol/sdk';
import { sdkVersion } from '@ahpd/sdk';
import type { AcpConnection, AcpConnectionOptions } from './types.js';

/**
 * What this bridge answers a permission request with when nobody can be asked.
 *
 * `cancelled` is the protocol's refusal, and refusing is the honest answer: a
 * client that allowed a tool silently would be a client deciding policy.
 */
const REFUSED: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } };

/**
 * What this bridge reports in the handshake; it names the AHP package rather
 * than a harness.
 *
 * The version is read from the manifest rather than written down here, because
 * a `clientInfo` that names a build this process is not is the one number in
 * the handshake nobody can act on.
 */
const CLIENT_INFO = { name: 'ahpd', version: sdkVersion() };

/**
 * How long a call that failed because the stream closed waits to hear why.
 *
 * The child's stdout can end a moment before its `exit` arrives, and the exit
 * code is the sentence a person needs; a server that closed its stdout and
 * kept running is never heard, so the wait is bounded.
 */
const EXIT_GRACE_MS = 1000;

/**
 * How much of the child's stderr is kept.
 *
 * Enough for the stack trace a server prints before it dies, and bounded so a
 * server that talks all day costs a fixed amount per session.
 */
const STDERR_BYTES = 8 * 1024;

/**
 * How long a server has to act on the SIGTERM before it is killed outright.
 *
 * A server that flushes what it wrote and unwinds its own work needs a moment;
 * one that took none of the SIGTERM must not hold the daemon's close open for
 * ever, which is what the SIGKILL is for.
 */
const KILL_GRACE_MS = 5000;

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
    /*
     * A group of its own, led by the server.
     *
     * Detached is what makes the close reach what the server started rather
     * than the one process: everything it spawns inherits this group, and a
     * signal to the group reaches all of it. It also keeps a signal meant for
     * this server off the daemon's own group.
     */
    detached: true,
  });
  // Drained rather than inherited: a server that chatters on stderr must not
  // block on a full pipe, and it must not write into the daemon's own output.
  // The last of it is kept, because a server that dies says why on stderr and
  // the exit code alone is rarely the sentence a person needs.
  let stderr = Buffer.alloc(0);
  /** Whether the ring has dropped bytes, and so may hold half a line. */
  let stderrCut = false;
  child.stderr.on('data', (chunk: Buffer) => {
    const held = Buffer.concat([stderr, chunk]);
    if (held.length <= STDERR_BYTES) {
      stderr = held;
      return;
    }
    stderr = held.subarray(held.length - STDERR_BYTES);
    stderrCut = true;
  });
  /** Settles when the server's stderr has been read to its end. */
  let readStderr: () => void = () => {};
  const drained = new Promise<void>((resolve) => { readStderr = resolve; });
  child.stderr.on('end', () => { readStderr(); });

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
    // A boolean option is set by the same request a select is, and the bridge
    // draws it as a control and sets it, so a server is free to offer one.
    session: { configOptions: { boolean: {} } },
  };

  /*
   * The client this bridge is, one registration per method a server may call.
   *
   * The same handlers the handshake advertises answer what it calls, so a
   * method this bridge has nothing for is one no server is told about - and a
   * server that calls it anyway gets the protocol's own "method not found"
   * rather than a request that never answers.
   */
  const app = client({ name: CLIENT_INFO.name });
  app.onNotification(methods.client.session.update, (context) => {
    /*
     * One update, routed by the session id the server named.
     *
     * A connection is opened per AHP session, so there is one conversation
     * here; the id is still passed through, because a server is free to send
     * an update for a session this bridge did not open and dropping it is
     * better than writing it into the wrong turn.
     */
    handlers.update(context.params.sessionId, context.params.update);
  });
  /*
   * A person's answer, or the protocol's refusal.
   */
  app.onRequest(methods.client.session.requestPermission, async (context): Promise<RequestPermissionResponse> => {
    const answer = await handlers.permission?.(context.params);
    if (answer === undefined || answer === 'cancelled') return REFUSED;
    return { outcome: { outcome: 'selected', optionId: answer.optionId } };
  });
  if (readTextFile !== undefined) app.onRequest(methods.client.fs.readTextFile, (context) => readTextFile(context.params));
  if (writeTextFile !== undefined) app.onRequest(methods.client.fs.writeTextFile, (context) => writeTextFile(context.params));
  if (createTerminal !== undefined) app.onRequest(methods.client.terminal.create, (context) => createTerminal(context.params));
  if (terminalOutput !== undefined) app.onRequest(methods.client.terminal.output, (context) => terminalOutput(context.params));
  if (waitForTerminalExit !== undefined) app.onRequest(methods.client.terminal.waitForExit, (context) => waitForTerminalExit(context.params));
  if (killTerminal !== undefined) app.onRequest(methods.client.terminal.kill, (context) => killTerminal(context.params));
  if (releaseTerminal !== undefined) app.onRequest(methods.client.terminal.release, (context) => releaseTerminal(context.params));

  const connection = app.connect(stream);

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

  /**
   * What the server wrote on stderr, for a failure to say out loud.
   *
   * A dead server's exit can be heard before its last words have been read off
   * the pipe, so the tail waits for the stream to end - bounded, because a
   * grandchild that inherited the pipe keeps it open long after the server that
   * spawned it is gone. A ring that has dropped bytes may have kept the middle
   * of a line, so that line goes rather than being shown as half a frame; a
   * ring that has dropped nothing keeps every byte it was given.
   */
  const stderrTail = async (): Promise<string> => {
    if (death !== undefined) {
      await Promise.race([
        drained,
        new Promise((resolve) => { setTimeout(resolve, EXIT_GRACE_MS).unref(); }),
      ]);
    }
    const held = stderr.toString('utf8');
    return (stderrCut ? held.slice(held.indexOf('\n') + 1) : held).trim();
  };

  /**
   * A signal to the server's whole group, which is the server and everything it
   * started.
   *
   * The negative pid is the group the server leads, because it was spawned
   * detached. A group that has already gone is not a failure to report: the
   * point of the signal was that the process is over.
   */
  const signal = (how: NodeJS.Signals): void => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, how);
    }
    catch {
      // Nothing left to signal.
    }
  };

  return {
    initialize: (): Promise<InitializeResponse> => {
      if (handshake !== undefined) return Promise.resolve(handshake);
      const greeting: InitializeRequest = {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities,
        clientInfo: CLIENT_INFO,
      };
      return heard(() => connection.agent.request(methods.agent.initialize, greeting)).then((reply) => {
        handshake = reply;
        return reply;
      });
    },
    authenticate: (request: AuthenticateRequest): Promise<AuthenticateResponse> =>
      heard(() => connection.agent.request(methods.agent.authenticate, request)),
    newSession: (request: NewSessionRequest): Promise<NewSessionResponse> =>
      heard(() => connection.agent.request(methods.agent.session.new, request)),
    loadSession: (request: LoadSessionRequest): Promise<LoadSessionResponse> =>
      heard(() => connection.agent.request(methods.agent.session.load, request)),
    listSessions: (request: ListSessionsRequest): Promise<ListSessionsResponse> =>
      heard(() => connection.agent.request(methods.agent.session.list, request)),
    setSessionMode: (request: SetSessionModeRequest): Promise<SetSessionModeResponse> =>
      heard(() => connection.agent.request(methods.agent.session.setMode, request)),
    setSessionConfigOption: (request: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse> =>
      heard(() => connection.agent.request(methods.agent.session.setConfigOption, request)),
    /*
     * `session/set_model`, which the SDK's agent no longer names.
     *
     * Sent as a method named rather than as a typed call, because that is all
     * the connection is left with, and a server that takes it is a server from
     * before the config options - which is the only kind this is asked of.
     */
    setModel: (request): Promise<unknown> => heard(() => connection.agent.request('session/set_model', request)),
    prompt: (sessionId: string, prompt: ContentBlock[]): Promise<PromptResponse> => heard(() => connection.agent.request(methods.agent.session.prompt, {
      sessionId,
      prompt,
    })),
    cancel: (sessionId: string): Promise<void> =>
      heard(() => connection.agent.notify(methods.agent.session.cancel, { sessionId })),
    closeSession: (sessionId: string): Promise<void> =>
      heard(() => connection.agent.request(methods.agent.session.close, { sessionId })).then(() => {}),
    ended,
    stderrTail,
    close: async (): Promise<void> => {
      // The stdin end is what a well-behaved server reads as a shutdown; the
      // kill is for one that does not, and it goes to the whole group so what
      // the server started goes with it.
      child.stdin.end();
      signal('SIGTERM');
      // Armed only while the server is still there, and disarmed by the wait
      // below settling: a server that took the SIGTERM is not SIGKILLed after
      // a process id that has since been reused.
      const kill = setTimeout(() => {
        if (death === undefined) signal('SIGKILL');
      }, KILL_GRACE_MS);
      kill.unref();
      try {
        await ended;
      }
      finally {
        clearTimeout(kill);
      }
    },
  };
}
