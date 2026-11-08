/**
 * The host's own moments, and what a plugin may subscribe to.
 *
 * An event is not a protocol frame: it is one of the things the host knows
 * because it did the work - a session opened, a turn ended, a store written -
 * and a client would only learn some of them, late and shaped for a screen. A
 * plugin subscribes with `on` and observes; it cannot answer, refuse or
 * rewrite, because changing what happens is what a tool, a port or an agent is
 * for.
 *
 * The union is the contract, so adding an event is a change to `@ahpd/sdk`.
 * A per-token delta is deliberately not here: a plugin that wants the stream
 * of a turn is a client.
 */

import type { ErrorInfo, SessionInputRequestKind } from '@microsoft/agent-host-protocol';

import type { PluginContext } from './plugin.js';
import type { PlanUpdate } from './session.js';
import type { Owner } from './usage.js';

/**
 * Every moment a plugin may subscribe to.
 *
 * The set is closed and written down in one place. An event that repeats a
 * state action a client already receives is added only for a moment a plugin
 * acts on without watching the session - a turn's two ends, a session that
 * began waiting on a person - and never for a per-token delta.
 */
export type EventName =
  | 'session_start'
  | 'session_end'
  | 'session_opened'
  | 'turn_start'
  | 'turn_end'
  | 'message'
  | 'tool_call'
  | 'plan_update'
  | 'input_needed_set'
  | 'input_needed_removed'
  | 'client_connect'
  | 'client_disconnect'
  | 'authenticated'
  | 'automation_fire'
  | 'resource_write'
  | 'users_changed'
  | 'terminal_open'
  | 'listening'
  | 'stopping'
  | 'log';

/** A session this host started, and the backend serving it. */
export interface SessionStartEvent {
  type: 'session_start';
  /** The session channel URI. */
  session: string;
  /** The agent `provider` it runs on. */
  provider: string;
  /**
   * The client that created it, when a client did.
   *
   * Absent for a session nobody asked for: an automation coming round at nine
   * in the morning, a changeset making its own, a plugin starting one for
   * somebody it names. A plugin that has to reach whoever is working in a
   * session needs this and `session_opened` both, because a client that did
   * not create one may still be in it.
   */
  client?: string;
}

/** A session this host stopped, and why. */
export interface SessionEndEvent {
  type: 'session_end';
  /** The session channel URI. */
  session: string;
  /** The word for what ended it, which only the host knows. */
  reason: string;
}

/**
 * A client subscribed to a session, or to one of its chats.
 *
 * The moment a client is in a session, and the only one: `session_start`
 * names whoever created it, and a session a person opens from a list was
 * created by nobody here. Raised once per client and session, so a client
 * that subscribes to a session and then to a chat of it has opened it once,
 * and one that opens a second window is a second client under its own id.
 */
export interface SessionOpenedEvent {
  type: 'session_opened';
  /** The session channel URI. */
  session: string;
  /** The id the client gave at `initialize` or `reconnect`. */
  client: string;
}

/**
 * A turn a session's chat began: a start this host handed the chat's
 * backend, one the backend opened itself, or a `!` command this host runs as
 * the turn. A start this host ends before handing it over, refused or failed
 * in its preparation, ends with no start before it, and so does a worker's
 * turn, which begins inside a call of its lead chat's turn.
 */
export interface TurnStartEvent {
  type: 'turn_start';
  /** The session channel URI. */
  session: string;
  /** The chat channel URI. */
  chat: string;
  /** The turn's id. */
  turn: string;
  /**
   * Who sent it, as a typed reference. Absent where nobody sent it on this
   * host: no users directory to name, or a turn the backend began by itself.
   */
  sender?: Owner;
  /** The queued message the turn took up, where it took one up. */
  queuedMessageId?: string;
}

/**
 * Why a turn ended, in VS Code's host's words for it.
 *
 * `success` when the turn finished, `cancelled` when a client or the agent
 * stopped it, `error` when it ended in `chat/error`, a send or its preparation
 * failing included, with the error and whether the turn can be resumed,
 * `rejected` when this host refused the start before handing it over, so no
 * turn began and nothing of one is left to finish, with the refusal and
 * whether whoever sent the message still holds it, and `localCommand` when
 * this host ran it as its own `!` command.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatContributionsService.ts#L19-L37
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTurnStarter.ts#L44-L49
 */
export type TurnEndReason =
  | { kind: 'success' }
  | { kind: 'cancelled' }
  | { kind: 'error'; error: ErrorInfo; resumable: boolean }
  | { kind: 'rejected'; error: ErrorInfo; recoverable: boolean }
  | { kind: 'localCommand' };

