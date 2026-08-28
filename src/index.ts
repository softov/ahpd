/**
 * The library.
 *
 * `ahpd` is a daemon you can run and a set of parts you can build your own
 * host out of. The parts are deliberately separable: `serve` is JSON-RPC over
 * a socket and knows nothing about agents, `createHost` is the protocol and
 * knows nothing about Claude, and `createSession` is the Claude translation
 * and knows nothing about the wire.
 *
 * So a different harness is a different `createSession`, and a different
 * transport is a different `serve`, and neither has to be a fork.
 */

export { createHost, ROOT } from './host.js';
export type { Host, HostOptions, Summary } from './host.js';

export { serve, RpcError, PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INTERNAL_ERROR } from './rpc.js';
export type { Peer, Request, Handler } from './rpc.js';

export { createSession } from './session.js';
export type { Session, SessionOptions, Emit } from './session.js';

export { catalogue, uriFor, idFor, idOf, Status } from './catalog.js';
export { turnsOf, tail, older, PAGE } from './transcript.js';
export type { Page } from './transcript.js';
export { probe } from './probe.js';
export type { Offered } from './probe.js';
