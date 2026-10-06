import type { query } from '@anthropic-ai/claude-agent-sdk';
import type { Bag, BoundTool, Session, SessionOptions, SubagentChat, SubagentRequest } from '@ahpd/sdk';
import type { Asked, Spawned } from '../spawn.js';
import type { Asking } from './asking.js';
import type { ClientTools } from './clienttools.js';
import type { Config } from './config.js';
import type { Parts } from './parts.js';
import type { Query } from './query.js';
import type { Servers } from './servers.js';
import type { Stream } from './stream.js';
import type { Turns } from './turns.js';
import type { Workers } from './workers.js';

/**
 * What this backend adds to a session's options.
 *
 * `SessionOptions` is every backend's, and none of this is: only the Claude
 * CLI has a spawn hook to hand a command to. Set together or not at all, by
 * `claude()` when the session named a machine.
 */
export interface ClaudeSessionOptions extends SessionOptions {
  /** Start the CLI somewhere other than this host. */
  spawn?: (asked: Asked) => Spawned;
  /** Where the CLI is wherever `spawn` starts it. */
  spawnExecutable?: string;
  /** The `CLAUDE_CONFIG_DIR` it reads there, or `false` for the image's own. */
  spawnConfigDir?: string | false;
  /**
   * What a stop given in a worker's chat stops: that worker, by default, or
   * with `session` the lead turn that runs it.
   */
  workerStop?: 'worker' | 'session';
  /**
   * The declared options this backend's variant holds.
   *
   * Read where the query is built, so a preset and a session go through the
   * same translation. Absent is a variant that names no option, which leaves
   * the session on what it always ran on.
   */
  preset?: Bag;
  /** The list the CLI reports, as the harness offers it; absent is the CLI's. */
  offerModels?: (cli: { id: string; name: string }[]) => Promise<{ id: string; name: string }[]>;
  /**
   * The host's seam for a chat of one tool call's own.
   *
   * A subagent is a conversation inside one call, and the host owns what a
   * chat is: this backend names the call and the words, and writes what the
   * harness said to the chat it is handed back. Absent on a host that does not
   * offer one, and then a subagent's frames stay in the turn that spawned it.
   */
  subagent?: (toolCallId: string, request: SubagentRequest) => SubagentChat;
}

/**
 * Everything an area of a session reaches for, in one object.
 *
 * Built once in `createSession` and handed to every area's factory, the way a
 * host tool is handed a `ToolCall`. A `let` in the closure that crosses into
 * another file is a field here, and it is read as `ctx.<name>` where it is
 * used rather than copied onto the factory's own scope at construction - so
 * the order the areas are built in never matters and nothing is frozen.
 */
