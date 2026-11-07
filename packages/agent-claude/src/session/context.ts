import type { query } from '@anthropic-ai/claude-agent-sdk';
import type { BackgroundTasks, Bag, BoundTool, OutputTerminals, Session, SessionOptions, ShellEnv, Start, SubagentChat, SubagentRequest, TerminalOutputs } from '@ahpd/sdk';
import type { AgentLogins } from '../logins.js';
import type { OfferedModel } from '../models.js';
import type { Asked, SpawnedProcess } from '../spawn.js';
import type { Asking } from './asking.js';
import type { ClientTools } from './clienttools.js';
import type { Config } from './config.js';
import type { ParseYaml } from './disk.js';
import type { Logins } from './logins.js';
import type { Parts } from './parts.js';
import type { Query } from './query.js';
import type { ClaudeTerminalOutputs } from './savedoutput.js';
import type { Servers } from './servers.js';
import type { Stream } from './stream.js';
import type { Turns } from './turns.js';
import type { Workers } from './workers.js';

/**
 * A prompt the CLI was handed, for as long as no result has named it: VS
 * Code's pending SDK message.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudePromptQueue.ts#L24-L32
 */
export interface PendingSdkMessage {
  /** What it said, which a turn opened for its answer carries. */
  message: Bag;
  /** Whether it steers a turn rather than starting one. */
  steering: boolean;
  /** The turn its answer belongs to: its own, or the one it steers. */
  turnId: string;
  /** A steering message's own id, the one a client knows it by. */
  id?: string;
  /**
   * What the CLI said it did with it, from the `state` of its
   * `command_lifecycle` frames: nothing yet, `queued` once it holds it,
   * `started` once it took it in.
   */
  lifecycle: 'sent' | 'queued' | 'started';
  /**
   * Whether the CLI was handed it: the SDK read it off the input stream, and
   * the CLI holds it whatever this session does next. Unset while it waits
   * there, and while its blocks are built.
   */
  read?: boolean;
}

/**
 * What this backend adds to a session's options.
 *
 * `SessionOptions` is every backend's, and none of this is: only the Claude
 * CLI has a spawn hook to hand a command to. Set together or not at all, by
 * `claude()` when the session named a machine.
 */
