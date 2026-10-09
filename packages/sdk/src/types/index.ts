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
export type { Emit, SessionOptions, Session, Ran, Chosen, MessageFrom, MessageAttachment, SubagentChat, SubagentRequest } from './session.js';
export type { HostOptions, Connection, Credential, Host, Diagnostics, HostTool, ToolCall, RootConfigPort, RootConfigAnswer } from './host.js';
export type { Loaded, Plugin, PluginContext, PluginHost, PluginSpec, PluginStarts, Contribution, PortContribution, PortKey, PortOf, Route, SessionRequest } from './plugin.js';
export type {
  AuthenticatedEvent, AutomationFireEvent, ClientConnectEvent, ClientDisconnectEvent, EventHandler, EventListener,
  EventName, HostEvent, HostEventOf, HostHandlers, InputNeededRemovedEvent, InputNeededSetEvent, ListeningEvent,
  LogEvent, MessageEvent, ResourceWriteEvent, SessionEndEvent, SessionStartEvent, StoppingEvent, TerminalOpenEvent,
  ToolCallEvent, TurnEndEvent, TurnStartEvent,
} from './events.js';
export type { Page } from './paging.js';
export type {
  Connected, OnConnect, Runtime, Listener, ListenOptions, NodeRequestListener, RequestHandler, RequestsListener, RequestsOptions, StdioOptions, Tap,
} from './listen.js';
export type { Offered } from './probe.js';
export type { Agent, Listed, Start, BoundTool, Endpoint, ToolEffects, RestoredSubagent, McpServer, StdioMcpServer, HttpMcpServer } from './agent.js';
export type { DirectoryNeed, FileNeed, EnvNeed, CopyNeed, PartNeed, StateNeed, Seed, ResolvedSeed, StateMode, MachineNeed, NeedKind, ResolvedNeed } from './machine.js';
export type { Entry, Metadata, Read, ResourceProvider, ResourceStore, SchemeDescription, Write } from './resources.js';
export type { BroughtBack, ComputerPort, MachineSource, NestedSpawn, Spawn, SpawnOptions } from './computers.js';
export type { ContainerConnect, ContainerConnectResult, ContainerPort, ContainerSink } from './containers.js';
export type { SessionConfigAnswerer, SessionConfigAsk } from './completions.js';
export type { Claim, Terminal, TerminalOptions, SpawnPty, TerminalStore, OpenTerminal, OpenedTerminal, StartTerminals } from './terminals.js';
export type { GitDir, Worktree, Worktrees } from './worktrees.js';
export type { NewPullRequest, PullRequest, PullRequests } from './github.js';
export type { Automation, AutomationRun, AutomationStore, RunEnding, StartSession } from './automations.js';
export type { Grant, Named, Principal, Role, UserFile, UserRecord, Users, Verb } from './users.js';
export type { ComputerTime, Cost, ModelCall, ModelUse, Owner, Usage, UsageBase, UsageEntry, UsageGroup, UsageKey, UsageTotal } from './usage.js';
export type {
  LimitPool, Measure, Period, Policies, Policy, PolicyEffect, PolicyKind, PolicyLimit, PolicyMatch, PolicyScope,
  PolicyValueType,
} from './policies.js';
export type { SecretRef, SecretWork, Vault } from './vault.js';
