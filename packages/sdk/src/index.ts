/**
 * The host: the protocol, and the parts to build your own out of.
 *
 * There is no backend in here, and that is the point of it being its own
 * package. `rpc` is JSON-RPC and holds no socket, `listen` is the only file
 * that knows which runtime it is on, and `createHost` is the protocol and
 * imports nothing that runs an agent. A harness is an `Agent` handed to
 * `createHost` from outside - `@ahpd/agent-claude` is one, `examples/` has one
 * written from nothing - and adding another is not a fork of this.
 *
 * Anything that touches the machine is the same shape again: `fileResources`
 * reads files, `shellTerminals` spawns shells and `gitBranches` spawns `git`,
 * and all three are passed to `createHost` rather than reached for by it. So
 * the protocol imports no runtime, and a host without one of them refuses the
 * commands it cannot answer instead of pretending to.
 *
 * Every shape lives in `types/` and nothing there imports a runtime value, so
 * the contract can be read without loading any of this.
 *
 * A plugin contributes this same option object rather than a second kind of
 * thing: `foldHostOptions` composes several plugins' contributions into one
 * `HostOptions`, and `PluginHost` in `types/plugin.ts` is those options named
 * back.
 */

export { createHost, HOST_CLOSE_WAIT_MS, ROOT, refusalReason } from './host.js';
export { subagentChatUri } from './host/channels.js';
export { eachPreset, foldHostOptions, pluginHost, raise, routeOf, routePrefix, AGENT_CLASH, ROUTE_ROOT } from './plugins/plugins.js';
export { frozenCopy, deepFreeze } from './utils/frozen.js';
export { readJson, readJsonObject, writeJsonAtomic } from './utils/jsonfile.js';
export type { JsonRead, JsonObjectRead, JsonWriteOptions } from './utils/jsonfile.js';
export type { EachPresetOptions, FoldedOptions, HostRecording, ServedRoute } from './plugins/plugins.js';
export { sdkVersion } from './version.js';
export { installLine, knownAgents } from './machines/agents.js';
export type { AgentVariable, KnownAgent } from './machines/agents.js';
export { doorOf, listen, overStdio, plainAnswer, runtime, serveRequests } from './listen.js';
export {
  createPeer, receive, RpcError, RpcTimeout, RpcClosed, ANSWER_TIMEOUT,
  PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INTERNAL_ERROR,
} from './rpc.js';
export { gitBranches } from './repo/git.js';
export { gitArgv } from './repo/hardened.js';
export { gitChanges } from './sessions/changes.js';
export { fileResources } from './resources/resources.js';
export { localPath, uriOf } from './resources/fileuri.js';
export { clientPluginsIn } from './plugins/clientplugins.js';
export { shellTerminals } from './machines/terminals.js';
export { isShellName, shellEnvOf } from './machines/shellenv.js';
export type { ShellEnv } from './machines/shellenv.js';
export { hostTools } from './tools/index.js';
export { toolServers, TOOLS_PREFIX } from './tools/server.js';
export type { MayRunTool, RunClientTool, ToolsChanged, ToolsEndpoint, ToolsServerOptions, ToolsServers } from './tools/server.js';
export { createClientCalls, DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from './tools/clientcalls.js';
export type { ClientCall, ClientCallAnswer, ClientCalls, ClientCallsOptions } from './tools/clientcalls.js';
export { toMcpContent } from './tools/mcpcontent.js';
export { machineAsked, refuseComputer, computersFor, computerId, computerSource, machineRefusal, openComputer } from './machines/computers.js';
export { nestedAgent } from './sessions/nested.js';
export type { NestedAsked, NestedHost, NestedOptions, NestedStarted } from './sessions/nested.js';
export { resolveNeeds, expandHome, partTarget, PART_ROOT, machinePathOf, hostPathOf } from './machines/machine.js';
export type { NeedSources } from './machines/machine.js';
export { sessionTools, wakeupTool } from './tools/session.js';
export { fillWords } from './automations/wakemessage.js';
export { artifactTools, ARTIFACTS_META } from './tools/artifacts.js';
export { gitWorktrees, worktreesOf, worktreeFor } from './repo/worktrees.js';
export { githubPullRequests } from './repo/github.js';
export { partsOf, SNAPSHOT_TAG } from './resources/attachments.js';
export type { Part, PartOptions, PartSource } from './resources/attachments.js';
export { checkReferences, memoryAutomations, pluginTriggerTypes, RUN_HISTORY_LIMIT, sameOwnerOrHost } from './automations/automations.js';
export type { AutomationsOptions } from './automations/automations.js';
export type { CallOutcome, CheckResult, ConnectorHealth, ConnectorOwner, ConnectorRef, ModelDialect, ModelPricing, ModelProvider, ProviderConnector, ProviderModel } from './types/connectors.js';
export { MODEL_DIALECTS } from './types/connectors.js';
export { disableConditionsOf } from './automations/automations.js';
export { enablementKeyOf, memoryEnablement } from './plugins/enablement.js';
export type { EnablementStore, HeldDecisions, HeldEnablementStore } from './plugins/enablement.js';
export { nextOccurrence, parseCron } from './automations/cron.js';
export type { Cron } from './automations/cron.js';
export { fileSessions, memorySessions, migrateSessions } from './sessions/sessions.js';
export type { FileSessionOptions } from './sessions/sessions.js';
export { fileUsage, usageMethods, usageProvider } from './usage/usage.js';
export type { FileUsageOptions, UsageAnswers, UsageNamedGroup, UsagePeriods, UsagePool, UsageProvider, UsageProviderOptions } from './usage/usage.js';
export { checkPolicy, filePolicies, memoryPolicies } from './access/policies.js';
export type { FilePoliciesOptions } from './access/policies.js';
export { bag, currentOwner, isRecord, ownerFilter, ownerOf, ownerOfPrincipal, reason, str, strings } from './utils/values.js';
export { absentResource, asFile, bodyText, isRecordPath, isRecordSlug, memoryRecords, putRecord, RECORD_PATH, RECORD_SLUG, removeRecord, splitResource } from './resources/records.js';
export { secretRef, fromEnvRef, scopeOf, readSecret, readSecrets } from './access/vault.js';
export type { SecretScope } from './access/vault.js';
export { decide } from './access/decide.js';
export type { Asked, Decision } from './access/decide.js';
export { chargeFor, COUNTED, keysOf, limitsOf } from './usage/charge.js';
export type { Charge, ChargeOptions, ChargeRefusal, LimitFigure, LimitMember, PayOrder } from './usage/charge.js';
export { fileUsers, grantProblem, signInRecord } from './access/users.js';
export type { FileUserOptions } from './access/users.js';
export { tokenMethods } from './access/tokens.js';
export { peopleChannels, peopleProviders } from './access/people.js';
export type { PeopleChannels, PeopleProvider } from './access/people.js';
export { policyChannels, policyProviders } from './access/policy.js';
export type { PolicyChannels, PolicyLimits, PolicyProvider } from './access/policy.js';
export { recordsChannel, recordsDomain, recordsMethods, servedRecords } from './resources/recordschannel.js';
export type { RecordEntry, RecordsChannel, RecordsChannelOptions, RecordsDomain, RecordsSource, ServedRecords } from './resources/recordschannel.js';
export { connectorsChannel } from './connectors/channel.js';
export type { ConnectorsChannel, ConnectorsChannelOptions, ConnectorState } from './connectors/channel.js';
export { BINDINGS_KEY, BINDINGS_SCHEME, bindingTarget, bindingsOf, checkBindings } from './connectors/bindings.js';
export type { Binding } from './connectors/bindings.js';
export { actionTools, actionToolName } from './connectors/actions.js';
export type { ActionHost } from './connectors/actions.js';
export { adaptersChannel } from './connectors/adapters.js';
export type { AdaptersChannel, AdaptersChannelOptions } from './connectors/adapters.js';
export { checkIcons } from './plugins/validate.js';
export type { Icon } from '@microsoft/agent-host-protocol';
export { covers, mayRead, membership, namesOf, poolsFor, scopeFor } from './usage/scopes.js';
export type { Membership, Scope, ScopeAnswer } from './usage/scopes.js';
export { githubIssuer, isIssuerUrl, issuerFrom, issuerKind, oidcIssuer } from './access/issuers.js';
export type { Fetcher, GitHubIssuerOptions, IssuerKind, OidcIssuerOptions } from './access/issuers.js';
export type { Issuer, IssuerAnswer } from './types/users.js';
export type { CreatedBy, NestedRecord, RemoteOrigin, SessionStore, StoredChat, StoredWorktree } from './types/sessions.js';
export { uriFor, idFor, idOf, Status, statusOf, activityOf, titleFrom } from './sessions/catalog.js';
export type { Activity, StatusBits } from './sessions/catalog.js';
export { tail, older, PAGE } from './sessions/paging.js';
export { callTimes, withCallTimes, startOf } from './utils/timing.js';
export { CommandAutoApprover, DEFAULT_TERMINAL_AUTO_APPROVE_RULES, splitCommand } from './access/commandautoapprover.js';
export type {
  CommandApprovalOptions, CommandApprovalResult, CommandShell, CommandSplit, CommandSplitter,
  TerminalAutoApprovePatterns, TerminalAutoApproveRuleValue, TerminalAutoApproveRules,
} from './access/commandautoapprover.js';

export type * from './types/index.js';