export interface ClaudeSessionOptions extends SessionOptions {
  /**
   * The name this chat's own conversation is kept under, from `Start.chatId`.
   *
   * Absent is the session's own id, which is the chat a session opens with.
   * Read where the CLI is told which conversation its first query carries, so
   * a second chat of one session is a transcript of its own rather than a
   * second writer of the session's.
   */
  chatId?: string;
  /**
   * How long a client has to answer a call of its tool.
   *
   * Resolved by the host before the session is built, so this is a number
   * wherever a client-tool call is waited on. Absent only where a session is
   * built by hand, and then the holder's own default applies.
   */
  clientToolTimeoutMs?: number;
  /**
   * The environment the operator names for the shells this session runs.
   *
   * Carried from `Start.shellEnv` and handed to the CLI: each name the
   * operator set in its `settings.env`, each one they removed out of the
   * environment the CLI is spawned with.
   */
  shellEnv?: ShellEnv;
  /**
   * How long the CLI has to answer its handshake: the bound the SDK's
   * `startup` is handed, past which the CLI did not start.
   *
   * Absent is the bound this backend ships with, which is the ordinary
   * install: a deployment whose machines are slower raises it through the
   * plugin's own option rather than by building a session by hand.
   */
  handshakeTimeoutMs?: number;
  /**
   * The CLIs of this agent's closed sessions that are still exiting, by each
   * conversation id one could write: a conversation starts under an id once
   * the CLI that could write its transcript has exited, as VS Code's Claude
   * shuts the live query down before it deletes a transcript.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1148-L1160
   */
  exits?: Map<string, Promise<unknown>>;
  /**
   * The plugin context's YAML reader, which a customization file's frontmatter
   * is read with. Absent where the session is built outside a plugin, and a
   * frontmatter is then read as none.
   */
  parseYaml?: ParseYaml;
  /** Start the CLI somewhere other than this host. */
  spawn?: (asked: Asked) => SpawnedProcess;
  /** Where the CLI is wherever `spawn` starts it. */
  spawnExecutable?: string;
  /** The `CLAUDE_CONFIG_DIR` it reads there, or `false` for the image's own. */
  spawnConfigDir?: string | false;
  /**
   * Where each turn of `seed` ended, in the CLI's own names, by turn id.
   *
   * What the read of the transcript named for the conversation this session
   * resumes: the entry a fork of a turn copies through and a rewind to it
   * keeps. A turn this session watches run names its own.
   */
  seedEnds?: ReadonlyMap<string, string>;
  /**
   * The declared options this backend's variant holds.
   *
   * Read where the query is built, so a preset and a session go through the
   * same translation. Absent is a variant that names no option, which leaves
   * the session on what it always ran on.
   */
  preset?: Bag;
  /**
   * The declared options read live from a record, at the start of each turn.
   *
   * An agent made from an agent record is edited while the daemon runs, so its
   * values are read through this rather than copied into `preset`: a turn that
   * finds them changed restarts the CLI on the same conversation. Absent for a
   * preset, which nothing edits while the daemon runs.
   */
  presetOf?: () => Bag;
  /** The list the CLI reports, as the harness offers it; absent is the CLI's. */
  offerModels?: (cli: OfferedModel[]) => Promise<OfferedModel[]>;
  /**
   * The Claude logins the agent's record may name, and whose agent it is.
   *
   * Absent where a session is built by hand, or by an embedder with no
   * `claude-login` adapter: the session runs as the CLI signs in.
   */
  logins?: AgentLogins;
  /**
   * Whether one folder is one the host vouched for, carried from `Start`.
   *
   * The query reads it for the CLI's `settingSources`, which is what decides
   * whether a project's settings, its hooks and its `CLAUDE.md` reach this
   * session at all. Absent is the host having said nothing, which is the same
   * answer an absent `Start.trusted` is: untrusted.
   */
  trusted?: (folder: string) => boolean;
  /**
   * Whether this session's shell commands are approved by its owner's rules,
   * carried from `Start`.
   *
   * The rules are the connection's that started the session: what a window
   * allows is that window's. Absent is a host that says nothing, and a command
   * line no rule could read is a call that asks.
   */
  getAutoApproval?: Start['getAutoApproval'];
  /**
   * Whether this session loads the settings of the person who runs the daemon,
   * carried from `Start`. Absent is yes.
   *
   * The query reads it for the CLI's `settingSources`: `false` takes `user`
   * out, so no `~/.claude` settings, memory or global `CLAUDE.md` reach the
   * model. What the folder carries is the other half, decided by `trusted`.
   */
  userSettings?: boolean;
  /**
   * The host's seam for a chat of one tool call's own.
   *
   * A subagent is a conversation inside one call, and the host owns what a
   * chat is: this backend names the call and the words, and writes what the
   * harness said to the chat it is handed back. Absent on a host that does not
   * offer one, and then a subagent's frames stay in the turn that spawned it.
   */
  subagent?: (toolCallId: string, request: SubagentRequest) => SubagentChat;
  /**
   * The host's background-task seam, carried from `Start`.
   *
   * Present on every session a host starts, because the host always offers it.
   * Absent only where a session is built by hand, and then the tasks the
   * harness leaves running are not reported: there is no host to draw them.
   */
  backgroundTasks?: BackgroundTasks;
  /**
   * The host's output-terminal factory, carried from `Start`.
   *
   * A background shell's output is text the harness already holds, so the host
   * owns the channel and this backend only writes into it. Absent only where a
   * session is built by hand, and then a shell is listed without its output.
   */
  outputTerminals?: OutputTerminals;
  /**
   * The outputs the host keeps for this chat, carried from `Start`.
   *
   * Where the whole output of a `Bash` result too large to send is kept, so
   * the call names a terminal the host answers for as long as the chat lasts.
   * Absent where the host's session store keeps no folder, and then the call
   * keeps Claude's notice alone.
   */
  terminalOutputs?: TerminalOutputs;
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
export interface SessionContext extends Omit<Config, 'methods'>, Omit<ClientTools, 'methods'>, Parts, Omit<Workers, 'methods'>, Stream, ClaudeTerminalOutputs, Asking, Logins, Omit<Query, 'methods'>, Omit<Servers, 'methods'>, Omit<Turns, 'methods'> {
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
  /** When the running turn started, in milliseconds. */
  startedAt: number;
  /**
   * The time the running turn took and what it used before a client resumed
   * it, which the turn holds with this run's; its usage and its ending say
   * this run's alone, which the host merges the rest into, as VS Code's host
   * says a resumed turn.
   */
  resumedFrom: { duration: number; usage: Bag | undefined } | undefined;
  /**
   * Why the *last* turn failed, or nothing.
   *
   * About one turn, not about the session for the rest of its life. It reads
   * into `Status.Error`, the status a chat's state opens with, as the turn's
   * `chat/error` leaves it in every client's. Starting a turn supersedes it:
   * what went wrong last time is not what is happening now.
   */
  failed: string | undefined;
  /**
   * Whether the last turn was stopped here and its result has not come yet.
   *
   * An interrupt ends with a result of its own, `error_during_execution` with
   * `is_error`, after the stop has already ended the turn as cancelled, and it
   * says the turn was stopped, which is no failure of the session.
   */
  interrupted: boolean;
  /**
   * The calls a stop answered itself and the CLI has not reported yet, while
   * the stop's interrupt waits for them.
   *
   * The CLI keeps an answer only once it has recorded the call's result, and
   * an interrupt that reaches it before that has it write its own text for
   * the call instead: "The user doesn't want to proceed with this tool use".
   * Nothing while no stop is waiting.
   */
  stopAnswers: Set<string> | undefined;
  /**
   * The CLI that died, ended its stream without a result or was closed by a
   * stop that aborts the query, or that a CLI meant to replace it did not
   * start beside, while the next send
   * has not yet started one that resumes the conversation, as the reference
   * marks its pipeline for a rebind. Its reader ends without failing the session.
   * Nothing while the CLI answering is the one reading.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L487-L495
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L696-L718
   */
  rebind: unknown;
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
  /**
   * What the input stream's parked read waits on, which a prompt pushed
   * completes: VS Code's queue's pending-prompt deferred.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudePromptQueue.ts#L67
   */
  pendingPromptDeferred: (() => void) | undefined;
  /**
   * The turns this session has already had.
   *
   * Seeded from `options.seed`, and every turn that ends is added to it. A
   * running turn is not in here: it is `active`, and moves in when it
   * completes.
   */
  turns: Bag[];
  /** Whether the session was disposed, which ends its input stream for good. */
  disposed: boolean;
  /**
   * The directories beside `cwd`, as this session currently has them: the
   * SDK's `additionalDirectories`, as VS Code's Claude session names them.
   *
   * Mutable because a client may add and remove them on a running session;
   * `cwd` itself is fixed, which is what the protocol's `immutablePrimary`
   * says and what the SDK enforces.
   */
  additionalDirectories: string[];
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
   * Every prompt the CLI was handed that no result has named yet: VS Code's
   * yielded entries.
   *
   * Keyed by the uuid it was sent under. The CLI names the prompts an answer
   * is for in `user_message_uuids`, on the answer's frames and on its result,
   * and the turn a prompt belongs to is the turn those frames and that result
   * are about. A steering message it reads after the turn's last tool call is
   * run as a turn of its own once the turn's result is out, so a turn is not
   * over while one of its prompts is here. A CLI that is put away, or that
   * dies, takes the rest with it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudePromptQueue.ts#L57-L58
   */
  yielded: Map<string, PendingSdkMessage>;
  /**
   * The uuid of the prompt the CLI's current answer is for, from the last frame
   * that named it: the pending message VS Code's pipeline routes a frame to
   * (`peekParent`).
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L664-L669
   */
  parentSdkUuid: string | undefined;
  /**
   * What the host asked said to the model, and the turn it asked it for.
   *
   * Read when the turn begins, and read back by the `UserPromptSubmit` hook
   * the whole time that turn runs - which is the only moment the CLI takes
   * context that is not the person's words. Kept against the turn and not on
   * the session, because that is the whole of its lifetime: a turn that ends
   * has taken its instruction with it, and no road that ends one has to say so.
   */
  hostInstructions: { turn: Bag; said: string[] } | undefined;
  /**
   * The agent the running query was built with: what was applied, as VS
   * Code's pipeline names what it last gave the CLI.
   *
   * A message's pick is compared against it: it is what the CLI is running
   * on, so a pick equal to it changes nothing and a different one pays for a
   * new CLI.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L556-L570
   */
  appliedAgent: string | undefined;
  /**
   * The id the SDK gave this conversation, VS Code's `sdkSessionId`, beside
   * the URI the session is served at.
   *
   * The client picks the URI before anything exists; the CLI picks its own id
   * when it starts and writes the transcript under that. Both name the same
   * conversation, so the catalogue has to know they do: the row on disk and
   * the row in memory are one session.
   */
  sdkSessionId: string | undefined;
  /**
   * Whether the SDK said it holds no conversation under the id this session
   * was asked to resume, which the first CLI's start asks where the record's
   * `writtenBy` is `getSessionInfo`: such a session starts a conversation
   * under that id instead.
   */
  unwritten: boolean;
  /** The CLI's `init` frame, the SDK's `system`/`init` message, once it has answered with one. */
  init: Bag | undefined;
  /**
   * Why the CLI this session holds went, while it is held for the next send
   * to start again: a turn preparing while it went fails with this. Cleared
   * when a CLI is started.
   */
  gone: string | undefined;
  /** What this session has been told the CLI can do, by customization. */
  customizations: Bag[];
  /** The models the CLI offered, as this session offers them, each with the thinking control it supports. */
  models: OfferedModel[];
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
  /**
   * Those values, built from a preset, which is the one way they are built.
   *
   * The defaults under everything, the preset over them, and the one thing the
   * session's own store has a say in - a `sandboxEnabled` it was left on - under
   * a preset that does not turn the sandbox off. A record's values are read
   * through this again when it is edited.
   */
  valuesOf: (preset: Bag) => Bag;
  /**
   * The values the running CLI was built from, as a comparison string: what
   * was applied, as VS Code's pipeline names it.
   *
   * A turn compares the record's values now with what the CLI was started with,
   * and restarts it when the two differ. Set at every `startQuery`, so the
   * question is always about the CLI that is answering.
   */
  appliedValues: string;
  /**
   * The config in force, by key: the protocol's config, what
   * `session/configChanged` merges into.
   *
   * `unknown` values, because the protocol declares a config bag
   * `Record<string, unknown>` and `permissions` is an object. Keys this
   * backend declared a string are narrowed where they are read.
   */
  config: Record<string, unknown>;
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
  /**
   * The effort level the CLI was last given, VS Code's pipeline's applied
   * effort: absent while the CLI runs at its model's own, which a new CLI
   * does until a turn names one.
   */
  appliedEffort: string | undefined;
  /*
   * The tools on offer, which is not a fixed list.
   *
   * The host's own are settled when the session is built; a client's arrive
   * when it announces itself and go when it leaves. So this is held rather
   * than read from `options` once: what the CLI was last given, which a send
   * moves to the set `toolDiff` holds.
   */
  offering: BoundTool[];
  /**
   * The query this session is reading, once there is one: the SDK's `Query`,
   * named as the SDK and VS Code's Claude pipeline name it, which holds none
   * before its first bind. A session's first send starts its first CLI.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L187-L193
   */
  query: ReturnType<typeof query> | undefined;
  /**
   * What somebody is part-way through typing.
   *
   * Held here so two people on one session see each other's, which is the
   * only reason a draft is on the wire at all - a client that kept its own
   * would need nothing from a host for it.
   */
  draft: Bag | undefined;
  /**
   * The turn being prepared, VS Code's `prepareTurn`: the turn `beginTurn` is
   * starting, from the moment it waits on a switch until it is running or
   * refused.
   *
   * Until the CLI has taken the model there is no `active`, but the turn has
   * begun: it is this session's, and one started beside it would reach the CLI
   * beside this one. One field, so every question of whether a turn is
   * running is asked of one thing.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1260
   */
  preparingTurn: string | undefined;
  /**
   * The tools the host handed since the CLI was last given a set, while there
   * are any: VS Code's client-tool diff, which the next send gives the CLI
   * before its prompt.
   */
  toolDiff: BoundTool[] | undefined;
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
  /**
   * Which tool call each streaming content block opened: VS Code's mapper's
   * active tool blocks.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L51
   */
  activeToolBlocks: Map<string, string>;
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
  /**
   * Whether the worker's spawn never came within the hold's bound: its held
   * frames were dropped, and what it says after is dropped too.
   */
  failed?: boolean;
}
