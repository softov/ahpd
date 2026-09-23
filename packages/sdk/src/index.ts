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

export { createHost, ROOT } from './host.js';
export { foldHostOptions, pluginHost, AGENT_CLASH } from './plugins.js';
export type { FoldedOptions, HostRecording } from './plugins.js';
export { sdkVersion } from './version.js';
export { listen, runtime } from './listen.js';
export {
  createPeer, receive, RpcError, RpcTimeout, RpcClosed, ANSWER_TIMEOUT,
  PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INTERNAL_ERROR,
} from './rpc.js';
export { gitBranches } from './git.js';
export { gitChanges } from './changes.js';
export { fileResources } from './resources.js';
export { shellTerminals } from './terminals.js';
export { hostTools } from './tools.js';
export { sessionTools } from './sessiontools.js';
export { artifactTools, ARTIFACTS_META } from './artifacttools.js';
export { gitWorktrees, worktreesOf, worktreeFor } from './worktrees.js';
export { githubPullRequests } from './github.js';
export { memoryAutomations } from './automations.js';
export { scheduledAutomations } from './scheduled.js';
export { fileSessions, memorySessions } from './sessions.js';
export type { FileSessionOptions } from './sessions.js';
export { fileUsers, signInRecord } from './users.js';
export type { FileUserOptions } from './users.js';
export { githubIssuer, oidcIssuer } from './issuers.js';
export type { Fetcher, GitHubIssuerOptions, OidcIssuerOptions } from './issuers.js';
export type { Issuer } from './types/users.js';
export type { SessionStore } from './types/sessions.js';
export type { ScheduledOptions } from './scheduled.js';
export { uriFor, idFor, idOf, Status } from './catalog.js';
export { tail, older, PAGE } from './paging.js';

export type * from './types/index.js';