/**
 * A turn that ended, on any chat of a session, a worker's among them, and
 * why: every way one ends, its backend's ends and the ones this host says
 * itself, a start it refused before any backend ran it among them, in the
 * shape of VS Code's `ITurnEnd`, which its host offers its chat contributions
 * after a turn ends. A plugin waiting on one chat's turn reads `channel`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatContributionsService.ts#L39-L49
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatContributionsService.ts#L258-L270
 */
export interface TurnEndEvent {
  type: 'turn_end';
  /** The session channel URI, the session that owns the chat. */
  session: string;
  /** The chat channel the turn ran on: the session's default chat, a peer chat, or a worker's. */
  channel: string;
  /** The turn's id. */
  turnId: string;
  /** Why the turn ended. */
  reason: TurnEndReason;
  /**
   * The queued message the turn took up, where the queue drain that began the
   * turn ended it itself: a start refused there comes with no `turn_start` to
   * name the message.
   */
  queuedMessageId?: string;
  /** Who sent it, as `TurnStartEvent.sender` says: the same name or nothing. */
  sender?: Owner;
}

/**
 * A session gained an entry on its input queue, which is usually a person being
 * waited on.
 *
 * `kind` is what tells the two apart. A `toolClientExecution` is not a question:
 * the call has cleared its confirmation gate and a client is running it, and the
 * protocol's own reducer deliberately does not count it as waiting on a person -
 * so a plugin that reacts to somebody being asked reads `kind` rather than the
 * event.
 *
 * The protocol's action is an upsert keyed by `id`, so a backend that sets the
 * same entry again raises the event again. Dedupe by `id` rather than counting.
 */
export interface InputNeededSetEvent {
  type: 'input_needed_set';
  /** The session channel URI. */
  session: string;
  /** The chat the request lives in. */
  chat: string;
  /** The request's id, the key its removal names. */
  id: string;
  /** The protocol's own `SessionInputRequestKind`, as the backend sent it. */
  kind: `${SessionInputRequestKind}`;
}

/**
 * A session stopped waiting on one of its requests.
 *
 * The `id` is the one the matching `input_needed_set` carried.
 */
export interface InputNeededRemovedEvent {
  type: 'input_needed_removed';
  /** The session channel URI. */
  session: string;
  /** The `id` of the request that is no longer wanted. */
  id: string;
}

/** A message a client sent as a turn. */
export interface MessageEvent {
  type: 'message';
  /** The session channel URI. */
  session: string;
  /** The chat channel URI. */
  chat: string;
  /** The turn id the message was sent under. */
  turn: string;
  /** What was typed, as the host about to hand it to the backend read it. */
  text: string;
}

/**
 * A host tool that was called, and whether it answered.
 *
 * A call made in a session carries the session and chat it was made from; one
 * made by a person with no session behind it carries `person` instead, and
 * neither `session` nor `chat`. Exactly one of the two is named, so a listener
 * that wants to know where the call came from asks what is there.
 */
export interface ToolCallEvent {
  type: 'tool_call';
  /** The session the call was made from, where one was. */
  session?: string;
  /** The chat the call was made from, where one was. */
  chat?: string;
  /** The person behind a call made with no session, where one was. */
  person?: string;
  /** The tool's `definition.name`. */
  tool: string;
  /** Whether it returned rather than threw. */
  ok: boolean;
  /** What it threw, when it threw. */
  error?: string;
}

/**
 * A harness's own task list, or one change to it, handed over by its backend.
 *
 * The backend is the only thing that sees a harness's task calls, so it brings
 * them here rather than making every plugin learn a harness's format. What
 * becomes of them is a plugin's business.
 */
export type PlanUpdateEvent = PlanUpdate & {
  type: 'plan_update';
  /** The session channel URI. */
  session: string;
  /** The chat channel URI. */
  chat: string;
  /** The harness that wrote it, as its backend's `provider`. */
  harness: string;
  /** The session's title, where the backend has one yet. */
  title?: string;
  /** Who sent the turn, where the host can name somebody. */
  sender?: Owner;
};

/** A client that connected and introduced itself. */
export interface ClientConnectEvent {
  type: 'client_connect';
  /** The id it gave at `initialize` or `reconnect`. */
  client: string;
}

/** A client whose connection went away. */
export interface ClientDisconnectEvent {
  type: 'client_disconnect';
  /** The id it had given, or `anonymous` where it gave none. */
  client: string;
}

/** A client that pushed a credential for one of the host's resources. */
export interface AuthenticatedEvent {
  type: 'authenticated';
  /** The client that pushed it. */
  client: string;
  /** The protected resource identifier it was for. */
  resource: string;
}

