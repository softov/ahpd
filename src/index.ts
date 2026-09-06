/**
 * The library.
 *
 * `ahpd` is a daemon you can run and a set of parts you can build your own
 * host out of. The parts are deliberately separable: `rpc` is JSON-RPC and
 * holds no socket, `listen` is the only file that knows which runtime it is
 * on, `createHost` is the protocol and imports no backend at all, and
 * `claude` is one backend that satisfies `Agent`.
 *
 * So another harness is another `Agent` handed to `createHost`, another
 * runtime is a case in `listen`, and neither is a fork. Anything that touches the
 * machine is the same shape again: `fileResources` reads files,
 * `shellTerminals` spawns shells and `gitBranches` spawns `git`, and all three
 * are passed to `createHost` rather than reached for by it. So the protocol
 * imports no runtime, and a host without one of them refuses the commands it
 * cannot answer instead of pretending to. `examples/` has a
 * backend written from nothing, which is the shortest description of what
 * `Agent` asks for.
 *
 * Every shape lives in `types/` and nothing there imports a runtime value, so
 * the contract can be read without loading any of this.
 */

export { createHost, ROOT } from './host.js';
export { listen } from './listen.js';
export {
  createPeer, receive, RpcError, RpcTimeout, RpcClosed, ANSWER_TIMEOUT,
  PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INTERNAL_ERROR,
} from './rpc.js';
export { gitBranches } from './git.js';
export { gitChanges } from './changes.js';
export { fileResources } from './resources.js';
export { shellTerminals } from './terminals.js';
export { hostTools } from './tools.js';
export { gitWorktrees, worktreesOf, worktreeFor } from './worktrees.js';
export { memoryAutomations } from './automations.js';
export { scheduledAutomations } from './scheduled.js';
export type { ScheduledOptions } from './scheduled.js';
export { claude } from './agents/claude.js';
export type { ClaudeOptions } from './agents/claude.js';
export { createSession } from './session.js';
export { catalogue, uriFor, idFor, idOf, Status } from './catalog.js';
export { turnsOf } from './transcript.js';
export { tail, older, PAGE } from './paging.js';
export { probe } from './probe.js';

export type * from './types/index.js';
