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
export type { Emit, SessionOptions, Session, Ran } from './session.js';
export type { HostOptions, Connection, Host } from './host.js';
export type { Page } from './paging.js';
export type { Connected, OnConnect, Runtime, Listener } from './listen.js';
export type { Offered } from './probe.js';
export type { Agent, Listed, Start } from './agent.js';
export type { Entry, Metadata, Read } from './resources.js';
export type { Claim, Terminal, TerminalOptions } from './terminals.js';
export type { Worktree, Worktrees } from './worktrees.js';
