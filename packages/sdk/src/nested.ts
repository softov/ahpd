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
 * are re-emitted with only their chat URIs renamed. An action this build does
 * not know is forwarded without being mirrored.
 *
 * A failure is a sentence and never a hang. The process may be missing, may
 * exit before it answers, may speak another protocol version or refuse the
 * session, and each of those ends the outer session with the last lines of
 * whatever it wrote to stderr. A session that has ended refuses what follows
 * with that sentence (`ended`).
 *
 * What a `Start` carries that the proxy does not pass on:
 *
 * - `forkAt`, `rewindAt` and `context`: the proxy answers no `forkPoint` or
 *   `endPoint`, so the host never asks it to fork or rewind;
 * - `credentials`: the machine gets its keys as the agent's machine needs say,
 *   decision `cofold-config-reaches-a-machine-by-a-path-variable`;
 * - `tools`, `instructions` and `subagent`: seams of this host, and the host
 *   inside has its own;
 * - `additional`, `terminals` and `resources`: this host's paths and stores,
 *   which are not the machine's.
 *
 * `resume` is carried: the inner session goes by the outer one's id, so a
 * resume continues the transcript the machine holds - decision
 * `a-nested-session-resumes-its-inner-transcript-by-id`.
 */

import { spawn as startProcess } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { AhpClient, RpcError } from '@microsoft/agent-host-protocol/client';
import type { AhpTransport, Subscription, TransportFrame } from '@microsoft/agent-host-protocol/client';
import { chatReducer, rootReducer, sessionReducer, SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import type { ChatAction, ChatState, RootAction, RootState, SessionAction, SessionState, StateAction } from '@microsoft/agent-host-protocol';
import { idOf } from './catalog.js';
import { uriOf } from './fileuri.js';
import { subagentChatUri } from './host/channels.js';
import { ANSWER_TIMEOUT } from './rpc.js';
import { computerId } from './computers.js';
import type { Agent, Start } from './types/agent.js';
import type { Bag } from './types/common.js';
import type { ComputerPort } from './types/computers.js';
import type { Chosen, MessageFrom, Session, SubagentChat } from './types/session.js';

/** How many of the inner host's own lines are kept for a failure's sentence. */
const TAIL = 12;

/** How many characters of one of those lines are kept. */
const LINE = 400;

/** How long a write that failed waits for the process's own end before it is the end. */
const INPUT_GRACE = 500;

/** How long a process asked to stop with `SIGTERM` has before it gets `SIGKILL`. */
const KILL_AFTER = 3_000;

/** How long closing waits for the inner host to dispose its session before stopping it. */
const DISPOSE_WAIT = 3_000;

/**
 * How much longer than `KILL_AFTER` a restart waits for the host inside to go.
 *
 * `SIGKILL` cannot be caught, so a process that is still there a second after
 * it is one nothing here can end - caught in a syscall, or with the pipes this
 * host reads held open by something it started, which is a program that
 * misbehaves and is no reason for a machine never to start again. What a
 * restart needs is that the host it is replacing is not writing the transcript
 * the new one takes over, and one that has been `SIGKILL`ed and has not gone a
 * second later is not writing it.
 */
const GONE_MARGIN = 1_000;

/** How long a restart waits for a host inside - one still starting, or one it stopped - before going on without it. */
const HANDOVER_WAIT = KILL_AFTER + GONE_MARGIN;

/** The inner host's root channel, where the agents it serves are listed. */
const ROOT = 'ahp-root://';

/**
 * The protocol's code for a session a host does not serve.
 *
 * It is what the inner host answers a subscribe with - `No agent for session
 * ...` - for a session that is neither running nor in its catalogue
 * (`snapshots.ts`), which is the same answer it gives for one it holds
 * nothing of.
 */
const NO_AGENT = -32001;

/** The session actions about one chat in the session's catalogue. */
const CATALOGUE = new Set(['session/chatAdded', 'session/chatUpdated', 'session/chatRemoved', 'session/defaultChatChanged']);

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

/**
 * A started inner host, and the path inside the machine its session works at.
 *
 * `workingDirectory` is the session folder as the machine sees it, through its
 * mounts; absent, the inner session is created at the folder this host named.
 */
export interface NestedStarted {
  host: NestedHost;
  workingDirectory?: string;
}

/** How one session of this backend runs nested. */
export interface NestedOptions {
  /**
   * The plugins the host inside loads: the one that registered this agent on
   * this host, as the host recorded its spec - decision
   * `the-host-records-which-plugin-registered-each-agent`.
   *
   * Empty when nothing is recorded, and then the session ends with a sentence
   * saying the host does not know which plugin serves it, and nothing is
   * started.
   */
  plugins: string[];
  /** How long a question to the inner host waits. Default `ANSWER_TIMEOUT`. */
  timeoutMs?: number;
  /**
   * Start the inner host, for a caller that is not this host's `computers`
   * port. A test hands in in-memory streams; the default asks the port for a
   * spawn and runs it here. Answers the host alone, or the host with the path
   * inside the machine its session works at.
   */
  start?: (asked: NestedAsked) => NestedHost | NestedStarted | Promise<NestedHost | NestedStarted>;
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
 * it answers an empty schema and no defaults, and is not a variant.
 */
export const nestedAgent = (provider: Agent | string, options: NestedOptions): Agent => {
  const real: Agent | undefined = typeof provider === 'string' ? undefined : provider;
  const name = typeof provider === 'string' ? provider : provider.provider;
  const create = (start: Start): Session => nestedSession(name, real?.variant === true, start, options);
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
const startInside = async (asked: NestedAsked): Promise<NestedStarted> => {
  if (asked.computers?.nested === undefined) {
    throw new Error(`This host has no computer plugin that can start a host inside computer://${asked.id}`);
  }
  const spawn = await asked.computers.nested(asked.id, {
    plugins: asked.plugins,
    ...(asked.cwd === undefined ? {} : { cwd: asked.cwd }),
  });
  if (spawn === undefined) throw new Error(`There is no computer called computer://${asked.id}`);
  const host = startProcess(spawn.command, spawn.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(spawn.env === undefined ? {} : { env: { ...process.env, ...spawn.env } }),
    ...(spawn.cwd === undefined ? {} : { cwd: spawn.cwd }),
  }) as unknown as NestedHost;
  return { host, ...(spawn.workingDirectory === undefined ? {} : { workingDirectory: spawn.workingDirectory }) };
};

/**
 * A stream cut into lines, each byte scanned once.
 *
 * The pieces of a line whose newline has not arrived are held as they came
 * and joined once it does, so a frame of any size costs its own length. Bytes
 * are decoded as UTF-8 across chunk boundaries, so a character split between
 * two reads is one character. `cap`, when given, is how many characters of a
 * line are kept at most; the rest of a longer one is dropped as it arrives,
 * and the line is handed on one character over the cap so the reader can tell
 * it was cut.
 */
const lineReader = (each: (line: string) => void, cap?: number): { write: (chunk: unknown) => void; end: () => void } => {
  const decoder = new StringDecoder('utf8');
  let parts: string[] = [];
  let held = 0;
  const take = (text: string): void => {
    if (cap === undefined) {
      parts.push(text);
      return;
    }
    if (held > cap) return;
    const kept = text.slice(0, cap + 1 - held);
    parts.push(kept);
    held += kept.length;
  };
  const flush = (): void => {
    const line = parts.join('').replace(/\r$/, '');
    parts = [];
    held = 0;
    each(line);
  };
  return {
    write: (chunk) => {
      const text = Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
      let from = 0;
      let at = text.indexOf('\n');
      while (at !== -1) {
        take(text.slice(from, at));
        flush();
        from = at + 1;
        at = text.indexOf('\n', from);
      }
      if (from < text.length) take(text.slice(from));
    },
    end: () => {
      const rest = decoder.end();
      if (rest !== '') take(rest);
      if (parts.length > 0) flush();
    },
  };
};

/**
 * One JSON frame per line, in and out.
 *
 * The transport `AhpClient` reads: a line from the inner host becomes a frame,
 * a message becomes a line on its stdin, and the process ending is the clean
 * close `recv` answers `null` for.
 *
 * The end is read from `close`, which a child process emits once its pipes
 * are drained, so every line it wrote is delivered before the end is said. A
 * failed write - the process gone, or its stdin closed while it runs - is an
 * end too, and never an error thrown into the daemon: the process's own end
 * is waited for `INPUT_GRACE`, since its code and its last lines say more,
 * and the write's own error is the reason when it does not come.
 */
const stdioTransport = (
  host: NestedHost,
  onStderr: (line: string) => void,
  onEnd: (why: string) => void,
): AhpTransport => {
  const pending: (TransportFrame | null)[] = [];
  let waiter: ((frame: TransportFrame | null) => void) | undefined;
  let closed = false;
  let broken: ReturnType<typeof setTimeout> | undefined;
  const deliver = (frame: TransportFrame | null): void => {
    if (waiter !== undefined) {
      const held = waiter;
      waiter = undefined;
      held(frame);
      return;
    }
    pending.push(frame);
  };
  const out = lineReader((line) => { if (line.trim() !== '') deliver({ kind: 'text', text: line }); });
  const err = lineReader((line) => {
    const said = line.trim();
    if (said !== '') onStderr(said.length > LINE ? `${said.slice(0, LINE)}…` : said);
  }, LINE);
  host.stdout.on('data', out.write);
  host.stderr.on('data', err.write);
  const finish = (why: string): void => {
    if (broken !== undefined) clearTimeout(broken);
    if (closed) return;
    closed = true;
    out.end();
    err.end();
    deliver(null);
    onEnd(why);
  };
  host.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    if (signal !== null) finish(`it was killed by ${signal}`);
    else finish(code === null || code === 0 ? '' : `it exited with code ${String(code)}`);
  });
  host.on('error', (error: Error) => { finish(error.message); });
  host.stdin.on('error', (error: Error) => {
    if (closed || broken !== undefined) return;
    broken = setTimeout(() => { finish(`it closed its input: ${error.message}`); }, INPUT_GRACE);
    broken.unref?.();
  });
  return {
    send: (message) => {
      if (closed) throw new Error('the host inside has ended');
      const text = typeof message === 'string' ? message : JSON.stringify(message);
      host.stdin.write(`${text}\n`);
    },
    recv: () => {
      if (pending.length > 0) return Promise.resolve(pending.shift() ?? null);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => { waiter = resolve; });
    },
    /*
     * The input is ended and the process left alone: stopping it is the
     * session's, which signals it once it has had its say.
     */
    close: () => {
      if (closed) return;
      closed = true;
      deliver(null);
      host.stdin.end();
    },
  };
};

