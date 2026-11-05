/** One agent session: its lifecycle, its turns, and what it is waiting for. */

import type { ActionOrigin, MessageAttachment } from '@microsoft/agent-host-protocol';
import type { Bag } from './common.js';
import type { FileEdit } from './changes.js';
import type { BoundTool } from './agent.js';
import type { Account } from './probe.js';
import type { ClientCallAnswer } from '../tools/clientcalls.js';

export type { MessageAttachment };

/**
 * Emits one state action on a session's channel.
 *
 * `session` addresses the session channel, `chat` the chat channel beneath it,
 * and `terminal` a terminal's own - the emitter knows which of its channels it
 * is talking about and the host knows what each is called.
 *
 * What a backend emits is the host's own action, said with no client's origin,
 * as the reference host says what its agents report.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L901-L912
 */
export type Emit = (channel: 'session' | 'chat' | 'terminal', action: Bag) => void;

/**
 * A channel of a session that its backend serves under this host's name for
 * it, as `Session.channel` answers it: a changeset or a canvas of the host a
 * nested session runs in.
 *
 * The host answers a subscribe with `snapshot`, and its backend says what
 * moves after that through `Start.emitOn`, under the same name, until
 * `release`.
 */
export interface SessionChannel {
  /** The channel's state now. */
  snapshot(): Promise<Bag>;
  /** A client's action on the channel, carried to the backend once the host has said it. */
  dispatch(action: Bag): void;
  /** A command a client sent about the channel, with its params as sent, answered by the backend. */
  request(method: string, params: Bag): Promise<unknown>;
  /** No client of this host watches the channel any more. */
  release(): void;
}

/**
 * What a backend knows about the worker chat it wants for one of its calls.
 *
 * A subagent runs inside a single tool call of a turn, and the protocol has a
 * place for it: a read-only chat whose origin is that call. The backend is the
 * only thing that can see the call and what the harness said about it, so it
 * brings the words; the host brings the URI, the catalogue row and the turn.
 */
export interface SubagentRequest {
  /** What the chat is called in a list. */
  title: string;
  /** The harness's own name for the kind of worker, when it said one. */
  agentName?: string;
  /** One line about the work, which the spawning call also shows. */
  description?: string;
  /** The message the worker was given, which opens its turn. */
  prompt?: string;
  /**
   * The spawning call's own parent, when this worker was spawned inside one.
   *
   * Empty for a call in the session's own chat, which is how a nested worker's
   * origin names the worker chat its call is in rather than the default chat.
   */
  parentToolCallId?: string;
}

/**
 * The worker chat a host opened, and the way a backend writes to it.
 *
 * `emit` takes the same chat actions the backend already emits for its own
 * chat, addressed to this one; `end` closes the turn the host opened, which is
 * the only thing that ends a worker's turn besides a cancellation.
 */
export interface SubagentChat {
  /** The URI the host named. */
  readonly uri: string;
  /**
   * The turn the host opened with the worker's prompt.
   *
   * Every response part and tool call the backend emits for this worker has to
   * name it, because a part that names no open turn lands nowhere.
   */
  readonly turnId: string;
  /** One state action on this chat's channel. */
  emit(action: Bag): void;
  /**
   * End the turn the host opened, and say how it went.
   *
   * `why` is the failure's own sentence and is only read for `error`.
   */
  end(state: 'complete' | 'error' | 'cancelled', why?: string): void;
}

/**
 * One entry of a harness's own task list.
 *
 * `status` and `priority` are the harness's own words rather than the host's.
 * A backend that translated them first would be deciding what a plugin is for:
 * which of the host's statuses an entry belongs to, and what a status this host
 * has never heard of becomes.
 */
export interface HarnessPlanEntry {
  /** What the step says. */
  text: string;
  /** The status the harness gave it, as the harness spells it. */
  status: string;
  /** How urgent the harness said it is, where it said. */
  priority?: string;
}

/**
 * One change to a harness's task list, as a tool that names a single task
 * sends it.
 *
 * `id` is the harness's own id for the task. A tool that adds a task may only
 * learn its id once the call's result arrives, so a change that adds has none -
 * and a change that updates names the id an earlier add was given.
 */
