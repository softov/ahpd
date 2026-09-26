/**
 * A session that runs in a host started inside a computer.
 *
 * A backend whose loop, tools and shell all run in this process cannot be
 * moved into a machine, and the host still owns the session a client sees. So
 * a whole `ahpd` with that backend loaded is started inside the machine, in
 * stdio mode, and this is the outer session that carries it: it speaks AHP to
 * the host inside with `AhpClient`, forwards the client's turns and answers,
 * and emits what the inner host says as the outer session's own actions -
 * decisions `a-cofold-session-in-a-computer-runs-in-a-nested-host` and
 * `a-session-reaches-a-nested-host-through-a-generic-proxy`.
 *
 * Two things make it a proxy rather than a second host: the inner turn ids are
 * the outer ones, so a client's optimistic write matches what comes back, and
 * the inner host's protocol version has to be this one's, because its actions
 * are re-emitted unchanged.
 *
 * A failure is a sentence and never a hang. The process may be missing, may
 * exit before it answers, may speak another protocol version or refuse the
 * session, and each of those ends the outer session with the last lines of
 * whatever it wrote to stderr.
 */

import { spawn as startProcess } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { AhpClient } from '@microsoft/agent-host-protocol/client';
import type { AhpTransport, Subscription, TransportFrame } from '@microsoft/agent-host-protocol/client';
import { chatReducer, PROTOCOL_VERSION, sessionReducer, SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import type { ChatAction, ChatState, SessionAction, SessionState, StateAction } from '@microsoft/agent-host-protocol';
import { ANSWER_TIMEOUT } from './rpc.js';
import { computerId } from './computers.js';
import type { Agent, Start } from './types/agent.js';
import type { Bag } from './types/common.js';
import type { ComputerPort } from './types/computers.js';
import type { Chosen, MessageFrom, Session } from './types/session.js';

/** How many of the inner host's own lines are kept for a failure's sentence. */
const TAIL = 12;

/**
 * The inner host's two streams and its end.
 *
 * Narrower than a child process on purpose: what the proxy needs is a line in
 * and a line out, and a test hands it a pair of in-memory streams instead of a
 * process. `start` is the only place that knows which it is.
 */
export type NestedHost = Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr' | 'on' | 'kill'>;

/** What the proxy asks for a host inside a machine. */
export interface NestedAsked {
  /** The machine's id, from the session's `computer://` setting. */
  id: string;
  /** The plugin specs the inner host loads. */
  plugins: string[];
  /** Where inside the machine it starts, when the session named a folder. */
  cwd?: string;
  /** The session's port, which is where the default `start` asks. */
  computers?: ComputerPort;
}

/** How one session of this backend runs nested. */
export interface NestedOptions {
  /**
   * The plugins the host inside loads.
   *
   * Default `@ahpd/agent-<provider>`, which is the package this repository
   * publishes every backend under: the inner host has to be able to serve the
   * provider this session names, and that package is what does.
   */
  plugins?: string[];
  /** How long a question to the inner host waits. Default `ANSWER_TIMEOUT`. */
  timeoutMs?: number;
  /**
   * Start the inner host, for a caller that is not this host's `computers`
   * port. A test hands in in-memory streams; the default asks the port for a
   * spawn and runs it here.
   */
  start?: (asked: NestedAsked) => NestedHost | Promise<NestedHost>;
  /** One line worth keeping. Nothing is logged without one. */
  log?: (line: string) => void;
}

/**
 * The agent the host runs a nested session through.
 *
 * Given the real backend, everything a client asks about before a session
 * exists is still that backend's - the provider, the schema, the defaults,
 * what it declared a machine needs - and only `create` is replaced: a session
 * that names a computer is the proxy, and one that does not is a plain session
 * on this host.
 *
 * A provider string is accepted too, for a caller that only wants the seam;
 * it answers an empty schema and no defaults.
 */
export const nestedAgent = (provider: Agent | string, options: NestedOptions = {}): Agent => {
  const real: Agent | undefined = typeof provider === 'string' ? undefined : provider;
  const name = typeof provider === 'string' ? provider : provider.provider;
  const plugins = options.plugins ?? [`@ahpd/agent-${name}`];
  const create = (start: Start): Session => nestedSession(name, plugins, start, options);
  return real === undefined
    ? ({ provider: name, displayName: name, schema: () => ({ properties: {} }), defaults: () => ({}), create })
    : { ...real, create };
};

/** The config the inner session is created with: everything but the machine. */
const innerConfig = (settings: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'computer'));

