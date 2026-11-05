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

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { PROTOCOL_VERSION, client, methods, ndJsonStream } from '@agentclientprotocol/sdk';
import type {
  AuthenticateRequest,
  AuthenticateResponse,
  ClientCapabilities,
  ContentBlock,
  CreateElicitationRequest,
  CreateElicitationResponse,
  ForkSessionRequest,
  ForkSessionResponse,
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
  ResumeSessionRequest,
  ResumeSessionResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
} from '@agentclientprotocol/sdk';
import { bag, isRecord, sdkVersion, str } from '@ahpd/sdk';
import type { Account } from '@ahpd/sdk';
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
 * How long a server has to act on the SIGTERM before it is killed outright.
 *
 * A server that flushes what it wrote and unwinds its own work needs a moment;
 * one that took none of the SIGTERM must not hold the daemon's close open for
 * ever, which is what the SIGKILL is for.
 */
const KILL_GRACE_MS = 5000;

/**
 * Windows, which has no process group to signal and no SIGTERM to send: a
 * negative pid there throws, and the server and what it started were never
 * stopped. Its tree is ended with `taskkill` instead.
 */
const windows = process.platform === 'win32';

/**
 * End what a server left running on Windows, once it has exited.
 *
 * A server that exits when its stdin closes leaves what it started running:
 * there is no group, and `taskkill /T` follows a living parent. Windows keeps a
 * process's parent id after the parent has gone, so the server's descendants
 * are found by it afterwards, kept to those started since the server was, so a
 * pid the system has since handed to another program is never one of them.
 * One read of the process list, and only after the server is gone.
 */
const endLeftovers = (root: number, since: number): void => {
  execFile(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds())" }'],
    { windowsHide: true, timeout: 10_000 },
    (error, out) => {
      // A list that could not be read leaves nothing to end, as before.
      if (error !== null) return;
      const all: { pid: number; parent: number; started: number }[] = [];
      for (const line of out.split(/\r?\n/)) {
        const [pid, parent, started] = line.trim().split(' ').map(Number);
        if (pid !== undefined && parent !== undefined && started !== undefined && !Number.isNaN(started)) {
          all.push({ pid, parent, started });
        }
      }
      const left: number[] = [];
      const next = [root];
      while (next.length > 0) {
        const parent = next.pop() as number;
        for (const one of all) {
          if (one.parent === parent && one.started >= since && one.pid !== root && !left.includes(one.pid)) {
            left.push(one.pid);
            next.push(one.pid);
          }
        }
      }
      for (const pid of left) {
        execFile('taskkill', ['/pid', String(pid), '/F'], { windowsHide: true }, () => {});
      }
    },
  );
};

/**
 * Where a server says it reports its sign-in at all.
 *
 * ACP reserves `_meta` for extensions of its own, and this key is
 * `@agentclientprotocol/codex-acp`'s: the empty object under it is a presence
 * flag rather than a shape, so all it says is that the server reports its
 * sign-in at all.
 */
const AUTH_STATUS = 'authStatus';

/** The notification a server that advertises `authStatus` reports its sign-in with. */
const AUTH_STATUS_UPDATE = '_auth/status_update';

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

/**
 * What a server's `authStatus` says about the account, as the host publishes it.
 *
 * The kinds and the fields they carry are `@agentclientprotocol/codex-acp`'s:
 * an `account` names the email and the plan of the sign-in it is, and the other
 * three are sign-ins that are not an account of the operator's - a key, a
 * gateway, and a provider's own identity, which is what Bedrock and an agent's
 * own name are. None of those is a sign-out, so each is `unavailable` rather
 * than `signedOut`, and none of them names an email.
 *
 * A kind this bridge does not know is left unanswered rather than read as one
 * of the others: each state is a claim about who is billed, and a guess at one
 * is worse than saying nothing.
 */
