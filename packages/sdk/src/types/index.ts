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
export type { Emit, SessionOptions, Session, Ran, CommandTerminal, RunCommand, Chosen, MessageFrom, MessageAttachment, SubagentChat, SubagentRequest, HarnessPlanEntry, HarnessPlanChange, PlanUpdate, TurnOptions } from './session.js';
export type { HostOptions, Connection, Credential, Host, Diagnostics, HostTool, ToolCall, RootConfigPort, RootConfigAnswer } from './host.js';
export type { AnnouncedPlugin, CapturedPlugin, ClientPlugins, HeldCopies, SyncedPlugin, TemplatePlugin } from './clientplugins.js';
export type { Alert, InstallAnswer, ChannelHandle, ChannelSubscriber, ChatPreamble, OpenedChat, Loaded, LoaderContext, Plugin, PluginChannel, PluginConnects, PluginContext, PluginContracts, PluginHost, PluginLink, PluginManifest, PluginMethod, PluginPeer, PluginSpec, PluginStarts, Contribution, PortContribution, PortKey, PortOf, PublishOptions, Route, ServedChannel, ServedMethod, SessionRequest, TriggerTypeDefinition } from './plugin.js';
export type {
  AuthenticatedEvent, AutomationFireEvent, ClientConnectEvent, ClientDisconnectEvent, EventHandler, EventListener,
  EventName, HostEvent, HostEventOf, HostHandlers, InputNeededRemovedEvent, InputNeededSetEvent, ListeningEvent,
  LogEvent, MessageEvent, ResourceWriteEvent, SessionEndEvent, SessionOpenedEvent, SessionStartEvent,
  StoppingEvent, TerminalOpenEvent, UsersChangedEvent,
  ToolCallEvent, TurnEndEvent, TurnStartEvent, PlanUpdateEvent,
} from './events.js';
export type { Page } from './paging.js';
export type {
  Admission, Connected, Door, DoorOptions, OnConnect, Runtime, Listener, ListenOptions, NodeRequestListener, RequestHandler, RequestsListener, RequestsOptions, StdioOptions, Tap,
} from './listen.js';
export type { Account, Offered } from './probe.js';
export type { Agent, Listed, Start, BoundTool, Endpoint, ToolEffects, RestoredSubagent, SessionAt, McpServer, StdioMcpServer, HttpMcpServer } from './agent.js';
export type { DirectoryNeed, FileNeed, EnvNeed, CopyNeed, PartNeed, StateNeed, Seed, ResolvedSeed, StateMode, MachineNeed, NeedKind, ResolvedNeed } from './machine.js';
export type { Entry, Metadata, Read, ResourceChange, ResourceProvider, ResourceStore, SchemeDescription, Watcher, WatchOptions, Write } from './resources.js';
export type { BroughtBack, ComputerPort, MachineSource, NestedSpawn, Spawn, SpawnOptions } from './computers.js';
export type { ContainerConnect, ContainerConnectResult, ContainerPort, ContainerSink } from './containers.js';
export type { SessionConfigAnswerer, SessionConfigAsk } from './completions.js';
export type { Claim, Terminal, TerminalOptions, SpawnPty, TerminalStore, OpenTerminal, OpenedTerminal, StartTerminals, OutputTerminal, OutputTerminals, TerminalOutputs } from './terminals.js';
export type { BackgroundTask, BackgroundTaskKind, BackgroundTasks } from './background.js';
export type { GitDir, Worktree, Worktrees } from './worktrees.js';
export type { NewPullRequest, PullRequest, PullRequests } from './github.js';
export type { Automation, AutomationEntry, AutomationRun, AutomationStore, RunEnding, StartSession } from './automations.js';
export type { Grant, IssuerVerify, MintedToken, Named, Principal, Role, TokenRecord, UserFile, UserRecord, Users, Verb } from './users.js';
export type { ComputerTime, Cost, ModelCall, ModelUse, Owner, Usage, UsageBase, UsageEntry, UsageGroup, UsageKey, UsageTotal } from './usage.js';
export type {
  LimitPool, Measure, Period, Policies, Policy, PolicyEffect, PolicyKind, PolicyLimit, PolicyMatch, PolicyScope,
  PolicyValueType,
} from './policies.js';
export type { SecretRef, SecretWork, Vault } from './vault.js';
export type { CollectionOptions, RecordChange, RecordCollection, RecordStore, StoredRecord } from './records.js';
export type { AgentHealth, Engine, AgentOwner, AgentRecord, AgentState, AgentTemplate, AgentView, ServedEngine } from './agents.js';
export type {
  Adapter, CallOutcome, Capability, CapabilityType, CheckResult, Connector, ConnectorHealth, ConnectorOwner, ModelDialect,
  ModelPricing, ModelProvider, ProviderConnector, ProviderModel, ServedAdapter,
} from './connectors.js';
