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

import type { PluginContext } from './plugin.js';

/**
 * Every moment a plugin may subscribe to.
 *
 * The set is closed and written down in one place. An event that only repeats
 * a state action a client already receives is refused rather than added.
 */
export type EventName =
  | 'session_start'
  | 'session_end'
  | 'turn_start'
  | 'turn_end'
  | 'message'
  | 'tool_call'
  | 'client_connect'
  | 'client_disconnect'
  | 'authenticated'
  | 'automation_fire'
  | 'resource_write'
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
}

/** A session this host stopped, and why. */
export interface SessionEndEvent {
  type: 'session_end';
  /** The session channel URI. */
  session: string;
  /** The word for what ended it, which only the host knows. */
  reason: string;
}

/** A turn that began. */
export interface TurnStartEvent {
  type: 'turn_start';
  /** The session channel URI. */
  session: string;
  /** The chat channel URI. */
  chat: string;
  /** The turn's id. */
  turn: string;
}

/** A turn that ended, and how. */
export interface TurnEndEvent {
  type: 'turn_end';
  /** The session channel URI. */
  session: string;
  /** The chat channel URI. */
  chat: string;
  /** The turn's id. */
  turn: string;
  /** `complete` when the backend finished it, `cancelled` when somebody stopped it. */
  status: 'complete' | 'cancelled';
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

/** A host tool that was called, and whether it answered. */
export interface ToolCallEvent {
  type: 'tool_call';
  /** The session the call was made from. */
  session: string;
  /** The chat the call was made from. */
  chat: string;
  /** The tool's `definition.name`. */
  tool: string;
  /** Whether it returned rather than threw. */
  ok: boolean;
  /** What it threw, when it threw. */
  error?: string;
}

/** A client that connected and introduced itself. */
export interface ClientConnectEvent {
  type: 'client_connect';
  /** The id it gave at `initialize` or `reconnect`. */
  client: string;
}

/** A client whose connection went away. */
export interface ClientDisconnectEvent {
  type: 'client_disconnect';
  /** The id it had given, or `anonymous` where it never introduced itself. */
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

/** An automation that started a session, which is the one thing that is not a person. */
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
  | TurnStartEvent
  | TurnEndEvent
  | MessageEvent
  | ToolCallEvent
  | ClientConnectEvent
  | ClientDisconnectEvent
  | AuthenticatedEvent
  | AutomationFireEvent
  | ResourceWriteEvent
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