export interface HarnessPlanChange {
  /** The harness's id for the task, absent on a change that adds it. */
  id?: string;
  /** What the task is, where the change says. */
  text?: string;
  /** The status it moves to, where the change says. */
  status?: string;
  /** How urgent it is, where the change says. */
  priority?: string;
}

/**
 * A harness's task list, or one change to it, handed to the host.
 *
 * A tool that rewrites its list whole sends `entries`; one that names a single
 * task sends `change`, and the two are never both there. `turn` is the turn
 * whose call wrote it, which is where a plugin reads who to stamp the task
 * with; `tool` is the harness's own name for the tool, which a translated task
 * keeps as its source.
 */
export type PlanUpdate = {
  /** The turn whose call wrote the list or the change. */
  turn: string;
  /** The harness's tool that wrote it, as the harness names it. */
  tool: string;
} & (
  | {
    /** The whole list, when the tool sends one. */
    entries: HarnessPlanEntry[];
    change?: never;
  }
  | {
    /** One change, when the tool sends one. */
    change: HarnessPlanChange;
    entries?: never;
  }
);

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
  /** Models this session's variant offers, so a stored one can be checked. */
  seedModels?: { id: string; name: string }[];
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
   * The chain entry this session is resumed *at*, keeping it and everything
   * before it.
   *
   * A rewind rather than a fork: the conversation carries on under the id it
   * already had, with the turns after that point dropped. What
   * `chat/truncated` asks for, and the id is the difference - a fork leaves
   * the original for somebody else to find, a truncation means there is
   * nothing left to find. Meaningless without `resume`, and ignored beside
   * `forkAt`, which asks for the other thing.
   */
  rewindAt?: string;
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
  /**
   * Client plugins this session runs with, by the directory each is in.
   *
   * A backend that loads plugins opens these directories; one that cannot
   * ignores the field and still gets their MCP servers through `mcpServers`,
   * which the host read out of the same copies.
   */
  plugins?: { path: string }[];
  /**
   * MCP servers of those plugins that a client switched off, by name.
   *
   * A backend that loads the plugin directories itself may find such a server
   * anyway, so the name is handed down beside them for a backend that can be
   * told not to run one. A backend that cannot ignores the field.
   */
  deniedMcpServers?: string[];
  /**
   * Tools the host contributes to this session.
   *
   * Offered to the model as an MCP server that runs in this process, so a
   * call is a function call rather than a subprocess. What they are is the
   * host's business; this only runs them.
   */
  tools?: BoundTool[];
  /** What the host wants the model told beside this backend's own prompt, one entry per instruction. */
  instructions?: string[];
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
   * is a filesystem and a session has none. `text` is what the caller already
   * holds of that side, for a backend that saw the file change rather than
   * watching it; the promise is waited for where the host has a filesystem to
   * read, so a `before` finishes before the write that follows it.
   */
  onFileEdit?(turnId: string, path: string, phase: 'before' | 'after', text?: string): Promise<void> | void;
  /**
   * A file a write tool is about to change, while a person decides about it.
   *
   * `Start.onEditProposed` handed down: the session names the call, the file
   * and what the tool would leave, and the host reads the file and holds that
   * text under a URI of its own for a client to draw the proposed side from.
   * The tool has not run, so the text is on no disk until it does.
   *
   * Absent on a host with no changeset source, and answering nothing is the
   * same answer: a call with no preview, whose confirmation goes out as it
   * would have without one.
   */
  onEditProposed?(toolCallId: string, path: string, apply: (current: string | undefined) => string | undefined): Promise<FileEdit | undefined> | FileEdit | undefined;
  /**
   * The preview for a call is done with.
   *
   * `Start.onEditSettled` handed down: said once the person has answered, and
   * once for every call the session was still holding as it closes. Absent on
   * a host that passes no such callback.
   */
  onEditSettled?(toolCallId: string): void;
  /**
   * A turn this session has written under an id of its own.
   *
   * `Start.onTurnRecorded` handed down: a backend that names a turn its own way
   * in its own transcript says so here, once, and the host keeps what it holds
   * against that turn under the other id as well. Absent on a host that passes
   * no such callback.
   */
  onTurnRecorded?(turnId: string, transcriptId: string): void;
  /**
   * The account this backend's harness is signed in as, once it is known.
   *
   * `Start.onAccount` handed down: a backend that reads the account while it
   * runs - an ACP server that reports its sign-in when a session starts - says
   * so here, and the host publishes it where a client reads the operator's
   * account. Absent on a host that keeps none.
   */
  onAccount?(account: Account): void;
  /**
   * A harness's own task list, or one change to it, out of this backend.
   *
   * `Start.planUpdate` handed down: the backend is the only thing that sees
   * its harness's task calls, so it brings them here and the host raises
   * `plan_update` with them. Absent on a host that passes no such callback.
   */
  planUpdate?(update: PlanUpdate): void;
  /**
   * Whether the host draws this session's Plan call itself.
   *
   * `Start.plan` handed down: a backend that reads it keeps its harness's own
   * list out of the turn, because the host draws the one call with the lines a
   * plugin gives it. What the harness still knows is brought here through
   * `planUpdate` either way.
   */
  plan?: boolean;
  /** Called once the agent has reported what it can do. */
  onHandshake?(): void;
}

