/**
 * Every shape this daemon speaks.
 *
 * Nothing under `types/` imports a runtime value, so the contract can be read
 * without loading the server, a socket or the agent SDK.
 */

export type { Bag } from './common.js';
export type { Request, Wire, Peer, Handler } from './rpc.js';
export type { Summary } from './catalog.js';
export type { Emit, SessionOptions, Session } from './session.js';
export type { HostOptions, Connection, Host } from './host.js';
export type { Page } from './transcript.js';
export type { Connected, OnConnect, Runtime, Listener } from './listen.js';
export type { Offered } from './probe.js';
export type { Agent, Listed, Start } from './agent.js';
