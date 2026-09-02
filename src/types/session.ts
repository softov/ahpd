/** One agent session: its lifecycle, its turns, and what it is waiting for. */

import type { Bag } from './common.js';

/**
 * Emits one state action on a session's channel.
 *
 * `session` addresses the session channel, `chat` the chat channel beneath it,
 * and `terminal` a terminal's own - the emitter knows which of its channels it
 * is talking about and the host knows what each is called.
 */
export type Emit = (channel: 'session' | 'chat' | 'terminal', action: Bag) => void;

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
  /**
   * Environment for the agent's own process.
   *
   * Merged over `process.env` by the session, never handed to the SDK alone:
   * the SDK's `env` *replaces* the subprocess environment rather than adding
   * to it, so passing only a credential is a subprocess with no `PATH`.
   */
  env?: Record<string, string>;
  /** An existing agent session to continue, rather than starting a new one. */
  resume?: string;
  /** Turns already known, so a resumed session does not open empty. */
  seed?: Bag[];
  /**
   * A file a tool is about to change, and the same file once it has.
   *
   * Off the agent's own message stream rather than out of a hook: the SDK's
   * `PreToolUse` and `PostToolUse` are bypassable from a person's settings,
   * and the stream is the signal that cannot be turned off. Called with
   * `before` as the tool is announced and `after` when its result arrives,
   * which is what makes a turn's changeset the turn's rather than the
   * working tree's at the time somebody asked.
   *
   * The path only. Reading it is the host's business, because reading a file
   * is a filesystem and a session has none.
   */
  onFileEdit?(turnId: string, path: string, phase: 'before' | 'after'): void;
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
  /** What it is doing now, in one line, or nothing when it is idle. */
  activity(): string | undefined;
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

  /**
   * Hold a message, and make it the next turn when the running one ends.
   *
   * The queue is the session's, not a client's: a client that held a message
   * would be the only thing that could ever send it, and nothing in a client
   * watches for a turn to end. The same `id` twice edits what is waiting.
   */
  queue(id: string, text: string, model?: string): void;
  /** Take one back, while it is still waiting. */
  unqueue(id: string): void;
  /**
   * What somebody is part-way through typing.
   *
   * Held by the session so two people on one chat see each other's - a client
   * that kept its own would need nothing from a host for this.
   */
  setDraft(text: string): void;
  /** Reorder what is waiting. Anything not named keeps its place behind what is. */
  reorder(order: string[]): void;

  /** Answer a tool call the agent is waiting on. */
  confirm(toolCallId: string, approved: boolean): void;
  /** Answer a question the agent asked, keyed by question id. */
  answer(requestId: string, accepted: boolean, answers: Bag): void;

  /** Run later turns on this model. False when the agent would not take it. */
  setModel(model: string): Promise<boolean>;
  /** Change how much the agent may do before asking. False when the mode is not one. */
  setPermissionMode(mode: string): boolean;
  /**
   * Change any other key of this backend's own schema. False when it is not one.
   *
   * `permissionMode`, `model`, `effortLevel` and `outputStyle` have their own
   * setters because they mean something to the host - a permission mode and an
   * output style are set on every chat in a session, not only the one that was
   * asked. Everything else a backend published in `schema()` arrives here, and
   * a backend without this takes none of them: a client draws its controls from
   * that schema, so a key that reaches nothing is a control that moves and
   * changes the session not at all.
   */
  setConfig?(key: string, value: string): boolean | Promise<boolean>;
  /** Change how hard it thinks. False when the level is not one. */
  setEffort(level: string): boolean;
  /** Change the voice it answers in. False when the CLI has no such style. */
  setOutputStyle(style: string): boolean;
  /** The config in force, by key. */
  settings(): Record<string, string>;

  /**
   * Turn a customization on or off. False when this backend cannot.
   *
   * False is a real answer and the one to give for anything with no runtime
   * switch: a control that reports success and changes nothing is worse than
   * one that refuses.
   */
  setCustomizationEnabled(id: string, enabled: boolean): Promise<boolean>;
  /** Start an MCP server, which is also how one that needs signing into is. */
  startMcpServer(id: string): Promise<boolean>;
  /** Stop one. */
  stopMcpServer(id: string): Promise<boolean>;

  /** End the session and stop its agent. */
  close(): void;
}
