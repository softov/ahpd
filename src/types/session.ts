/** One agent session: its lifecycle, its turns, and what it is waiting for. */

import type { Bag } from './common.js';

/**
 * Emits one state action on a session's channel.
 *
 * `session` addresses the session channel, `chat` the chat channel beneath it.
 */
export type Emit = (channel: 'session' | 'chat', action: Bag) => void;

/** How to construct a session. */
export interface SessionOptions {
  /** The session channel URI, `ahp-session:/<id>`. */
  uri: string;
  /** The chat channel URI beneath it, `ahp-chat:/<id>`. */
  chatUri: string;
  /** The directory the agent works in. */
  cwd: string;
  /** Config values chosen at creation, by key. */
  settings?: Record<string, string>;
  /** The config schema this session reports, shared with the root channel. */
  schema?: () => Bag;
  /** Customizations to report until the agent reports its own. */
  seedCustomizations?: Bag[];
  /** Where state actions go. */
  emit: Emit;
  /** An existing agent session to continue, rather than starting a new one. */
  resume?: string;
  /** Turns already known, so a resumed session does not open empty. */
  seed?: Bag[];
  /** Called once the agent has reported what it can do. */
  onHandshake?(): void;
}

/** A live session. */
export interface Session {
  /** The session channel URI. */
  readonly uri: string;
  /** The chat channel URI. */
  readonly chatUri: string;

  /** Models this session can run a turn on. Empty until the agent has answered. */
  models(): { id: string; name: string }[];
  /**
   * The id the agent gave this session, if it has said one yet.
   *
   * Not the same as `uri`: the client names the channel, the agent names the
   * transcript it writes. The catalogue needs both to tell that the row on
   * disk and this session are one conversation.
   */
  agentId(): string | undefined;
  /** Skills, commands, subagents and MCP servers this session was given. */
  customizations(): Bag[];
  /** Every completed turn. Snapshots carry only the newest page of these. */
  allTurns(): Bag[];

  /** `SessionStatus` bitset, derived from what the session is doing now. */
  status(): number;
  /** Display title. */
  title(): string;
  /** ISO 8601 timestamp of the last change. */
  modifiedAt(): string;
  /**
   * Where the agent is actually working, as `file://` URIs.
   *
   * Asked rather than assumed: the host knows what directory it was started
   * in and a session may have been created in another, so a host that
   * answered with its own reported the wrong one for exactly the sessions
   * somebody chose a directory for.
   */
  workingDirectories(): string[];
  /** The session channel's state, for a subscription snapshot. */
  sessionState(): Bag;
  /** The chat channel's state, for a subscription snapshot. */
  chatState(): Bag;

  /** Start a turn with what the person said, optionally naming a model. */
  begin(turnId: string, text: string, model?: string): void;
  /** Stop the running turn, and answer anything it was blocked on. */
  cancel(turnId: string): void;

  /** Answer a tool call the agent is waiting on. */
  confirm(toolCallId: string, approved: boolean): void;
  /** Answer a question the agent asked, keyed by question id. */
  answer(requestId: string, accepted: boolean, answers: Bag): void;

  /** Run later turns on this model. False when the agent would not take it. */
  setModel(model: string): Promise<boolean>;
  /** Change how much the agent may do before asking. False when the mode is not one. */
  setPermissionMode(mode: string): boolean;
  /** Change how hard it thinks. False when the level is not one. */
  setEffort(level: string): boolean;
  /** The config in force, by key. */
  settings(): Record<string, string>;

  /** End the session and stop its agent. */
  close(): void;
}