/**
 * The command the default `start` runs: the port's spawn, on this host.
 *
 * The descriptor is the port's; this owns the process and its stdio, which is
 * the same division every backend that spawns through the port keeps.
 */
const startInside = async (asked: NestedAsked): Promise<NestedHost> => {
  if (asked.computers?.nested === undefined) {
    throw new Error(`This host has no computer plugin that can start a host inside computer://${asked.id}`);
  }
  const spawn = await asked.computers.nested(asked.id, {
    plugins: asked.plugins,
    ...(asked.cwd === undefined ? {} : { cwd: asked.cwd }),
  });
  if (spawn === undefined) throw new Error(`There is no computer called computer://${asked.id}`);
  return startProcess(spawn.command, spawn.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(spawn.env === undefined ? {} : { env: { ...process.env, ...spawn.env } }),
    ...(spawn.cwd === undefined ? {} : { cwd: spawn.cwd }),
  }) as unknown as NestedHost;
};

/**
 * One JSON frame per line, in and out.
 *
 * The transport `AhpClient` reads: a line from the inner host becomes a frame,
 * a message becomes a line on its stdin, and the process ending is the clean
 * close `recv` answers `null` for.
 */
const stdioTransport = (
  host: NestedHost,
  onStderr: (line: string) => void,
  onEnd: (why: string) => void,
): AhpTransport => {
  const pending: (TransportFrame | null)[] = [];
  let waiter: ((frame: TransportFrame | null) => void) | undefined;
  let closed = false;
  const deliver = (frame: TransportFrame | null): void => {
    if (waiter !== undefined) {
      const held = waiter;
      waiter = undefined;
      held(frame);
      return;
    }
    pending.push(frame);
  };
  let out = '';
  host.stdout.on('data', (chunk: unknown) => {
    out += String(chunk);
    let at = out.indexOf('\n');
    while (at !== -1) {
      const line = out.slice(0, at).replace(/\r$/, '');
      out = out.slice(at + 1);
      if (line.trim() !== '') deliver({ kind: 'text', text: line });
      at = out.indexOf('\n');
    }
  });
  const lines = (chunk: unknown, each: (line: string) => void): void => {
    for (const line of String(chunk).split('\n')) {
      const said = line.replace(/\r$/, '').trim();
      if (said !== '') each(said);
    }
  };
  host.stderr.on('data', (chunk: unknown) => { lines(chunk, onStderr); });
  host.on('exit', (code: number | null) => {
    if (closed) return;
    closed = true;
    const why = code === null || code === 0 ? '' : `it exited with code ${String(code)}`;
    deliver(null);
    onEnd(why);
  });
  host.on('error', (error: Error) => {
    if (closed) return;
    closed = true;
    deliver(null);
    onEnd(error.message);
  });
  return {
    send: (message) => {
      const text = typeof message === 'string' ? message : JSON.stringify(message);
      host.stdin.write(`${text}\n`);
    },
    recv: () => {
      if (pending.length > 0) return Promise.resolve(pending.shift() ?? null);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => { waiter = resolve; });
    },
    close: () => {
      if (closed) return;
      closed = true;
      deliver(null);
      host.kill('SIGTERM');
    },
  };
};

/** The default chat URI a host gives a session, for a snapshot that named none. */
const defaultChatFor = (session: string): string =>
  `ahp-chat://default/${Buffer.from(session, 'utf8').toString('base64url')}`;

/**
 * One proxied session.
 *
 * Everything a client does is dispatched to the inner session and everything
 * the inner host says is emitted here, so the outer host and its clients treat
 * this exactly as a backend that ran locally. The startup is asynchronous - a
 * process, a handshake, a session - and every turn that arrives before it is
 * ready waits behind a gate rather than being dropped.
 */
