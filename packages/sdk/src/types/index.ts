/**
 * Every shape this daemon speaks.
 *
 * Nothing under `types/` imports a runtime value, so the contract can be read
 * without loading the server, a socket or the agent SDK.
 */

export type { Bag } from './common.js';
/*
 * The protocol's own shapes, as this host builds them.
 *
 * On the public surface because the port names them: `Agent.transcript`
 * answers with `WireTurn<Turn>[]`, and a backend written against this library
 * cannot implement that without being able to say it.
 */
export type { OnWire, WireTurn } from './wire.js';
export type { Request, Wire, Peer, Handler } from './rpc.js';
export type { Summary } from './catalog.js';
export type { Emit, SessionOptions, Session, Ran, Chosen, MessageFrom } from './session.js';
export type { HostOptions, Connection, Credential, Host, Diagnostics, HostTool, ToolCall } from './host.js';
export type { Loaded, Plugin, PluginContext, PluginHost, PluginSpec, Contribution, PortContribution, PortKey, PortOf } from './plugin.js';
export type {
  AuthenticatedEvent, AutomationFireEvent, ClientConnectEvent, ClientDisconnectEvent, EventHandler, EventListener,
  EventName, HostEvent, HostEventOf, HostHandlers, LogEvent, MessageEvent, ResourceWriteEvent,
  SessionEndEvent, SessionStartEvent, TerminalOpenEvent, ToolCallEvent, TurnEndEvent, TurnStartEvent,
} from './events.js';
export type { Page } from './paging.js';
export type { Connected, OnConnect, Runtime, Listener, Tap } from './listen.js';
export type { Offered } from './probe.js';
export type { Agent, Listed, Start, BoundTool, Endpoint, ToolEffects } from './agent.js';
export type { Entry, Metadata, Read, ResourceProvider, ResourceStore } from './resources.js';
export type { Claim, Terminal, TerminalOptions, SpawnPty, TerminalStore, OpenTerminal, OpenedTerminal, StartTerminals } from './terminals.js';
export type { Worktree, Worktrees } from './worktrees.js';
export type { NewPullRequest, PullRequest, PullRequests } from './github.js';
export type { Automation, AutomationRun, AutomationStore, RunEnding, StartSession } from './automations.js';
export type { Capability, Grant, Principal, UserFile, UserRecord, Users } from './users.js';
