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
export { foldHostOptions, pluginHost, raise, routeOf, routePrefix, AGENT_CLASH, ROUTE_ROOT } from './plugins.js';
export { frozenCopy, deepFreeze } from './frozen.js';
export { readJson, readJsonObject, writeJsonAtomic } from './jsonfile.js';
export type { JsonRead, JsonObjectRead, JsonWriteOptions } from './jsonfile.js';
export type { FoldedOptions, HostRecording, ServedRoute } from './plugins.js';
export { sdkVersion } from './version.js';
export { listen, overStdio, runtime, serveRequests } from './listen.js';
export {
  createPeer, receive, RpcError, RpcTimeout, RpcClosed, ANSWER_TIMEOUT,
  PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INTERNAL_ERROR,
} from './rpc.js';
export { gitBranches } from './repo/git.js';
export { gitArgv } from './repo/hardened.js';
export { gitChanges } from './changes.js';
export { fileResources } from './resources.js';
export { localPath, uriOf } from './fileuri.js';
export { shellTerminals } from './terminals.js';
export { hostTools } from './tools/index.js';
export { toolServers, TOOLS_PREFIX } from './tools/server.js';
export type { RunClientTool, ToolsChanged, ToolsEndpoint, ToolsServerOptions, ToolsServers } from './tools/server.js';
export { createClientCalls, DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from './tools/clientcalls.js';
export type { ClientCall, ClientCallAnswer, ClientCalls, ClientCallsOptions } from './tools/clientcalls.js';
export { toMcpContent } from './tools/mcpcontent.js';
export { machineAsked, refuseComputer, computersFor, computerId, computerSource, machineRefusal, openComputer } from './computers.js';
export { nestedAgent } from './nested.js';
export type { NestedAsked, NestedHost, NestedOptions, NestedStarted } from './nested.js';
export { resolveNeeds, expandHome, partTarget, PART_ROOT } from './machine.js';
export type { NeedSources } from './machine.js';
export { sessionTools } from './tools/session.js';
export { artifactTools, ARTIFACTS_META } from './tools/artifacts.js';
export { gitWorktrees, worktreesOf, worktreeFor } from './repo/worktrees.js';
export { githubPullRequests } from './repo/github.js';
export { partsOf, SNAPSHOT_TAG } from './attachments.js';
export type { Part, PartOptions, PartSource } from './attachments.js';
export { memoryAutomations } from './automations.js';
export { scheduledAutomations } from './scheduled.js';
export { fileSessions, memorySessions, migrateSessions } from './sessions.js';
export type { FileSessionOptions } from './sessions.js';
export { fileUsage, usageProvider } from './usage.js';
export type { FileUsageOptions, UsageProvider, UsageProviderOptions } from './usage.js';
export { checkPolicy, filePolicies, memoryPolicies } from './policies.js';
export type { FilePoliciesOptions } from './policies.js';
export { bag, isRecord, ownerOf, reason, str, strings } from './values.js';
export { absentResource, asFile, bodyText, splitResource } from './records.js';
export { secretRef, scopeOf, readSecret } from './vault.js';
export type { SecretScope } from './vault.js';
export { decide } from './decide.js';
export type { Asked, Decision } from './decide.js';
export { fileUsers, signInRecord } from './users.js';
export type { FileUserOptions } from './users.js';
export { peopleProviders } from './people.js';
export type { PeopleProvider } from './people.js';
export { policyProviders } from './policy.js';
export type { PolicyProvider } from './policy.js';
export { covers, mayRead, membership, namesOf, poolsFor, scopeFor } from './scopes.js';
export type { Membership, Scope, ScopeAnswer } from './scopes.js';
export { githubIssuer, isIssuerUrl, issuerFrom, issuerKind, oidcIssuer } from './issuers.js';
export type { Fetcher, GitHubIssuerOptions, IssuerKind, OidcIssuerOptions } from './issuers.js';
export type { Issuer, IssuerAnswer } from './types/users.js';
export type { NestedRecord, SessionStore } from './types/sessions.js';
export type { ScheduledOptions } from './scheduled.js';
export { uriFor, idFor, idOf, Status } from './catalog.js';
export { tail, older, PAGE } from './paging.js';
export { callTimes, withCallTimes, startOf } from './timing.js';

export type * from './types/index.js';
