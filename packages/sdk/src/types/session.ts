/** One agent session: its lifecycle, its turns, and what it is waiting for. */

import type { MessageAttachment } from '@microsoft/agent-host-protocol';
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
 * `handed` says the action answers a client's action the host handed this
 * backend earlier (`Start.handed`), and it goes out as that client's echo,
 * carrying the client's origin.
 */
export type Emit = (channel: 'session' | 'chat' | 'terminal', action: Bag, handed?: Handed) => void;

/**
 * A client's action, held by the backend the host handed it to.
 *
 * The protocol has the client that sent an action hold it as pending until
 * the host answers it, with the action carrying its origin or with a rejection
 * (https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md).
 * A backend answers most actions while the host is handing them over, and the
 * host gives that answer the origin itself. A backend that answers later, once
 * something else has answered it (the proxy, once the host inside a machine
 * has), keeps this from `Start.handed` and answers through it: an action
 * emitted with it is the echo, and `refuse` is the rejection.
 */
export interface Handed {
  /** Refuse the action to the client that sent it, with `reason`. */
  refuse: (reason: string) => void;
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
   * The client's action the host handed this session, for an action it
   * answers or refuses after the host has stopped applying it
   * (`Start.handed`).
   */
  handed?: (action: Bag) => Handed | undefined;
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

/**
 * The terminal a host-run command runs in, as soon as it is open.
 *
 * `isPty` is the terminal's own, as its state says it: a client reads it to
 * decide whether the output holds VT sequences. Absent where the state says
 * nothing.
 */
export interface CommandTerminal {
  /** The channel a client subscribes to. */
  uri: string;
  /** Whether a pseudoterminal runs the command. */
  isPty?: boolean;
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
  /** Whether a pseudoterminal ran it, as `CommandTerminal.isPty` says. */
  isPty?: boolean;
  /** What it exited with, where the runtime reported one. */
  code?: number;
}

/**
 * The host's half of a `!` command, as `Session.ran` is handed it: run the
 * command for the tool call `toolCallId`, tell `opened` the terminal as soon as
 * it opens, and answer with what the command did.
 */
export type RunCommand = (toolCallId: string, opened?: (terminal: CommandTerminal) => void) => Promise<Ran>;

/** Who a message came from, when not the person at the keyboard. */
export interface MessageFrom {
  /** `Message.origin`. The user's when absent. */
  origin?: { kind: 'user' | 'agent' | 'tool' | 'automation' | 'systemNotification' };
  /** `Message._meta`, carried whole. */
  _meta?: Bag;
  /** `Message.agent`, the protocol's `AgentSelection`: the agent this message picked. */
  agent?: { uri: string };
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
   * because the shell is - a session has no port to spawn one through. `run`
   * calls `opened` with the terminal as soon as it is open, which is when the
   * call names it, so a client watches the output arrive rather than only
   * reading it afterwards, as the reference host's `!` command does:
   * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/bangLocalCommand.ts#L96-L104
   *
   * Optional. `terminalCommandPrefix` is advertised per host rather than per
   * backend, because the protocol's capability is the host's - so a backend
   * that leaves this out is one whose `!command` turn the host refuses, with
   * the reason, rather than one it silently turns into a question.
   *
   * `queuedAs` is the queued message this command is, when it came through
   * `chat/pendingMessageSet` rather than as a turn: it waits behind the
   * running turn and anything already queued, the same id twice edits what
   * is waiting, and the turn that runs it names it as `queuedMessageId` so a
   * client takes it out of its queue - whether that turn starts now or later.
   */
  ran?(turnId: string, command: string, run: RunCommand, queuedAs?: string): void;

  /**
   * Put a message into the turn that is already running.
   *
   * Steering, in the protocol's word: somebody correcting an agent halfway
   * rather than waiting for it to finish doing the thing they are trying to
   * stop. Answers whether there was a turn to steer - a chat with nothing
   * running has nothing to inject into, and the caller says so rather than
   * quietly turning it into an ordinary message.
   *
   * `attachments` are the message's own, as `begin` takes them: the files the
   * host wrote for whatever the client pasted, which is what the correction is
   * about as often as the words are.
   *
   * `from` is the message's sender, as `begin` takes it: the turn a backend
   * begins with the steered text keeps the origin and `_meta` of the message
   * that was steered. Absent, the message is the user's.
   *
   * Optional. A backend that cannot take a message mid-turn leaves it out,
   * and this host refuses steering for that backend with that as the reason.
   */
  steer?(id: string, text: string, attachments?: MessageAttachment[], from?: MessageFrom): boolean;