/** Who a message came from, when not the person at the keyboard. */
export interface MessageFrom {
  /** `Message.origin`. The user's when absent. */
  origin?: { kind: 'user' | 'agent' | 'tool' | 'automation' | 'systemNotification' };
  /** `Message._meta`, carried whole. */
  _meta?: Bag;
  /**
   * `Message.agent`, the protocol's `AgentSelection`: the agent this message
   * picked, on a steering message. A send's is handed with `changeAgent`
   * before it.
   */
  agent?: { uri: string };
}

/**
 * A steering message, as the host hands it to a backend: the protocol's
 * `PendingMessage`, its message read into the words, the files and the sender
 * a backend takes.
 */
export interface SteeringMessage {
  /** The pending message's id, the client's. */
  id: string;
  /** What it says. */
  text: string;
  /** Its own attachments, as `sendMessage` takes them. */
  attachments?: MessageAttachment[];
  /** Who sent it, when not the person at the keyboard. */
  from?: MessageFrom;
}

/**
 * What a turn is given beside its message, decided when the turn begins.
 *
 * `instructions` is the host's own word to the model on this turn and no
 * other: context the person did not type and the transcript does not show.
 * A session another window delegated work to is told to report back to the
 * chat the work came from, and a client in it is what can do the reporting.
 *
 * A function rather than the words themselves, because when they are read is
 * part of what they say. A message that waits its turn was sent in earlier,
 * and a client that joined, or left, in between is what this is for - so the
 * backend asks at the moment the turn begins, not at the moment it arrived.
 */
export interface TurnOptions {
  /** What the host wants said on this turn. Empty is a host with nothing to say. */
  instructions?: () => string[];
}

/**
 * A backend's answer to one config value: `true` for taken as asked, or its
 * own words for a value it could not take.
 */
export type ConfigTaken = true | string;

/** A live session. */
export interface Session {
  /** The session channel URI. */
  readonly uri: string;
  /** The chat channel URI. */
  readonly chatUri: string;

  /**
   * Models this session can run a turn on. Empty until the agent has answered.
   *
   * The two limits are the ones the backend published, and are absent for a
   * model nothing is known about rather than zero.
   */
  models(): { id: string; name: string; maxContextWindow?: number; maxOutputTokens?: number }[];
  /**
   * The id the agent gave this session, if it has said one yet.
   *
   * Not the same as `uri`: the client names the channel, the agent names the
   * transcript it writes. The catalogue needs both to tell that the row on
   * disk and this session are one conversation.
   */
  agentId(): string | undefined;

  /**
   * Whether the agent can be asked for this conversation again, by `agentId()`.
   *
   * Absent means it can. Moving a chat and restarting one are the same act on a
   * backend: it is started again with `resume` set to the id it kept the
   * conversation under, and a backend that cannot take one back would answer
   * with an empty conversation. So the host asks before it offers a chat as
   * movable, and a backend that cannot name a conversation it can reopen says
   * so here rather than being offered and failing.
   *
   * Two answer no. A nested session: the host inside the machine makes a fresh
   * inner session each time it is started, so no id is one it can be resumed by.
   * And an ACP server that did not advertise `loadSession`, whose conversations
   * live in the server process rather than anywhere this host can point at.
   */
  resumable?(): boolean;