/** An automation that started a run, which is the one thing that is not a person. */
export interface AutomationFireEvent {
  type: 'automation_fire';
  /** The automation's resource. */
  automation: string;
  /** The run it started. */
  run: string;
}

/** A write a client made through this host's resource store. */
export interface ResourceWriteEvent {
  type: 'resource_write';
  /** The URI that was written. */
  uri: string;
}

/**
 * The users directory changed: a person edited its file, or this host wrote it.
 *
 * Carries nothing, because a principal is read again from the directory on
 * each access and the listener reads what it needs. A plugin that answers per
 * person, such as a channel that filters what each subscriber sees, reads its
 * subscribers again and sends the difference.
 */
export interface UsersChangedEvent {
  type: 'users_changed';
}

/** A terminal this host opened. */
export interface TerminalOpenEvent {
  type: 'terminal_open';
  /** The terminal channel URI. */
  terminal: string;
  /** The directory it was opened in. */
  cwd: string;
}

/**
 * The socket is open and bound, and this is what it bound.
 *
 * Fired by the daemon rather than by `createHost`, because the listener is
 * the daemon's: a host answers connections and never opens them. It is the
 * one event that arrives before any client could, which is what makes it the
 * place to stand something up that forwards to the bound port - a tunnel, an
 * announcement on the network - rather than guessing the port beforehand.
 *
 * A handler is awaited like any other, so a plugin that takes three seconds
 * to make a tunnel delays the line that says the daemon is ready. That is the
 * intended order: a URL printed before it works is a URL somebody pastes.
 */
export interface ListeningEvent {
  type: 'listening';
  /** Which runtime the listener found itself on. */
  runtime: 'node' | 'bun' | 'deno';
  /** The address it bound. */
  host: string;
  /** The port it accepted, resolved - never the zero that asked for any. */
  port: number;
  /** Whether a connection token is required to open one. */
  guarded: boolean;
  /**
   * The connection token itself, when one is required: the daemon's endpoint
   * record for the plugins in its own process, as VS Code's local endpoint
   * record carries `connectionToken` to processes of the same user, so a
   * plugin that carries a connection to the daemon - a tunnel's hop - can
   * present it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/LOCAL_ENDPOINT.md
   */
  connectionToken?: string;
}

/**
 * The listener is about to close, and the host with it.
 *
 * Fired before `listener.close()`, so what a plugin stood up at `listening`
 * has somewhere to be taken down. Awaited, and on the shutdown path, so a
 * handler that hangs is a daemon that will not stop.
 */
export interface StoppingEvent {
  type: 'stopping';
}

/** One line the host already writes to its own log. */
export interface LogEvent {
  type: 'log';
  /** The line, the same string `onEvent` receives. */
  line: string;
}

/** Every event, discriminated on `type`. */
export type HostEvent =
  | SessionStartEvent
  | SessionEndEvent
  | SessionOpenedEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageEvent
  | ToolCallEvent
  | PlanUpdateEvent
  | InputNeededSetEvent
  | InputNeededRemovedEvent
  | ClientConnectEvent
  | ClientDisconnectEvent
  | AuthenticatedEvent
  | AutomationFireEvent
  | ResourceWriteEvent
  | UsersChangedEvent
  | TerminalOpenEvent
  | ListeningEvent
  | StoppingEvent
  | LogEvent;

/** The member of `HostEvent` whose `type` is `K`, so a handler is typed per name. */
export type HostEventOf<K extends EventName> = Extract<HostEvent, { type: K }>;

/**
 * What a plugin does with an event.
 *
 * The return value is ignored and refusing or rewriting is not available: a
 * handler that wants to change what happens contributes a tool, a port or an
 * agent instead. The handler is awaited before the next one runs, so a slow
 * handler is a deliberate cost.
 */
export type EventHandler<K extends EventName = EventName> =
  (event: HostEventOf<K>, context: PluginContext) => void | Promise<void>;

/**
 * One subscription, with the plugin that made it.
 *
 * `by` is what a handler that throws is reported against, because a host with
 * several plugins installed has no other way to say which one is broken.
 * `context` is captured at registration rather than rebuilt at fire time: it
 * is the same read-only context `apply` was handed, and the host does not
 * otherwise know every directory the daemon was told to serve.
 */
export interface EventListener<K extends EventName = EventName> {
  /** The plugin's name. */
  by: string;
  /** What the handler may read, as `apply` read it. */
  context: PluginContext;
  /** What to call. */
  handle: EventHandler<K>;
}

/** The listeners for every event, by name, in registration order. */
export type HostHandlers = { [K in EventName]?: EventListener<K>[] };
