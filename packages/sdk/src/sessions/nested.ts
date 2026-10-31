/**
 * A session that runs in a host started inside a computer.
 *
 * A backend whose loop, tools and shell all run in this process cannot be
 * moved into a machine, and the host still owns the session a client sees. So
 * a whole `ahpd` with that backend loaded is started inside the machine, in
 * stdio mode, and this is the outer session that carries it: it speaks AHP to
 * the host inside with `AhpClient`, forwards the client's turns and answers,
 * and emits what the inner host says as the outer session's own actions.
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
 * resume continues the transcript the machine holds.
 */

import { spawn as startProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { AhpClient, RpcError } from '@microsoft/agent-host-protocol/client';
import type { AhpTransport, Subscription, TransportFrame } from '@microsoft/agent-host-protocol/client';
import { chatReducer, rootReducer, sessionReducer, SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import type { ChatAction, ChatState, RootAction, RootState, SessionAction, SessionState, StateAction } from '@microsoft/agent-host-protocol';
import { idOf, uriFor } from './catalog.js';
import { posixUriOf, uriOf } from '../resources/fileuri.js';
import { machinePathOf } from '../machines/machine.js';
import { subagentChatUri } from '../host/channels.js';
import { STOP_FLAG } from '../host/background.js';
import { ANSWER_TIMEOUT } from '../rpc.js';
import { computerId } from '../machines/computers.js';
import type { Agent, Start } from '../types/agent.js';
import type { BackgroundTask } from '../types/background.js';
import type { Bag } from '../types/common.js';
import type { ComputerPort, HandedAgent, HandedRecord, NestedHost, NestedStarted } from '../types/computers.js';
import type { Chosen, Handed, MessageFrom, Session, SubagentChat } from '../types/session.js';

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

/*
 * What a started inner host is is the port's, not this file's: `connect` answers
 * one over a socket, and `NestedHost` is what both roads hand back. Re-exported
 * here because this is where a caller of the proxy looks for it.
 */
export type { NestedHost, NestedStarted };

/** What the proxy asks for a host inside a machine. */
export interface NestedAsked {
  /** The machine's id, from the session's `computer://` setting. */
  id: string;
  /** The plugin specs the inner host loads. */
  plugins: string[];
  /** Where inside the machine it starts, when the session named a folder. */
  cwd?: string;
  /** The record the host inside serves, for an agent made from a record. */
  record?: HandedRecord;
  /** The session's port, which is where the default `start` asks. */
  computers?: ComputerPort;
}

/** How one session of this backend runs nested. */
export interface NestedOptions {
  /**
   * The plugins the host inside loads: the one that registered this agent on
   * this host, as the host recorded its spec.
   *
   * Empty when nothing is recorded, and then `handed` is asked. When neither
   * answers, the session ends with a sentence saying the host does not know
   * which plugin serves it, and nothing is started.
   */
  plugins: string[];
  /**
   * The plugin and the record of an agent made from a record, asked at each
   * start of the host inside when `plugins` is empty.
   */
  handed?: () => Promise<HandedAgent | undefined>;
  /** How long a question to the inner host waits. Default `ANSWER_TIMEOUT`. */
  timeoutMs?: number;
  /**
   * Start the inner host, where the port has a road the default does not take.
   *
   * A test hands in in-memory streams, and a host whose port can `connect`
   * hands back the socket the machine opened for this session. Answers the
   * host alone, or the host with the path inside the machine its session works
   * at, or nothing for a machine this caller does not serve: nothing falls back
   * to the default, which asks the port for a spawn here.
   */
  start?: (asked: NestedAsked) => NestedHost | NestedStarted | undefined | Promise<NestedHost | NestedStarted | undefined>;
  /** One line worth keeping. Nothing is logged without one. */
  log?: (line: string) => void;
  /**
   * What the session does when a host that `start` answered goes while it is ready.
   *
   * `end` stops the session with a sentence, and the next turn resumes it by
   * the inner host's id. `reconnect` keeps it, and opens it again through the
   * same `start` - which is how a session on a node survives the node's
   * `ahpd join` restarting: the node dials the hub again, and the port hands
   * this session a socket on the other side. Left out, or for a host the
   * default started, the session ends for good, as a machine's does.
   */
  restart?: 'end' | 'reconnect';
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
    ...(asked.record === undefined ? {} : { record: asked.record }),
  });
  if (spawn === undefined) throw new Error(`There is no computer called computer://${asked.id}`);
  const host = startProcess(spawn.command, spawn.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    // On Windows the command is a console program - `ssh.exe`, `docker.exe` -
    // and a daemon has no console, so without this each session opens a window
    // that stays for as long as the session runs.
    windowsHide: true,
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

/**
 * A `file://` URI for a path, as a session's working directories are spelled.
 *
 * A path that starts with `/` is a POSIX path, and is spelled as one on any
 * host: the folder inside a machine is the machine's, and a Windows host that
 * read `/home/me/work` by its own rules handed the inner host
 * `file:///C:/home/me/work`, which names nothing there.
 */
const fileUri = (path: string): string => (path.startsWith('/') ? posixUriOf(path) : uriOf(path));

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
  /** The plugins the host inside loads, which a record agent's start fills. */
  let plugins = options.plugins;
  const restart = options.restart;
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
  /**
   * Resolves when the process has gone, and is armed again for each one opened.
   *
   * A session that came back on a second host has a second process, and a
   * close that waited on the first one being gone would wait on nothing.
   */
  let gone = new Promise<void>((resolve) => { onGone = resolve; });
  let root: RootState | undefined;
  let session: SessionState | undefined;
  let chat: ChatState | undefined;
  let ready = false;
  /**
   * Whether the session inside is to be resumed rather than made.
   *
   * True from the start for a session this host was asked to resume, and true
   * again once the host inside has gone and the session is opened on the id it
   * already has.
   */
  let resuming = start.resume !== undefined;
  /** Whether the host inside is being opened again, so one gone host starts one. */
  let reopening = false;
  /** Whether the host inside is one `start` answered, which is the only kind `restart` applies to. */
  let answered = false;
  /** The sentence this session ended with, gone for good: the host refuses what follows. */
  let ended: string | undefined;
  /**
   * The sentence the session stopped with, while it can still be opened again.
   *
   * A session whose node went under `end` is shown as failed with this
   * sentence, and the next turn opens it again at its own id - so it is not
   * `ended`, which is a session that refuses everything that follows.
   */
  let halted: string | undefined;
  let closed = false;
  /** The request that makes the session inside, while it is in flight. */
  let making: Promise<unknown> | undefined;
  /** The close in flight, so a second caller waits on the same one. */
  let closing: Promise<void> | undefined;
  let turn: string | undefined;
  /**
   * The folder this host named, and where it is inside the machine, as URIs.
   * Inside is the folder's machine path until the port says otherwise.
   */
  const outside = start.workingDirectory === undefined ? undefined : fileUri(start.workingDirectory);
  let inside = start.workingDirectory === undefined ? undefined : fileUri(machinePathOf(start.workingDirectory));
  /** The resources the inner host asked this session's client to sign into. */
  const awaited = new Set<string>();
  /** What was asked for before the inner session existed, in order. */
  const waiting: (() => void)[] = [];
  /** The name this session's client gives itself to the host inside. */
  const clientId = `ahpd-nested-${id}`;
  /**
   * The actions clients outside sent that the host inside has been handed and
   * has not answered, by the `clientSeq` this session's client sent each with.
   *
   * The host inside answers each one on the envelope that carries that
   * client's origin, with its echo or its rejection, and that answer is the
   * one the client outside is owed for its own action.
   */
  const answering = new Map<number, Handed>();
  /** The actions clients outside sent that wait, with `waiting`, for the host inside. */
  const unsent = new Set<Handed>();
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

  /**
   * One action for the host inside, and the client action outside it carries
   * out, when a client sent one: held until the host inside answers it, and
   * refused when nothing will.
   */
  const deliver = (channel: 'session' | 'chat', action: Bag, handed?: Handed): void => {
    if (closed || ended !== undefined) {
      handed?.refuse(ended ?? `${provider}'s session in computer://${id} has closed`);
      return;
    }
    if (handed !== undefined) unsent.add(handed);
    gate(() => {
      // Refused while it waited, and so let go of by the client that sent it.
      if (handed !== undefined && !unsent.delete(handed)) return;
      try {
        const sent = client?.dispatch(channel === 'chat' ? innerChat : innerSession, action as unknown as StateAction);
        if (sent !== undefined && handed !== undefined) answering.set(sent.clientSeq, handed);
      }
      catch (error) {
        log(`${provider}: could not reach the host inside computer://${id}: ${reason(error)}`);
        handed?.refuse(`${provider}'s host inside computer://${id} could not be reached: ${reason(error)}`);
      }
    });
  };

  /** A client's action, carried to the host inside and answered from there to the client that sent it. */
  const carry = (channel: 'session' | 'chat', action: Bag): void => { deliver(channel, action, start.handed?.(action)); };

  /**
   * Refuse every client action the host inside will not answer now.
   *
   * Its answers would come over the connection that has gone, or from a
   * session that has ended, and each client outside holds its action until
   * it hears one.
   */
  const unanswered = (sentence: string): void => {
    for (const handed of [...answering.values(), ...unsent]) handed.refuse(sentence);
    answering.clear();
    unsent.clear();
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
    halted = undefined;
    log(`${provider} in computer://${id}: ${message}`);
    unanswered(message);
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

  /**
   * Stop the session where it ran, in a sentence, and leave it openable again.
   *
   * This is what `end` - the default - does when the node a session runs on
   * restarts its `ahpd join`: the session is shown as failed with the sentence
   * naming the machine, and the next turn opens it again at the inner host's
   * id. It is not `fail`, because the host refuses every later action on a
   * session that answered `ended()` - which would be this one refusing the very
   * turn that resumes it.
   */
  const halt = (message: string): void => {
    if (ended !== undefined || halted !== undefined || closed) return;
    halted = message;
    ready = false;
    log(`${provider} in computer://${id}: ${message}`);
    unanswered(message);
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
  };

  /**
   * What the host inside going means for the session.
   *
   * Before it ever came up, it is a start that failed, and its own sentence is
   * the useful one. Once it is ready, a host `start` answered goes as
   * `restart` says: `end` stops the session where it ran, and the next turn
   * opens it again by the inner host's id; `reconnect` keeps it and opens it
   * again through the same `start`, which is how a session on a node outlives
   * the node's `ahpd join` restarting. Any other host going ends the session.
   */
  const lost = (why: string): void => {
    if (ended !== undefined || closed) return;
    if (!ready) {
      fail(`${provider}'s host inside computer://${id} ended before its session started${why === '' ? '' : ` (${why})`}.${lastWords()}`);
      return;
    }
    if (restart === undefined || !answered) {
      fail(`${provider}'s host inside computer://${id} ended${why === '' ? '' : `: ${why}`}.${lastWords()}`);
      return;
    }
    if (restart === 'reconnect') {
      unanswered(`${provider}'s host inside computer://${id} ended${why === '' ? '' : `: ${why}`}, and the session is being opened again there`);
      void reopen(why);
      return;
    }
    halt(`${provider}'s host inside computer://${id} ended${why === '' ? '' : `: ${why}`}.${lastWords()}`);
  };

  /**
   * The same session, on the host the node started for it now.
   *
   * The socket that carried it is gone and the node is dialling again; `start`
   * is what asks the port for the new one, and a port with a node in the
   * middle waits a bounded time for it rather than failing at the moment the
   * node is about to be back. A reopen that fails ends the session in a
   * sentence saying so, which is the same end `end` gives straight away.
   */
  const reopen = async (why: string): Promise<void> => {
    if (closed || reopening) return;
    reopening = true;
    ready = false;
    exited = false;
    resuming = true;
    log(`${provider} in computer://${id} lost the host it was running on${why === '' ? '' : ` (${why})`}; opening the session again there`);
    try {
      await bringUp();
    }
    catch (error) {
      fail(`${provider}'s session in computer://${id} could not be opened again after its host ended: ${reason(error)}.${lastWords()}`);
    }
    finally {
      reopening = false;
    }
  };

  /** Each inner chat this session serves, by its inner URI, to the outer URI it is served under. */
  const outerOf = new Map<string, string>();
  /** The inner chats this session does not serve, each logged once. */
  const unserved = new Set<string>();

  /**
   * A file URI the inner session names, as the folder this host named.
   *
   * The same text on Linux and macOS, where the folder is mounted at its own
   * path; on Windows the machine's `/c/...` is the host's `C:\...`. Anything
   * not under the folder inside is left as it is.
   */
  const outerDir = (uri: string): string => {
    if (inside === undefined || outside === undefined || inside === outside) return uri;
    if (uri === inside) return outside;
    if (uri.startsWith(`${inside}/`)) return `${outside}${uri.slice(inside.length)}`;
    return uri;
  };

  /** A value with every inner chat URI it carries put under its outer name, and every file URI under the host's folder. */
  const outward = (value: unknown): unknown => {
    if (typeof value === 'string') return outerOf.get(value) ?? outerDir(value);
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
   * Report an inner background row through the outer host's seam, or nothing.
   *
   * The host inside has already built the row and decided what a client may do
   * with it; what this session adds is the outer names - the chat the row is
   * on, and the worker chat a subagent row names - and a stop of its own, which
   * is a request to the host inside rather than a function held out here.
   *
   * `terminal` is left off deliberately: it names a channel of the host
   * inside, which a client out here has no way to subscribe to.
   *
   * Answers whether it took the action. A `Start` with no seam is not one of
   * this host's - only a caller building one by hand - and there the row is
   * left to `served`, which emits it as it came.
   */
  const reported = (action: Bag): boolean => {
    const type = String(action.type);
    if (type !== 'chat/backgroundWorkSet' && type !== 'chat/backgroundWorkRemoved') return false;
    const tasks = start.backgroundTasks;
    if (tasks === undefined) return false;
    if (type === 'chat/backgroundWorkRemoved') {
      tasks.remove(start.chatUri, String(action.id ?? ''));
      return true;
    }
    const work = (action.work ?? {}) as Bag;
    const meta = (work._meta ?? {}) as Bag;
    const taskId = String(work.id ?? '');
    const inside = innerChat;
    /*
     * The stop is the outer host asking the inner one, because that is where
     * the backend that knows how to stop the task is. Its answer is the inner
     * host's, unwrapped: `{ stopped }` there is the answer a client outside
     * would have got had the task been reported here in the first place.
     */
    const stop = async (): Promise<boolean> => {
      if (client === undefined || ended !== undefined || closed) return false;
      try {
        /*
         * Through a widened `request`, because the client is typed over the
         * protocol's own commands and `vscode/*` is exactly what this
         * repository serves outside them. The inner host answers it the same
         * way a client of its own would be answered.
         */
        const ask = client.request.bind(client) as unknown as (method: string, params: Record<string, unknown>) => Promise<unknown>;
        const answer = await ask('vscode/stopBackgroundWork', { chat: inside, id: taskId }) as { stopped?: unknown } | undefined;
        return answer?.stopped === true;
      }
      catch (error) {
        log(`${provider} in computer://${id}: could not stop ${taskId} inside: ${reason(error)}`);
        return false;
      }
    };
    const task: BackgroundTask = {
      id: taskId,
      kind: work.kind === 'subagent' ? 'subagent' : 'shell',
      label: String(work.label ?? ''),
      startedAt: String(work.startedAt ?? ''),
      ...(work.kind === 'subagent'
        // The inner chat, named outside when this session serves that worker -
        // and as it came when it does not, because the protocol requires the
        // field and there is no other chat to name.
        ? { chat: String(outward(work.chat ?? '') ?? '') }
        : { command: typeof work.command === 'string' ? work.command : '' }),
      ...(meta[STOP_FLAG] === true ? { stop } : {}),
    };
    tasks.set(start.chatUri, task);
    return true;
  };

  /**
   * One inner action as the outer session says it, or nothing.
   *
   * Every chat URI in it is the outer one. A catalogue action about a chat
   * this session does not serve - a worker's chat, a fork - is kept back, so a
   * client is never told of a chat it cannot open, and a reorder names only
   * the chats that are served. A `chat/inputCompleted` is kept back as well,
   * because the outer host says it once `answer` has taken it.
   */
  const served = (channel: 'session' | 'chat', action: Bag): Bag | undefined => {
    if (channel === 'session' && action.type === 'session/chatsReordered' && Array.isArray(action.chats)) {
      return { ...action, chats: (action.chats as unknown[]).filter((chat) => typeof chat === 'string' && outerOf.has(chat)).map(outward) };
    }
    if (channel === 'session' && action.type === 'session/chatAdded' && opensWorker((action.summary ?? {}) as Bag)) return undefined;
    if (channel === 'chat' && action.type === 'chat/inputCompleted') return undefined;
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
        const { action, origin, rejectionReason } = event.params;
        /*
         * The answer to a client action outside, when it carries this client's
         * origin: the host inside says the echo of what it was handed, or
         * rejects it, on the envelope that names the `clientSeq` it came under.
         */
        const sentAs = origin?.clientId === clientId ? origin.clientSeq : undefined;
        const handed = sentAs === undefined ? undefined : answering.get(sentAs);
        if (sentAs !== undefined) answering.delete(sentAs);
        /*
         * A rejection changes nothing, inside or out: the client that sent the
         * action is refused with the reason the host inside gave, and the
         * mirror and every other client are left as they were.
         */
        if (rejectionReason !== undefined) {
          if (handed !== undefined) handed.refuse(rejectionReason);
          else log(`${provider} in computer://${id}: the host inside refused ${action.type}: ${rejectionReason}`);
          // A turn refused inside never runs, so nothing ends it here either.
          if (action.type === 'chat/turnStarted' && turn === action.turnId) turn = undefined;
          continue;
        }
        /*
         * A background row is reported, not relayed.
         *
         * The host inside built it from its backend's own task and drew it for
         * its own clients; out here the row has to be this host's, naming this
         * chat and this session's stop, so it goes through the seam and the
         * host out here builds it again. It is taken before the reduce, so the
         * mirror this session answers a late subscriber with does not carry a
         * row the host out here keeps.
         */
        if (channel === 'chat' && reported(action as unknown as Bag)) continue;
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
        if (shown !== undefined) start.emit(channel, shown, handed);
      }
    }
    catch (error) {
      if (ended === undefined && halted === undefined && !closed) {
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
    const handed = options.plugins.length === 0 ? await options.handed?.() : undefined;
    if (handed !== undefined) plugins = [handed.plugin];
    if (plugins.length === 0) throw new Error(`this host does not know which plugin serves ${provider}, so it cannot start one there`);
    const asked: NestedAsked = {
      id,
      plugins,
      ...(start.workingDirectory === undefined ? {} : { cwd: start.workingDirectory }),
      ...(handed === undefined ? {} : { record: handed.record }),
      ...(start.computers === undefined ? {} : { computers: start.computers }),
    };
    const offered = options.start === undefined ? undefined : await options.start(asked);
    answered = offered !== undefined;
    const answer = offered ?? await startInside(asked);
    const started: NestedStarted = 'stdin' in answer ? { host: answer } : answer;
    const opened = started.host;
    host = opened;
    gone = new Promise<void>((resolve) => { onGone = resolve; });
    exited = false;
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
        lost(why);
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
    const hello = await held.initialize({ clientId, protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS] });
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(hello.protocolVersion)) {
      throw new Error(`the host inside computer://${id} speaks ${hello.protocolVersion}, and this host offered ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`);
    }
    const listed = await held.subscribe(ROOT);
    root = listed.result.snapshot?.state as RootState | undefined;
    void pumpRoot(listed.subscription);
    innerProvider = servedAs((root?.agents ?? []).map((agent) => agent.provider));
    innerSession = uriFor(sessionId);
    innerChat = defaultChatFor(innerSession);
    /*
     * This host's trust in the session's folder, carried to the folder inside.
     *
     * The host inside reads trust from the client connected to it, which is
     * this proxy, and a proxy that said nothing is a client that trusts
     * nothing: an ACP agent there was refused in every machine. Trust stays the
     * person's: only a folder this host's client vouched for is vouched for
     * inside, and only the one folder the session works in there. Sent on the
     * same stream before the create, so the create reads it.
     */
    if (inside !== undefined && start.workingDirectory !== undefined && start.trusted?.(start.workingDirectory) === true) {
      held.dispatch(ROOT, { type: 'root/configChanged', config: { workspaceTrust: { enabled: true, trustedUris: [inside] } } } as unknown as StateAction);
    }
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
     * host resumes a session it is not running.
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
    if (!resuming) await make();
    const lead = await held.subscribe(innerSession).catch(async (error: unknown) => {
      if (!resuming || !(error instanceof RpcError) || error.code !== NO_AGENT) throw error;
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
    halted = undefined;
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

  /** Whether a tool call of the running turn waits on a confirmation. */
  const confirming = (toolCallId: string): boolean => (chat?.activeTurn?.responseParts ?? []).some((part) => {
    const held = part as { kind?: unknown; toolCall?: { toolCallId?: unknown; status?: unknown } };
    return held.kind === 'toolCall' && held.toolCall?.toolCallId === toolCallId
      && held.toolCall.status === 'pending-confirmation';
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
    /*
     * The id above is the session id from the first breath, and it is not one
     * the host inside the machine can be asked for again: a start that finds no
     * session under it makes a new one rather than reopening what was there. So
     * a chat of a session inside a machine is never movable.
     */
    resumable: () => false,
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
        // Said in the snapshot too, for a client that subscribes after the end,
        // and while the session is stopped and the next turn would open it again.
        ...(ended === undefined && halted === undefined ? {} : { lifecycle: 'failed', creationError: { errorType: 'sessionStartFailed', message: ended ?? halted } }),
        resource: start.uri,
      };
    },
    chatState: (): Bag => ({ ...(outward(chat ?? { title: mine.title(), status: mine.status(), modifiedAt: mine.modifiedAt(), turns: [] }) as Bag), resource: start.chatUri }),

    begin: (turnId: string, text: string, model?: Chosen, from?: MessageFrom): void => {
      turn = turnId;
      /*
       * A turn after the session stopped is the turn that resumes it: the
       * session inside is opened again at its own id, and the action waits
       * behind the gate until the inner host holds that session, so the client
       * that said one more thing gets the conversation it had.
       */
      if (halted !== undefined && !closed) {
        halted = undefined;
        void reopen('');
      }
      carry('chat', {
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
      // A message queued on a session that stopped resumes it the way a turn
      // does: it is a turn waiting, and the host inside is where it waits.
      if (halted !== undefined && !closed) {
        halted = undefined;
        void reopen('');
      }
      carry('chat', {
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
      carry('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id: queueId });
    },
    reorder: (order: string[]): void => {
      carry('chat', { type: 'chat/queuedMessagesReordered', order });
    },
    setDraft: (draft: Bag | undefined): void => {
      carry('chat', { type: 'chat/draftChanged', ...(draft === undefined ? {} : { draft }) });
    },
    /* Taken only while the inner chat has a turn running. */
    steer: (steerId: string, text: string): boolean => {
      if (chat?.activeTurn === undefined) return false;
      carry('chat', { type: 'chat/pendingMessageSet', kind: 'steering', id: steerId, message: { text } });
      return true;
    },
    /* Taken only for the inner chat's last turn, when it failed and nothing runs. */
    resume: (turnId: string): boolean => {
      const last = chat?.turns.at(-1);
      if (chat?.activeTurn !== undefined || last === undefined || last.id !== turnId || last.state !== 'error') return false;
      carry('chat', { type: 'chat/turnResume', turnId });
      return true;
    },
    cancel: (turnId: string): void => {
      if (turn === turnId) turn = undefined;
      carry('chat', { type: 'chat/turnCancelled', turnId });
    },
    /* Taken only for a tool call of the running inner turn that waits on a confirmation. */
    confirm: (toolCallId: string, approved: boolean, optionId?: string): boolean => {
      const running = chat?.activeTurn;
      if (running === undefined || !confirming(toolCallId)) return false;
      carry('chat', {
        type: 'chat/toolCallConfirmed',
        turnId: running.id,
        toolCallId,
        approved,
        ...(optionId === undefined ? {} : { selectedOptionId: optionId }),
      });
      return true;
    },
    /* Taken only for an input request the inner session has open. */
    answer: (requestId: string, accepted: boolean, answers: Bag): boolean => {
      const open = (session?.inputNeeded ?? []).some((entry) => entry.id === requestId) || asking(requestId);
      if (!open) return false;
      deliver('chat', { type: 'chat/inputCompleted', requestId, response: accepted ? 'accept' : 'decline', answers });
      return true;
    },
    /* Taken only for an input request the running inner turn has open. */
    setAnswer: (requestId: string, questionId: string, answer: Bag | undefined): boolean => {
      if (!asking(requestId)) return false;
      carry('chat', { type: 'chat/inputAnswerChanged', requestId, questionId, ...(answer === undefined ? {} : { answer }) });
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
      carry('session', { type: 'session/mcpServerStartRequested', id: serverId });
      return true;
    },
    stopMcpServer: async (serverId: string): Promise<boolean> => {
      if (!holds(session?.customizations, serverId)) return false;
      carry('session', { type: 'session/mcpServerStopRequested', id: serverId });
      return true;
    },
    /*
     * Handed inside, and answered from there.
     *
     * Whether the server was blocking is the inner session's own state, so
     * there is nothing to decide out here: the action is carried to the host
     * inside, whose answer reaches the client outside that sent it. True,
     * because the request reached the host that can do something about it -
     * and no `holds` check, because the answer either way is the same action,
     * and the inner host treats one for a server it does not have as the no-op
     * it is.
     */
    backgroundMcpServerStartup: async (serverId: string): Promise<boolean> => {
      carry('session', { type: 'session/mcpServerBackgroundRequested', id: serverId });
      return true;
    },
    awaiting: () => [...awaited],
    /*
     * A token for a resource the inner session asked for, handed to the inner host.
     *
     * One aimed at a server goes in aimed at the same server, which the
     * session inside publishes under the same id, so the host there gives it
     * to that server alone. The resource then stays awaited, because another
     * server inside may still wait for it.
     */
    authenticated: async (resource: string, token: string, server?: string): Promise<boolean> => {
      if (client === undefined || !ready || closed || ended !== undefined || !awaited.has(resource)) return false;
      try {
        /*
         * Through a widened `request`, because the client is typed over the
         * 1.0.0 package and `target` came after it, with no version of its own.
         */
        const ask = client.request.bind(client) as unknown as (method: string, params: Record<string, unknown>) => Promise<unknown>;
        await ask('authenticate', {
          channel: ROOT,
          resource,
          token,
          ...(server === undefined ? {} : { target: { kind: 'mcpServer', session: innerSession, customizationId: server } }),
        });
        if (server === undefined) awaited.delete(resource);
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
     * `reason` says which of the two this close is. `dispose` is a session
     * being deleted, which loses the transcript inside; `stopping` is one
     * being started again - a directory added, a folder moved, this daemon
     * going down - which keeps it, because the inner host resumes it. Only the
     * first call decides, since it is the one that starts the sequence.
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
    close: (reason = 'dispose'): Promise<void> => {
      closing ??= (async () => {
        closed = true;
        const removing = reason === 'dispose';
        unanswered(`${provider}'s session in computer://${id} has closed`);
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
  /** The record the host inside serves, for an agent made from a record. */
  record?: HandedRecord;
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
      ...(asked.record === undefined ? {} : { record: asked.record }),
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