const nestedSession = (
  provider: string,
  plugins: string[],
  start: Start,
  options: NestedOptions,
): Session => {
  const log = options.log ?? ((): void => { /* nothing is kept without one */ });
  const timeoutMs = options.timeoutMs ?? ANSWER_TIMEOUT;
  const said = start.settings?.computer;
  const id = computerId(said);
  if (id === undefined) {
    throw new Error(`${provider} runs nested only in a computer://<id>, and this session names ${typeof said === 'string' && said.trim() !== '' ? said : 'none'}`);
  }
  const startedAt = new Date().toISOString();
  const innerSession = `ahp-session:/${crypto.randomUUID()}`;
  let innerChat = defaultChatFor(innerSession);
  let client: AhpClient | undefined;
  let host: NestedHost | undefined;
  let session: SessionState | undefined;
  let chat: ChatState | undefined;
  let ready = false;
  let ended: string | undefined;
  let closed = false;
  let turn: string | undefined;
  /** What was asked for before the inner session existed, in order. */
  const waiting: (() => void)[] = [];
  /** The inner host's own last lines, for a failure's sentence. */
  const tail: string[] = [];
  const lastWords = (): string => (tail.length === 0 ? '' : ` It said: ${tail.join(' | ')}`);

  const gate = (run: () => void): void => {
    if (ready) run();
    else waiting.push(run);
  };

  const deliver = (channel: 'session' | 'chat', action: Bag): void => {
    if (closed || ended !== undefined) return;
    gate(() => {
      try { client?.dispatch(channel === 'chat' ? innerChat : innerSession, action as unknown as StateAction); }
      catch (error) {
        log(`${provider}: could not reach the host inside computer://${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  };

  /**
   * End the outer session with one sentence.
   *
   * `session/creationFailed` is what a client reads as the session being over,
   * and it is the action the host itself uses for a backend that would not
   * start - so the sentence appears where every other creation failure does.
   */
  const fail = (message: string): void => {
    if (ended !== undefined || closed) return;
    ended = message;
    log(`${provider} in computer://${id}: ${message}`);
    start.emit('session', { type: 'session/creationFailed', error: { errorType: 'sessionStartFailed', message } });
    if (turn !== undefined) {
      start.emit('chat', {
        type: 'chat/error',
        turnId: turn,
        duration: 0,
        part: { kind: 'error', error: { errorType: 'turnFailed', message } },
      });
      turn = undefined;
    }
    host?.kill('SIGTERM');
  };

  /**
   * One subscription, pumped.
   *
   * The action goes out as it arrived, and is reduced into the mirror beside
   * it so a client that arrives late gets a snapshot rather than an empty
   * chat. The inner host's own channels are not the client's, but the state
   * the host serves is rewritten with the outer ones before it is sent.
   */
  const pump = async (subscription: Subscription, channel: 'session' | 'chat'): Promise<void> => {
    try {
      for await (const event of subscription) {
        if (ended !== undefined || closed) return;
        if (event.type !== 'action') continue;
        const action = event.params.action;
        /*
         * The mirror is kept so a client that arrives late gets a snapshot.
         * A shape it cannot reduce is dropped rather than fatal: the action
         * itself still goes out, and an inner host that says something this
         * build's reducers do not know is not a reason to end the session.
         */
        try {
          if (channel === 'session') {
            if (session !== undefined) session = sessionReducer(session, action as SessionAction);
          }
          else if (chat !== undefined) {
            chat = chatReducer(chat, action as ChatAction);
          }
        }
        catch (error) {
          log(`${provider}: kept the inner ${channel} action ${action.type} out of the snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (channel === 'chat') {
          if (action.type === 'chat/turnStarted') turn = action.turnId;
          else if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled' || action.type === 'chat/error') {
            if (turn === action.turnId) turn = undefined;
          }
        }
        start.emit(channel, action as unknown as Bag);
      }
    }
    catch (error) {
      if (ended === undefined && !closed) {
        fail(`${provider}'s host inside computer://${id} stopped answering: ${error instanceof Error ? error.message : String(error)}${lastWords()}`);
      }
    }
  };

  /**
   * The whole startup, as one sentence on any failure.
   *
   * The steps are the protocol's own order - initialize, then create the
   * session, then subscribe - and each failure names which one it was.
   */
  const bringUp = async (): Promise<void> => {
    const asked: NestedAsked = {
      id,
      plugins,
      ...(start.workingDirectory === undefined ? {} : { cwd: start.workingDirectory }),
      ...(start.computers === undefined ? {} : { computers: start.computers }),
    };
    const opened = options.start !== undefined ? await options.start(asked) : await startInside(asked);
    host = opened;
    const transport = stdioTransport(
      opened,
      (line) => {
        if (tail.length >= TAIL) tail.shift();
        tail.push(line);
      },
      (why) => {
        if (ended !== undefined || closed) return;
        /*
         * An exit before the session existed is the start failing, and its own
         * sentence is more use than the request timeout that would follow - a
         * program that was never there, or one that refused the host.
         */
        if (!ready) {
          fail(`${provider}'s host inside computer://${id} ended before its session started${why === '' ? '' : ` (${why})`}.${lastWords()}`);
          return;
        }
        fail(`${provider}'s host inside computer://${id} ended${why === '' ? '' : `: ${why}`}.${lastWords()}`);
      },
    );
    const held = new AhpClient(transport, { requestTimeoutMs: timeoutMs });
    client = held;
    held.connect();
    const hello = await held.initialize({ clientId: `ahpd-nested-${id}`, protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS] });
    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`the host inside computer://${id} speaks ${hello.protocolVersion}, and this host speaks ${PROTOCOL_VERSION}`);
    }
    await held.request('createSession', {
      channel: innerSession,
      provider,
      config: innerConfig(start.settings ?? {}),
      ...(start.workingDirectory === undefined ? {} : { workingDirectories: [`file://${start.workingDirectory}`] }),
    });
    const lead = await held.subscribe(innerSession);
    session = lead.result.snapshot?.state as SessionState | undefined;
    const named = (session as { defaultChat?: unknown } | undefined)?.defaultChat;
    if (typeof named === 'string' && named !== '') innerChat = named;
    const talk = await held.subscribe(innerChat);
    chat = talk.result.snapshot?.state as ChatState | undefined;
    void pump(lead.subscription, 'session');
    void pump(talk.subscription, 'chat');
    ready = true;
    log(`${provider} runs in computer://${id} through ${plugins.join(', ')}`);
    for (const run of waiting.splice(0)) run();
  };

  void bringUp().catch((error: unknown) => {
    const why = error instanceof Error ? error.message : String(error);
    fail(`${provider} could not start a host inside computer://${id}: ${why}.${lastWords()}`.replace(/\.\s*$/, '.'));
  });

  /** The outer session's own names for the inner state. */
  const mine = {
    title: (): string => session?.title ?? chat?.title ?? 'Nested session',
    activity: (): string | undefined => chat?.activity ?? session?.activity,
    status: (): number => chat?.activeTurn !== undefined ? 8 : 1,
    modifiedAt: (): string => chat?.modifiedAt ?? startedAt,
  };

  return {
    uri: start.uri,
    chatUri: start.chatUri,
    models: () => [],
    agentId: () => innerSession.replace(/^ahp-session:\//, ''),
    customizations: () => (session?.customizations ?? start.seedCustomizations ?? []) as unknown as Bag[],
    allTurns: () => (chat?.turns ?? []) as unknown as Bag[],
    status: mine.status,
    activity: mine.activity,
    title: mine.title,
    modifiedAt: mine.modifiedAt,
    workingDirectories: () => session?.workingDirectories ?? (start.workingDirectory === undefined ? [] : [`file://${start.workingDirectory}`]),
    /*
     * The inner state, under the outer names. The host rewrites the fields it
     * owns - the chat list, the status, the people in it - but a state whose
     * own `resource` still named the inner channel would be a snapshot about a
     * channel the client never asked for.
     */
    sessionState: (): Bag => ({ ...(session ?? { provider, title: mine.title(), status: mine.status(), lifecycle: 'ready' }), resource: start.uri }),
    chatState: (): Bag => ({ ...(chat ?? { title: mine.title(), status: mine.status(), modifiedAt: mine.modifiedAt(), turns: [] }), resource: start.chatUri }),

    begin: (turnId: string, text: string, model?: Chosen, from?: MessageFrom): void => {
      turn = turnId;
      deliver('chat', {
        type: 'chat/turnStarted',
        turnId,
        message: {
          text,
          ...(model === undefined ? {} : { model }),
          ...(from?.origin === undefined ? {} : { origin: from.origin }),
          ...(from?._meta === undefined ? {} : { _meta: from._meta }),
        },
      });
    },
    queue: (queueId: string, text: string, model?: Chosen, from?: MessageFrom): void => {
      deliver('chat', {
        type: 'chat/pendingMessageSet',
        kind: 'queued',
        id: queueId,
        message: {
          text,
          ...(model === undefined ? {} : { model }),
          ...(from?.origin === undefined ? {} : { origin: from.origin }),
          ...(from?._meta === undefined ? {} : { _meta: from._meta }),
        },
      });
    },
    unqueue: (queueId: string): void => {
      deliver('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id: queueId });
    },
    reorder: (order: string[]): void => {
      deliver('chat', { type: 'chat/queuedMessagesReordered', order });
    },
    setDraft: (draft: Bag | undefined): void => {
      deliver('chat', { type: 'chat/draftChanged', ...(draft === undefined ? {} : { draft }) });
    },
    steer: (steerId: string, text: string): boolean => {
      deliver('chat', { type: 'chat/pendingMessageSet', kind: 'steering', id: steerId, message: { text } });
      return true;
    },
    resume: (turnId: string): boolean => {
      deliver('chat', { type: 'chat/turnResume', turnId });
      return true;
    },
    cancel: (turnId: string): void => {
      if (turn === turnId) turn = undefined;
      deliver('chat', { type: 'chat/turnCancelled', turnId });
    },
    confirm: (toolCallId: string, approved: boolean): void => {
      deliver('chat', { type: 'chat/toolCallConfirmed', toolCallId, approved });
    },
    answer: (requestId: string, accepted: boolean, answers: Bag): void => {
      deliver('chat', { type: 'chat/inputCompleted', requestId, response: accepted ? 'accept' : 'decline', answers });
    },
    setAnswer: (requestId: string, questionId: string, answer: Bag | undefined): boolean => {
      deliver('chat', { type: 'chat/inputAnswerChanged', requestId, questionId, ...(answer === undefined ? {} : { answer }) });
      return true;
    },
    setConfig: (key: string, value: unknown): true => {
      deliver('session', { type: 'session/configChanged', config: { [key]: value } });
      return true;
    },
    setCustomizationEnabled: async (customizationId: string, enabled: boolean): Promise<boolean> => {
      deliver('session', {
        type: 'session/customizationToggled',
        id: customizationId,
        enablement: [{ kind: 'session', enabled }],
      });
      return true;
    },
    startMcpServer: async (serverId: string): Promise<boolean> => {
      deliver('session', { type: 'session/mcpServerStartRequested', id: serverId });
      return true;
    },
    stopMcpServer: async (serverId: string): Promise<boolean> => {
      deliver('session', { type: 'session/mcpServerStopRequested', id: serverId });
      return true;
    },
    awaiting: () => [] as string[],
    settings: (): Record<string, unknown> => ({
      ...innerConfig(start.settings ?? {}),
      ...((session?.config?.values ?? {}) as Record<string, unknown>),
    }),
    close: (): void => {
      if (closed) return;
      closed = true;
      /*
       * Asked first, so the inner host disposes its own session and its
       * backend, and dropped when there is nobody left to ask: the process
       * below is the guarantee either way.
       */
      if (ready && client !== undefined && ended === undefined) {
        void client.request('disposeSession', { channel: innerSession }).catch(() => { /* the kill below is the answer */ });
      }
      void client?.shutdown().catch(() => { /* nothing left to say */ });
      host?.kill('SIGTERM');
    },
  };
};
