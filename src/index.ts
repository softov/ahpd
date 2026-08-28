/**
 * The library.
 *
 * `ahpd` is a daemon you can run and a set of parts you can build your own
 * host out of. The parts are deliberately separable: `rpc` is JSON-RPC and
 * holds no socket, `listen` is the only file that knows which runtime it is
 * on, `createHost` is the protocol and knows nothing about Claude, and
 * `createSession` is the Claude translation and knows nothing about the wire.
 *
 * So a different harness is a different `createSession`, a different runtime
 * is a case in `listen`, and neither has to be a fork.
 *
 * Every shape lives in `types/` and nothing there imports a runtime value, so
 * the contract can be read without loading any of this.
 */

export { createHost, ROOT } from './host.js';
export { listen } from './listen.js';
export {
  createPeer, receive, RpcError,
  PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INTERNAL_ERROR,
} from './rpc.js';
export { createSession } from './session.js';
export { catalogue, uriFor, idFor, idOf, Status } from './catalog.js';
export { turnsOf, tail, older, PAGE } from './transcript.js';
export { probe } from './probe.js';

export type * from './types/index.js';