const accountOf = (status: unknown, at: number): Account | undefined => {
  if (!isRecord(status)) return undefined;
  const kind = str(status.kind);
  if (kind === 'none') return { status: 'signedOut', observedAt: at };
  if (kind === 'api_key' || kind === 'gateway' || kind === 'external') return { status: 'unavailable', observedAt: at };
  if (kind !== 'account') return undefined;
  // The nested object is left out entirely by a server that names neither, so
  // an account with no email is a sign-in this host can only say it has.
  const held = isRecord(status.account) ? status.account : {};
  const email = str(held.email);
  const plan = str(held.plan);
  return {
    status: 'signedIn',
    ...(email === undefined ? {} : { email }),
    ...(plan === undefined ? {} : { planType: plan }),
    observedAt: at,
  };
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
  // A second early, as a process's own start time is read back to the
  // millisecond and the two clocks need not agree on the last one.
  const spawnedAt = Date.now() - 1000;
  const child = spawn(options.command, options.args ?? [], {
    env: { ...process.env, ...options.env },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    /*
     * A group of its own, led by the server.
     *
     * Detached is what makes the close reach what the server started rather
     * than the one process: everything it spawns inherits this group, and a
     * signal to the group reaches all of it. It also keeps a signal meant for
     * this server off the daemon's own group. On Windows `detached` is a
     * console of its own instead, so it is left off, as a terminal leaves it.
     */
    ...(windows ? {} : { detached: true }),
    // A daemon on Windows has no console, and a console program it starts
    // opens a window of its own without this.
    windowsHide: true,
  });
  /*
   * Drained rather than inherited: a server that chatters on stderr must not
   * block on a full pipe, and it must not write into the daemon's own output.
   * Each line goes to the log as it arrives, as VS Code's agents log a
   * runtime's stderr, so a server that dies says why where the operator reads.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L2716
   */
  let partial = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    const lines = `${partial}${chunk}`.split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) if (line.trim() !== '') options.log?.(`${options.command} stderr: ${line}`);
  });
  child.stderr.on('end', () => {
    if (partial.trim() !== '') options.log?.(`${options.command} stderr: ${partial}`);
    partial = '';
  });

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
    waitForTerminalExit, killTerminal, releaseTerminal, elicitation, elicitationComplete, account,
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
    // Both shapes are told, because this bridge draws a form as a question and
    // a page as a link, which are two different things to answer.
    ...(elicitation !== undefined ? { elicitation: { form: {}, url: {} } } : {}),
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
  /*
   * The server's own question, and the server saying its page is done.
   *
   * The completion is a notification rather than a response, because a URL
   * elicitation is answered by whoever opened the page rather than by this
   * client: the server's own flow ends it, and this is how it says so.
   *
   * The request's own signal goes with the question, because a server that no
   * longer wants an answer says so with `$/cancel_request` and the SDK has
   * already read it: the signal is aborted, and the handler is what takes the
   * question off the chat before the server's own waiting ends.
   */
  if (elicitation !== undefined) {
    app.onRequest(methods.client.elicitation.create, (context): Promise<CreateElicitationResponse> => elicitation(context.params, context.signal));
  }
  if (elicitationComplete !== undefined) {
    app.onNotification(methods.client.elicitation.complete, (context) => elicitationComplete(context.params));
  }
  if (readTextFile !== undefined) app.onRequest(methods.client.fs.readTextFile, (context) => readTextFile(context.params));
  if (writeTextFile !== undefined) app.onRequest(methods.client.fs.writeTextFile, (context) => writeTextFile(context.params));
  if (createTerminal !== undefined) app.onRequest(methods.client.terminal.create, (context) => createTerminal(context.params));
  if (terminalOutput !== undefined) app.onRequest(methods.client.terminal.output, (context) => terminalOutput(context.params));
  if (waitForTerminalExit !== undefined) app.onRequest(methods.client.terminal.waitForExit, (context) => waitForTerminalExit(context.params));
  if (killTerminal !== undefined) app.onRequest(methods.client.terminal.kill, (context) => killTerminal(context.params));
  if (releaseTerminal !== undefined) app.onRequest(methods.client.terminal.release, (context) => releaseTerminal(context.params));

  /*
   * The account the server is signed in as, which a harness that signs in out
   * of band states with a notification of its own.
   *
   * `authStatus` in the handshake is what a server says it will do this with,
   * and that reply is read after this registration - so a status that arrived
   * first is kept and handed over once the handshake has said the server means
   * it, rather than an account being dropped for the order it arrived in.
   */
  let held: Account | undefined;
  /** Whether the handshake advertised that this server reports its sign-in. */
  let announces = false;
  const handOver = (): void => {
    if (announces && held !== undefined) account?.(held);
  };
  if (account !== undefined) {
    app.onNotification<{ authStatus?: unknown }>(
      AUTH_STATUS_UPDATE,
      (params) => bag(params) as { authStatus?: unknown },
      (context) => {
        const read = accountOf(bag(context.params).authStatus, Date.now());
        if (read === undefined) return;
        held = read;
        handOver();
      },
    );
  }

  const connection = app.connect(stream);

  /**
   * The server's `initialize` answer, kept so it is asked for once.
   *
   * A server is told what a client can do at the start of a connection and
   * never again, so `initialize` answers the held reply on a second call
   * rather than negotiating twice.
   */
  let initializeResponse: InitializeResponse | undefined;

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
   * A signal to the server's whole group, which is the server and everything it
   * started.
   *
   * The negative pid is the group the server leads, because it was spawned
   * detached. A group that has already gone is not a failure to report: the
   * point of the signal was that the process is over.
   *
   * On Windows the closed stdin is the only polite ask, so a SIGTERM sends
   * nothing more, and a SIGKILL ends the server's tree with `taskkill`: `/T`
   * for what it started, `/F` because a process with no window ignores a
   * request to close.
   */
  const signal = (how: NodeJS.Signals): void => {
    if (child.pid === undefined) return;
    if (windows) {
      if (how === 'SIGKILL') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
      }
      return;
    }
    try {
      process.kill(-child.pid, how);
    }
    catch {
      // Nothing left to signal.
    }
  };

  return {
    initialize: (): Promise<InitializeResponse> => {
      if (initializeResponse !== undefined) return Promise.resolve(initializeResponse);
      const greeting: InitializeRequest = {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities,
        clientInfo: CLIENT_INFO,
      };
      return heard(() => connection.agent.request(methods.agent.initialize, greeting)).then((reply) => {
        initializeResponse = reply;
        const says = reply.agentCapabilities?._meta?.[AUTH_STATUS];
        announces = says !== undefined && says !== null;
        handOver();
        return reply;
      });
    },
    authenticate: (request: AuthenticateRequest): Promise<AuthenticateResponse> =>
      heard(() => connection.agent.request(methods.agent.authenticate, request)),
    newSession: (request: NewSessionRequest): Promise<NewSessionResponse> =>
      heard(() => connection.agent.request(methods.agent.session.new, request)),
    loadSession: (request: LoadSessionRequest): Promise<LoadSessionResponse> =>
      heard(() => connection.agent.request(methods.agent.session.load, request)),
    resumeSession: (request: ResumeSessionRequest): Promise<ResumeSessionResponse> =>
      heard(() => connection.agent.request(methods.agent.session.resume, request)),
    /*
     * `session/fork`, which the SDK calls unstable.
     *
     * Sent through the SDK's own method rather than as a name, because the
     * request and the answer are typed and a fork's whole point is the id that
     * comes back. A server that never advertised the capability is never asked
     * - the session decides - so what is unstable here is only ever reached on
     * a server that has opted into it.
     */
    forkSession: (request: ForkSessionRequest): Promise<ForkSessionResponse> =>
      heard(() => connection.agent.request(methods.agent.session.fork, request)),
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
    deleteSession: (sessionId: string): Promise<void> =>
      heard(() => connection.agent.request(methods.agent.session.delete, { sessionId })).then(() => {}),
    ended,
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
      // In the background: the close is over once the server is, and what it
      // left is ended a moment later.
      if (windows && child.pid !== undefined) endLeftovers(child.pid, spawnedAt);
    },
  };
}
