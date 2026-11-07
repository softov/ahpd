import type { CreateElicitationResponse, PromptCapabilities, SessionModeState, SessionUpdate } from '@agentclientprotocol/sdk';
import type { Bag, BoundTool, Chosen, Emit, MessageAttachment, MessageFrom, OpenedTerminal, Start, TurnOptions } from '@ahpd/sdk';
import type { TypedAnswer } from '../mapping.js';
import type { AcpConnection, AcpOptions, AcpTurn, ConfirmationOption, PermissionAnswer, WatchedSession, WatchedTurn } from '../types.js';
import type { ClientCalls } from './clientcalls.js';
import type { Choice, Config } from './config.js';
import type { Handlers } from './handlers.js';
import type { Opening } from './opening.js';
import type { Turn } from './turn.js';

/** A turn handed while the server ran another: what `sendMessage` was handed. */
export interface PendingTurn {
  turnId: string;
  text: string;
  model?: Chosen | undefined;
  from?: MessageFrom | undefined;
  attachments?: MessageAttachment[] | undefined;
  options?: TurnOptions | undefined;
}

/**
 * One terminal this session opened for the server.
 *
 * A terminal outlives the call that made it - an agent starts a server or a
 * watch and goes on - which is what makes it background work once the call has
 * ended. A row says when the work started and the line it runs, so both are
 * kept beside the handle rather than read back from the host's channel.
 */
export interface HeldTerminal {
  handle: OpenedTerminal;
  /** The most bytes of output a read hands back, as the request that opened it asked. */
  outputByteLimit?: number;
  /** Whether the process has exited. */
  exited?: boolean;
  /** When the host opened it, as the row's `startedAt`. */
  openedAt: string;
  /** The command and its arguments, as one line. */
  command: string;
  /**
   * The id its row was reported under, while the row stands.
   *
   * Also what makes a removal happen once: an exit and a release can both come,
   * and the second one finds nothing left to remove.
   */
  listed?: string;
}

/**
 * Everything an area of a session reaches for, in one object.
 *
 * Built once in `acpSession` and handed to every area's factory, the way the
 * host hands one to its own. A `let` in the closure that crosses into another
 * file is a field here, and it is read as `ctx.<name>` where it is used rather
 * than copied onto a factory's own scope at construction - so the order the
 * areas are built in never matters and nothing is frozen.
 */