/** The default chat URI a host gives a session, for a snapshot that named none. */
const defaultChatFor = (session: string): string =>
  `ahp-chat://default/${Buffer.from(session, 'utf8').toString('base64url')}`;

/** A promise that settles by itself after `ms`, whichever comes first. */
const bounded = (work: Promise<unknown>, ms: number): Promise<unknown> => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  timer.unref?.();
  work.then(resolve, resolve).finally(() => { clearTimeout(timer); });
});

/** Whether a customization by that id is in a list, at any depth. */
const holds = (list: unknown, id: string): boolean => Array.isArray(list) && list.some((one: unknown) => {
  if (typeof one !== 'object' || one === null) return false;
  const held = one as { id?: unknown; children?: unknown };
  return held.id === id || holds(held.children, id);
});

/** A `file://` URI for a path, as a session's working directories are spelled. */
const fileUri = (path: string): string => uriOf(path);

/**
 * One proxied session.
 *
 * Everything a client does is dispatched to the inner session and everything
 * the inner host says is emitted here, so the outer host and its clients treat
 * this exactly as a backend that ran locally. The startup is asynchronous - a
 * process, a handshake, a session - and every turn that arrives before it is
 * ready waits behind a gate rather than being dropped.
 */
const nestedSession = (provider: string, variant: boolean, start: Start, options: NestedOptions): Session => {
  const log = options.log ?? ((): void => { /* nothing is kept without one */ });
  const timeoutMs = options.timeoutMs ?? ANSWER_TIMEOUT;
  const plugins = options.plugins;
  const said = start.settings?.computer;
  const id = computerId(said);
  if (id === undefined) {
    throw new Error(`${provider} runs nested only in a computer://<id>, and this session names ${typeof said === 'string' && said.trim() !== '' ? said : 'none'}`);
  }
  const startedAt = new Date().toISOString();
  /*
   * The inner session goes by the outer one's id, so the id a later resume
   * names is the one the inner host kept its transcript under.
   */
  const sessionId = start.resume ?? idOf(start.uri);
  /*
   * Named the way the inner host holds a session, `<provider>:/<id>`, once the
   * provider it serves is known, so a session it resumes is broadcast on the
   * very channels this one watches.
   */
  let innerSession = `ahp-session:/${sessionId}`;
  let innerChat = defaultChatFor(innerSession);
  /** The provider the inner host serves this session as. */
  let innerProvider = provider;
  let client: AhpClient | undefined;
  let host: NestedHost | undefined;
  /** Whether the inner host's process has gone, so it is not signalled again. */
  let exited = false;
  /** Resolves when the process has gone - its own `exit`, its pipes closing, or an error - so a caller can wait for the process and not the request. */
  let onGone: () => void = () => { /* nothing waits before one is started */ };
  const gone = new Promise<void>((resolve) => { onGone = resolve; });
  let root: RootState | undefined;
  let session: SessionState | undefined;
  let chat: ChatState | undefined;
  let ready = false;
  let ended: string | undefined;
  let closed = false;
  /** The request that makes the session inside, while it is in flight. */
  let making: Promise<unknown> | undefined;
  /** The close in flight, so a second caller waits on the same one. */
  let closing: Promise<void> | undefined;
  let turn: string | undefined;
  /** The folder this host named, and where it is inside the machine, as URIs. */
  const outside = start.workingDirectory === undefined ? undefined : fileUri(start.workingDirectory);
  let inside = outside;
  /** The resources the inner host asked this session's client to sign into. */
  const awaited = new Set<string>();
  /** What was asked for before the inner session existed, in order. */
  const waiting: (() => void)[] = [];
  /** The inner host's own last lines, for a failure's sentence. */
  const tail: string[] = [];
  const lastWords = (): string => (tail.length === 0 ? '' : ` It said: ${tail.join(' | ')}`);
  const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  /** Ask the process to stop, and make it stop when it has not a while later. */
  const stop = (): void => {
    if (host === undefined || exited) return;
    const held = host;
    held.kill('SIGTERM');
    const later = setTimeout(() => { if (!exited) held.kill('SIGKILL'); }, KILL_AFTER);
    later.unref?.();
  };

  const gate = (run: () => void): void => {
    if (ready) run();
    else waiting.push(run);
  };

  const deliver = (channel: 'session' | 'chat', action: Bag): void => {
    if (closed || ended !== undefined) return;
    gate(() => {
      try { client?.dispatch(channel === 'chat' ? innerChat : innerSession, action as unknown as StateAction); }
      catch (error) {
        log(`${provider}: could not reach the host inside computer://${id}: ${reason(error)}`);
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
    stop();
  };

  /** Each inner chat this session serves, by its inner URI, to the outer URI it is served under. */
  const outerOf = new Map<string, string>();
  /** The inner chats this session does not serve, each logged once. */
  const unserved = new Set<string>();

  /** A value with every inner chat URI it carries put under its outer name. */
  const outward = (value: unknown): unknown => {
    if (typeof value === 'string') return outerOf.get(value) ?? value;
    if (Array.isArray(value)) return value.map(outward);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, held]) => [key, outward(held)]));
    }
    return value;
  };

  /** The first inner chat URI a value carries that this session does not serve. */
  const strayIn = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value.startsWith('ahp-chat:') && !outerOf.has(value) ? value : undefined;
    const inside = Array.isArray(value) ? value : typeof value === 'object' && value !== null ? Object.values(value) : [];
    for (const held of inside) {
      const found = strayIn(held);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  /** A worker chat of the inner session's, served outside through the host's `subagent` seam. */
  interface Worker {
    /** The call in the inner lead chat, or in another worker's chat, that runs it. */
    toolCallId: string;
    /** The chat the host opened outside, once the inner one was read. */
    opened?: SubagentChat;
    /** The inner chat's turn, which is the outer chat's `opened.turnId`. */
    turn?: string;
    done: boolean;
  }
  /** The inner worker chats this session serves, by inner URI. */
  const workers = new Map<string, Worker>();

  /** End a worker's outer turn the way its inner turn ended. */
  const settle = (worker: Worker, action: Bag): boolean => {
    if (worker.opened === undefined || worker.done) return worker.done;
    const type = String(action.type);
    if (type !== 'chat/turnComplete' && type !== 'chat/turnCancelled' && type !== 'chat/error') return false;
    worker.done = true;
    if (type === 'chat/turnComplete') worker.opened.end('complete');
    else if (type === 'chat/turnCancelled') worker.opened.end('cancelled');
    else {
      const said = ((action.part as Bag | undefined)?.error as Bag | undefined)?.message;
      worker.opened.end('error', typeof said === 'string' ? said : undefined);
    }
    return true;
  };

  /** One inner worker action, written to the outer chat on the turn the host opened. */
  const toWorker = (worker: Worker, action: Bag): void => {
    if (worker.opened === undefined || worker.done) return;
    if (action.type === 'chat/turnStarted') return;
    if (settle(worker, action)) return;
    const moved = action.turnId !== undefined && action.turnId === worker.turn ? { ...action, turnId: worker.opened.turnId } : action;
    worker.opened.emit(outward(moved) as Bag);
  };

  /**
   * Read an inner worker chat and open it outside.
   *
   * The prompt and whatever the worker already said are in the inner chat's
   * snapshot, so the outer chat is opened with that prompt and the parts are
   * written to it before the actions that follow.
   */
  const openWorker = async (inner: string, worker: Worker, summary: Bag): Promise<void> => {
    const held = client;
    const subagent = start.subagent;
    if (held === undefined || subagent === undefined) return;
    let watched: Awaited<ReturnType<AhpClient['subscribe']>>;
    try { watched = await held.subscribe(inner); }
    catch (error) {
      log(`${provider} in computer://${id}: could not read the worker chat ${inner}: ${reason(error)}`);
      return;
    }
    if (ended !== undefined || closed) return;
    /*
     * From here on it is the outer host's own work: the seam that opens the
     * chat, the parts written into it, and the subscription that follows it.
     * None of it runs under a caller - `opensWorker` starts this with `void`,
     * because it is called from the action that announces the worker and has
     * to answer whether the session serves that chat - so a throw would be a
     * rejection nobody holds, and this package installs no
     * `unhandledRejection` handler, which is a daemon that ends because one
     * worker's chat could not be opened. The session is not that chat: a line
     * about it, and the session runs on.
     */
    try {
      const state = (watched.result.snapshot?.state ?? {}) as Partial<ChatState>;
      const finished = (state.turns ?? []).at(-1);
      const current = state.activeTurn ?? finished;
      const origin = (summary.origin ?? {}) as Bag;
      const parent = workers.get(String(origin.chat ?? ''))?.toolCallId;
      const text = (current?.message as { text?: unknown } | undefined)?.text;
      worker.opened = subagent(worker.toolCallId, {
        title: typeof summary.title === 'string' ? summary.title : 'Subagent',
        ...(typeof text === 'string' ? { prompt: text } : {}),
        ...(parent === undefined ? {} : { parentToolCallId: parent }),
      });
      outerOf.set(inner, worker.opened.uri);
      if (current !== undefined) worker.turn = current.id;
      for (const part of current?.responseParts ?? []) {
        worker.opened.emit({ type: 'chat/responsePart', turnId: worker.opened.turnId, part: outward(part) });
      }
      if (state.activeTurn === undefined && finished !== undefined) {
        settle(worker, { type: finished.state === 'cancelled' ? 'chat/turnCancelled' : finished.state === 'error' ? 'chat/error' : 'chat/turnComplete' });
      }
      try {
        for await (const event of watched.subscription) {
          if (ended !== undefined || closed || worker.done) return;
          if (event.type === 'action') toWorker(worker, event.params.action as unknown as Bag);
        }
      }
      catch { /* the session's own subscriptions say why it ended */ }
    }
    catch (error) {
      log(`${provider} in computer://${id}: the worker chat ${inner} could not be opened: ${reason(error)}`);
    }
  };

  /**
   * Whether a chat the inner session added is a worker this session serves,
   * and if so start serving it.
   *
   * Its outer name is known at once - the host names a worker chat by the
   * session and the call - so a link to it in the lead chat that arrives
   * before the chat is read is already rewritten.
   */
  const opensWorker = (summary: Bag): boolean => {
    const origin = (summary.origin ?? {}) as Bag;
    const inner = summary.resource;
    if (origin.kind !== 'tool' || typeof origin.toolCallId !== 'string' || typeof inner !== 'string') return false;
    if (start.subagent === undefined || workers.has(inner)) return start.subagent !== undefined;
    const worker: Worker = { toolCallId: origin.toolCallId, done: false };
    workers.set(inner, worker);
    outerOf.set(inner, subagentChatUri(start.uri, origin.toolCallId));
    void openWorker(inner, worker, summary);
    return true;
  };

  /**
   * One inner action as the outer session says it, or nothing.
   *
   * Every chat URI in it is the outer one. A catalogue action about a chat
   * this session does not serve - a worker's chat, a fork - is kept back, so a
   * client is never told of a chat it cannot open, and a reorder names only
   * the chats that are served.
   */
  const served = (channel: 'session' | 'chat', action: Bag): Bag | undefined => {
    if (channel === 'session' && action.type === 'session/chatsReordered' && Array.isArray(action.chats)) {
      return { ...action, chats: (action.chats as unknown[]).filter((chat) => typeof chat === 'string' && outerOf.has(chat)).map(outward) };
    }
    if (channel === 'session' && action.type === 'session/chatAdded' && opensWorker((action.summary ?? {}) as Bag)) return undefined;
    // A worker's row is the host's own, kept by the seam that opened it.
    if (channel === 'session' && CATALOGUE.has(String(action.type)) && workers.has(String(action.chat ?? ''))) return undefined;
    const stray = channel === 'session' && CATALOGUE.has(String(action.type)) ? strayIn(action) : undefined;
    if (stray !== undefined) {
      if (!unserved.has(stray)) log(`${provider} in computer://${id}: ${stray} is a chat of the host inside, which this host does not serve`);
      unserved.add(stray);
      return undefined;
    }
    return outward(action) as Bag;
  };

  /** A working directory the inner session reports, as the folder this host named. */
  const outerDir = (uri: string): string => {
    if (inside === undefined || outside === undefined || inside === outside) return uri;
    if (uri === inside) return outside;
    if (uri.startsWith(`${inside}/`)) return `${outside}${uri.slice(inside.length)}`;
    return uri;
  };

  /**
   * One subscription, pumped.
   *
   * The action goes out with its chat URIs renamed, and is reduced into the
   * mirror beside it so a client that arrives late gets a snapshot rather than
   * an empty chat. A sign-in the inner host asks for on the session is kept,
   * so the outer host can route a client's token back here.
   */
  const pump = async (subscription: Subscription, channel: 'session' | 'chat'): Promise<void> => {
    try {
      for await (const event of subscription) {
        if (ended !== undefined || closed) return;
        if (event.type === 'authRequired') {
          const resource = (event.params.resource as { resource?: unknown } | undefined)?.resource;
          if (typeof resource === 'string' && resource !== '') awaited.add(resource);
          continue;
        }
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
          log(`${provider}: kept the inner ${channel} action ${action.type} out of the snapshot: ${reason(error)}`);
        }
        if (channel === 'chat') {
          if (action.type === 'chat/turnStarted') turn = action.turnId;
          else if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled' || action.type === 'chat/error') {
            if (turn === action.turnId) turn = undefined;
          }
        }
        const shown = served(channel, action as unknown as Bag);
        if (shown !== undefined) start.emit(channel, shown);
      }
    }
    catch (error) {
      if (ended === undefined && !closed) {
        fail(`${provider}'s host inside computer://${id} stopped answering: ${reason(error)}${lastWords()}`);
      }
    }
  };

  /** The inner root, kept current, so the models are the inner host's own. */
  const pumpRoot = async (subscription: Subscription): Promise<void> => {
    try {
      for await (const event of subscription) {
        if (closed || event.type !== 'action' || root === undefined) continue;
        try { root = rootReducer(root, event.params.action as RootAction); }
        catch (error) { log(`${provider}: kept the inner root action ${event.params.action.type} out of the snapshot: ${reason(error)}`); }
      }
    }
    catch { /* the session's own subscriptions say why it ended */ }
  };

  /**
   * The provider the inner host serves this session as.
   *
   * The outer name when the inner host serves it. Otherwise, for an agent
   * that is not a variant - a built-in, or a default renamed by an option -
   * the single agent the inner host serves; a variant is never run as another
   * agent, since the inner host loads its plugin without the preset.
   */
  const servedAs = (agents: string[]): string => {
    if (agents.includes(provider)) return provider;
    const loaded = plugins.join(', ');
    if (agents.length === 0) throw new Error(`the host inside computer://${id} serves no agent, so it did not load ${loaded}`);
    if (variant) {
      throw new Error(`the host inside computer://${id} does not serve ${provider}, only ${agents.join(', ')}, and ${provider} is not run as another agent`);
    }
    if (agents.length > 1) {
      throw new Error(`the host inside computer://${id} serves ${agents.join(', ')} from ${loaded}, and none of them is ${provider}`);
    }
    return agents[0] as string;
  };

  /**
   * The whole startup, as one sentence on any failure.
   *
   * The steps are the protocol's own order - initialize, read the root, create
   * the session, then subscribe - and each failure names which one it was.
   */
  const bringUp = async (): Promise<void> => {
    if (plugins.length === 0) throw new Error(`this host does not know which plugin serves ${provider}, so it cannot start one there`);
    const asked: NestedAsked = {
      id,
      plugins,
      ...(start.workingDirectory === undefined ? {} : { cwd: start.workingDirectory }),
      ...(start.computers === undefined ? {} : { computers: start.computers }),
    };
    const answer = options.start !== undefined ? await options.start(asked) : await startInside(asked);
    const started: NestedStarted = 'stdin' in answer ? { host: answer } : answer;
    const opened = started.host;
    host = opened;
    opened.on('close', () => { exited = true; onGone(); });
    opened.on('error', () => { exited = true; onGone(); });
    /*
     * And the process's own end, which `close` can be a long way behind: a
     * child that started something holding its stdout - a machine's own daemon,
     * a shell's background job - is gone with its pipes still open, so nothing
     * reports `close` until that something lets go, and a restart waiting for
     * `close` waits with it. `exit` is the process being gone, which is what
     * the session after this one has to wait for.
     */
    opened.on('exit', () => { exited = true; onGone(); });
    if (closed) {
      stop();
      return;
    }
    if (started.workingDirectory !== undefined) inside = fileUri(started.workingDirectory);
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
    /*
     * The host inside may ask its client for what it serves; this host
     * publishes nothing to it, and says so rather than leaving the request
     * unanswered or unknown.
     */
    held.setServerRequestHandler(async (method: string) => {
      log(`${provider} in computer://${id}: the host inside asked for ${method}, which this host does not serve it`);
      throw new Error(`this host publishes no resources to the host inside computer://${id}, so ${method} is not answered`);
    });
    held.connect();
    const hello = await held.initialize({ clientId: `ahpd-nested-${id}`, protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS] });
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(hello.protocolVersion)) {
      throw new Error(`the host inside computer://${id} speaks ${hello.protocolVersion}, and this host offered ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`);
    }
    const listed = await held.subscribe(ROOT);
    root = listed.result.snapshot?.state as RootState | undefined;
    void pumpRoot(listed.subscription);
    innerProvider = servedAs((root?.agents ?? []).map((agent) => agent.provider));
    innerSession = `${innerProvider}:/${sessionId}`;
    innerChat = defaultChatFor(innerSession);
    const make = async (): Promise<void> => {
      /*
       * Nothing is made for a session that is already being removed.
       *
       * `close` reads `making` the moment it is called and waits on it, so a
       * create that started before the close is one the close can dispose;
       * this is the other half - a close that arrived while the start-up was
       * between its own `closed` check and here would otherwise write a
       * session into the machine after the record of it is gone.
       */
      if (closed) return;
      const asked = held.request('createSession', {
        channel: innerSession,
        provider: innerProvider,
        config: innerConfig(start.settings ?? {}),
        ...(inside === undefined ? {} : { workingDirectories: [inside] }),
      });
      making = asked;
      await asked;
    };
    /*
     * A resumed session is not made again: the inner host holds it under the
     * same id, and the first turn forwarded to it resumes it there, the way any
     * host resumes a session it is not running - decision
     * `a-nested-session-resumes-its-inner-transcript-by-id`.
     *
     * But this host asks to resume whenever `agentId()` is set, and that is the
     * session id from the first breath: a restart before the turn inside has
     * ever run - which is what adding a directory to a brand-new session is -
     * resumes a session the inner host has never persisted. It answers the
     * subscribe below with `NO_AGENT`, and that is a session to make rather
     * than a failure, because the turn about to be sent needs one to run in.
     * The refusal is the inner host answering the only question that matters -
     * whether it will serve this session - so it is asked here rather than by
     * listing its catalogue first, which is a listing of the machine's
     * transcripts and not always the same set it can read.
     */
    if (start.resume === undefined) await make();
    const lead = await held.subscribe(innerSession).catch(async (error: unknown) => {
      if (start.resume === undefined || !(error instanceof RpcError) || error.code !== NO_AGENT) throw error;
      log(`the host inside computer://${id} holds no session ${sessionId} to resume, so one was made`);
      await make();
      return await held.subscribe(innerSession);
    });
    session = lead.result.snapshot?.state as SessionState | undefined;
    const named = (session as { defaultChat?: unknown } | undefined)?.defaultChat;
    if (typeof named === 'string' && named !== '') innerChat = named;
    outerOf.set(innerChat, start.chatUri);
    const talk = await held.subscribe(innerChat);
    chat = talk.result.snapshot?.state as ChatState | undefined;
    void pump(lead.subscription, 'session');
    void pump(talk.subscription, 'chat');
    ready = true;
    log(`${provider} runs in computer://${id} as ${innerProvider} through ${plugins.join(', ')}`);
    for (const run of waiting.splice(0)) run();
  };

  /*
   * The start, kept so a close can wait for it.
   *
   * A close that arrives before this has settled has no process to stop - the
   * one inside is still on its way in - and it must not answer before there is
   * one, or the host that replaces this session is started while the host it is
   * replacing is still coming up.
   */
  const starting = bringUp();
  void starting.catch((error: unknown) => {
    fail(`${provider} could not start a host inside computer://${id}: ${reason(error)}.${lastWords()}`.replace(/\.\s*$/, '.'));
  });

  /** The outer session's own names for the inner state. */
  const mine = {
    title: (): string => session?.title ?? chat?.title ?? 'Nested session',
    activity: (): string | undefined => chat?.activity ?? session?.activity,
    status: (): number => chat?.activeTurn !== undefined ? 8 : 1,
    modifiedAt: (): string => chat?.modifiedAt ?? startedAt,
  };

  /** Whether an input request is open on the running turn. */
  const asking = (requestId: string): boolean => (chat?.activeTurn?.responseParts ?? []).some((part) => {
    const held = part as { kind?: unknown; request?: { id?: unknown }; response?: unknown };
    return held.kind === 'inputRequest' && held.request?.id === requestId && held.response === undefined;
  });

  /** The inner session's declaration of one config key, or nothing. */
  const declared = (key: string): Bag | undefined => {
    const properties = (session?.config?.schema as { properties?: Record<string, Bag> } | undefined)?.properties;
    return properties?.[key];
  };

  return {
    uri: start.uri,
    chatUri: start.chatUri,
    /* The inner host's models for the provider it serves this session as. */
    models: () => (root?.agents.find((agent) => agent.provider === innerProvider)?.models ?? [])
      .map((model) => ({ id: model.id, name: model.name })),
    agentId: () => sessionId,
    customizations: () => (session?.customizations ?? start.seedCustomizations ?? []) as unknown as Bag[],
    allTurns: () => (chat?.turns ?? []) as unknown as Bag[],
    status: mine.status,
    activity: mine.activity,
    title: mine.title,
    modifiedAt: mine.modifiedAt,
    workingDirectories: () => session?.workingDirectories?.map(outerDir) ?? (outside === undefined ? [] : [outside]),
    /*
     * The inner state, under the outer names. The host rewrites the fields it
     * owns - the chat list, the status, the people in it - but a state whose
     * own `resource` still named the inner channel would be a snapshot about a
     * channel the client never asked for. Every inner chat URI is the outer
     * one, a chat this session does not serve is left out of the list, a
     * worker's row is the host's own from the seam that opened it, and the
     * working directories are the folders this host named.
     */
    sessionState: (): Bag => {
      const held = (session ?? { provider, title: mine.title(), status: mine.status(), lifecycle: 'ready', chats: [] }) as unknown as Bag;
      const chats = Array.isArray(held.chats)
        ? (held.chats as Bag[]).filter((one) => outerOf.has(String(one.resource)) && !workers.has(String(one.resource)))
        : [];
      const shown = outward({ ...held, chats }) as Bag;
      return {
        ...shown,
        ...(typeof held.defaultChat === 'string' && !outerOf.has(held.defaultChat) ? { defaultChat: start.chatUri } : {}),
        ...(Array.isArray(held.workingDirectories) ? { workingDirectories: (held.workingDirectories as string[]).map(outerDir) } : {}),
        // Said in the snapshot too, for a client that subscribes after the end.
        ...(ended === undefined ? {} : { lifecycle: 'failed', creationError: { errorType: 'sessionStartFailed', message: ended } }),
        resource: start.uri,
      };
    },
    chatState: (): Bag => ({ ...(outward(chat ?? { title: mine.title(), status: mine.status(), modifiedAt: mine.modifiedAt(), turns: [] }) as Bag), resource: start.chatUri }),

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
    /* Taken only while the inner chat has a turn running. */
    steer: (steerId: string, text: string): boolean => {
      if (chat?.activeTurn === undefined) return false;
      deliver('chat', { type: 'chat/pendingMessageSet', kind: 'steering', id: steerId, message: { text } });
      return true;
    },
    /* Taken only for the inner chat's last turn, when it failed and nothing runs. */
    resume: (turnId: string): boolean => {
      const last = chat?.turns.at(-1);
      if (chat?.activeTurn !== undefined || last === undefined || last.id !== turnId || last.state !== 'error') return false;
      deliver('chat', { type: 'chat/turnResume', turnId });
      return true;
    },
    cancel: (turnId: string): void => {
      if (turn === turnId) turn = undefined;
      deliver('chat', { type: 'chat/turnCancelled', turnId });
    },
    confirm: (toolCallId: string, approved: boolean, optionId?: string): void => {
      deliver('chat', { type: 'chat/toolCallConfirmed', toolCallId, approved, ...(optionId === undefined ? {} : { selectedOptionId: optionId }) });
    },
    answer: (requestId: string, accepted: boolean, answers: Bag): void => {
      deliver('chat', { type: 'chat/inputCompleted', requestId, response: accepted ? 'accept' : 'decline', answers });
    },
    /* Taken only for an input request the running inner turn has open. */
    setAnswer: (requestId: string, questionId: string, answer: Bag | undefined): boolean => {
      if (!asking(requestId)) return false;
      deliver('chat', { type: 'chat/inputAnswerChanged', requestId, questionId, ...(answer === undefined ? {} : { answer }) });
      return true;
    },
    /*
     * Taken for a key the inner session's schema declares and does not fix
     * once the session runs; anything else is refused in a sentence, since the
     * inner host would refuse it where no client could hear.
     */
    setConfig: (key: string, value: unknown): true | string => {
      const property = declared(key);
      if (property === undefined) return `${provider} in computer://${id} has no setting called ${key}`;
      if (property.sessionMutable === false) return `${key} is fixed once the session has started`;
      deliver('session', { type: 'session/configChanged', config: { [key]: value } });
      return true;
    },
    setCustomizationEnabled: async (customizationId: string, enabled: boolean): Promise<boolean> => {
      if (!holds(session?.customizations, customizationId)) return false;
      deliver('session', {
        type: 'session/customizationToggled',
        id: customizationId,
        enablement: [{ kind: 'session', enabled }],
      });
      return true;
    },
    startMcpServer: async (serverId: string): Promise<boolean> => {
      if (!holds(session?.customizations, serverId)) return false;
      deliver('session', { type: 'session/mcpServerStartRequested', id: serverId });
      return true;
    },
    stopMcpServer: async (serverId: string): Promise<boolean> => {
      if (!holds(session?.customizations, serverId)) return false;
      deliver('session', { type: 'session/mcpServerStopRequested', id: serverId });
      return true;
    },
    awaiting: () => [...awaited],
    /* A token for a resource the inner session asked for, handed to the inner host. */
    authenticated: async (resource: string, token: string): Promise<boolean> => {
      if (client === undefined || !ready || closed || ended !== undefined || !awaited.has(resource)) return false;
      try {
        await client.request('authenticate', { channel: ROOT, resource, token });
        awaited.delete(resource);
        return true;
      }
      catch (error) {
        log(`${provider} in computer://${id}: the host inside did not take the token for ${resource}: ${reason(error)}`);
        return false;
      }
    },
    ended: () => ended,
    settings: (): Record<string, unknown> => ({
      ...innerConfig(start.settings ?? {}),
      ...((session?.config?.values ?? {}) as Record<string, unknown>),
    }),
    /*
     * Disposed, then stopped: the inner host is asked to dispose its session
     * and its backend and given `DISPOSE_WAIT` to answer, its input is closed,
     * and the process gets `SIGTERM` and then `SIGKILL`.
     *
     * `removing` says which of the two this close is: a session being deleted
     * loses the transcript inside, and a session being started again - a
     * directory added, a folder moved - keeps it, because the inner host
     * resumes it - decision
     * `a-nested-session-resumes-its-inner-transcript-by-id`. Only the first
     * call decides, since it is the one that starts the sequence.
     *
     * A restart's promise settles when the process has gone, because the
     * caller is about to start another host on this same session and two of
     * them must not be writing one transcript - and it settles at `KILL_AFTER`
     * plus a margin whatever the process does, so a host inside that will not
     * go is a line in the log rather than a machine that never starts again. A
     * removal's settles when the sequence has been sent, as it always did: the
     * host is going anyway, and `Host.close` waits on it from the outside,
     * bounded.
     */
    close: (removing = true): Promise<void> => {
      closing ??= (async () => {
        closed = true;
        /*
         * A restart that arrives while the host inside is still coming up has
         * no process to stop yet: `host` is set once `startInside` has answered,
         * and not before. Waiting for the start is what keeps the host that
         * replaces this session from being started while the host it replaces
         * is still on its way in - and `bringUp` reads `closed` the moment it
         * has the process, stops it there and returns, so this wait ends with
         * the old host already leaving. A start that failed is nothing for this
         * close to say: it was announced when it happened. The wait is bounded
         * the way the one for a process that was stopped is, since a start that
         * never settles would otherwise hold a restart for good.
         */
        if (!removing && host === undefined) {
          const settled = await bounded(starting.then(() => true, () => true), HANDOVER_WAIT);
          if (settled !== true) log(`${provider}: the host inside computer://${id} had not started ${HANDOVER_WAIT}ms after this session was closed, and it is started again without it`);
        }
        const held = client;
        /*
         * A session removed while the request that makes the one inside is
         * still in flight - a nested session deleted a moment after it was
         * made - is the case the dispose below cannot see for itself: `ready`
         * is set at the end of the start-up, and the machine's store already
         * holds what the create wrote, which outlives this host and is what
         * the next one would resume. Waiting for the answer is what makes the
         * removal a removal, and a create that failed is a session that was
         * never made, so the dispose is skipped and the host is stopped as it
         * was. `make` asks for nothing once `closed` is set, so nothing starts
         * behind this wait.
         */
        const made = removing && making !== undefined
          ? await making.then(() => true, () => false)
          : false;
        const up = (ready || made) && held !== undefined && ended === undefined;
        if (removing && up && held !== undefined) {
          await bounded(held.request('disposeSession', { channel: innerSession }), DISPOSE_WAIT);
        }
        await held?.shutdown().catch(() => { /* nothing left to say */ });
        stop();
        /*
         * And the process, gone: `exit`, `close` or `error`, whichever the
         * process has said first. `SIGKILL` was sent `KILL_AFTER` ago, so a
         * process that has not gone by the margin after it is one nothing here
         * can end, and the restart goes on without it rather than never.
         */
        if (!removing && host !== undefined) {
          const goneYet = await bounded(gone.then(() => true), HANDOVER_WAIT);
          if (goneYet !== true) log(`${provider}: the host inside computer://${id} is still there ${HANDOVER_WAIT}ms after it was stopped, and it is started again without it`);
        }
      })();
      return closing;
    },
  };
};