  /**
   * Whether the backend has work in hand the host cannot see.
   *
   * A background task, or a timer the agent set itself, which would be lost
   * if the host let the agent go while the session is quiet. Absent means it
   * has none, and a session that answers true does not sleep.
   */
  busy?(): boolean;

  /**
   * The backend's own name for the last entry a turn left behind, if it has
   * one.
   *
   * What a fork is cut at, and a fork copies through it: the new chat holds
   * the chosen turn whole, its answer included, as the AHP spec's
   * `ForkChatSource` says. A turn has an id this host chose and the backend
   * has an id of its own for the same entry, and only the backend's means
   * anything when it is asked to resume at one.
   *
   * Optional, and its absence is what makes forking unavailable: a backend
   * that cannot name the entry a turn ended at cannot be asked to continue
   * from one, and the host advertises no `fork` capability for it rather than
   * offering a control that fails when it is used.
   */
  forkPoint?(turnId: string): string | undefined;
  /**
   * The backend's own name for the *last* thing a turn did, if it has one.
   *
   * Where a rewind cuts: the turn stays whole and what came after it is
   * dropped. `forkPoint` and `endPoint` both name the last entry a turn left
   * behind, and they are both kept because they are not the same question: a
   * backend may fork and may not truncate, and one that can do both is
   * free to answer the two from different entries.
   *
   * Optional and, like `forkPoint`, answered for a turn whose last entry the
   * backend can name: one this process watched run, or one the backend named
   * when it read the transcript the session resumes. A turn read back by a
   * backend that names none has no point, and such a session can be truncated
   * no further back than its own first turn.
   */
  endPoint?(turnId: string): string | undefined;
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
  /**
   * Give it a title, without announcing it.
   *
   * The host announces: on the default chat a title is the session's and goes
   * out as `session/titleChanged`, on a peer chat as `session/chatUpdated`,
   * and the chat cannot tell which it is. Optional; a backend without it
   * keeps whatever title it derives.
   */
  setTitle?(title: string): void;
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
   * A changeset or canvas channel this session's backend serves, by this
   * host's name for it, or nothing for one it does not.
   *
   * A backend that answers it is the one producer of the session's changeset
   * lists, its chat's canvas list and its chat's row, all but the read and
   * archived bits, which are this host's: the proxy of a session in a
   * machine, whose host there runs the session. The reference host's designs
   * across hosts leave the host running a session the one producer of its
   * state: a relay forwards that host's messages, and a mirror enqueues that
   * host's own envelopes for the session's chat and changeset channels.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/relayTransport.ts#L48-L55
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/missionControl/missionControlSessionMirror.ts#L227-L228
   */
  channel?(uri: string): SessionChannel | undefined;

  /**
   * Carry a client's action on this session's chat or session channel to the
   * host that runs the session, as the client sent it.
   *
   * A backend that answers it is the proxy of a session another host runs,
   * reached as a relay reaches one: this host says nothing of the action and
   * hands the session nothing else for it, and the host running the session
   * applies the action and echoes it. The echo comes back through
   * `Start.answer` under `origin`, which answers the client that sent it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/relayTransport.ts#L123-L137
   *
   * A turn's start is admitted here first, its policy and its machine, and
   * carried once this host admits it. With no `origin` the action is this
   * host's own, said here already and carried as it is: a message it queues
   * for the chat, which the host there runs.
   */
  relay?(channel: 'session' | 'chat', action: Bag, origin?: ActionOrigin): void;

  /**
   * Hand one steering message to the turn that is running.
   *
   * Steering, in the protocol's word: somebody correcting an agent halfway
   * rather than waiting for it to finish doing the thing they are trying to
   * stop. The answer is one of three, as the reference host's agents answer:
   * `true` when the backend took it; `false` when it cannot yet, a turn still
   * preparing its prompt among them, so the host keeps it pending and hands it
   * again on the turn's next action; and a promise of `false` when the turn it
   * was meant for ended first, handing it back unsent, so the host steers the
   * turn that runs then with it, or runs it as the next turn.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1943-L1948
   *
   * `message.attachments` are the message's own, as `sendMessage` takes them:
   * the files the host wrote for whatever the client pasted, which is what the
   * correction is about as often as the words are. `message.from` is its
   * sender, so a turn a backend runs with the steered text keeps the origin
   * and `_meta` of the message that was steered. Absent, the message is the
   * user's.
   *
   * Optional. A backend that cannot take a message mid-turn leaves it out,
   * and this host refuses steering for that backend in the reference host's
   * words.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13526-L13529
   */
  sendSteeringMessage?(message: SteeringMessage): boolean | Promise<boolean>;

