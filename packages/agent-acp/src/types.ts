/**
 * The shapes this package exports.
 *
 * The agent's options, the connection's, and the per-turn state a
 * `session/update` is mapped through. Nothing here imports a runtime value, so
 * the contract can be read without spawning anything.
 */

import type {
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptResponse,
  SessionUpdate,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
} from '@agentclientprotocol/sdk';
import type { Bag, MessageFrom } from '@ahpd/sdk';

/** What an embedder, or a plugin's options, may set. */
export interface AcpOptions {
  /** The program to spawn as the ACP server. */
  command: string;
  /** The arguments to give it. */
  args?: string[];
  /** Environment variables merged over `process.env` for the child. */
  env?: Record<string, string>;
  /** The directory the server runs in; the session's working directory when absent. */
  cwd?: string;
  /** The AHP provider id. Default `acp`. */
  provider?: string;
  /** What a client reads instead of the id. Default `ACP`. */
  displayName?: string;
  /** One line about what this backend is. */
  description?: string;
  /** The model id a session that names none runs on. */
  model?: string;
}

/** One `session/update` notification, already routed by the session id it named. */
export interface AcpHandlers {
  update(sessionId: string, update: SessionUpdate): void;
}

/** How a connection spawns a server and where its updates go. */
export interface AcpConnectionOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  handlers: AcpHandlers;
}

/** One open ACP connection over a server's stdio. */
export interface AcpConnection {
  /**
   * The handshake, which is where the server says what it can do.
   *
   * Asks once and answers the held reply on a second call, because a server is
   * told what a client can do at the start of a connection and never again.
   */
  initialize(): Promise<InitializeResponse>;
  /** Open one session on the server, which names it. */
  newSession(request: NewSessionRequest): Promise<NewSessionResponse>;
  /** Reopen a session the server already has, which replays its history. */
  loadSession(request: LoadSessionRequest): Promise<LoadSessionResponse>;
  /** The sessions the server holds, when it advertises a catalogue. */
  listSessions(request: ListSessionsRequest): Promise<ListSessionsResponse>;
  /** Put the session into one of the server's modes. */
  setSessionMode(request: SetSessionModeRequest): Promise<SetSessionModeResponse>;
  /** Set one of the server's own session config options. */
  setSessionConfigOption(request: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse>;
  /** Send one prompt and wait for the turn to stop. */
  prompt(sessionId: string, text: string): Promise<PromptResponse>;
  /** The ACP cancel notification, which asks the server to stop a running prompt. */
  cancel(sessionId: string): Promise<void>;
  /** End the subprocess. */
  close(): void;
}

/** One tool call the server opened, as the mapping remembers it between updates. */
export interface AcpCall {
  /** The server's own id for the call, which every action names. */
  toolCallId: string;
  /** The programmatic name, when the server gave one, and its title otherwise. */
  toolName: string;
  /** What a client draws instead of the name. */
  displayName: string;
  /** Whether `chat/toolCallReady` has gone out for it. */
  readied: boolean;
}

/**
 * One turn's mapping state, mutated as updates arrive.
 *
 * The markdown part is opened by the session before the turn runs, so a text
 * delta always has somewhere to go. The reasoning part is opened by the
 * mapping at the first thought chunk, because nothing before it says one is
 * coming. `parts` is the turn's own response-part list, held for a snapshot.
 */
export interface AcpTurn {
  /** The turn the client began. */
  turnId: string;
  /** The markdown part the session opened before the first delta. */
  textPartId: string;
  /** Every response part this turn holds, shared with the session's snapshot. */
  parts: Bag[];
  /** The reasoning part id, once a thought chunk opens one. */
  reasoningPartId?: string;
  /** Tool calls this turn opened, by the server's own id. */
  calls: Map<string, AcpCall>;
}

/**
 * One turn this process watched, as the catalogue reads it back.
 *
 * The updates are kept raw rather than as the parts they built, because the
 * transcript is a second rendering of the same notifications: replaying them
 * through the one mapping is what stops a rebuilt conversation from disagreeing
 * with the live one.
 */
export interface WatchedTurn {
  /** The turn the client began. */
  turnId: string;
  /** ISO 8601 timestamp, taken from the action the turn began with. */
  startedAt: string;
  /** What began the turn, as the transcript reports it. */
  message: { text: string; origin?: MessageFrom['origin'] };
  /** How it ended, once it has. */
  state: 'complete' | 'cancelled' | 'error';
  /** How long it took, in milliseconds, once it has ended. */
  duration?: number;
  /** Every update the server sent while this turn ran. */
  updates: SessionUpdate[];
}

/**
 * One ACP session this process watched.
 *
 * The ACP server owns the conversation and `loadSession` is how it is read
 * back, so this is not a second store: it is what a catalogue row needs to open
 * onto something, kept for the life of the process and dropped when the process
 * is.
 */
export interface WatchedSession {
  /** The provider id this bridge registered, which keys the catalogue. */
  provider: string;
  /** The server's own session id. */
  id: string;
  /** The directory it was opened in. */
  cwd: string;
  /** Directories beside it, as paths rather than URIs. */
  additional: string[];
  /** The title the session reports, which is the first thing said until one is set. */
  title: string;
  /** ISO 8601 timestamp of the first time this process watched it. */
  createdAt: string;
  /** ISO 8601 timestamp of the last update this process watched. */
  modifiedAt: string;
  /** Every turn this process watched, in the order they ran. */
  turns: WatchedTurn[];
}