export interface SessionContext extends Config, Handlers, Opening, Turn, ClientCalls {
  /** The backend's identity and wiring. */
  options: AcpOptions;
  /** What this particular session was told. */
  start: Start;
  /**
   * How this session tells its agent the modes the server named.
   *
   * The agent's schema lists a preset's modes until a session of it hears the
   * server's own, so this is where the next session a client sets up for the
   * same agent reads the list the server last gave.
   */
  heardModes: ((modes: { id: string; name: string }[]) => void) | undefined;
  /**
   * The thinking levels each model offers, by model id, as the sessions of
   * this agent heard them from their servers.
   *
   * The agent's, shared by its sessions: a server names the levels of the model
   * in force, so the levels of a model are known once a session has run on it,
   * and every session lists them on that model from then on.
   */
  levels: Map<string, Choice[]>;
  /** The provider id this session reports, the backend's own or `acp`. */
  provider: string;
  /**
   * The tools this session may offer, the host's own and its clients'.
   *
   * What the host handed at the session's start, and what it replaces whole
   * whenever a client announces what it provides or stops being active. A
   * client's tool carries an owner, which is what a call the agent reports for
   * one is recognised by.
   */
  offering: BoundTool[];
  /** Say one thing on one channel, to every client watching it. */
  emit: Emit;
  /** The directory the server works in, ACP's `cwd`. */
  cwd: string;
  /** Whether a path is one this session was given to work in. */
  inside: (path: string) => boolean;
  /**
   * Set the chat's `modifiedAt`, and its record's with it.
   *
   * Set where the protocol's reducer sets it and nowhere else: to a turn's
   * start as it starts, and to its start plus its duration as it ends.
   */
  setModifiedAt: (at: string) => void;
  /** `SessionStatus`: 8 is in progress, 4 waits on a person and 1 is idle. */
  status: () => number;
  /** The config values in force, by key. `session/configChanged` merges into this. */
  values: Record<string, unknown>;
  /** Finished turns. The running one is `active` and is deliberately not here. */
  turns: Bag[];
  /** What the host offered until the server reports its own. */
  seeds: Bag[];
  /** The commands the server last advertised, as the built-in skills container a client draws. */
  commands: Bag[];
  /**
   * The modes the server named, once it has.
   *
   * ACP only names them on `session/new` and `session/load`, so a session that
   * has not opened yet cannot honestly report an enum for them; the agent's
   * own schema carries the property without one.
   */
  modes: SessionModeState | undefined;
  active: Bag | undefined;
  /**
   * The turns handed while the server ran another, in the order they came,
   * each prompted once the turn in front of it is over: a session runs one
   * prompt at a time, as the reference agent runs each send after the one
   * before it. The host said each start, so the turn it took the place of in
   * every client's state runs on here.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1814
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L358-L387
   */
  pendingTurns: PendingTurn[];
  /** The turns a later one took the place of, which run on and end in no history. */
  replaced: Set<string>;
  /** The running turn's mapping, so an update knows what it belongs to. */
  mapping: AcpTurn | undefined;
  /**
   * The session's cumulative cost as of the last `usage_update` read, which is
   * what the next turn counts from.
   *
   * ACP reports a cost for the whole session rather than for a turn, so a turn
   * can only be told what it spent by the change since it opened.
   */
  cumulative: number | undefined;
  /** The connection this session spawned, once it has one. */
  live: AcpConnection | undefined;
  /** The server's own id for this conversation, once `session/new` answered. */
  acpSessionId: string | undefined;
  /** Whether the server said it can be asked to close that conversation. */
  closes: boolean;
  /**
   * Whether the server said it can be handed a conversation back by its id.
   *
   * The handshake's `loadSession`, kept because a chat is offered as movable
   * only where a move would work: a server without it holds its conversations
   * in the process, so one here could not be picked up again.
   */
  loads: boolean;
  /**
   * Whether the server said it can take a conversation back without replaying it.
   *
   * The handshake's `sessionCapabilities.resume`. A server with it is asked for
   * the session rather than handed the whole conversation again, which is what
   * a client that already holds the turns wants - and the only way to continue
   * a conversation on a server that has no `loadSession` at all.
   */
  resumes: boolean;
  /**
   * Whether the server said it can copy a conversation into a new one.
   *
   * The handshake's `sessionCapabilities.fork`, which is UNSTABLE in ACP and
   * absent from most servers. Read per session because it is the server's own
   * answer, and what decides whether a turn has a fork point at all.
   */
  forks: boolean;
  /** What the server said it can take in a prompt, once its `initialize` answer has said it. */
  promptCapabilities: PromptCapabilities | undefined;
  /**
   * The updates a server replayed while this session was opening.
   *
   * A `session/load` answers with the whole conversation before its response,
   * and those updates are earlier turns rather than part of whichever turn
   * happened to ask for the server.
   */
  replay: SessionUpdate[];
  /** Whether the session is opening, so an update it sends is replay. */
  loading: boolean;
  /** The one opening, shared by every caller, so one server is spawned. */
  opening: Promise<{ connection: AcpConnection; sessionId: string }> | undefined;
  /**
   * What the record said when this session's server was last spawned, as one
   * string to compare.
   *
   * Read as the session is created, which is when its first server is built,
   * and empty for a backend that has no record behind it.
   */
  startedWith: string;
  /** Whether a client asked to stop, read when the prompt settles. */
  cancelRequested: boolean;
  /** Whether the session was disposed, after which no turn starts. */
  disposed: boolean;
  /** Why the last turn failed, or nothing. Cleared when a turn starts. */
  error: string | undefined;
  title: string;
  /**
   * Whether a person named this session themselves.
   *
   * An agent may call a conversation what it likes until somebody says
   * otherwise; after that the name is theirs, and the agent's next idea for it
   * is read as nothing to do.
   */
  renamed: boolean;
  /** Whether the title is one a local command suggested, which the first real message replaces. */
  provisional: boolean;
  /** The catalogue's record of this session, once the server has named it. */
  record: WatchedSession | undefined;
  /** The turn being watched, while one runs. Kept for the transcript. */
  watchedTurn: WatchedTurn | undefined;
  /**
   * The permissions the server is waiting on a person for, by tool call id.
   *
   * Held because the ACP request is answered from here: `confirm` settles the
   * promise the request is awaiting, which is what sends the reply back.
   */
  permissions: Map<string, {
    /** The input-needed entry id a client answers by. */
    requestId: string;
    /** The option an approval with no option picked selects, when the server offered a once option. */
    allow?: string;
    /** The option a refusal with no option picked selects, when it offered a once option. */
    reject?: string;
    /** Every option the server offered, as the call offers them to a person. */
    offered: ConfirmationOption[];
    /** The input-needed entry said for it, which the session's state lists while it stands. */
    entry?: Bag;
    settle(answer: PermissionAnswer): void;
  }>;
  /**
   * The terminals this session opened for the server, by the server's own id,
   * and whether each one's process has exited.
   */
  terminals: Map<string, HeldTerminal>;
  /**
   * The questions the server is waiting on a person for, by the request id.
   *
   * Held the way `permissions` is, and for the same reason: the ACP request is
   * answered from here. What is a person's here is the form's own fields, so
   * only the answers they name are handed back as content.
   */
  elicitations: Map<string, {
    /** The fields the server asked for, so an answer carries nothing else. */
    fields: Set<string>;
    /** Where each question open to an answer of its own takes a typed one, and whether it offers `None of the above`. */
    typed: Map<string, TypedAnswer>;
    /** The input-needed entry said for it, which the session's state lists while it stands. */
    entry?: Bag;
    settle(answer: CreateElicitationResponse): void;
  }>;
}