  /**
   * Take back a steering message handed with `sendSteeringMessage` that a
   * client removed before the model read it. One the model read stays in its
   * turn. Without it, the host refuses a removal of steering while a turn
   * runs, as the reference host does.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1950-L1955
   */
  withdrawSteeringMessage?(id: string): void;

  /**
   * Send what was said as the turn `turnId`, whose start the host has said:
   * the client's own, or the host's for a turn it begins itself. The backend
   * says no start of it.
   *
   * The turn's model and agent are handed before it, with `changeModel` and
   * `changeAgent`, as the reference host hands an agent's before its send.
   * Settles once the prompt is the agent's; a rejection is a send that
   * failed, and the host ends the turn in a `sendFailed` error with its
   * words.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1303-L1311
   *
   * `from` is the message's provenance when it was not typed by a person:
   * `origin` (`{ kind: 'agent' }` for a message another session's agent
   * sent) and `_meta` (where from, in the reference client's
   * `vscode.chat.delegation` spelling). Absent, the message is the user's.
   *
   * `attachments` are the message's own, in the protocol's spelling: what a
   * client pasted or picked is handed over rather than described in the text,
   * so a backend that can see an image sees the image and one that cannot is
   * the only thing that has to say so. Absent for a message that carried none,
   * which is every message this host writes itself.
   *
   * `options` is what the turn is given beside the message, read here because
   * this is where the turn begins.
   *
   * A turn handed while another runs is a send of its own, which the backend
   * runs once the work in front of it is done, as the reference host hands a
   * client's start to its agent at once and its agents run each in turn. The
   * turn it replaced in every client's state runs on, its actions name it,
   * and it is in no history.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1815
   */
  sendMessage(turnId: string, text: string, from?: MessageFrom, attachments?: MessageAttachment[], options?: TurnOptions): void | Promise<void>;

  /**
   * The model a client picked for this chat's next send. A model the backend
   * takes is the chat's for the turns after it too, and the chat keeps the one
   * it has when the backend will not take another.
   *
   * The host hands a turn's model before its send when the chat's backend
   * offers it, and logs one it does not. A rejection fails the turn being
   * prepared, in a `modelSelectionFailed` error.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2228-L2235
   */
  changeModel(model: Chosen): void | Promise<void>;

  /**
   * The agent this chat's turns run as from its next send, or the backend's
   * own when absent: the protocol's `AgentSelection` a message carries.
   *
   * Handed before every send. A rejection is logged, and the turn is sent all
   * the same, as the reference host sends it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2236-L2238
   */
  changeAgent(agent: { uri: string } | undefined): void | Promise<void>;

  /**
   * Run the latest turn again, without adding a message.
   *
   * What `chat/turnResume` asks for: the turn errored, its message and its
   * parts are intact, and the client wants the same prompt tried again rather
   * than typed again. Rejects when the backend holds no such turn to run, and
   * the host ends the turn again in an error that can be resumed.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1313-L1314
   *
   * Optional. A backend that cannot re-run a turn leaves it out, and the host
   * refuses the action with that as the reason.
   */
  resumeTurn?(turnId: string): void | Promise<void>;

  /**
   * Stop what this chat runs: the turn in flight and everything the backend
   * holds of it, with anything it was blocked on answered.
   *
   * The host calls this when a client's stop names the chat's running turn,
   * once it has said the stop to every client of the chat: the turn has ended
   * in their state, and what the backend says of it afterwards is not said
   * again. A stop naming any other turn, or none, reaches no backend.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1316-L1317
   */
  abort(): void | Promise<void>;

  /**
   * Stop one worker, named by the tool call that spawned it, and leave the
   * turn that runs it going: what a stop given in that worker's chat means.
   *
   * Optional. Without it a stop in a worker chat cancels the lead chat's
   * running turn, which is the only stop such a backend has.
   */
  stopWorker?(toolCallId: string): void;

