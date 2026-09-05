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

/**
 * The model a turn runs on.
 *
 * An object rather than a name, because a model that carries a `configSchema`
 * is chosen by picking a row *and* answering its form: the protocol's
 * `ModelSelection` is `{ id, config }`, and a host that read only the id would
 * accept a form it then ignored.
 */
export interface Chosen {
  /** The model, spelled as `RootState.agents[].models[].id` spells it. */
  id: string;
  /**
   * What the client filled that model's own `configSchema` in with.
   *
   * JSON primitives, which is what the protocol carries here: most pickers
   * produce strings and a numeric one produces a number.
   */
  config?: Record<string, string | number | boolean | null>;
}

/** How to construct a session. */
export interface SessionOptions {
  /** The session channel URI, `ahp-session:/<id>`. */
  uri: string;
  /** The chat channel URI beneath it, `ahp-chat:/<id>`. */
  chatUri: string;
  /**
   * Directories beside the first the agent may also read and write.
   *
   * The first is `cwd` and is the process root; these are its peers. The
   * protocol calls the whole set `workingDirectories` and fixes index 0 for
   * the session's lifetime, which is what `immutablePrimary` means.
   */
  additional?: string[];
  /** The directory the agent works in. */
  cwd: string;
  /** Config values chosen at creation, by key. */
  settings?: Record<string, unknown>;
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
  /**
   * The prompt this session is resumed *at*, so the rest is left behind.
   *
   * A fork: the conversation continues from that turn as though the ones
   * after it had not happened, under a new id of its own so the original is
   * untouched. Meaningless without `resume`, which names what is being forked.
   */
  forkAt?: string;
  /**
   * Context the first turn carries without showing it.
   *
   * A side chat is started from a turn somewhere else and needs to know what
   * that turn said, but the protocol is explicit that the source transcript is
   * not copied into this chat's visible history - so this reaches the model
   * and never the wire.
   */
  context?: string;

  /**
   * MCP servers this session declares, by name.
   *
   * Declared by the host rather than left to the backend's own discovery,
   * because a server the SDK was given is one it can be told about again -
   * which is what applying a token a client signed in with requires.
   */
  mcpServers?: Record<string, Bag>;
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

/** What a host-run command did, once it has finished doing it. */
export interface Ran {
  /** Whether it exited cleanly. */
  success: boolean;
  /** One line about how it went, in the past tense, for the finished call. */
  said: string;
  /** Everything it printed. Empty when it printed nothing. */
  output: string;
  /** The terminal it ran in, so a client can watch it while it runs. */
  terminal?: string;
  /** What it exited with, where the runtime reported one. */
  code?: number;
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

  /**
   * The backend's own name for the prompt that began a turn, if it has one.
   *
   * What a fork is cut at. A turn has an id this host chose and the backend
   * has an id of its own for the same prompt, and only the backend's means
   * anything when it is asked to resume at one.
   *
   * Optional, and its absence is what makes forking unavailable: a backend
   * that cannot name a prompt cannot be asked to continue from one, and the
   * host advertises no `fork` capability for it rather than offering a control
   * that fails when it is used.
   */
  forkPoint?(turnId: string): string | undefined;
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

  /**
   * Run one command as a turn of this chat's, without asking the agent.
   *
   * What the composer's `!` prefix means: the person typed a command rather
   * than a question, and the answer is a shell's. The turn is still the
   * chat's - a host that emitted one this session did not know about would
   * serve a snapshot without it the moment anybody re-subscribed - so the
   * session opens it, reports the tool call, and closes it when `run`
   * settles.
   *
   * `run` is the host's half: it is handed the id of the tool call this turn
   * is about and answers with what happened. The terminal is the host's
   * because the shell is - a session has no port to spawn one through - and
   * naming it back is what lets a client watch the output arrive rather than
   * only read it afterwards.
   *
   * Optional. A backend that leaves it out is one this host advertises no
   * `terminalCommandPrefix` for, which is the protocol's own way of saying the
   * shorthand is unavailable.
   */
  ran?(turnId: string, command: string, run: (toolCallId: string) => Promise<Ran>): void;

  /**
   * Put a message into the turn that is already running.
   *
   * Steering, in the protocol's word: somebody correcting an agent halfway
   * rather than waiting for it to finish doing the thing they are trying to
   * stop. Answers whether there was a turn to steer - a chat with nothing
   * running has nothing to inject into, and the caller says so rather than
   * quietly turning it into an ordinary message.
   *
   * Optional. A backend that cannot take a message mid-turn leaves it out,
   * and this host refuses steering for that backend with that as the reason.
   */
  steer?(id: string, text: string): boolean;

  /** Start a turn with what the person said, optionally naming a model. */
  begin(turnId: string, text: string, model?: Chosen): void;
  /** Stop the running turn, and answer anything it was blocked on. */
  cancel(turnId: string): void;

  /**
   * Hold a message, and make it the next turn when the running one ends.
   *
   * The queue is the session's, not a client's: a client that held a message
   * would be the only thing that could ever send it, and nothing in a client
   * watches for a turn to end. The same `id` twice edits what is waiting.
   */
  queue(id: string, text: string, model?: Chosen): void;
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

  /**
   * Take one config value, or say why not.
   *
   * Every key a client sets goes through here, including the ones a backend
   * advertises in its own schema: the host reads that schema for how a key
   * behaves - whether it can move on a running session, whether it belongs to
   * the session or to one chat - and knows nothing about what any key means.
   *
   * `true` when it was taken. A string is the refusal, in the backend's own
   * words, and it is a string rather than `false` because only the backend
   * knows which of the two things went wrong: a key it does not serve, or a
   * value it will not take for a key it does. A host that answered both with
   * one sentence would be telling a client its control does not exist when
   * the truth is that the value was wrong.
   */
  setConfig?(key: string, value: unknown): true | string | Promise<true | string>;
  /** The config in force, by key. */
  settings(): Record<string, unknown>;

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

  /**
   * A token for one of this session's MCP servers, as the client signed in.
   *
   * Answers whether the server it names is one of this session's. The token
   * becomes that server's `Authorization` header and the server is asked to
   * connect again; nothing else in the session is told.
   *
   * Optional: a backend that cannot re-declare a server leaves it out, and the
   * host then advertises no resource for one to be signed into.
   */
  authenticated?(resource: string, token: string): Promise<boolean>;

  /**
   * The OAuth resources this session's MCP servers need signing into.
   *
   * What `authenticate` is checked against: the protocol says a client's
   * `resource` MUST match one the server advertised, and these are advertised
   * on the servers' own `authRequired` states.
   */
  awaiting?(): string[];

  /** End the session and stop its agent. */
  close(): void;
}
