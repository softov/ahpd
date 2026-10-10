import type { PromptCapabilities, SessionModeState, SessionUpdate } from '@agentclientprotocol/sdk';
import type { Bag, BoundTool, Emit, OpenedTerminal, Start } from '@ahpd/sdk';
import type { AcpConnection, AcpOptions, AcpTurn, ConfirmationOption, PermissionAnswer, WatchedSession, WatchedTurn } from '../types.js';
import type { ClientCalls } from './clientcalls.js';
import type { Config } from './config.js';
import type { Handlers } from './handlers.js';
import type { Opening } from './opening.js';
import type { Queue } from './queue.js';
import type { Turn } from './turn.js';

/**
 * Everything an area of a session reaches for, in one object.
 *
 * Built once in `acpSession` and handed to every area's factory, the way the
 * host hands one to its own. A `let` in the closure that crosses into another
 * file is a field here, and it is read as `ctx.<name>` where it is used rather
 * than copied onto a factory's own scope at construction - so the order the
 * areas are built in never matters and nothing is frozen.
 */
export interface SessionContext extends Config, Handlers, Opening, Queue, Turn, ClientCalls {
  /** The backend's identity and wiring. */
  options: AcpOptions;
  /** What this particular session was told. */
  start: Start;
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
  /** The directory the server works in. */
  where: string;
  /** Whether a path is one this session was given to work in. */
  inside: (path: string) => boolean;
  /** Move the session's modified stamp, and its record's with it. */
  touch: () => void;
  /** Say what it is doing, on both channels, the way a session mirrors its chat. */
  doing: (said: string | undefined) => void;
  /** `SessionStatus`: 8 is in progress, 4 waits on a person and 1 is idle. */
  status: () => number;
  /** The config in force, by key. `session/configChanged` merges into this. */
  settings: Record<string, unknown>;
  /** Finished turns. The running one is `active` and is deliberately not here. */
  turns: Bag[];
  /** What the host offered until the server reports its own. */
  seeds: Bag[];
  /** The commands the server last advertised, as customizations. */
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
  /** What the server said it can take in a prompt, once the handshake has said it. */
  takes: PromptCapabilities | undefined;
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
  /** Whether a client asked to stop, read when the prompt settles. */
  cancelRequested: boolean;
  closed: boolean;
  /** Why the last turn failed, or nothing. Cleared when a turn starts. */
  failed: string | undefined;
  title: string;
  /**
   * Whether a person named this session themselves.
   *
   * An agent may call a conversation what it likes until somebody says
   * otherwise; after that the name is theirs, and the agent's next idea for it
   * is read as nothing to do.
   */
  renamed: boolean;
  /** Messages waiting for the running turn to end. The host's, not a client's. */
  queued: Bag[];
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
    settle(answer: PermissionAnswer): void;
  }>;
  /** The terminals this session opened for the server, by the server's own id. */
  terminals: Map<string, { handle: OpenedTerminal; limit?: number }>;
}