  /**
   * What somebody is part-way through typing, which the host has said to every
   * client of the chat: held for the chat's state the session answers, and
   * said by nothing here.
   */
  setDraft(draft: Bag | undefined): void;
  /**
   * A client's read or archived bit for the chat, once this host has said and
   * kept it, carried to the host that runs the chat.
   *
   * A backend that runs its chat on another host takes it, as the proxy of a
   * session in a machine does, and the `chat/isReadChanged` and
   * `chat/isArchivedChanged` that host says of its own clients are the chat's
   * bits here too. A backend that leaves it out has its chat's bits kept by
   * this host alone.
   */
  flag?(bit: 'read' | 'archived', on: boolean): void;

  /**
   * Answer a tool call the agent is waiting on.
   *
   * `optionId` is the `id` of the `ConfirmationOption` the person picked, when
   * this backend offered options on the call and the client sent one as
   * `selectedOptionId`; absent, the answer is a plain approve or deny.
   *
   * Handed over once the chat's state has the call pending a confirmation,
   * which is the protocol's condition for taking one. The backend says the
   * `chat/toolCallConfirmed` back, and the host sends the client's own
   * decision in its place. False when no call by that id waits on a
   * confirmation here, and the host then says the decision itself, since
   * every client holds the call the state says.
   */
  confirm(toolCallId: string, approved: boolean, optionId?: string): boolean;

  /**
   * Replace the tools this session offers the model.
   *
   * The host's own are fixed at creation; a client's come and go with the
   * client, which is what this is for. Replaces rather than merges, because
   * a tool taken away has to be able to go.
   *
   * False when the backend could not re-declare them - a session whose agent
   * has gone, or one whose backend cannot change its tools once it is running.
   *
   * Optional. A backend that leaves it out is one this host offers no
   * client-provided tools through, and it says so rather than accepting an
   * announcement it will not act on.
   */
  setTools?(tools: BoundTool[]): Promise<boolean>;
  /**
   * The client running a tool call, as this backend holds it, for a call that
   * is one client's to run, and nothing for a call the agent runs itself.
   *
   * The backend's own record. Which client may write into a call, or say its
   * result, the host reads off the call's contributor in the chat's state,
   * which is what the call's start said.
   */
  toolCallOwner?(toolCallId: string): string | undefined;
  /**
   * What a client says one of its own tool calls did.
   *
   * The whole answer, not only its words: a client's tool can return an image
   * or a file as readily as a sentence, and a backend whose harness takes
   * those is handed them. `text` is the blocks' words joined, which is what a
   * harness that takes only text reads.
   *
   * Handed over once the host has said the client's result to every client of
   * the chat, and for a result its client asks to have confirmed, once a
   * client has approved it or denied it, a denial handed as a failure. False
   * when no call by that id waits on that client here, a second result for a
   * call among them, which the host logs. What the backend says of the call
   * afterwards is not said again.
   */
  completeToolCall?(
    toolCallId: string,
    clientId: string,
    result: ClientCallAnswer,
  ): boolean;
  /**
   * A client that was running tool calls here has gone.
   *
   * Its outstanding calls are failed rather than left open: the agent is
   * waiting on a promise that nothing can settle any more, and a turn that
   * hangs for ever is worse than a tool that says it could not run.
   */
  clientGone?(clientId: string): void;
  /**
   * Answer a question the agent asked, keyed by question id.
   *
   * Handed over once the chat's state has the request open, and the host says
   * the `chat/inputCompleted` back to every client of the chat, so a backend
   * does not emit that action itself. False when the request is not one this
   * session is waiting on.
   *
   * `response` is the kind the client sent, where it sent one, and it is here
   * because a decline and a cancel are two different things to tell a server:
   * one is somebody saying no, the other that nobody was asked. Only the
   * backend knows which of the two its agent can be told, so the host passes
   * the kind on rather than reducing it to `accepted` on the way. A backend
   * that reads the two-way answer alone leaves it out, and the host leaves it
   * out for a client that sent no kind at all.
   */
  answer(requestId: string, accepted: boolean, answers: Bag, response?: 'accept' | 'decline' | 'cancel'): boolean;
  /**
   * One question of an open request, as somebody types the answer.
   *
   * The protocol calls the result the request's synced answer state, and it is
   * what a `chat/inputCompleted` carrying no answers of its own is completed
   * with. Held by the session for the same reason a draft message is: two
   * people on one chat are answering one form.
   *
   * Handed over once the chat's state has the request open. The backend says
   * the `chat/inputAnswerChanged` back. False when nothing here is waiting on
   * that request, or when what is waiting is a tool confirmation rather than a
   * question, and the host then says the draft itself.
   *
   * Optional. A backend that keeps no drafts leaves it out, and the host
   * refuses the action with that as the reason.
   */
  setAnswer?(requestId: string, questionId: string, answer: Bag | undefined): boolean;