export interface SessionContext extends Omit<Config, 'methods'>, Omit<ClientTools, 'methods'>, Parts, Omit<Workers, 'methods'>, Stream, Asking, Omit<Query, 'methods'>, Omit<Servers, 'methods'>, Omit<Turns, 'methods'> {
  /** The options `createSession` was given. */
  options: ClaudeSessionOptions;
  /** Say one thing on one channel, to every client watching it. */
  emit: SessionOptions['emit'];
  /** The session itself, once it has been built, for the methods that call it. */
  self: Session;
  /** The turn now running, when there is one. */
  active: Bag | undefined;
  title: string;
  modified: string;
  /** What the session is doing, in one line, or nothing when it is idle. */
  activity: string | undefined;
  /** When the running turn started, in milliseconds. */
  startedAt: number;
  /**
   * Why the *last* turn failed, or nothing.
   *
   * About one turn, not about the session for the rest of its life. It reads
   * into `Status.Error` and into the summary's `error`, and it used to be set
   * and never unset - so one failed tool call left every client showing a
   * session in error through every turn that followed, and through a restart
   * of the client, because the flag lives here rather than there. Starting a
   * turn supersedes it: what went wrong last time is not what is happening
   * now.
   */
  failed: string | undefined;
  /**
   * The model the turn now running actually answered on, as its own frames
   * reported it.
   *
   * Not the one configured: a session may be set to `sonnet` and a turn may
   * run on whatever that resolved to on the day, and the protocol asks for
   * the model a turn *was* answered by. A client reads it to name the model
   * on a historic turn and to size the context window that turn used.
   */
  ran: string | undefined;
  /** The content block the session's own agent is streaming, by its index. */
  streaming: string | undefined;
  /** What is let waiting for the input stream to be read again. */
  wake: (() => void) | undefined;
  /**
   * The turns this session has already had.
   *
   * Seeded from `options.seed`, and every turn that ends is added to it. A
   * running turn is not in here: it is `active`, and moves in when it
   * completes.
   */
  turns: Bag[];
  /** Whether the input stream has ended, which no later turn can undo. */
  closed: boolean;
  /**
   * The directories beside `cwd`, as this session currently has them.
   *
   * Mutable because a client may add and remove peers on a running session;
   * `cwd` itself never moves, which is what the protocol's `immutablePrimary`
   * says and what the SDK enforces anyway.
   */
  peers: string[];
  /**
   * A steering message, for as long as it is waiting to be read.
   *
   * The protocol's `ChatState.steeringMessage` is "a message to inject into
   * the current turn at a convenient point", and the convenient point is when
   * the CLI next reads its prompt. Between the two there is a real window - a
   * turn mid-tool-call has not read anything for some time - and this is what
   * fills it. Cleared where the generator hands the message over, because that
   * is the moment it stops waiting.
   */
  steering: Bag | undefined;
  /**
   * The agent the running query was built with, and the CLI answering it.
   *
   * `running` is what a message's pick is compared against: it is what the CLI
   * is actually running on, so a pick equal to it changes nothing and only a
   * different one pays for a new CLI.
   */
  running: string | undefined;
  /**
   * The id the agent gave this session, which is not the URI it is served at.
   *
   * The client picks the URI before anything exists; the CLI picks its own id
   * when it starts and writes the transcript under that. Both name the same
   * conversation, so the catalogue has to know they do - otherwise the row on
   * disk and the row in memory are two sessions saying the same thing.
   */
  agentId: string | undefined;
  /** The CLI's `init` frame, once it has answered with one. */
  handshake: Bag | undefined;
  /**
   * Why this session's CLI is gone, once it is.
   *
   * Survives `begin`, unlike `failed`: the query is built once and a session
   * whose process has exited cannot run another turn however many are asked
   * for. Set when the run loop ends, for whatever reason, and never cleared.
   */
  gone: string | undefined;
  /** What this session has been told the CLI can do, by customization. */
  customizations: Bag[];
  /** The models the CLI offered, as this session offers them. */
  offered: { id: string; name: string }[];
  /*
   * The declared Claude options this session runs on, by field.
   *
   * What each is when nothing named one, then what this backend's variant
   * holds, under the names the declarations give them. These are written by
   * whoever configured this backend, and not by a session's config keys: the
   * one thing this session's own store has a say in is a `sandboxEnabled` it
   * was left on, which no field of the schema carries any more.
   */
  values: Bag;
  /** The config in force, by key. What `session/configChanged` merges into. */
  /*
   * What this session was told to run as.
   *
   * `unknown` and not `string`, because the protocol declares a config bag
   * `Record<string, unknown>` and `permissions` is an object. Keys this
   * backend declared a string are narrowed where they are read.
   */
  settings: Record<string, unknown>;
  /**
   * The tools this session has already been told about, by name.
   *
   * Held here as well as handed to the SDK, because the SDK takes them when
   * the query is built: a list changed on a running session reaches the agent
   * only through `canUseTool`, which is the one place this host sits between
   * the two.
   */
  allowed: { allow: string[]; deny: string[] };
  /** What the client picked. Absent means whatever the CLI defaults to. */
  chosen: string | undefined;
  /*
   * The tools on offer, which is not a fixed list.
   *
   * The host's own are settled when the session is built; a client's arrive
   * when it announces itself and go when it leaves. So this is held rather
   * than read from `options` once, and `setTools` re-declares the server the
   * model reaches them through.
   */
  offering: BoundTool[];
  /**
   * The query this session is reading, once there is one.
   *
   * Typed as the query and not as the query or nothing, because as a `let` in
   * the closure it was declared where it was first built and TypeScript kept it
   * narrowed from there. As a field it exists from the start of the session, so
   * `undefined` would have to be widened into it by hand; nothing reads it
   * before the query is built, and the identity checks that follow it want the
   * query either way.
   */
  handle: ReturnType<typeof query>;
  /**
   * What somebody is part-way through typing.
   *
   * Held here so two people on one session see each other's, which is the
   * only reason a draft is on the wire at all - a client that kept its own
   * would need nothing from a host for it.
   */
  draft: Bag | undefined;
  /**
   * The turn `beginTurn` is starting, from the moment it waits on a switch until
   * it is running or refused.
   *
   * Until the CLI has taken the model there is no `active`, but the turn has
   * begun: it is this session's, and one started beside it would reach the CLI
   * beside this one. Held here rather than as a chain of switches, so every
   * question of whether a turn is running is asked of one thing.
   */
  beginning: string | undefined;
}

/**
 * One conversation inside the SDK stream, with its own parts and its turn.
 *
 * The session's own agent and every subagent it delegates to share one
 * stream, told apart only by `parent_tool_use_id`. A response part is
 * identified *within its turn* - `#<message>:<index>` names the same slot in
 * two conversations - so each keeps its own maps, and the main scope's are
 * the session's own. A worker's parts are emitted on its chat rather than
 * mixed into the turn that spawned it.
 */
export interface Scope {
  /** The call that spawned it; empty for the session's own agent. */
  parent: string;
  /** The chat a worker writes to; nothing for the session's own agent. */
  chat: SubagentChat | undefined;
  turn: Bag | undefined;
  parts: Map<string, Bag>;
  calling: Map<string, string>;
  streaming: string | undefined;
  /**
   * Frames for a worker whose chat is not open yet, in the order they came.
   *
   * Nothing has been applied and nothing has been said: a frame for a worker
   * the harness has not named yet has no turn to belong to, and saying it on
   * the lead chat would draw a worker's words as the parent's. Delivered
   * whole when the chat opens, so it is applied as if it had arrived then.
   */
  waiting?: (() => void)[] | undefined;
  /** What releases `waiting` when no spawn is recorded in time. */
  release?: ReturnType<typeof setTimeout> | undefined;
}