/** What deleting a nested session that is not running needs to reach its copy. */
export interface NestedDeleteAsked {
  /** The machine's id, as in `computer://<id>`. */
  id: string;
  /** The plugins the host inside loads: the recorded plugin of the session's agent. */
  plugins: string[];
  /** The id the inner host holds the session under, which is the outer one's. */
  sessionId: string;
  /** The session's port, which is where the host inside is started. */
  computers?: ComputerPort;
  /** One line worth keeping, for the copy that could not be reached. */
  log?: (line: string) => void;
}

/**
 * A nested session's copy inside its machine, gone.
 *
 * The half of a delete a session that is not running has no close for: a host
 * is started inside the machine for one question. The listing is what puts the
 * row in that host's catalogue without opening it - the session is not running
 * there either, and starting its agent only to delete it would be the work of a
 * resume nobody asked for - and `disposeSession` then takes it out of the
 * host's store, which is what the next daemon would have listed and resumed.
 *
 * A session the inner host does not list is already gone, which is the answer a
 * delete twice gets. Everything else - no such machine, a host that will not
 * start, one that does not answer - is a line and never a throw: what was asked
 * for is that the session is gone from this host, and the copy inside is the
 * part that could not be reached.
 */
export const deleteNested = async (asked: NestedDeleteAsked): Promise<void> => {
  const say = asked.log ?? ((): void => { /* nothing was given to say it to */ });
  const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  const where = `computer://${asked.id}`;
  let started: NestedStarted;
  try {
    started = await startInside({
      id: asked.id,
      plugins: asked.plugins,
      ...(asked.computers === undefined ? {} : { computers: asked.computers }),
    });
  }
  catch (error) {
    say(`could not delete ${asked.sessionId} inside ${where}: ${reason(error)}`);
    return;
  }
  const opened = started.host;
  let exited = false;
  opened.on('close', () => { exited = true; });
  opened.on('error', () => { exited = true; });
  const stop = (): void => {
    if (exited) return;
    opened.kill('SIGTERM');
    const later = setTimeout(() => { if (!exited) opened.kill('SIGKILL'); }, KILL_AFTER);
    later.unref?.();
  };
  const client = new AhpClient(
    stdioTransport(opened, () => { /* its own lines say nothing a delete needs */ }, () => { exited = true; }),
    { requestTimeoutMs: ANSWER_TIMEOUT },
  );
  try {
    // This is not a session, so there is nothing for the host inside to ask it.
    client.setServerRequestHandler(async (method: string) => {
      throw new Error(`this delete answers nothing to the host inside ${where}, so ${method} is not answered`);
    });
    client.connect();
    const hello = await client.initialize({ clientId: `ahpd-nested-delete-${asked.id}`, protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS] });
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(hello.protocolVersion)) {
      throw new Error(`the host inside ${where} speaks ${hello.protocolVersion}, and this host offered ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`);
    }
    const listed = await client.request('listSessions', { channel: ROOT });
    const row = listed.items.find((one) => idOf(one.resource) === asked.sessionId);
    if (row === undefined) say(`${asked.sessionId} is not in ${where} any more, so nothing was deleted there`);
    else await bounded(client.request('disposeSession', { channel: row.resource }), DISPOSE_WAIT);
  }
  catch (error) {
    say(`could not delete ${asked.sessionId} inside ${where}: ${reason(error)}`);
  }
  await client.shutdown().catch(() => { /* nothing left to say */ });
  stop();
};