  /**
   * Take one config value a client set, once the host has said it.
   *
   * Every key a client sets comes here, including the ones a backend
   * advertises in its own schema: the host reads that schema for how a key
   * behaves - whether it can move on a running session, whether it belongs to
   * the session or to one chat - and knows nothing about what any key means.
   * The host checks a change against the schema and says it, as the reference
   * host says a client's config change in the client's own keys and then
   * applies it to its agents.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13576-L13661
   *
   * `true` when it was taken as it was asked. A string is the backend's own
   * words for a value it could not take, a key it does not serve or a value
   * it will not take for a key it does, which the host logs: the change
   * stands as every client was told it.
   */
  setConfig?(key: string, value: unknown): ConfigTaken | Promise<ConfigTaken>;
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
   * Stop holding a turn back on an MCP server that is still starting.
   *
   * The protocol's `session/mcpServerBackgroundRequested`, and the name is VS
   * Code's own for the same seam. The server keeps starting; what changes is
   * that the next message does not wait for it.
   *
   * True when the backend took the request, which it says by emitting: the
   * action, and the `session/mcpServerStateChanged` that follows it, or a state
   * restoring `blocking: true` when it could not stop waiting. False when
   * nothing here was waiting on that server.
   *
   * Optional: no backend here holds a message back on a starting server. Where
   * this is absent or answers false the host answers the request from the
   * state the server has. A server starting with `blocking: true` keeps it, so
   * the request goes to every client and that state follows it, which is how
   * the protocol has a host decline one; on any other server the request moves
   * nothing, and goes to every client alone.
   */
  backgroundMcpServerStartup?(id: string): Promise<boolean>;

  /**
   * A token for one of this session's MCP servers, as the client signed in.
   *
   * Answers whether the server it names is one of this session's. The token
   * becomes that server's `Authorization` header and the server is asked to
   * connect again; nothing else in the session is told.
   *
   * `server` is the customization id of the server a client's `target` named.
   * The token is then that server's alone: another server waiting for the
   * same resource is not given it. With no `server`, the backend gives it to
   * a server waiting for the resource.
   *
   * Optional: a backend that cannot re-declare a server leaves it out, and the
   * host then advertises no resource for one to be signed into.
   */
  authenticated?(resource: string, token: string, server?: string): Promise<boolean>;

  /**
   * The OAuth resources this session's MCP servers need signing into.
   *
   * What `authenticate` is checked against: the protocol says a client's
   * `resource` MUST match one the server advertised, and these are advertised
   * on the servers' own `authRequired` states.
   */
  awaiting?(): string[];

  /**
   * The sentence this session ended with, or nothing while it runs.
   *
   * A session whose agent has gone for good - a host inside a machine that
   * died - answers it, and the host refuses every later client action on its
   * session and chat channels with it, and ends a new turn on them in an
   * error with it.
   *
   * Optional. A backend that is either running or closed leaves it out.
   */
  ended?(): string | undefined;

  /**
   * End the session and stop its agent.
   *
   * `reason` says why it ends, and defaults to `dispose`. `dispose` is a
   * session this host is deleting: a backend that keeps its transcript on the
   * far side of a process - one running nested - disposes the one inside, so
   * nothing is left behind.
   *
   * `stopping` is a session this host only lets go of, and which another host
   * or the same one resumes by id. The transport ends and what the far side
   * holds stays, so the resume finds the conversation rather than a gap.
   *
   * A backend that can tell when its process has gone answers a promise that
   * settles then, and never rejects; `Host.close` waits on it, bounded.
   */
  close(reason?: 'dispose' | 'stopping'): void | Promise<void>;
}