  /**
   * Start a turn with what was said, optionally naming a model.
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
   */
  begin(turnId: string, text: string, model?: Chosen, from?: MessageFrom, attachments?: MessageAttachment[], options?: TurnOptions): void;
  /**
   * Run the latest turn again, without adding a message.
   *
   * What `chat/turnResume` asks for: the turn errored, its message and its
   * parts are intact, and the client wants the same prompt tried again rather
   * than typed again. Answers whether there was such a turn to resume.
   *
   * Optional. A backend that cannot re-run a turn leaves it out, and the host
   * refuses the action with that as the reason.
   */
  resume?(turnId: string): boolean;

  /** Stop the running turn, and answer anything it was blocked on. */
  cancel(turnId: string): void;

  /**
   * Stop one worker, named by the tool call that spawned it, and leave the
   * turn that runs it going: what a stop given in that worker's chat means.
   *
   * Optional. Without it a stop in a worker chat cancels the lead chat's
   * running turn, which is the only stop such a backend has.
   */
  stopWorker?(toolCallId: string): void;

  /**
   * Hold a message, and make it the next turn when the running one ends.
   *
   * The queue is the session's, not a client's: a client that held a message
   * would be the only thing that could ever send it, and nothing in a client
   * watches for a turn to end. The same `id` twice edits what is waiting.
   *
   * `attachments` are the message's own, as `begin` takes them, and are held
   * with it: a picture pasted into a message that waits its turn is still a
   * picture when the turn comes.
   *
   * `options` is what the turn is given beside the message, held with it and
   * read when the turn comes - which is later than this call, so the words
   * are the ones true then rather than the ones true now.
   */
  queue(id: string, text: string, model?: Chosen, from?: MessageFrom, attachments?: MessageAttachment[], options?: TurnOptions): void;
  /** Take one back, while it is still waiting. */
  unqueue(id: string): void;
  /**
   * What somebody is part-way through typing.
   *
   * Held by the session so two people on one chat see each other's - a client
   * that kept its own would need nothing from a host for this.
   */
  setDraft(draft: Bag | undefined): void;
  /** Reorder what is waiting. Anything not named keeps its place behind what is. */
  reorder(order: string[]): void;

  /**
   * Answer a tool call the agent is waiting on.
   *
   * `optionId` is the `id` of the `ConfirmationOption` the person picked, when
   * this backend offered options on the call and the client sent one as
   * `selectedOptionId`; absent, the answer is a plain approve or deny.
   *
   * False when no call by that id is waiting on a confirmation here: a client
   * out of step, which the host refuses, since the protocol has a host reject
   * a confirmation of a call that is not pending one.
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
   * The client running a tool call, for a call that is one client's to run.
   *
   * Nothing for a call the agent is running itself, which is what makes this
   * the check for whether a client may write into one: the protocol says a
   * host should refuse `chat/toolCallContentChanged` from anybody but the
   * call's own contributor.
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
   * False when no call by that id is waiting, or when it is waiting on a
   * different client - both are a client out of step rather than a no-op, and
   * the host refuses rather than dropping it.
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
   * False when the request is not one this session is waiting on, which the
   * host refuses as a client out of step. True is what the host says the
   * `chat/inputCompleted` back to every client of the chat on, so a backend
   * does not emit that action itself.
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
   * False when nothing here is waiting on that request, or when what is
   * waiting is a tool confirmation rather than a question.
   *
   * Optional. A backend that keeps no drafts leaves it out, and the host
   * refuses the action with that as the reason.
   */
  setAnswer?(requestId: string, questionId: string, answer: Bag | undefined): boolean;

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
   * nothing, and its sender alone hears it back.
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
   * session and chat channels with it, a new turn included.
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
